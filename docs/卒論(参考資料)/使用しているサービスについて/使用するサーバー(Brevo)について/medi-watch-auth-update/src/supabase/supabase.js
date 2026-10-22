// ============================================================
//  Supabase クライアント初期化
//  - supabaseAdmin: service_role キー使用（RLSをバイパス、サーバー専用処理用）
//  - createAuthClient: 認証処理（サインアップ／ログイン／確認コード等）用。
//                      リクエストごとに新しく作る
//  - createUserClient: ユーザーのアクセストークンでRLSを適用したクライアントを生成
// ============================================================
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabase] 環境変数が不足しています。.env を確認してください（SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY）。'
  );
}

const SERVER_AUTH_OPTIONS = { autoRefreshToken: false, persistSession: false };

// サーバー内部の特権処理用（通知送信、cronジョブなど）。RLSを無視するため取り扱い注意。
//
// ★ このクライアントで auth.signInWithPassword / refreshSession / verifyOtp などを
//    呼んではいけない。supabase-js はクライアント内にセッションを保持すると、
//    以後のDB操作をそのユーザーの権限で行うため、cron や通知処理が
//    「最後に操作したユーザー」の権限で動いてしまう。
//    （auth.getUser(token) と auth.admin.* はセッションを保持しないので使ってよい）
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: SERVER_AUTH_OPTIONS,
});

// 認証処理用のクライアントを、リクエストごとに新しく作る。
// 共有インスタンスを使い回すと、あるユーザーのセッションがクライアント内に残り、
// 同時に来た別ユーザーのリクエストと混ざる恐れがあるため。
function createAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: SERVER_AUTH_OPTIONS });
}

function createUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: SERVER_AUTH_OPTIONS,
  });
}

module.exports = { supabaseAdmin, createAuthClient, createUserClient };
