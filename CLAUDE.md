# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 運用ルール（必ず守ること）
- 回答は常に日本語で行う。
- コマンド実行の確認時に表示する説明文（ツール呼び出しの description など）も日本語で書く。
- ブランチ運用: 作業は必ず `feature/xxxx` ブランチで行い、`develop` へPRを出してマージする。`main` はアプリ完成時に `develop` からマージする予定のため、それまでは `main` への直接のコミット・push・マージは行わない。
- デプロイ: Render。`develop` へのマージで自動デプロイされる（つまり develop へのマージ＝本番反映）。
- メール送信: Brevo を使用（Supabase Auth の SMTP 経由。テンプレートは `src/supabase/templates/`）。
- `docs/` の資料は卒論の参考資料であり、実装の根拠には使わない。仕様・挙動はソースコードとマイグレーションを正とする（`docs/` 内の README は古い記述を含む）。

## 作業の進め方（毎回この手順で行う）
1. 最新の `develop` から新しいブランチを切る: `git fetch origin` → `git checkout -b feature/NNNN origin/develop`。`NNNN` は既存の `feature/NNNN`（4桁の連番。ローカル・リモートの両方を確認する）の最大値 + 1 にする。
2. 作業が終わったらコミットして `git push -u origin feature/NNNN` する。
3. `gh` は使えないので、PR は作成しない。代わりに次の2つをユーザーに渡す。
   - develop 向けの PR を作成する URL: `https://github.com/zono-NISHI/medi-watch/compare/develop...feature/NNNN?expand=1`
   - PR のタイトルと説明文（日本語。説明文には「変更の概要」「変更した理由」「確認・テストした内容」の3つの見出しを付ける）
4. マージは行わない。PR の作成とマージはユーザーがブラウザで行う。

## 概要
medi-watch は電子お薬手帳の Web アプリ（PWA）。患者が服薬を記録し（映像つきも可）、家族にプッシュ通知が届く。1つの Express サーバーが API と静的フロントエンドを同一オリジンで配信する。画面の文言・コードコメント・エラーメッセージは日本語で書かれているので、その方針を守る。

## コマンド
- `npm install`
- `npm run dev`: `node --watch server.js`（変更時に自動再起動）
- `npm start`: 本番用の起動
- アプリ: http://localhost:3000 ／ ヘルスチェック: `GET /api/health`
- テストランナー・リンター・ビルド工程はない。フロントは素のファイルをそのまま配信している。動作確認はサーバーを起動してブラウザで行う。`POST /api/push/test` を使うと、cron を待たずにログイン中の本人の端末へテスト通知を送れる。
- VAPID 鍵の生成: `npx web-push generate-vapid-keys`
- 初期設定: `.env.example` を `.env` にコピーする。`DEBUG_AUTH=true` にすると、本番以外で認証の詳細ログが出る。
- カメラ・プッシュ通知・Service Worker は HTTPS か `localhost` でのみ動く。

## アーキテクチャ

### バックエンド（`server.js`, `src/`）
- `server.js` は `/api/{auth,care-groups,medications,schedules,logs,push}` をマウントし、`public/` を静的配信して、待ち受け開始後に `startReminderCron()` を呼ぶ。Helmet の CSP は意図的に無効にしている（jsQR の CDN とカメラを使うため）。Morgan は `verify-email.html` / `reset-password.html` のクエリ文字列を伏せて記録する（使い捨てトークンが含まれるため）。
- `src/supabase/supabase.js` は3種類のクライアントを提供する。**必ず用途どおりに使い分けること:**
  - `supabaseAdmin`（service_role、RLS をバイパス）: cron・通知処理、`auth.getUser(token)` / `auth.admin.*` 用。このクライアントで `signInWithPassword` / `refreshSession` / `verifyOtp` を**絶対に**呼ばない。そのユーザーのセッションが残り、以後の admin のクエリがすべてそのユーザーの権限で動いてしまう。
  - `createAuthClient()`: リクエストごとに新しく作る anon クライアント。サインアップ／ログイン／OTP／リフレッシュの処理はすべてこれを使う（`src/routes/auth.js`）。
  - `createUserClient(token)`: ユーザー権限で RLS が適用される。`requireAuth`（`src/middleware/auth.js`）がこれを `req.supabase` として、`req.user`・`req.accessToken` と一緒に付与する。ルートのハンドラは `req.supabase` 経由でクエリし、アクセス制御を RLS に任せる。
