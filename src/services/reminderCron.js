// ============================================================
//  服薬リマインダー cron ジョブ
//  1分ごとに実行し、以下を行う:
//   1. 本日分のスケジュールに対応する medication_logs が無ければ生成（pending）
//   2. reminder_minutes 後に scheduled_time を迎える患者本人へプッシュ通知
//   3. scheduled_time を過ぎても 'pending' のままのログは 'medication_missed' として
//      家族へ通知（簡易的に scheduled_time + 30分経過で判定）
//
//  ※ service_role 権限の supabaseAdmin を使うため、RLSの影響を受けず全患者を横断処理する。
// ============================================================
const cron = require('node-cron');
const webpush = require('web-push');
const { supabaseAdmin } = require('../supabase/supabase');
const { notifyCareGroup, vapidConfigured } = require('./notificationService');
const { JST_OFFSET, jstToday, buildScheduledAt } = require('../lib/jst');

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSED_THRESHOLD_MINUTES = 30; // この分数を過ぎても未服薬なら「飲み忘れ」とみなす

// 1. 本日分のスケジュールに対応するログをまだ持っていない患者分を作成する
async function ensureTodayLogs() {
  const { dateStr: today, dow } = jstToday();

  const { data: schedules, error } = await supabaseAdmin
    .from('medication_schedules')
    .select('id, patient_id, scheduled_time, days_of_week, is_active, updated_at')
    .eq('is_active', true);

  if (error) {
    console.error('[cron] スケジュール取得エラー:', error);
    return;
  }

  const todaySchedules = (schedules || []).filter((s) => (s.days_of_week || []).includes(dow));
  if (todaySchedules.length === 0) return;

  for (const schedule of todaySchedules) {
    const scheduledAt = buildScheduledAt(today, schedule.scheduled_time);

    // 今日の服薬時刻を過ぎてから登録・変更されたスケジュールは、今日の分を作らない
    // （作るとすぐに家族へ「飲み忘れ」が届いてしまうため。明日から記録する）
    if (new Date(schedule.updated_at) > scheduledAt) continue;

    // 1つのスケジュールにつき1日1件。時刻を変えた日に、変更前の時刻の記録（服薬済みなど）が
    // あれば新しい時刻の分は作らない（同じ日に2回飲むことになってしまうため）
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('medication_logs')
      .select('id')
      .eq('schedule_id', schedule.id)
      .gte('scheduled_at', `${today}T00:00:00${JST_OFFSET}`)
      .lte('scheduled_at', `${today}T23:59:59${JST_OFFSET}`)
      .limit(1);

    if (existErr) {
      console.error('[cron] 既存ログ確認エラー:', existErr);
      continue;
    }
    if (existing && existing.length > 0) continue;

    const { error: insertErr } = await supabaseAdmin.from('medication_logs').insert({
      schedule_id: schedule.id,
      patient_id: schedule.patient_id,
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
    });

    if (insertErr) console.error('[cron] ログ生成エラー:', insertErr);
  }
}

