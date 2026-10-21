# メール認証・ログイン維持・パスワード再設定　作業手順（独自ドメインなし版）

対象：medi-watch（Express + Supabase Auth + Brevo SMTP）
前提：**独自ドメインは取得せず、Gmail アドレスを送信元にする**（卒業論文の個人開発・発表用）

作業は **A → B → C → D → E** の順に進める。
ダッシュボードの項目名は、Supabase・Brevo の画面の版によって多少異なることがある。

---

## この構成でのメールの扱い（先に理解しておくこと）

- Gmail などの無料メールのドメインは、Brevo で**認証できない**。そのため Brevo は、送信時に差出人アドレスのドメイン部分を **Brevo のドメイン（`@brevosend.com` など）に置き換えて**送る。
- メールはきちんと届くが、受信者には**見慣れない差出人**に見え、**迷惑メールフォルダに入りやすい**。
- 送信元には、個人で普段使うアドレスではなく、**このアプリ専用に作った Gmail**（例：`a.sendemail7@gmail.com`）を使う。

---

## A. コードの反映（最初に行う）

1. 作業用ブランチを作る（例：`git checkout -b feature/0014`）。
2. 配布した zip（`medi-watch-auth-update.zip`）をプロジェクトのルート（`package.json` がある場所）に展開し、上書きする。
   - zip の中身は外枠のフォルダがなく、`server.js`・`src`・`public`・`docs` がそのまま入っている。
   - Windows の「すべて展開」は既定で `medi-watch-auth-update` フォルダを新しく作るので、その場合はフォルダの**中身**をルートにコピーして上書きする。
   - 一緒に配布した `medi-watch-auth-update.patch` は、変更内容を確認するための差分ファイル。zip で上書きするなら使わなくてよい。
     zip の代わりに `git apply --ignore-whitespace medi-watch-auth-update.patch` で適用することもできるが、元のソース（今回の変更を何も適用していない状態）にしか適用できない。**zip と patch の両方を適用しないこと。**
3. `public/js/config.js` の `MAIL_FROM` は **空文字（`''`）のまま**にする。

   ```js
   MAIL_FROM: '',
   ```

   理由：独自ドメインがない構成では、実際に届くメールの差出人が Brevo によって置き換えられる。
   画面に Gmail アドレスを「送信元」と表示すると、届いたメールの差出人と一致せず、かえって利用者を混乱させるため。
   （空文字にすると、確認画面・再設定画面の「送信元：〜」の行は表示されない）
4. 新しい npm パッケージや環境変数の追加はない。`npm run dev` で起動できることを確認する。
5. コミットする。

### 変更・追加したファイル

| 種別 | ファイル | 内容 |
| --- | --- | --- |
| 変更 | `src/supabase/supabase.js` | 認証用クライアントを**リクエストごとに作る** `createAuthClient()` を追加。`supabaseAnon` は廃止 |
| 変更 | `src/routes/auth.js` | リンク（token_hash）での確認、パスワード再設定API、セッション更新の修正、ログアウト時のトークン無効化 |
| 変更 | `server.js` | メール内リンクのトークンをアクセスログに残さない |
| 変更 | `public/js/api.js` | **アクセストークンの自動更新**（約1時間ごとのログアウトを解消） |
| 変更 | `public/js/config.js` | `MAIL_FROM`（送信元アドレスの表示用。この構成では空文字） |
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
2. **ドメイン認証（Senders, domains, IPs → Domains）は行わない。**
   独自ドメインがないため不要。Gmail のドメインは認証できないので、「Add your sending domain」画面は Cancel で閉じる。
