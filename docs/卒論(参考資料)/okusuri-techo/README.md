# 電子お薬手帳 Webアプリ（medi-watch）

> 服薬の記録を家族とリアルタイムに共有できる電子お薬手帳。  
> QRコード登録・服薬リマインド通知・服薬映像記録・家族への通知に対応。

---

## 技術スタック

| 層 | 採用技術 |
|---|---|
| フロントエンド | HTML / CSS / Vanilla JavaScript（マルチページ構成） |
| バックエンド | Node.js / Express |
| DB・認証 | Supabase (PostgreSQL + Auth + Storage + RLS) |
| プッシュ通知 | Web Push API / VAPID |
| カメラ | MediaDevices API (getUserMedia / MediaRecorder) |
| QR読み取り | jsQR (CDN) |
| 音声案内 | Web Speech API (SpeechSynthesis) |
| バージョン管理 | Git / GitHub |

---

## ディレクトリ構成

```
medi-watch/
├── public/                  # フロントエンド静的ファイル（Expressが配信）
│   ├── index.html           # 表紙（ランディング）
│   ├── signup.html          # 新規登録
│   ├── login.html           # ログイン
│   ├── home.html            # 今日のお薬（服薬チェック・音声・カメラ）
│   ├── medications.html     # お薬管理（手入力・QRスキャン）
│   ├── logs.html            # 服薬記録履歴
│   ├── family.html          # 家族・見守り設定
│   ├── mypage.html          # マイページ
│   ├── sw.js                # Service Worker（プッシュ通知受信）
│   ├── manifest.json        # PWAマニフェスト
│   ├── assets/
│   │   └── icon-192.png
│   ├── css/
│   │   ├── base.css         # デザインシステム基盤
│   │   ├── cover.css        # 表紙ページ
│   │   ├── auth.css         # 認証ページ
│   │   ├── home.css         # ホーム・服薬モーダル
│   │   ├── medications.css  # お薬管理
│   │   ├── logs.css         # 記録履歴
│   │   ├── family.css       # 家族ページ
│   │   └── mypage.css       # マイページ
│   └── js/
│       ├── config.js        # API URLなど設定
│       ├── api.js           # APIクライアント・セッション管理
│       ├── ui.js            # 共通UIユーティリティ（トースト・ナビなど）
│       └── pages/
│           ├── home.js
│           ├── medications.js
│           ├── logs.js
│           ├── family.js
│           └── mypage.js
│
├── src/                     # バックエンド（Express）
│   ├── supabase/
│   │   ├── supabase.js      # Supabaseクライアント初期化
│   │   └── migrations/
│   │       ├── 0001_最初のデータベース構築.sql  # 初期DB構築
│   │       └── 0002_invite_code_rls.sql        # 招待コード用RPC関数
│   ├── middleware/
│   │   └── auth.js          # JWT認証ミドルウェア
│   ├── routes/
│   │   ├── auth.js          # 認証API
│   │   ├── careGroups.js    # ケアグループAPI
│   │   ├── medications.js   # 薬情報API
│   │   ├── schedules.js     # スケジュールAPI
│   │   ├── logs.js          # 服薬記録API
│   │   └── push.js          # プッシュ通知API
│   ├── services/
│   │   ├── jahisParser.js         # JAHIS QRコード解析
│   │   ├── notificationService.js # Web Push送信
│   │   └── reminderCron.js        # 服薬リマインダーcronジョブ
│   └── lib/
│       └── utils.js         # 共通ユーティリティ
│
├── server.js                # エントリポイント（ルート直下）
├── .env                     # 環境変数（Gitにコミットしない）
├── .gitignore
├── package.json
└── package-lock.json
```

> **ポイント**：`public/` は Express が静的配信するため、フロントエンドを別サーバーで立てる必要はありません。  
> `http://localhost:3000` 一つで API とフロントの両方にアクセスできます（**同一オリジンなので CORS 設定も不要**）。

---

## セットアップ手順

### 1. Supabase のDBを構築する

