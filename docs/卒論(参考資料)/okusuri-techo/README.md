# 電子お薬手帳 Webアプリ

> 服薬の記録を家族とリアルタイムに共有できる電子お薬手帳。  
> QRコード登録・服薬リマインド通知・服薬映像記録・家族への通知に対応。

---

## 技術スタック

| 層 | 採用技術 |
|---|---|
| フロントエンド | HTML / CSS / Vanilla JavaScript (SPA風マルチページ) |
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
okusuri-techo/
├── backend/
│   ├── src/
│   │   ├── server.js          # Expressサーバー エントリポイント
│   │   ├── lib/
│   │   │   ├── supabase.js    # Supabaseクライアント初期化
│   │   │   └── utils.js       # 共通ユーティリティ
│   │   ├── middleware/
│   │   │   └── auth.js        # JWT認証ミドルウェア
│   │   ├── routes/
│   │   │   ├── auth.js        # 認証API
│   │   │   ├── careGroups.js  # ケアグループAPI
│   │   │   ├── medications.js # 薬情報API
│   │   │   ├── schedules.js   # スケジュールAPI
│   │   │   ├── logs.js        # 服薬記録API
│   │   │   └── push.js        # プッシュ通知API
│   │   └── services/
│   │       ├── jahisParser.js  # JAHIS QRコード解析
│   │       ├── notificationService.js  # Web Push送信
│   │       └── reminderCron.js # 服薬リマインダーcronジョブ
│   ├── migrations/
│   │   ├── 0001_最初のデータベース構築.sql  # 初期DB構築（Supabaseで実行）
│   │   └── 0002_invite_code_rls.sql          # 招待コード用RPC関数
│   ├── package.json
│   └── .env.example
│
└── frontend/
    ├── index.html       # 表紙（ランディング）
    ├── signup.html      # 新規登録
    ├── login.html       # ログイン
    ├── home.html        # 今日のお薬（服薬チェック・音声・カメラ）
    ├── medications.html # お薬管理（手入力・QRスキャン）
    ├── logs.html        # 服薬記録履歴
    ├── family.html      # 家族・見守り設定
    ├── mypage.html      # マイページ
    ├── sw.js            # Service Worker（プッシュ通知受信）
    ├── css/
    │   ├── base.css         # デザインシステム基盤
    │   ├── cover.css        # 表紙ページ
    │   ├── auth.css         # 認証ページ
    │   ├── home.css         # ホーム・服薬モーダル
    │   ├── medications.css  # お薬管理
    │   ├── logs.css         # 記録履歴
    │   ├── family.css       # 家族ページ
    │   └── mypage.css       # マイページ
    └── js/
        ├── config.js    # API URLなど設定
        ├── api.js       # APIクライアント・セッション管理
        ├── ui.js        # 共通UIユーティリティ（トースト・ナビなど）
        └── pages/
            ├── home.js
            ├── medications.js
            ├── logs.js
            ├── family.js
            └── mypage.js
```

---

## セットアップ手順

### 1. Supabase のDBを構築する

1. [Supabase](https://supabase.com) でプロジェクトを作成する。
2. **SQL Editor** を開き、`backend/migrations/0001_最初のデータベース構築.sql` の全内容を貼り付けて実行する。
3. 続けて `backend/migrations/0002_invite_code_rls.sql` を実行する。
4. **Project Settings > API** から以下の値をメモしておく。
   - `Project URL`
   - `anon public key`
   - `service_role key`（厳重管理。絶対にフロントエンドに含めないこと）

### 2. バックエンドの起動

```bash
cd backend
cp .env.example .env
# .env を編集して Supabase の URL / Key を設定する
```

VAPID 鍵の生成（初回のみ）:
```bash
npx web-push generate-vapid-keys
# 生成された PUBLIC KEY / PRIVATE KEY を .env に設定
```

```bash
npm install
npm run dev      # 開発用（nodemon でホットリロード）
npm start        # 本番用
```

バックエンドは `http://localhost:3000` で起動します。

### 3. フロントエンドの設定

`frontend/js/config.js` を編集する:

```js
window.APP_CONFIG = {
  API_BASE_URL: 'http://localhost:3000/api',  // バックエンドのURL
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
};
```

### 4. フロントエンドの起動

フロントエンドは静的HTMLファイルです。  
**Live Server**（VS Code拡張）や `npx serve frontend` で配信できます。

```bash
# VS Code の Live Server 拡張を使う場合
# → frontend/index.html を右クリック → "Open with Live Server"

# またはコマンドラインで
npx serve frontend -p 5173
```

> ⚠ **CORS設定**: バックエンドの `.env` の `FRONTEND_ORIGIN` を  
> フロントエンドのURLに合わせてください（例: `http://localhost:5173`）。

> ⚠ **HTTPS必須機能**: カメラ・プッシュ通知・Service Worker は  
> HTTPS または `localhost` 環境でのみ動作します。

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

## 本番デプロイの注意点

- バックエンドは **Render / Railway / Fly.io** などにデプロイ可能。
- フロントエンドは **Vercel / Netlify / GitHub Pages** などで静的ホスティング。
- **HTTPS 必須**（カメラ・PWA・プッシュ通知の要件）。
- `SUPABASE_SERVICE_ROLE_KEY` は絶対にフロントエンドのコードに含めないこと。
- Service Worker (`sw.js`) は **フロントエンドのルートディレクトリ** に置くこと（サブディレクトリに置くとスコープが限定される）。
