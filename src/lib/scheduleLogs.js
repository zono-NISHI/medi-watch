// ============================================================
//  スケジュールの登録・変更に合わせて、今日の服薬記録（medication_logs）をそろえる
//  今日の記録は通常 cron（1分ごと）が作るが、それを待つと「記録」タブに出るまで
//  時間差ができる。また時刻を変えた場合、古い時刻の「未記録」が残ると
//  飲み忘れ通知の対象になってしまう。そのため登録・変更の直後にここで整える。
// ============================================================
const { JST_OFFSET, jstToday, buildScheduledAt } = require('./jst');

// 今日の分の記録をもう作らなくてよいか
// logs: そのスケジュールの今日の記録 [{ status, scheduled_at }]
//  - 服薬済み・スキップがある → 作らない（同じ日に2回飲むことになってしまうため）
//  - 同じ予定時刻の記録がある → 作らない（二重にできないように）
//  - 変更前の時刻の「飲み忘れ」（過ぎた未記録）だけ → 新しい時刻の分を作る（今日の分はまだ飲んでいないため）
function hasTodayLog(logs, scheduledAt) {
  return (logs || []).some(
    (l) => l.status !== 'pending' || new Date(l.scheduled_at).getTime() === scheduledAt.getTime()
  );
}

// supabase: 呼び出し元の権限のクライアント（ルートでは req.supabase）
// schedule: { id, patient_id, scheduled_time, days_of_week, is_active }
// 失敗しても登録・変更そのものは成功させたいので、エラーはログに出すだけにする
// （作り損ねた記録は cron が後で作る）
async function syncTodayLog(supabase, schedule) {
  const now = new Date();
  const { dateStr, dow } = jstToday(now);
  const dayStart = `${dateStr}T00:00:00${JST_OFFSET}`;
  const dayEnd = `${dateStr}T23:59:59${JST_OFFSET}`;
  const scheduledAt = buildScheduledAt(dateStr, schedule.scheduled_time);
  const appliesToday = schedule.is_active !== false && (schedule.days_of_week || []).includes(dow);

  // 今日のこれからの「未記録」のうち、今の設定と合わないもの（変更前の時刻・止めた予定）を消す
  // 服薬済み・スキップ・飲み忘れ（時刻を過ぎた未記録）は履歴なので残す（お薬の削除と同じ扱い）
  let staleQuery = supabase
    .from('medication_logs')
    .delete()
    .eq('schedule_id', schedule.id)
    .eq('status', 'pending')
    .gt('scheduled_at', now.toISOString())
    .lte('scheduled_at', dayEnd);
  if (appliesToday) staleQuery = staleQuery.neq('scheduled_at', scheduledAt.toISOString());
  const { error: deleteErr } = await staleQuery;
  if (deleteErr) console.error('[scheduleLogs] 古い未記録の削除エラー:', deleteErr);

  // 時刻がもう過ぎている予定は作らない（作るとすぐに家族へ「飲み忘れ」が届いてしまう）
  if (!appliesToday || scheduledAt < now) return;

  const { data: existing, error: existErr } = await supabase
    .from('medication_logs')
    .select('status, scheduled_at')
    .eq('schedule_id', schedule.id)
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd);
  if (existErr) {
    console.error('[scheduleLogs] 今日の記録の確認エラー:', existErr);
    return;
  }
  if (hasTodayLog(existing, scheduledAt)) return;

  const { error: insertErr } = await supabase.from('medication_logs').insert({
    schedule_id: schedule.id,
    patient_id: schedule.patient_id,
    scheduled_at: scheduledAt.toISOString(),
    status: 'pending',
  });
  if (insertErr) console.error('[scheduleLogs] 今日の記録の作成エラー:', insertErr);
}

module.exports = { syncTodayLog, hasTodayLog };