3. **Settings → Senders, domains, IPs → Senders**　← **この手順は省略しないこと**
   - 「Add a sender」で、送信元を登録する。
     - From name：`電子お薬手帳_medi-watch`
     - From email：アプリ専用の Gmail（例：`a.sendemail7@gmail.com`）
   - Brevo からその Gmail に確認メールが届くので、開いて確認を済ませる。
   - 一覧で、その送信元が確認済み（Verified）になっていることを確認する。
   - ここで確認済みにした送信元でないと、Supabase から送るメールが Brevo に受け付けられないことがある。
   - 「ドメインが認証されていないため差出人を置き換える」旨の警告が出ることがあるが、この構成では想定どおりなので、そのまま進めてよい。
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
   - Sender email：**B-3 で確認済みにした Gmail**（例：`a.sendemail7@gmail.com`）
   - Sender name：`電子お薬手帳_medi-watch`
   - Host：`smtp-relay.brevo.com`　／　Port：`587`
   - Username：Brevo の Login　／　Password：Brevo の SMTP キー(※「## E.」の手順で確認して)
4. **Authentication → Emails → Templates → Confirm sign up**
   - Subject：`【電子お薬手帳】メールアドレスの確認をお願いします`
   - Body：`src/supabase/templates/confirm-signup.html` の **コメントの下の `<div>` 以下すべて**
5. **Authentication → Emails → Templates → Reset password**
   - Subject：`【電子お薬手帳】パスワードの再設定`
   - Body：`src/supabase/templates/reset-password.html` の `<div>` 以下すべて
6. **Authentication → Rate Limits**
   - メール送信数（1時間あたり）を確認し(10/20確認時点では100)、テストや発表で足りる値にしておく（Brevo の無料プランの送信上限の範囲内）。

---

## D. デプロイ

1. ブランチを push し、develop へマージ → Render に反映。
2. Render の環境変数は変更不要。
3. デプロイ後、`/api/health` が `{"status":"ok"}` を返すことを確認。

---

## E. 動作確認チェックリスト

**発表で実際に使うメールアドレス（端末）で**試すこと。

### 新規登録・メール確認
- [ ] 新規登録 → 確認画面に進み、登録したアドレスが表示される
- [ ] メールが届く（**受信トレイになければ迷惑メールフォルダも確認**）
- [ ] 届いたメールの差出人を確認して控えておく（Brevo による置き換え後のアドレスになっている）
- [ ] メールの「確認を完了する」→ 開いたページで「確認を完了する」を押す → ホームに進む
- [ ] 同じボタンをもう一度使う →「このボタンは、もう使えません」と、ログイン／送り直しの案内が出る
- [ ] 別の登録で、6桁コード入力（全角数字でも可）→ ホームに進む
- [ ] 間違ったコード → エラーが出る
- [ ] 「確認のメールをもう一度送る」→ 60秒のカウントダウン、新しいメールが届く
- [ ] 「新規登録はしたが、メールの確認（ボタンを押す、またはコードを入力する）をまだしていない状態で、ログイン画面からログインしようとしたらどうなるか」 → 確認画面に案内される

### ログイン状態の維持
- [ ] ログインしたまま **1時間以上** 放置 → 画面操作・通知タップでログイン画面に戻らない
- [ ] 開発者ツールで `localStorage` の `okusuri_techo_session` の `refresh_token` が更新されている(※上記の1時間以上放置したうえで実行する)
1時間待たずに試す方法
okusuri_techo_session の値の中にある expires_at（トークンの期限）を、過去の時刻に書き換えると、すぐに試せます。
1. 開発者ツールで okusuri_techo_session の値をダブルクリックして編集し、"expires_at": の後ろの数字を 1 に変えて確定します。
2. 画面を再読み込みします。
3. ログイン画面に戻されず、refresh_token と expires_at が新しい値に変わっていれば合格です。

- [ ] ログアウト → 再度ホームを開くとログイン画面になる

### パスワード再設定
- [ ] 
1. ログイン画面でメールアドレスとパスワードを入力して「ログインする」を押す
2. 「メールアドレスまたはパスワードが正しくありません」と表示される
3. そこで「パスワードを忘れた方はこちら」を押す
→ 入力済みのアドレスが引き継がれる

- [ ] メールの「パスワードを決め直す」→ ボタン → 新しいパスワード → ホームに進む
- [ ] 新しいパスワードでログインできる
- [ ] 6桁コードでも同じように再設定できる
- [ ] 今と同じパスワードを入れる →「今までと同じです」と案内され、ホームへ進める

### ローカル開発での注意
メールのボタンは Site URL（本番）を開く。ローカル（`localhost:3000`）で試すときは、
**6桁コードの入力で確認する**か、一時的に Site URL を `http://localhost:3000` に変える（終わったら戻す）。

---

## 発表当日に向けた準備

- **デモ用アカウントは事前に作っておく。** 当日は、作成済みアカウントでのログインを基本にし、新規登録のデモは「メールが届く → ボタンで確認」の流れを見せる程度にする。
- **デモで使う受信アドレスは Gmail にする。** 置き換え後の差出人でも比較的届きやすい。携帯会社のメール（docomo・au・SoftBank）は受信設定によって届かないことがあるので、デモには使わない。
- 受信用の Gmail では、事前に届いたメールを「迷惑メールではない」にしておくと、以後は受信トレイに入りやすくなる。
- 会場の通信不良に備え、**一連の流れの画面録画（動画）を用意**しておく。
- Render の無料プランは、しばらくアクセスがないとスリープし、最初の表示に時間がかかる。**発表の直前に一度アクセスして起こしておく。**

---

## トラブルシューティング

| 症状 | 確認する場所 |
| --- | --- |
| メールが届かない | まず迷惑メールフォルダ。次に Supabase **Authentication → Logs** に `Error sending ... email` が出ていないか（出ていれば SMTP 設定、または B-3 の送信元が確認済みになっているか） |
| Brevo 側で送信されたか | Brevo **Transactional → Logs**（または Statistics） |
| 「続けて送ることはできません」 | 同じアドレスへは60秒に1回まで（Supabase の既定） |
| ボタンのリンク先が 404 | Site URL の末尾に `/` が付いていないか、本番に `verify-email.html` がデプロイされているか |
| 登録やログインが「しばらくできません」になる | 全利用者が Render サーバーの IP で数えられるため、Supabase の IP ごとの制限に達した可能性。発表規模では通常起きないが、テストを短時間に繰り返したときは5分ほど待つ |

---

## 既知の制約（論文の「課題・今後の展望」に書ける点）

- 独自ドメインがないため、送信元のドメイン認証（SPF・DKIM・DMARC）ができず、差出人が Brevo のアドレスに置き換わる。迷惑メール判定されやすく、利用者が差出人を見て公式のメールだと判断しにくい。
  → 実運用では、独自ドメインを取得して認証し、`no-reply@独自ドメイン` から送る。
- 携帯会社のメールでは、受信設定によって届かないことがある。高齢の利用者が多い想定では、独自ドメインの取得と、受信設定の案内（`MAIL_FROM` の表示）が必要。
- 認証 API をすべて Express サーバー経由で呼ぶため、Supabase からは全利用者が同じ IP に見える。利用者が増えた場合は、IP 転送（`Sb-Forwarded-For`）の導入やレート制限の見直しが必要。

---

## 設計上の注意（今後の開発で守ること）

- **`supabaseAdmin` で `auth.signInWithPassword` / `refreshSession` / `verifyOtp` などを呼ばない。**
  supabase-js はクライアント内にセッションを保持すると、以後の DB 操作をそのユーザーの権限で行う。
  cron や通知処理が「最後に操作したユーザー」の権限で動いてしまう。認証処理は `createAuthClient()` を使う。
  （`auth.getUser(token)` と `auth.admin.*` はセッションを保持しないので使ってよい）
- `PUT /api/auth/password` は現在のパスワードを確認しない。マイページに「パスワード変更」を作る場合は、現在のパスワードの確認を追加する。
- メール本文に、ユーザーが自由入力した値（名前など）を差し込まない。
- 将来独自ドメインを取得したら、Brevo でドメインを認証し、B-3（Senders）・C-3（Sender email）・`MAIL_FROM` の3か所を、同じ `no-reply@独自ドメイン` に揃える。
