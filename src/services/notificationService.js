// ============================================================
//  通知サービス
//  - 家族・介護者の端末へプッシュ通知を送信する
//    ・ブラウザ（Web 版・PWA）… Web Push（web-push）
//    ・ネイティブ版（Android アプリ）… Firebase Cloud Messaging（firebase-admin）
//      （アプリの画面の WebView は Web Push に対応していないため）
//  - 送信ログを notification_logs に記録
//  - service_role 権限（supabaseAdmin）を使用するためRLSの影響を受けない
// ============================================================
const webpush = require('web-push');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { supabaseAdmin } = require('../supabase/supabase');

const JST_OFFSET_MS = 9 * 60 * 60 * 1000; // 通知の本文に、予定の時刻を日本時間で入れるため

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (err) {
    console.warn('[notificationService] VAPID鍵の設定に失敗しました。Web Push は無効になります。', err.message);
  }
} else {
  console.warn('[notificationService] VAPID鍵が未設定のため、Web Push は送信されません。');
}

// ネイティブ版へ送るための Firebase のサービスアカウントの鍵。
// Render の環境変数 FIREBASE_SERVICE_ACCOUNT に、Firebase コンソールでダウンロードした JSON の中身をそのまま入れる
// （貼り付けにくい場合に備えて、JSON を Base64 にした値も受け付ける）。
function parseServiceAccount(raw) {
  const text = raw.trim();
  return JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8'));
}

let fcmMessaging = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const app = initializeApp({ credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    fcmMessaging = getMessaging(app);
  } catch (err) {
    // 鍵の中身はログに出さない（秘密の値のため）
    console.warn('[notificationService] Firebase の鍵の読み込みに失敗しました。アプリへの通知は無効になります。', err.message);
  }
} else {
  console.warn('[notificationService] FIREBASE_SERVICE_ACCOUNT が未設定のため、アプリ（ネイティブ版）への通知は送信されません。');
}
const fcmConfigured = !!fcmMessaging;

// FCM で、この宛先（トークン）がもう使えないことを表すエラー。アプリの削除・データの消去などで起きる
const FCM_GONE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// アプリ側（public/js/push.js）で作る通知チャンネル。重要度「高」で、画面の上に表示する
const FCM_CHANNEL_ID = 'family_notice';

// 宛先の種類ごとに、送る仕組みが用意できているか
function canSend(sub) {
  return sub.kind === 'fcm' ? fcmConfigured : vapidConfigured;
}

// 1台の端末へ送る。
// 戻り値: { ok, status, message, gone }（gone … 宛先が無効になっており、DB から消すべき）
async function sendToSubscription(sub, payload, { ttlSeconds = 24 * 60 * 60 } = {}) {
  if (!canSend(sub)) {
    return {
      ok: false,
      status: null,
      message: sub.kind === 'fcm' ? 'サーバーに Firebase の鍵が設定されていません。' : 'サーバーに VAPID 鍵が設定されていません。',
      gone: false,
    };
  }

  if (sub.kind === 'fcm') {
    // data の値は文字列でなければならない。通知をタップしたときに開く画面を決めるのに使う（push.js）
    const data = {};
    for (const key of ['type', 'logId', 'patientId', 'url']) {
      if (payload[key] != null) data[key] = String(payload[key]);
    }
    try {
      await fcmMessaging.send({
        token: sub.endpoint,
        notification: { title: payload.title, body: payload.body },
        data,
        android: {
          // 省電力状態（Doze）でも後回しにされないよう high にする（Web Push の urgency: 'high' と同じ考え方）
          priority: 'high',
          ttl: ttlSeconds * 1000,
          notification: { channelId: FCM_CHANNEL_ID, sound: 'default' },
        },
      });
      return { ok: true, status: 200, message: '', gone: false };
    } catch (err) {
      return {
        ok: false,
        status: err.code || null,
        message: String(err.message).slice(0, 200),
        gone: FCM_GONE_CODES.has(err.code),
      };
    }
  }

  try {
    const r = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      JSON.stringify(payload),
      // 省電力状態（Android の Doze など）でも後回しにされないよう、urgency を high にする。
      // TTL：端末がオフラインの間だけ保持し、古くなったお知らせが何日も後に届かないようにする。
      { TTL: ttlSeconds, urgency: 'high' }
    );
    return { ok: true, status: r.statusCode, message: '', gone: false };
  } catch (err) {
    // 410/404はサブスクリプション失効
    return {
      ok: false,
      status: err.statusCode || null,
      message: String(err.body || err.message).slice(0, 200),
      gone: err.statusCode === 410 || err.statusCode === 404,
    };
  }
}

