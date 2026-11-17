-- ============================================================
--  0007_ネイティブ版（Android アプリ）のプッシュ通知（FCM）
--  実行場所: Supabase ダッシュボード > SQL Editor
--  （0001 → 0002 → 0003 → 0004 → 0005 → 0006 の後に実行してください）
-- ============================================================
--
--  背景:
--    ネイティブ版（Capacitor の Android アプリ）の画面は WebView で表示しており、
--    WebView は Web Push に対応していない。そのため、ネイティブ版を使う家族（見守る側）には
--    「飲み忘れ」などのお知らせが届かなかった。
--    ネイティブ版では Firebase Cloud Messaging（FCM）で通知を届ける。
--
--  このマイグレーションで行うこと:
--    1. push_subscriptions に kind 列を追加する
--       ・'webpush' … ブラウザ（Web 版・PWA）の Web Push。これまでの行はすべてこちら
--       ・'fcm'     … ネイティブ版の FCM。端末ごとの宛先（FCM のトークン）を endpoint 列に入れる
--    2. Web Push だけで使う p256dh・auth_key を、FCM の行では空でよいようにする
--       （Web Push の行では、これまでどおり必須）
--
--  endpoint 列に FCM のトークンを入れるので、既存の UNIQUE (user_id, endpoint)
--  （同じ端末の二重登録を防ぐ）と RLS（自分の端末だけ操作できる）は、そのまま FCM にも効く。
--  何度実行しても同じ結果になるように書いてある。
-- ============================================================

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'webpush';

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_kind_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_kind_check CHECK (kind IN ('webpush', 'fcm'));

ALTER TABLE public.push_subscriptions
  ALTER COLUMN p256dh   DROP NOT NULL,
  ALTER COLUMN auth_key DROP NOT NULL;

-- Web Push の行は、暗号化キーが無いと送れないため、これまでどおり必須にする
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_webpush_keys_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_webpush_keys_check
  CHECK (kind <> 'webpush' OR (p256dh IS NOT NULL AND auth_key IS NOT NULL));

COMMENT ON TABLE  public.push_subscriptions          IS 'プッシュ通知の宛先（端末ごとに1行）。Web Push とネイティブ版の FCM の両方を保存する';
COMMENT ON COLUMN public.push_subscriptions.kind     IS '''webpush''（ブラウザ）または ''fcm''（ネイティブ版の Android アプリ）';
COMMENT ON COLUMN public.push_subscriptions.endpoint IS 'Web Push の endpoint の URL、または FCM のトークン';
COMMENT ON COLUMN public.push_subscriptions.p256dh   IS 'ECDH 公開鍵（ブラウザが生成）。Web Push のときだけ使う';
COMMENT ON COLUMN public.push_subscriptions.auth_key IS '認証シークレット（ブラウザが生成）。Web Push のときだけ使う';
