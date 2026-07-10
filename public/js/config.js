// ============================================================
//  アプリ設定
//  バックエンドAPIのURLとSupabaseのpublic設定をここにまとめる
// ============================================================
window.APP_CONFIG = {
  // バックエンドAPIのベースURL（'/api' と書いておけば、ローカルでもRenderでも自動的に正しいURLになるので、デプロイ時に書き換える必要がない）
  API_BASE_URL: '/api', 

  // Supabase（フロントから直接 Auth セッション維持や Realtime に使う場合のみ必要）
  SUPABASE_URL: 'https://wkbzgpxjtswzbxyapmlr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_itaNkkTX1T3ANaKqqZmz7w_B5u0NV-y',
};
