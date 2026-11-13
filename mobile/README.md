# medi-watch ネイティブ版（Android）

Web 版の画面（`../public/`）をそのまま Android アプリに同梱し、**服薬アラームだけをネイティブ（Java）で動かす**アプリです。Capacitor 8 を使っています。

- アプリを閉じていても、画面が消えていても、ロック中でも、ほかのアプリを使っている最中でも、服薬時刻に全画面で「カメラを起動する」を出し、止めるまで音を鳴らします。
- API はこれまでどおり Render のサーバー（`public/js/config.js` の `NATIVE_SERVER_ORIGIN`）を使います。サーバー・データベースは Web 版と共通です。
- 家族への「飲み忘れ」プッシュ通知は、今はアプリでは受け取れません（WebView が Web Push に対応していないため）。`docs/卒論(参考資料)/後でできるようにしたいこと/` を参照。

## フォルダ構成

```
mobile/
├── package.json            … Capacitor（ルートの package.json とは別。Render には影響しない）
├── capacitor.config.json   … アプリID・アプリ名・同梱する画面（webDir: ../public）
└── android/                … Android Studio で開くプロジェクト
    └── app/src/main/
        ├── AndroidManifest.xml          … 権限・アラーム画面・受信処理の登録
        └── java/jp/mediwatch/app/
            ├── MainActivity.java        … アプリ本体（WebView）。アラームから来たら home.html?take=ID を開く
            └── alarm/
                ├── MediAlarmPlugin.java … Web の画面（alarm.js の NativeAlarm）との窓口
                ├── AlarmStore.java      … 予定・今日の記録・「あとで」を端末に保存
                ├── AlarmScheduler.java  … 次に鳴らす時刻を AlarmManager.setAlarmClock で予約
                ├── AlarmReceiver.java   … 予約時刻になった／通知の「あとで」
                ├── AlarmRinger.java     … 通知（音を繰り返す・全画面インテント）を出す・止める
                ├── AlarmActivity.java   … 画面いっぱいのアラーム画面
                └── BootReceiver.java    … 再起動・時刻変更のあとに予約し直す
```

`android/app/src/main/assets/public/` は `npx cap sync` で `../public/` からコピーされるもので、git には入れません（`android/.gitignore`）。

## 初めての準備（1回だけ）

1. **Android Studio** をインストールする（https://developer.android.com/studio）。初回起動時の案内に従って Android SDK も入れる。詳しい手順は [Android Studioのインストール手順.md](Android%20Studioのインストール手順.md)（SDK Manager で Android 16.0 / API 36 を追加するのを忘れないこと）。
2. ターミナルで次を実行する。
   ```
   cd mobile
   npm install
   npx cap sync android
   ```
3. `npx cap open android` で Android Studio が開く（開かない場合は、Android Studio の「Open」で `mobile/android` を選ぶ）。初回は Gradle の同期に数分かかる。

## 自分のスマホで動かす

1. スマホの「設定」→「デバイス情報」→「ビルド番号」を7回タップして開発者向けオプションを出し、「USB デバッグ」をオンにする。
2. USB でパソコンにつなぎ、スマホに出る「USB デバッグを許可しますか？」で許可する。
3. Android Studio の上部で端末を選び、▶（Run）を押す。

### `public/` を変えたとき
Web の画面を直したら、アプリに取り込み直してから ▶ を押す。
```
cd mobile
npx cap sync android
```
（Web 版は develop へのマージで Render に出るが、**アプリの画面は APK を作り直して入れ直すまで変わらない**。API（サーバー）の変更は、すぐにアプリにも反映される。）

## 動作の確認

1. アプリでログインし、マイページの「お薬の時間のアラーム」の4つの設定をすべて「済み ✓」にする。
2. 「お薬」で、2〜3分後の時刻にお薬を登録する（マイページの「次のアラーム」にその時刻が出ることを確認）。
3. 次の状態で、それぞれ時刻にアラームが出て鳴ることを確認する。
   - アプリを開いたまま
   - ホームボタンでアプリを閉じ、別のアプリ（Chrome など）を使っている最中
   - 画面を消して（ロックして）待つ
   - 最近使ったアプリの一覧からアプリを消した状態
4. 「カメラを起動する」で、ロック解除 → ホームの撮影画面でカメラが起動することを確認する。
5. 「あとで」で5分後にもう一度鳴ることを確認する。
6. 服薬時刻より前にホームで「飲んだ」を記録し、その時刻に鳴らないことを確認する。
7. スマホを再起動してからも鳴ることを確認する。

### ログ（確認用）
アプリの画面のコンソール：パソコンの Chrome で `chrome://inspect` を開き、USB でつないだスマホのアプリ（WebView）の「inspect」を押す。
ネイティブ側のログ：Android Studio の「Logcat」で `MediAlarm` を検索する。

### アイコンを変えるとき
アプリのアイコン（Web 版の `public/assets/` と、`android/app/src/main/res/mipmap-*/`）は、リポジトリのルートの `scripts/generate-icons.ps1` で描いている。図柄や色を変えるときはこのスクリプトを直し、ルートで次を実行して全サイズを作り直す（Windows 標準の機能だけで動く）。
```
powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```
アダプティブアイコン（Android 8 以降）の背景色は `android/app/src/main/res/values/ic_launcher_background.xml`。アイコンを変えたら APK を作り直して入れ直す。スマホによってはホーム画面に古いアイコンが残るので、そのときはアプリを一度アンインストールしてから入れる。

## 他の人のスマホに配る（APK）

1. Android Studio の「Build」→「Generate Signed App Bundle or APK…」→「APK」を選ぶ。
2. 初回は「Create new…」で署名用の鍵（keystore）を作る。**この鍵ファイルとパスワードは無くさないこと**（無くすと、同じアプリとして更新版を入れられなくなる）。鍵は git に入れない。
3. 「release」を選んで作成すると、`mobile/android/app/release/app-release.apk` ができる。
4. APK を Google ドライブなどで渡し、相手のスマホでタップしてインストールしてもらう。途中で「提供元不明のアプリ」の許可を求められたら、許可してもらう。
5. インストール後、相手のスマホでも、マイページの「お薬の時間のアラーム」の設定を済ませてもらう。
   - 「ほかのアプリの上に重ねて表示」がオンにできない（灰色）場合は、スマホの「設定」→「アプリ」→「お薬手帳」→ 右上の「︙」→「制限付き設定を許可」を押してから、もう一度設定する（ストア以外から入れたアプリで出ることがある）。

更新版を配るときは、`android/app/build.gradle` の `versionCode` を1つ増やし、同じ鍵で作り直す。

## 注意
- **サーバーの URL**：`public/js/config.js` の `NATIVE_SERVER_ORIGIN` を Render の本番 URL にしておくこと。違うと、アプリからログインできない。
- **サーバー側の CORS**：アプリ（`https://localhost`）から API を呼べるよう、`server.js` で許可している。サーバーの変更は develop へのマージで Render に反映されてから、アプリで確認できる。
- 機種によっては、電池の最適化でアプリが止められ、鳴らないことがある。その場合は「設定」→「アプリ」→「お薬手帳」→「電池」で「制限なし」にする。
- Google Play で配る場合は、全画面インテント（`USE_FULL_SCREEN_INTENT`）と正確なアラーム（`USE_EXACT_ALARM`）の利用について、Play Console での申告が必要になる。