// 家族宛ての通知には「誰の」お知らせかを必ず入れる。
// 1つのアカウントで自分の服薬と家族の見守りを両方行うため、
// 名前が無いと自分のことか家族のことか区別できない。
// 文言は、サーバーが知っている事実だけを伝える。
// ・記録が無いとき（medication_missed）は「飲み忘れ」と決めつけない。本人がアラームの「あとで」で
//   先延ばしにしている場合や、飲んだのに記録し忘れている場合もあり、サーバーにはその区別がつかないため。
// ・スキップ（medication_skipped）は本人が選んだことなので、飲み忘れとは分け、
//   アプリ内の表示（ボタン「今回はスキップする」、記録の「スキップ」）と同じ言葉で伝える。
// 通知はお薬 1 つにつき 1 通にし、どのお薬のお知らせかを本文に入れる（med … 「08:00の「ロキソニン」」）。
// 同じ時刻のお薬を 1 通にまとめると、どのお薬を飲んだのか・どのお薬の映像を見られるのかが分からなかったため。
// 本文はお薬の名前から始める（誰のお知らせかは見出しにあり、通知欄で折りたたまれていても 1 行目で見分けられるように）。
function buildMessage(type, patientName, med) {
  const who = patientName ? `${patientName}さん` : 'ご家族';
  const what = med || 'お薬';
  switch (type) {
    case 'medication_reminder':
      return { title: 'お薬の時間です', body: 'お薬を服用する時間になりました。' };
    case 'medication_taken':
      return { title: `服薬完了：${who}`, body: `${what}を服用したことが記録されました。` };
    case 'medication_missed':
      return { title: `まだお薬の記録がありません：${who}`, body: `${what}は、予定の時間を過ぎましたが、まだ記録がありません。` };
    case 'medication_skipped':
      return { title: `スキップ：${who}`, body: `${what}を、今回はスキップしました。` };
    case 'video_recorded':
      return { title: `服薬映像：${who}`, body: `${what}を服用する様子を、映像で確認できます。` };
    default:
      return { title: '通知', body: 'お薬手帳からのお知らせです。' };
  }
}

async function getProfileName(userId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[notificationService] 名前の取得に失敗:', error.message);
    return null;
  }
  return data?.name || null;
}

// 記録（medication_logs）のお薬を、通知の本文に入れる言い方にする（例: 08:00の「ロキソニン」）。
// 取得できないときは null（本文は「お薬」になる）
async function getLogMedLabel(logId) {
  if (!logId) return null;
  const { data, error } = await supabaseAdmin
    .from('medication_logs')
    .select('scheduled_at, medication_schedules(medications(name))')
    .eq('id', logId)
    .maybeSingle();
  if (error) {
    console.warn('[notificationService] お薬の名前の取得に失敗:', error.message);
    return null;
  }
  if (!data) return null;
  const name = data.medication_schedules?.medications?.name || 'お薬';
  // 予定の時刻は日本時間で出す（サーバーは UTC で動くため）
  const time = data.scheduled_at
    ? new Date(new Date(data.scheduled_at).getTime() + JST_OFFSET_MS).toISOString().slice(11, 16)
    : '';
  return `${time ? `${time}の` : ''}「${name}」`;
}

