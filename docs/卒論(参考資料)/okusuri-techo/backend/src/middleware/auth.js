// ============================================================
//  認証ミドルウェア
//  Authorization: Bearer <access_token> を検証し、
//  req.user / req.supabase（ユーザー権限のSupabaseクライアント）をセットする
// ============================================================
const { createUserClient, supabaseAdmin } = require('../lib/supabase');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'ログインが必要です。' });
    }

    // service_role クライアントでトークンを検証し、ユーザー情報を取得
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'セッションが無効です。再度ログインしてください。' });
    }

    req.user = data.user;
    req.accessToken = token;
    // 以後のDB操作はこのクライアントを使うことで、RLSがユーザー権限で評価される
    req.supabase = createUserClient(token);

    next();
  } catch (err) {
    console.error('[auth] 検証エラー:', err);
    res.status(500).json({ error: '認証処理中にエラーが発生しました。' });
  }
}

module.exports = { requireAuth };
