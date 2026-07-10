// ============================================================
//  通知サービス
//  - Web Push API を使い、家族・介護者の端末へプッシュ通知を送信
//  - 送信ログを notification_logs に記録
//  - service_role 権限（supabaseAdmin）を使用するためRLSの影響を受けない
// ============================================================
const webpush = require('web-push');
const { supabaseAdmin } = require('../supabase/supabase');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (err) {
    console.warn('[notificationService] VAPID鍵の設定に失敗しました。プッシュ通知は無効になります。', err.message);
  }
} else {
  console.warn('[notificationService] VAPID鍵が未設定のため、プッシュ通知は送信されません。');
}

const NOTIFICATION_MESSAGES = {
  medication_reminder: { title: 'お薬の時間です', body: 'お薬を服用する時間になりました。' },
  medication_taken: { title: '服薬完了のお知らせ', body: 'お薬を服用したことが記録されました。' },
  medication_missed: { title: '飲み忘れの可能性があります', body: '予定の時間にお薬の記録が確認できませんでした。' },
  video_recorded: { title: '服薬映像が記録されました', body: '服薬の様子を映像で確認できます。' },
};

// 患者本人のケアグループに所属する家族・介護者へ通知を送信する
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

  const message = NOTIFICATION_MESSAGES[type] || { title: '通知', body: 'お薬手帳からのお知らせです。' };

  // 対象ユーザーのプッシュサブスクリプションを取得
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('*')
    .in('user_id', targetUserIds);

  if (subErr) throw subErr;

  let sentCount = 0;
  if (vapidConfigured && subs && subs.length > 0) {
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_key },
            },
            JSON.stringify({ title: message.title, body: message.body, logId, type })
          );
          sentCount += 1;
        } catch (err) {
          // 410/404はサブスクリプション失効。DBから削除してクリーンアップ。
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
          } else {
            console.error('[notificationService] 送信失敗:', sub.id, err.message);
          }
        }
      })
    );
  }

  // 送信ログを記録（送信できたかどうかに関わらず、対象者リストとして記録する）
  await supabaseAdmin.from('notification_logs').insert({
    group_id: groupIds[0] || null,
    log_id: logId || null,
    type,
    sent_to_user_ids: targetUserIds,
  });

  return { sent: sentCount, targeted: targetUserIds.length };
}

module.exports = { notifyCareGroup, vapidConfigured, VAPID_PUBLIC_KEY };
