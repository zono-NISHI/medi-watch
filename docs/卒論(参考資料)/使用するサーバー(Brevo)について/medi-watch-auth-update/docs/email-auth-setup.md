# メール認証・ログイン維持・パスワード再設定　作業手順

対象：medi-watch（Express + Supabase Auth + Brevo SMTP）

作業は **A → B → C → D → E** の順に進める。
ダッシュボードの項目名は、Supabase・Brevo の画面の版によって多少異なることがある。

---

## A. コードの反映（最初に行う）

1. 作業用ブランチを作る（例：`git checkout -b feature/0014`）。
2. 配布した zip をプロジェクトのルート（`package.json` がある場所）に展開し、上書きする。
3. `public/js/config.js` の `MAIL_FROM` に、送信元アドレスを入れる（B-3 で Brevo に登録する送信元アドレス。C-3 の Sender email とも同じ値にする）。

   ```js
   MAIL_FROM: 'no-reply@あなたのドメイン',
   ```

4. 新しい npm パッケージや環境変数の追加はない。`npm run dev` で起動できることを確認する。
5. コミットする。

### 変更・追加したファイル

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| 変更 | `src/supabase/supabase.js` | 認証用クライアントを**リクエストごとに作る** `createAuthClient()` を追加。`supabaseAnon` は廃止 |
| 変更 | `src/routes/auth.js` | リンク（token_hash）での確認、パスワード再設定API、セッション更新の修正、ログアウト時のトークン無効化 |
| 変更 | `server.js` | メール内リンクのトークンをアクセスログに残さない |
| 変更 | `public/js/api.js` | **アクセストークンの自動更新**（約1時間ごとのログアウトを解消） |
| 変更 | `public/js/config.js` | `MAIL_FROM`（送信元アドレスの表示用） |
| 変更 | `public/js/ui.js` | 送信元アドレス表示、URL からトークンを取り出して消す処理 |
| 変更 | `public/signup.html` | 登録後に確認画面へ進む |
| 変更 | `public/login.html` | 未確認なら確認画面へ案内、「パスワードを忘れた方」リンク |
| 変更 | `public/css/auth.css` | 確認画面・再設定画面の見た目 |
| 追加 | `public/verify-email.html` | メール確認（メールのボタンから／確認コード入力） |
| 追加 | `public/reset-password.html` | パスワード再設定（メール送信 → 確認 → 新しいパスワード） |
| 追加 | `src/supabase/templates/confirm-signup.html` | Supabase に貼る「Confirm sign up」メール本文 |
| 追加 | `src/supabase/templates/reset-password.html` | Supabase に貼る「Reset password」メール本文 |

---

## B. Brevo の設定

1. **Settings → Automations → Transactional emails → Tracking**
   「Anonymous email tracking」を **Yes** にして **Save**。
2. **Settings → Senders, domains, IPs → Domains**
   送信に使うドメインを追加し、表示される DNS レコード（SPF・DKIM・DMARC）をドメインの DNS に登録して、認証済みにする。
   携帯会社のメール（docomo・au・SoftBank）に届きやすくするために重要。
3. **Settings → Senders, domains, IPs → Senders**
   送信元アドレス（例：`no-reply@あなたのドメイン`）を登録する。
4. **Settings → SMTP & API → SMTP** の値を控える（Server・Port・Login・SMTP キー）。
   キーの値を控えていなければ「Generate SMTP key」で作り直す。
5. 同じ画面の「Activate for SMTP keys」（未許可IPのブロック）は **有効にしない**。

---

## C. Supabase の設定

1. **Authentication → URL Configuration**
   - **Site URL**：本番の URL（例：`https://medi-watch.onrender.com`）。**末尾に `/` を付けない。**
     メールのボタンのリンク先はこの URL になる。
2. **Authentication → Sign In / Providers → Email**
   - **Confirm email**：ON
   - **Email OTP Expiration**：`3600`（1時間。変える場合はメール本文の「1時間」も直す）
3. **Authentication → Emails → SMTP Settings**
   - Enable custom SMTP：ON
   - Sender email：B-3 のアドレス　／　Sender name：`電子お薬手帳`
   - Host：`smtp-relay.brevo.com`　／　Port：`587`
   - Username：Brevo の Login　／　Password：Brevo の SMTP キー
