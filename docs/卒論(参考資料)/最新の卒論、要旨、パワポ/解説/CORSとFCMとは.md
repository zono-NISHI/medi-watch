# CORS と FCM とは

卒論・発表で出てくる用語「CORS」「FCM」の意味と、medi-watch でどう使っているかをまとめる。

## CORS（Cross-Origin Resource Sharing／オリジン間リソース共有）

### 意味

- ブラウザには、あるサイト（オリジン）の画面から、別のオリジンのサーバーへ勝手にデータを取りに行かせないというセキュリティの決まりがある（同一オリジンポリシー）。
- オリジンとは「プロトコル＋ドメイン＋ポート」の組み合わせのこと（例: `https://medi-watch.onrender.com`）。
- CORS は、サーバーが「このオリジンからのアクセスなら許可する」とレスポンスのヘッダー（`Access-Control-Allow-Origin` など）で伝え、例外として別オリジンからのアクセスを認める仕組み。

### medi-watch での使われ方

- Web 版は、画面も API も Render の同じ URL から配信している（同一オリジン）ので、CORS は要らない。
- ネイティブ版（Android アプリ）は、画面をスマホの中の `https://localhost` から開き、API は Render の URL（`public/js/config.js` の `NATIVE_SERVER_ORIGIN`）へ送る。オリジンが違うため、そのままでは WebView がブロックする。
- そこで `server.js` では、`/api` へのアクセスについて、アプリの画面のオリジン（`https://localhost` と `capacitor://localhost`）だけを CORS で許可している。
  - 許可するメソッド: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
  - 許可するヘッダー: `Content-Type, Authorization`
  - 事前確認（`OPTIONS` のリクエスト）には 204 で答える。
- 認証は Cookie ではなく `Authorization` ヘッダーのトークンで行っている。そのため、このオリジンを許可しても、ほかのサイトから利用者になりすました操作はできない。

## FCM（Firebase Cloud Messaging）

### 意味

- Google の Firebase が提供している、スマホアプリなどへプッシュ通知を送るサービス。

### medi-watch での使われ方

- ブラウザ版への通知は Web Push（VAPID 鍵と `web-push` ライブラリ）で送っている。
- Android アプリの WebView は Web Push に対応していないため、ネイティブ版の家族への通知は FCM で送っている。
  - サーバー側: `firebase-admin` で送信する（`src/services/notificationService.js`）。環境変数 `FIREBASE_SERVICE_ACCOUNT`（Firebase のサービスアカウントの JSON）が必要。
  - アプリ側: `@capacitor/push-notifications` で受け取る（`public/js/push.js` の `PushSetup`）。`mobile/android/app/google-services.json` が必要。
- 送り先は、`push_subscriptions.kind` が `fcm` の端末。端末の FCM トークンは `endpoint` 列に入れている（マイグレーション 0007）。
