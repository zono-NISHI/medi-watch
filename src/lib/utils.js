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

  const pgCode = String(error?.code ?? '');

  // サーバー側の設定不備・内部エラー（ポリシー再帰、権限設定漏れ など）
  if (pgCode.startsWith('42') || pgCode.startsWith('XX')) {
    return res.status(500).json({
      code: 'SERVER_CONFIG_ERROR',
      error: 'ただいまデータを取得できません。しばらくたってからお試しください。',
    });
  }

  // 参照権限なし
  if (pgCode === '42501') {
    return res.status(403).json({ code: 'FORBIDDEN', error: '閲覧する権限がありません。' });
  }

  // 一意制約違反など、入力起因のもの
  if (pgCode === '23505') {
    return res.status(409).json({ code: 'CONFLICT', error: 'すでに登録されています。' });
  }

  return res.status(400).json({ code: 'BAD_REQUEST', error: fallbackMessage });
}

module.exports = { asyncHandler, sendSupabaseError };