1. [Supabase](https://supabase.com) でプロジェクトを作成する。
2. **SQL Editor** を開き、`src/supabase/migrations/0001_最初のデータベース構築.sql` の全内容を貼り付けて実行する。
3. 続けて `src/supabase/migrations/0002_invite_code_rls.sql` を実行する。
4. **Storage** で `medication-videos` という名前のバケットを作成する（服薬映像の保存先）。
5. **Project Settings > API** から以下の値をメモしておく。
   - `Project URL`
   - `anon public key`
   - `service_role key`（厳重管理。**絶対にフロントエンドに含めないこと**）

### 2. 環境変数を設定する

リポジトリのルートに `.env` を作成する。

```env
# サーバー設定
PORT=3000
NODE_ENV=development

# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Web Push (VAPID)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:admin@example.com
```

VAPID（Voluntary Application Server Identification）鍵の生成（初回のみ）:

```bash
npx web-push generate-vapid-keys
# 出力された Public Key / Private Key を .env に貼り付ける
```

### 3. フロントエンドの設定

`public/js/config.js` を編集する。  
**Express が同一オリジンで配信するため、`API_BASE_URL` は相対パスで問題ありません。**

```js
window.APP_CONFIG = {
  API_BASE_URL: '/api',   // 同一オリジンなので相対パスでOK
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
};
```

### 4. 起動する

```bash
npm install
npm run dev      # 開発用（nodemon でホットリロード）
npm start        # 本番用
```

ブラウザで **`http://localhost:3000`** を開くと表紙ページが表示されます。  
`signup.html` からアカウントを作成してログインしてください。

> ⚠ **HTTPS 必須機能**: カメラ・プッシュ通知・Service Worker は  
> **HTTPS または `localhost`** 環境でのみ動作します。  
> ファイルを直接ダブルクリックして開く（`file://` プロトコル）と動作しません。

---

## server.js の静的配信設定

`server.js` で `public/` を配信するには、以下の設定が入っている必要があります。

```js
const path = require('path');

// public/ ディレクトリを静的配信
app.use(express.static(path.join(__dirname, 'public')));

// APIルート
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/care-groups', require('./src/routes/careGroups'));
app.use('/api/medications', require('./src/routes/medications'));
app.use('/api/schedules', require('./src/routes/schedules'));
app.use('/api/logs', require('./src/routes/logs'));
app.use('/api/push', require('./src/routes/push'));
```

---

## require パスの対応表

`supabase.js` が `src/lib/` から `src/supabase/` に移動したため、各ファイルの `require` を以下のように修正してください。

| ファイル | 変更前 | 変更後 |
|---|---|---|
| `src/middleware/auth.js` | `require('../lib/supabase')` | `require('../supabase/supabase')` |
| `src/services/notificationService.js` | `require('../lib/supabase')` | `require('../supabase/supabase')` |
| `src/services/reminderCron.js` | `require('../lib/supabase')` | `require('../supabase/supabase')` |
| `src/routes/*.js` | `require('../lib/utils')` | 変更なし |
| `server.js` | `require('./routes/auth')` | `require('./src/routes/auth')` |
| `server.js` | `require('./services/reminderCron')` | `require('./src/services/reminderCron')` |

---

## 主要機能の説明

### 患者向け

| 機能 | 説明 |
|---|---|
| QRコード登録 | 薬局発行の JAHIS フォーマット QR を読み取って薬を登録 |
| 手動登録 | 薬名・用量・服薬時刻を手入力で登録 |
| 音声案内 | 服薬時刻になると Web Speech API で音声お知らせ |
| カメラ撮影 | 内向きカメラで服薬シーンを録画・Supabase Storage に保存 |
| 服薬チェック | 「飲んだ」「スキップ」ボタンで記録 |
| プッシュ通知 | 服薬前リマインドを自端末で受信 |

### 家族・介護者向け

| 機能 | 説明 |
|---|---|
| 招待コード参加 | 患者が発行した 8 桁コードを入力してグループ参加 |
| 服薬完了通知 | 患者が「飲んだ」を押すとリアルタイムでプッシュ通知を受信 |
| 飲み忘れ通知 | 予定時刻から 30 分経過しても未記録の場合に通知 |
| 映像閲覧 | 服薬シーンの録画を後から確認（閲覧権限がある場合のみ） |
| 記録確認 | 「記録」タブから服薬履歴を一覧で確認 |

---

## API エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/auth/signup` | 新規登録 |
| POST | `/api/auth/login` | ログイン |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | プロフィール取得 |
| PATCH | `/api/auth/me` | プロフィール更新 |
| POST | `/api/care-groups` | 見守りグループ作成 |
| GET | `/api/care-groups` | グループ一覧 |
| POST | `/api/care-groups/join` | 招待コードで参加 |
| GET | `/api/medications` | 薬一覧 |
| POST | `/api/medications` | 薬を手動登録 |
| POST | `/api/medications/scan-qr` | QRコード解析 |
| GET | `/api/schedules` | 服薬スケジュール一覧 |
| GET | `/api/logs` | 服薬記録一覧 |
| PATCH | `/api/logs/:id/take` | 「飲んだ」を記録 |
| PATCH | `/api/logs/:id/skip` | 「スキップ」を記録 |
| GET | `/api/push/vapid-public-key` | VAPID公開鍵の取得 |
| POST | `/api/push/subscribe` | プッシュ通知購読 |

---

## .gitignore の推奨内容

```gitignore
node_modules/
.env
.env.local
.DS_Store
*.log
```

---

## 本番デプロイの注意点

- **Render / Railway / Fly.io** などに、リポジトリ全体をそのままデプロイできます（フロント・バックエンド一体構成のため）。
- **HTTPS 必須**（カメラ・PWA・プッシュ通知の要件）。
- `SUPABASE_SERVICE_ROLE_KEY` は絶対にフロントエンドのコードに含めないこと。
- `.env` は `.gitignore` に含め、GitHub にコミットしないこと。
- Service Worker (`sw.js`) は `public/` 直下に置くこと（サブディレクトリに置くとスコープが限定される）。