// 2. リマインド時刻（scheduled_time の reminder_minutes 分前）を過ぎた患者へ通知
//    「±30秒以内」だけを対象にすると、Render のスリープや cron の遅れで1分飛んだだけで
//    通知が永久に送られなくなる。そこで「リマインド時刻を過ぎていて、服薬時刻 + 30分より前で、
//    まだ送っていない」ものを送る。送信済みかどうかは notification_logs で判定する。
async function sendDueReminders() {
  if (!vapidConfigured) {
    console.warn('[cron] VAPID 鍵が未設定のため、リマインドを送れません。');
    return;
  }

  const now = new Date();
  const { dateStr: today } = jstToday(now);

  const { data: pendingLogs, error } = await supabaseAdmin
    .from('medication_logs')
    .select('id, scheduled_at, patient_id, medication_schedules!inner(reminder_minutes, medications(name))')
    .eq('status', 'pending')
    .eq('medication_schedules.is_active', true) // 削除・停止した薬の記録には通知しない
    .gte('scheduled_at', `${today}T00:00:00${JST_OFFSET}`)
    .lte('scheduled_at', `${today}T23:59:59${JST_OFFSET}`);

  if (error) {
    console.error('[cron] リマインド対象取得エラー:', error);
    return;
  }

  const dueLogs = (pendingLogs || []).filter((log) => {
    const reminderMinutes = log.medication_schedules?.reminder_minutes ?? 5;
    const scheduledAt = new Date(log.scheduled_at).getTime();
    const reminderAt = scheduledAt - reminderMinutes * 60 * 1000;
    const expireAt = scheduledAt + MISSED_THRESHOLD_MINUTES * 60 * 1000;
    return now.getTime() >= reminderAt && now.getTime() < expireAt;
  });
  if (dueLogs.length === 0) return;

  // 送信済みのリマインドを除く
  const { data: alreadySent, error: sentErr } = await supabaseAdmin
    .from('notification_logs')
    .select('log_id')
    .eq('type', 'medication_reminder')
    .in('log_id', dueLogs.map((l) => l.id));
  if (sentErr) {
    console.error('[cron] 送信済みリマインド確認エラー:', sentErr);
    return;
  }
  const sentSet = new Set((alreadySent || []).map((n) => n.log_id));

  for (const log of dueLogs) {
    if (sentSet.has(log.id)) continue;

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', log.patient_id);

    // 端末が未登録なら記録せず次回また確認する（途中で通知を有効にした場合に間に合うように）
    if (!subs || subs.length === 0) {
      console.log('[cron] リマインド対象だが端末が未登録:', log.id);
      continue;
    }

    const medName = log.medication_schedules?.medications?.name || 'お薬';
    let sentCount = 0;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({
            title: 'お薬の時間です',
            body: `まもなく「${medName}」を服用する時間です。`,
            logId: log.id,
            type: 'medication_reminder',
          }),
          { TTL: 30 * 60, urgency: 'high' } // 端末がオフラインでも30分間は配送を試みる
        );
        sentCount += 1;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('[cron] リマインド送信失敗:', sub.id, err.statusCode, err.body || err.message);
        }
      }
    }

    console.log(`[cron] リマインド送信: log=${log.id} 成功 ${sentCount}/${subs.length}`);
    // 1回でも送れたら記録する（同じ予定へ毎分送らないため）
    if (sentCount > 0) {
      await supabaseAdmin.from('notification_logs').insert({
        log_id: log.id,
        type: 'medication_reminder',
        sent_to_user_ids: [log.patient_id],
      });
    }
  }
}

// 3. 服薬予定時刻を一定時間過ぎても 'pending' のままのログを「飲み忘れ」として家族へ通知
//    同じログに毎分重複通知しないよう、notification_logs に既送信記録がないかを確認する。
async function notifyMissedDoses() {
  const now = new Date();
  const thresholdTime = new Date(now.getTime() - MISSED_THRESHOLD_MINUTES * 60 * 1000);

  const { data: overdueLogs, error } = await supabaseAdmin
    .from('medication_logs')
    .select('id, patient_id, scheduled_at, status, medication_schedules!inner(is_active)')
    .eq('status', 'pending')
    .eq('medication_schedules.is_active', true) // 削除・停止した薬の記録には通知しない
    .lte('scheduled_at', thresholdTime.toISOString())
    .gte('scheduled_at', new Date(now.getTime() - DAY_MS).toISOString());

  if (error) {
    console.error('[cron] 飲み忘れ対象取得エラー:', error);
    return;
  }
  if (!overdueLogs || overdueLogs.length === 0) return;

  const logIds = overdueLogs.map((l) => l.id);
  const { data: alreadyNotified, error: notifErr } = await supabaseAdmin
    .from('notification_logs')
    .select('log_id')
    .eq('type', 'medication_missed')
    .in('log_id', logIds);

  if (notifErr) {
    console.error('[cron] 通知済みログ確認エラー:', notifErr);
    return;
  }
  const notifiedSet = new Set((alreadyNotified || []).map((n) => n.log_id));

  for (const log of overdueLogs) {
    if (notifiedSet.has(log.id)) continue; // 既に飲み忘れ通知済みならスキップ
    try {
      // ステータスを skipped にせず、'pending' のまま家族にだけ通知する
      // （患者が後から「飲んだ」を押せるようにするため）
      await notifyCareGroup({ patientId: log.patient_id, logId: log.id, type: 'medication_missed' });
    } catch (err) {
      console.error('[cron] 飲み忘れ通知エラー:', err);
    }
  }
}

function startReminderCron() {
  // 毎分実行
  cron.schedule('* * * * *', async () => {
    try {
      await ensureTodayLogs();
      await sendDueReminders();
      await notifyMissedDoses();
    } catch (err) {
      console.error('[cron] 実行エラー:', err);
    }
  });
  console.log('[cron] 服薬リマインダーcronジョブを起動しました（毎分実行）。');
}

module.exports = { startReminderCron };