4. **Authentication → Emails → Templates → Confirm sign up**
   - Subject：`【電子お薬手帳】メールアドレスの確認をお願いします`
   - Body：`src/supabase/templates/confirm-signup.html` の **コメントの下の `<div>` 以下すべて**
5. **Authentication → Emails → Templates → Reset password**
   - Subject：`【電子お薬手帳】パスワードの再設定`
   - Body：`src/supabase/templates/reset-password.html` の `<div>` 以下すべて
6. **Authentication → Rate Limits**
   - メール送信数（1時間あたり）を、Brevo のプランの送信上限の範囲で余裕のある値にする。

---

## D. デプロイ

1. ブランチを push し、develop へマージ → Render に反映。
2. Render の環境変数は変更不要。
3. デプロイ後、`/api/health` が `{"status":"ok"}` を返すことを確認。

---

## E. 動作確認チェックリスト

実際のメールアドレスで、**Gmail と、可能なら携帯会社のメール**の両方で試す。

### 新規登録・メール確認
- [ ] 新規登録 → 確認画面に進み、登録したアドレスが表示される
- [ ] メールが届く（件名・送信元・ボタン・6桁コードが正しい）
- [ ] メールの「確認を完了する」→ 開いたページで「確認を完了する」を押す → ホームに進む
- [ ] 同じボタンをもう一度使う →「このボタンは、もう使えません」と、ログイン／送り直しの案内が出る
- [ ] 別の登録で、6桁コード入力（全角数字でも可）→ ホームに進む
- [ ] 間違ったコード → エラーが出る
- [ ] 「確認のメールをもう一度送る」→ 60秒のカウントダウン、新しいメールが届く
- [ ] 確認前にログイン → 確認画面に案内される

### ログイン状態の維持
- [ ] ログインしたまま **1時間以上** 放置 → 画面操作・通知タップでログイン画面に戻らない
- [ ] 開発者ツールで `localStorage` の `okusuri_techo_session` の `refresh_token` が更新されている
- [ ] ログアウト → 再度ホームを開くとログイン画面になる

### パスワード再設定
- [ ] ログイン画面「パスワードを忘れた方はこちら」→ 入力済みのアドレスが引き継がれる
- [ ] メールの「パスワードを決め直す」→ ボタン → 新しいパスワード → ホームに進む
- [ ] 新しいパスワードでログインできる
- [ ] 6桁コードでも同じように再設定できる
- [ ] 今と同じパスワードを入れる →「今までと同じです」と案内され、ホームへ進める

### ローカル開発での注意
メールのボタンは Site URL（本番）を開く。ローカル（`localhost:3000`）で試すときは、
**6桁コードの入力で確認する**か、一時的に Site URL を `http://localhost:3000` に変える（終わったら戻す）。

---

## トラブルシューティング

| 症状 | 確認する場所 |
| --- | --- |
| メールが届かない | Supabase **Authentication → Logs** に `Error sending ... email` が出ていないか（出ていれば SMTP 設定・送信元の認証） |
| Brevo 側で送信されたか | Brevo **Transactional → Logs**（または Statistics） |
| 「続けて送ることはできません」 | 同じアドレスへは60秒に1回まで（Supabase の既定） |
| ボタンのリンク先が 404 | Site URL の末尾に `/` が付いていないか、本番に `verify-email.html` がデプロイされているか |
| 登録やログインが「しばらくできません」になる | 全利用者が Render サーバーの IP で数えられるため、Supabase の IP ごとの制限に達した可能性。利用者が増えたら Rate Limits の見直しや IP 転送（`Sb-Forwarded-For`）を検討 |

---

## 設計上の注意（今後の開発で守ること）

- **`supabaseAdmin` で `auth.signInWithPassword` / `refreshSession` / `verifyOtp` などを呼ばない。**
  supabase-js はクライアント内にセッションを保持すると、以後の DB 操作をそのユーザーの権限で行う。
  cron や通知処理が「最後に操作したユーザー」の権限で動いてしまう。認証処理は `createAuthClient()` を使う。
  （`auth.getUser(token)` と `auth.admin.*` はセッションを保持しないので使ってよい）
- `PUT /api/auth/password` は現在のパスワードを確認しない。マイページに「パスワード変更」を作る場合は、現在のパスワードの確認を追加する。
- メール本文に、ユーザーが自由入力した値（名前など）を差し込まない。
