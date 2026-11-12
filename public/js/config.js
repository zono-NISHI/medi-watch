// ============================================================
//  アプリ設定
//  バックエンドAPIのURLとSupabaseのpublic設定をここにまとめる
// ============================================================

// ネイティブ版（mobile/ の Android アプリ）の中で動いているか。
// アプリの中では Capacitor が、ページのスクリプトより先に window.Capacitor を用意する。
const IS_NATIVE_APP = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());

// ネイティブ版がつなぐサーバー（Render の本番 URL。末尾に / を付けない）。
// アプリの画面はスマホの中（https://localhost）から開くため、'/api' ではサーバーに届かない。
const NATIVE_SERVER_ORIGIN = 'https://medi-watch.onrender.com';

window.APP_CONFIG = {
  IS_NATIVE_APP,

  // バックエンドAPIのベースURL（Web 版は '/api' と書いておけば、ローカルでもRenderでも自動的に正しいURLになるので、デプロイ時に書き換える必要がない）
  API_BASE_URL: IS_NATIVE_APP ? `${NATIVE_SERVER_ORIGIN}/api` : '/api',

  // Supabase（フロントから直接 Auth セッション維持や Realtime に使う場合のみ必要）
  SUPABASE_URL: 'https://wkbzgpxjtswzbxyapmlr.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_itaNkkTX1T3ANaKqqZmz7w_B5u0NV-y',

  // 確認メール・パスワード再設定メールの送信元アドレス（画面の「届かないときは」に表示する）。
  // Supabase の SMTP Settings の Sender email と同じ値にする。空文字なら表示しない。
  MAIL_FROM: '',
};
