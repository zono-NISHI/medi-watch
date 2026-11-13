# Android Studio のインストール手順（Windows）

ネイティブ版（`mobile/`）をビルドするために、Android Studio と Android SDK を入れる手順です。[README.md](README.md) の「初めての準備」の手順1を詳しく書いたものです。

## 0. 始める前に
- **空き容量**：Android Studio と SDK で 10GB 以上あると安心です（インストーラーの画面には「Space required: 4.3GB」と出ますが、このあと SDK をダウンロードします）。
- **管理者権限**：インストールに必要です。権限がないと、UAC（「このアプリがデバイスに変更を加えることを許可しますか？」）で止まります。
- **時間**：インストーラーが約1.3GB、初回起動時の SDK が数GBあります。回線によっては30分以上かかります。

## 1. インストーラーをダウンロードする
1. https://developer.android.com/studio を開く。
2. 「Android Studio ○○ をダウンロード」を押す（○○は版の名前。例：Rabbit 2）。
3. 利用規約を一番下までスクロールし、「上記の利用規約を読み、同意します」にチェックを入れる。
4. 「Windows 用 Android Studio をダウンロード」を押す。`android-studio-xxxx-windows.exe` がダウンロードされる。

## 2. インストールする
1. ダウンロードした `.exe` をダブルクリックし、UAC の確認で「はい」を押す。
2. **Welcome**：「Next」を押す。
3. **Choose Components**：「Android Studio」と「Android Virtual Device」にチェックが入ったまま「Next」を押す。
   - 「Android Studio」のチェックが灰色なのは、外せない必須の項目だから。
   - 「Android Virtual Device」は PC 上で動く仮想のスマホ（エミュレーター）。アラームの確認は実機で行うので必須ではないが、スマホが手元にないときの画面の確認に使える。
4. **Configuration Settings**：インストール先は初期値（`C:\Program Files\Android\Android Studio`）のまま「Next」を押す。
5. **Choose Start Menu Folder**：「Install」を押す。
6. 完了したら、「Start Android Studio」にチェックを入れたまま「Finish」を押す。

## 3. 初回起動時の設定（ここで Android SDK が入る）
「Finish」を押すと Android Studio が起動し、続けて次の画面が出る。

1. **Import Android Studio Settings**（出ない場合もある）：「Do not import settings」を選び、「OK」を押す。
2. **Help improve Android Studio**（使用状況のデータを Google に送るかの確認）：「Don't send」を押す。
   - どちらを選んでも開発には影響しない。後から「Settings」→「Appearance & Behavior」→「System Settings」→「Data Sharing」で変えられる。
3. **Setup Wizard – Welcome**：「Next」を押す。
4. **Install Type**：「Standard」を選び、「Next」を押す。
5. **Select UI Theme**：好きなテーマを選び、「Next」を押す。
6. **Verify Settings**：SDK の保存先（`C:\Users\<ユーザー名>\AppData\Local\Android\Sdk`）を確認し、「Next」を押す。
7. **License Agreement**：左側の一覧のライセンス（`android-sdk-license` など）を1つずつ選び、それぞれ「Accept」にしてから「Finish」を押す。全部を Accept にしないと「Finish」は押せない。
8. **Downloading Components**：SDK のダウンロードとインストールが始まる。
   - 表示されている「○%」は、今ダウンロードしているファイル1つ分の進み具合。下のバーが全体の進み具合。
   - 終わるまで「Cancel」は押さない。PC をスリープさせたり、ネットワークを切ったりしない。
   - 右下の「Finish」が押せるようになったら押す。
9. 「Welcome to Android Studio」（New Project / Open などが並ぶ画面）が出れば、インストールは完了。

## 4. SDK を確認し、足りないものを入れる
Welcome 画面の「More Actions」→「SDK Manager」を開く（プロジェクトを開いているときは「File」→「Settings」→「Languages & Frameworks」→「Android SDK」）。

### SDK Platforms タブ
- **Android 16.0（"Baklava"）の API Level「36.0」にチェックを入れる**。
  - このプロジェクトは `android/variables.gradle` で `compileSdkVersion = 36` を指定しているため、API 36 が必要になる。
  - 初回の設定で入るのは、その時点で最新の Android（例：Android 17.0 / API 37.0）だけなので、そのままでは API 36 が入っていない。
- 「36.0-ext18」などの「ext」が付いたものや、「Preview」「CANARY」は不要。

### SDK Tools タブ
次の項目の Status が「Installed」（または「Update Available」）になっていれば大丈夫。
- Android SDK Build-Tools（チェック欄が「－」でも、いずれかの版が入っていれば問題ない）
- Android SDK Platform-Tools
- Android Emulator（エミュレーターを使う場合）

スマホが Google Pixel の場合は「Google USB Driver」にもチェックを入れる（USB でつないだスマホを Windows が認識するために必要）。ほかのメーカーの機種は、そのメーカーのサイトから USB ドライバーを入れる。

チェックを付けたら「Apply」→ 確認画面で「OK」を押す。ダウンロードが終わったら「Finish」→「OK」で閉じる。

## 5. このあと
[README.md](README.md) の「初めての準備」の手順2に進む。VS Code のターミナルで次を実行する。
```
cd mobile
npm install
npx cap sync android
npx cap open android
```
- `npx cap open android` で Android Studio が見つからないと表示された場合は、Android Studio の「Open」で `mobile\android` フォルダーを選ぶ。
- 初めて開いたときは、右下に「Gradle sync」の進行状況が表示され、数分かかる。終わるまで待つ。

## つまずきやすい点
- **Gradle の同期で「SDK Platform 36 が見つからない」などのエラーが出る**：手順4で API 36.0 を入れたか確認する。
- **Gradle の同期で JDK のエラーが出る**：「File」→「Settings」→「Build, Execution, Deployment」→「Build Tools」→「Gradle」の「Gradle JDK」で、Android Studio に同梱されている「jbr-21」を選ぶ。
- **スマホをつないでも、上部の端末一覧に出ない**：USB ドライバー（手順4）を確認する。USB ケーブルが充電専用のものでないかも確認する。スマホ側で「USB デバッグを許可しますか？」が出ていたら許可する。
