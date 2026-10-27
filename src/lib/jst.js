// ============================================================
//  日本時間（JST）での日付計算
//  Render などのサーバーは UTC で動くため、new Date() の日付・曜日・時刻をそのまま使うと
//  9時間ずれる（例：8:00 の予定が 17:00 に通知される／朝 0〜9 時は前日扱いになる）。
//  服薬時刻は利用者が日本時間で入力したものなので、必ず JST として扱う。
// ============================================================
const JST_OFFSET = '+09:00';
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// JST での今日の日付（YYYY-MM-DD）と曜日（0=日曜）
function jstToday(now = new Date()) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return { dateStr: jst.toISOString().slice(0, 10), dow: jst.getUTCDay() };
}

function buildScheduledAt(dateStr, timeStr) {
  // scheduled_time は 'HH:MM:SS' 形式。日本時間として解釈する。
  return new Date(`${dateStr}T${timeStr}${JST_OFFSET}`);
}

module.exports = { JST_OFFSET, jstToday, buildScheduledAt };
