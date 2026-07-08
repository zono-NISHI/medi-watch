// ============================================================
//  アプリ設定
//  バックエンドAPIのURLとSupabaseのpublic設定をここにまとめる
// ============================================================
window.APP_CONFIG = {
  // バックエンドAPIのベースURL（開発時はlocalhost、本番はデプロイ先URLに変更）
  API_BASE_URL: 'http://localhost:3000/api',

  // Supabase（フロントから直接 Auth セッション維持や Realtime に使う場合のみ必要）
  SUPABASE_URL: 'https://wkbzgpxjtswzbxyapmlr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_itaNkkTX1T3ANaKqqZmz7w_B5u0NV-y',
};