// 指定したユーザーの全端末へプッシュ通知を送り、送れた台数を返す
async function sendToUsers(userIds, payload) {
  if (!userIds || userIds.length === 0) return 0;

  const { data: subs, error: subErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (subErr) throw subErr;
  // 送る仕組み（VAPID 鍵・Firebase の鍵）が用意できている種類の端末だけに送る
  const targets = (subs || []).filter(canSend);
  if (targets.length === 0) return 0;

  let sentCount = 0;
  await Promise.all(
    targets.map(async (sub) => {
      const r = await sendToSubscription(sub, payload);
      if (r.ok) {
        sentCount += 1;
      } else if (r.gone) {
        // 宛先が無効になっている（ブラウザの購読の失効・アプリの削除など）。DBから削除してクリーンアップ。
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('[notificationService] 送信失敗:', sub.id, sub.kind, r.status, r.message);
      }
    })
  );
  return sentCount;
}

// 見守られている本人が「見守りを外す」を押したとき、外された人（見守っていた人）へ知らせる。
// 何も知らせないと、見守っていた人は急に相手の情報が見られなくなり、不具合や異変と誤解しやすい。
// 外された人はもう相手の情報を見られないため、patientId は送らず、タップで見守り画面を開く。
// notification_logs の type はCHECK制約で服薬関連に限られているため、ここでは記録しない。
async function notifyWatchRemoved({ removedUserId, patientId }) {
  const patientName = await getProfileName(patientId);
  const who = patientName ? `${patientName}さん` : '見守っていたご家族';
  return sendToUsers([removedUserId], {
    title: `見守りが終了しました：${who}`,
    body: `${who}が、あなたによる見守りを外しました。今後は${who}のお薬の様子を見られません。`,
    type: 'watch_removed',
    url: 'family.html',
  });
}

// 患者本人のケアグループに所属する家族・介護者へ通知を送信する（記録 1 つ＝お薬 1 つにつき 1 通）。
// logId は通知に入れて送り、タップしたときに、ホームでそのお薬のカードを示すのに使う（push.js・sw.js）
async function notifyCareGroup({ patientId, logId, type }) {
  // 患者のケアグループを取得
  const { data: groups, error: groupErr } = await supabaseAdmin
    .from('care_groups')
    .select('id')
    .eq('patient_id', patientId);

  if (groupErr) throw groupErr;
  if (!groups || groups.length === 0) return { sent: 0 };

  const groupIds = groups.map((g) => g.id);

  // 各グループのメンバー（家族・介護者）を取得
  // video_recorded 通知は can_view_video=true のメンバーのみへ送る
  let memberQuery = supabaseAdmin
    .from('care_group_members')
    .select('user_id, can_view_video, group_id')
    .in('group_id', groupIds);

  const { data: members, error: memberErr } = await memberQuery;
  if (memberErr) throw memberErr;

  const targetUserIds = (members || [])
    .filter((m) => (type === 'video_recorded' ? m.can_view_video : true))
    .map((m) => m.user_id);

  if (targetUserIds.length === 0) return { sent: 0 };

  // 見守られている本人が、自分の家族を見守る側として通知を受け取ることはない
  // （自分のグループには参加できない）が、念のため送信先から除外しておく
  const recipients = targetUserIds.filter((id) => id !== patientId);
  if (recipients.length === 0) return { sent: 0 };

  const [patientName, medLabel] = await Promise.all([getProfileName(patientId), getLogMedLabel(logId)]);
  const message = buildMessage(type, patientName, medLabel);

  const sentCount = await sendToUsers(recipients, {
    title: message.title,
    body: message.body,
    logId,
    type,
    patientId,
  });

  // 送信ログを記録（送信できたかどうかに関わらず、対象者リストとして記録する）
  await supabaseAdmin.from('notification_logs').insert({
    group_id: groupIds[0] || null,
    log_id: logId || null,
    type,
    sent_to_user_ids: recipients,
  });

  return { sent: sentCount, targeted: recipients.length };
}

module.exports = {
  notifyCareGroup,
  notifyWatchRemoved,
  sendToSubscription,
  vapidConfigured,
  fcmConfigured,
  VAPID_PUBLIC_KEY,
};
