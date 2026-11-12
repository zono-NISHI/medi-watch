// ============================================================
//  同じお薬に、同じ服薬時刻のスケジュールを2つ登録させないための確認
//  同じ時刻が2つあると、cron がその日の記録を2件作り、リマインド通知・アラーム・
//  家族への「飲み忘れ」通知も2回ずつになる。本人も同じ薬を2回飲んでよいのか迷ってしまう。
//  食前・食後の違いだけでは別の予定とみなさない（同じ時刻に同じ薬を2回飲むことになるため）。
// ============================================================

// DB の TIME（'08:00:00'）と画面の入力（'08:00'）を同じ形にそろえる
function toHHMM(time) {
  return String(time || '').slice(0, 5);
}

// times の中で2回以上出てくる最初の時刻（'HH:MM'）。重複がなければ null
function findDuplicateTime(times) {
  const seen = new Set();
  for (const t of times) {
    const hhmm = toHHMM(t);
    if (seen.has(hhmm)) return hhmm;
    seen.add(hhmm);
  }
  return null;
}

// 重複していたときに返す内容（フロントは code で判断する）
function duplicateTimeError(hhmm) {
  return {
    code: 'DUPLICATE_SCHEDULE_TIME',
    error: `同じお薬に、${hhmm} の服薬時刻が2つあります。同じ時刻は1つにまとめてください。`,
  };
}

// 同じお薬の、停止していないスケジュールのうち、同じ時刻のものがあるか
// excludeId: 変更中のスケジュール自身は数えない
async function hasActiveScheduleAt(supabase, medicationId, time, excludeId = null) {
  const { data, error } = await supabase
    .from('medication_schedules')
    .select('id, scheduled_time')
    .eq('medication_id', medicationId)
    .eq('is_active', true);
  if (error) return { error };
  const found = (data || []).some((s) => s.id !== excludeId && toHHMM(s.scheduled_time) === toHHMM(time));
  return { found };
}

module.exports = { toHHMM, findDuplicateTime, duplicateTimeError, hasActiveScheduleAt };
