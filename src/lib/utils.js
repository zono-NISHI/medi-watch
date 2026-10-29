// ============================================================
//  共通ユーティリティ
// ============================================================

// 非同期ルートハンドラのエラーを自動でnext()に渡すラッパー
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 使う機能（見守る／見守られる）の設定に反する操作を、DBのトリガー（0005）が止めたときの返し方。
// DBは ERRCODE 'P0001' と、HINT の識別子で知らせてくる。
const WATCH_FEATURE_ERRORS = {
  WATCH_DISABLED: {
    status: 403,
    error: '「家族を見守る」機能を使わない設定になっています。マイページの「使う機能」で変更できます。',
  },
  TARGET_NOT_WATCHABLE: {
    status: 403,
    error: 'このご家族は「見守ってもらう」機能を使っていないため、見守りを始められません。',
  },
  BE_WATCHED_DISABLED: {
    status: 403,
    error: '「家族に見守ってもらう」機能を使わない設定になっています。マイページの「使う機能」で変更できます。',
  },
  STILL_WATCHING: {
    status: 409,
    error: '見守っているご家族がいるため、「家族を見守る」をやめられません。先に「見守り」画面で見守りをやめてください。',
  },
  STILL_WATCHED: {
    status: 409,
    error: 'あなたを見守っているご家族がいるため、「家族に見守ってもらう」をやめられません。先に「見守り」画面で見守りを外してください。',
  },
};

// Supabaseのエラーをまとめて返すヘルパー
function sendSupabaseError(res, error, fallbackMessage = '処理中にエラーが発生しました。') {
  console.error('[supabase error]', error);

  const pgCode = String(error?.code ?? '');

  const featureError = pgCode === 'P0001' && WATCH_FEATURE_ERRORS[error?.hint];
  if (featureError) {
    return res.status(featureError.status).json({ code: error.hint, error: featureError.error });
  }

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
