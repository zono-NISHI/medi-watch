// ============================================================
//  Supabase クライアント初期化
//  - supabaseAdmin: service_role キー使用（RLSをバイパス、サーバー専用処理用）
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

// サーバー内部の特権処理用（通知送信、cronジョブなど）。RLSを無視するため取り扱い注意。
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 認証処理（サインアップ／ログイン）用。anonキーを使うことで、
// Supabase Auth が想定する通常のクライアント経路で処理される。
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function createUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

module.exports = { supabaseAdmin, supabaseAnon, createUserClient };