- ルートの書き方: ハンドラを `asyncHandler` で包み、DB エラーは `sendSupabaseError(res, error, '日本語メッセージ')`（`src/lib/utils.js`）で返す。この関数が PG のエラーコードを HTTP ステータスと `code` に変換する。エラーのレスポンスは `{ code?, error: '<そのまま利用者に見せてよい日本語>' }` の形で、フロントは文言ではなく `code` で分岐する。
- `src/services/reminderCron.js` は node-cron で毎分、Web プロセス内で動く。処理順は、有効なスケジュールから今日の `pending` の `medication_logs` を作成 → 患者へリマインド通知 → `scheduled_at` から30分過ぎても pending のままのログについて家族へ「飲み忘れ」通知（`notification_logs` で二重送信を防ぐ）。**日付・時刻はすべて JST（`+09:00`）で扱う。** Render などのサーバーは UTC で動くため。
- `src/services/notificationService.js` が Web Push を送信する（`notifyCareGroup`, `vapidConfigured`）。`src/services/jahisParser.js` は薬局の JAHIS 形式の QR コードを解析する。

### データベース（`src/supabase/migrations/`）
- マイグレーションツールは使っていない。番号つきの各 `.sql` を Supabase の SQL Editor に貼り付けて、番号順（0001 → 0002 → …）に実行する。スキーマ変更は次の番号のファイルとして追加し、既存ファイルと同じヘッダーコメント（目的・実行場所・前提となるマイグレーション）を付ける。
- テーブル: `profiles`, `care_groups`, `care_group_members`, `medications`, `medication_schedules`, `medication_logs`, `push_subscriptions`, `notification_logs`。服薬映像は Storage バケット `medication-videos` に保存する。
- RLS の権限判定は `SECURITY DEFINER` のヘルパー関数（`is_group_member`, `can_view_patient`, `can_view_patient_video` など。0003 で追加）にまとめている。ポリシー同士が互いのテーブルを参照して再帰する問題（42P17）を避けるため。新しいポリシーも同じ方式で追加し、互いのテーブルを参照するポリシーは書かない。
- 0004（相互見守り）: 1つのアカウントが「見守る側」と「見守られる側」の両方になれる。`profiles.role` で表示する画面を分けることはもうしない。1人が持てる見守りグループ（招待コード）は1つまで。見守り相手の一覧は RPC の `list_my_watchers` / `list_my_watching` で取得する。
- `src/supabase/templates/*.html` は Supabase Auth のメールテンプレート（ダッシュボードで設定する）。

### フロントエンド（`public/`）
- バンドラーもモジュールも使わない、素の JS によるマルチページ構成。各 HTML は通常の `<script>` タグで、まず `js/config.js`（`window.APP_CONFIG`）→ `js/api.js` を読み込む。ログイン後の画面はその後に `js/ui.js` →（`home`・`mypage` は `js/push.js`）→ `js/pages/<page>.js` を読み込む。認証系の画面（`login` / `signup` / `verify-email` / `reset-password`）は `js/validate.js` → `js/ui.js` を読み込み、画面の処理は HTML 内のインラインスクリプトに書かれている。共通処理はグローバル変数としてページから参照されるため、読み込み順が重要。
- `api.js`: `Session`（localStorage のキー `okusuri_techo_session`）、`ApiError`（`code`/`status`/`field`）、fetch のラッパー。`/api/auth/refresh` でアクセストークンを自動更新する。更新処理は1つだけ実行して共有するため、同時に複数のリクエストがあってもリフレッシュトークンを使い切らない。
- `ui.js`: トースト、`handleApiError`、`requireLoginOrRedirect`、ナビゲーション。
- `sw.js` は `public/` の直下に置いたままにする。アプリ全体をスコープに含めるため。
- 高齢の利用者を想定しているので、平易で丁寧な日本語の文言と、大きく分かりやすい UI を優先する。
