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
const { supabaseAdmin } = require('../lib/supabase');
const { notifyCareGroup, vapidConfigured } = require('./notificationService');

const DAY_MS = 24 * 60 * 60 * 1000;
const MISSED_THRESHOLD_MINUTES = 30; // この分数を過ぎても未服薬なら「飲み忘れ」とみなす

function todayDateString(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC基準。実運用ではJSTタイムゾーン考慮を推奨)
}

function buildScheduledAt(dateStr, timeStr) {
  // scheduled_time は 'HH:MM:SS' 形式
  return new Date(`${dateStr}T${timeStr}`);
}

// 1. 本日分のスケジュールに対応するログをまだ持っていない患者分を作成する
async function ensureTodayLogs() {
  const today = todayDateString();
  const dow = new Date().getDay(); // 0=日曜

  const { data: schedules, error } = await supabaseAdmin
    .from('medication_schedules')
    .select('id, patient_id, scheduled_time, days_of_week, is_active')
    .eq('is_active', true);

  if (error) {
    console.error('[cron] スケジュール取得エラー:', error);
    return;
  }

  const todaySchedules = (schedules || []).filter((s) => (s.days_of_week || []).includes(dow));
  if (todaySchedules.length === 0) return;

  for (const schedule of todaySchedules) {
    const scheduledAt = buildScheduledAt(today, schedule.scheduled_time);

    const { data: existing, error: existErr } = await supabaseAdmin
      .from('medication_logs')
      .select('id')
      .eq('schedule_id', schedule.id)
      .eq('scheduled_at', scheduledAt.toISOString())
      .maybeSingle();

    if (existErr) {
      console.error('[cron] 既存ログ確認エラー:', existErr);
      continue;
    }
    if (existing) continue;

    const { error: insertErr } = await supabaseAdmin.from('medication_logs').insert({
      schedule_id: schedule.id,
      patient_id: schedule.patient_id,
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
    });

    if (insertErr) console.error('[cron] ログ生成エラー:', insertErr);
  }
}

// 2. リマインド時刻（scheduled_time の reminder_minutes 分前）になった患者へ通知
async function sendDueReminders() {
  if (!vapidConfigured) return;

  const now = new Date();
  const today = todayDateString(now);

  const { data: pendingLogs, error } = await supabaseAdmin
    .from('medication_logs')
    .select('id, scheduled_at, patient_id, medication_schedules(reminder_minutes, medications(name))')
    .eq('status', 'pending')
    .gte('scheduled_at', `${today}T00:00:00`)
    .lte('scheduled_at', `${today}T23:59:59`);

  if (error) {
    console.error('[cron] リマインド対象取得エラー:', error);
    return;
  }

  for (const log of pendingLogs || []) {
    const reminderMinutes = log.medication_schedules?.reminder_minutes ?? 5;
    const scheduledAt = new Date(log.scheduled_at);
    const reminderAt = new Date(scheduledAt.getTime() - reminderMinutes * 60 * 1000);

    // cronは1分間隔なので、現在時刻がリマインド時刻の±30秒以内なら送信対象とする
    const diffSec = Math.abs(now.getTime() - reminderAt.getTime()) / 1000;
    if (diffSec > 30) continue;

    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', log.patient_id);

    const medName = log.medication_schedules?.medications?.name || 'お薬';

    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({
            title: 'お薬の時間です',
            body: `まもなく「${medName}」を服用する時間です。`,
            logId: log.id,
            type: 'medication_reminder',
          })
        );
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
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
    .select('id, patient_id, scheduled_at, status')
    .eq('status', 'pending')
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
