// ============================================================
//  共通ユーティリティ
// ============================================================

// 非同期ルートハンドラのエラーを自動でnext()に渡すラッパー
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Supabaseのエラーをまとめて返すヘルパー
function sendSupabaseError(res, error, fallbackMessage = '処理中にエラーが発生しました。') {
  console.error('[supabase error]', error);
  return res.status(400).json({ error: error?.message || fallbackMessage });
}

module.exports = { asyncHandler, sendSupabaseError };
