// ============================================================
//  卒論発表のスライド（.pptx）を作る
//  使い方: scripts/thesis/slides で  node build_slides.js [出力先.pptx]
//  - 持ち時間 12分・12枚。ノートの【約○秒】の合計は約10分30秒（残りはデモの操作の余裕）
//  - ノートには「話す内容」「Webアプリの操作」「ネイティブアプリの操作」を入れている（notes() で作る）
//  - 力点は4つの機能（見守り通知・映像記録・ケアグループ・薬の登録）と、2つの工夫（アラーム画面・相互見守り）
//  - 文言を直すときは、このファイルの該当するスライドを書き換えて作り直す
//  - 配色はアプリ（public/css/base.css）と同じ藍色・テラコッタ・紙色
// ============================================================
const path = require('path');
const pptxgen = require('pptxgenjs');

const OUT = process.argv[2] || path.join(__dirname, '..', '..', '..', 'docs', '卒論(参考資料)', '最新の卒論、要旨、パワポ', '2370354_西薗正彦_卒業論文発表.pptx');
const ICON = path.join(__dirname, '..', '..', '..', 'public', 'assets', 'icon-512.png');

const INDIGO = '2C4A52', INDIGO_DEEP = '1D3338', TERRA = 'D97D54', TERRA_DEEP = 'B8623E';
const SAGE = '6B9080', CLAY = 'B5544A', PAPER = 'FBF7F0', PAPER_WARM = 'F4ECDD', INK = '33312E', INK_SOFT = '6B6660', WHITE = 'FFFFFF', LINE = 'E3D8C4';
const FONT = 'Meiryo';

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 インチ
pres.author = '西薗正彦';
pres.title = '家族見守り型 電子お薬手帳Webアプリケーション「medi-watch」の設計と開発';
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

pres.defineSlideMaster({
  title: 'CONTENT',
  background: { color: WHITE },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 32, bold: true, color: INDIGO, align: 'left', valign: 'middle', margin: 0 }, text: '' } },
  ],
  slideNumber: { x: 12.2, y: 6.95, w: 0.7, h: 0.3, fontFace: FONT, fontSize: 12, color: INK_SOFT, align: 'right' },
});
pres.defineSlideMaster({ title: 'DARK', background: { color: INDIGO } });

// ---- 部品 ----
const T = (s, text, x, y, w, h, o = {}) => s.addText(text, { x, y, w, h, fontFace: FONT, fontSize: 18, color: INK, margin: 0, valign: 'top', isTextBox: true, ...o });
const card = (s, x, y, w, h, fill = PAPER_WARM) => s.addShape(pres.ShapeType.roundRect, { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: 0.12 });
const dot = (s, x, y, d, label, fill = TERRA) => {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  T(s, label, x, y, d, d, { align: 'center', valign: 'middle', color: WHITE, bold: true, fontSize: Math.round(d * 30) });
};
const arrow = (s, x, y, w, color = INK_SOFT) => s.addShape(pres.ShapeType.line, { x, y, w, h: 0, line: { color, width: 2.5, endArrowType: 'triangle' } });
const varrow = (s, x, y, h, color = INK_SOFT) => s.addShape(pres.ShapeType.line, { x, y, w: 0, h, line: { color, width: 2.5, endArrowType: 'triangle' } });
// ノートの文（発表者だけに見える）。秒数・話す内容・Web版の操作・Android版の操作の順に並べる
const notes = (sec, talk, web, nat) => `【約${sec}秒】\n■ 話す内容\n${talk}\n\n■ Webアプリの操作\n${web}\n\n■ ネイティブアプリ（Android版）の操作\n${nat}`;
const content = (title, notes) => {
  const s = pres.addSlide({ masterName: 'CONTENT' });
  s.addText(title, { placeholder: 'title' });
  s.addNotes(notes);
  return s;
};

// ============ 1. タイトル ============
{
  const s = pres.addSlide({ masterName: 'DARK' });
  s.addImage({ path: ICON, x: 0.9, y: 0.8, w: 1.5, h: 1.5, rounding: false });
  T(s, '2026年度 卒業論文発表', 2.7, 1.0, 9, 0.45, { color: 'CFE0DC', fontSize: 20 });
  T(s, '選択テーマ：Webサイトの制作', 2.7, 1.5, 9, 0.45, { color: 'CFE0DC', fontSize: 18 });
  T(s, '家族見守り型 電子お薬手帳Webアプリケーション\n「medi-watch」の設計と開発', 0.9, 2.75, 11.6, 1.7, { color: WHITE, fontSize: 34, bold: true, valign: 'middle' });
  T(s, '～ 服薬状況のプッシュ通知と映像による見守りの実現 ～', 0.9, 4.55, 11.6, 0.6, { color: 'F2C9B4', fontSize: 24 });
  T(s, '経営情報学部 システム情報学科　2370354　西薗 正彦', 0.9, 5.75, 11.6, 0.45, { color: WHITE, fontSize: 20 });
  T(s, '指導教員：高井 那美 教授', 0.9, 6.25, 11.6, 0.45, { color: 'CFE0DC', fontSize: 18 });
  s.addNotes(notes(15,
    '「家族見守り型 電子お薬手帳Webアプリケーション medi-watch の設計と開発」について発表します。システム情報学科の西薗正彦です。よろしくお願いします。',
    '【発表前の準備】\n・PCのブラウザで Render のサイトを2つのウィンドウで開き、本人（見守られる側）と家族（見守る側）のアカウントでそれぞれログインしておく。\n・家族のアカウントで「プッシュ通知を有効にする」を済ませ、「テスト通知を送る」で届くことを確かめておく。\n・本人のお薬の服薬時刻を、スライド6を話すころ（発表開始の約5分後）に登録しておく。\n・アラームの音が出るよう、本人のウィンドウを一度クリックしておく。Google Meet で共有するときは、音声も共有されることを確かめておく。',
    '【発表前の準備】\n・スマホをUSBでPCにつなぎ（USBデバッグをオン）、scrcpy でスマホの画面をPCのウィンドウに映す。2台つなぐときは adb devices で番号を調べ、scrcpy -s <番号> で1台ずつ開く。\n・scrcpy のウィンドウを Google Meet の「ウィンドウ」で共有でき、アラームの音もPCから出る（Android 11以降）ことを確かめておく。\n・家族のアカウントのスマホで、マイページの「ご家族のお知らせ」→「お知らせを受け取る」を済ませておく。\n・本人のアカウントのスマホで、マイページの「お薬の時間のアラーム」の4つの設定を「済み ✓」にしておく。\n・薬局の明細書（JAHIS形式のQRコードが載ったもの）を手元に用意する。'));
}

// ============ 2. 背景 ============
{
  const s = content('背景：薬を飲めたかを、離れた家族は確かめられない', notes(35, '日本は高齢社会で、複数の薬を毎日飲む高齢者が増えています。記憶力の低下や生活リズムの乱れで、飲み忘れや重複服薬が起こりやすくなります。\n一方で、核家族化が進み、離れて暮らす家族には「今日、薬をきちんと飲めたのか」を確かめる手段がほとんどありません。\nこの「家族による見守り」を、手持ちのスマートフォンで実現できないかと考えたのが、本研究の出発点です。', '操作しない。', '操作しない。'));
  card(s, 0.6, 1.7, 5.3, 4.9, INDIGO);
  T(s, '離れて暮らす家族の不安', 1.0, 2.1, 4.5, 0.5, { color: 'CFE0DC', fontSize: 18 });
  T(s, '「今日、薬を\nきちんと\n飲めたのか」', 1.0, 2.8, 4.5, 2.6, { color: WHITE, fontSize: 38, bold: true, valign: 'middle' });
  T(s, 'を確かめる手段が乏しい', 1.0, 5.6, 4.5, 0.5, { color: 'F2C9B4', fontSize: 20 });
  const rows = [
    ['1', '複数の薬を毎日飲む高齢者が増加', '日本は世界でも有数の高齢社会'],
    ['2', '飲み忘れ・重複服薬が起こりやすい', '記憶力の低下、生活リズムの乱れ'],
    ['3', '親と離れて暮らす家族が増えている', '核家族化の進行'],
  ];
  rows.forEach(([n, head, sub], i) => {
    const y = 1.85 + i * 1.6;
    dot(s, 6.4, y, 0.8, n);
    T(s, head, 7.5, y - 0.05, 5.3, 0.5, { fontSize: 22, bold: true, color: INDIGO });
    T(s, sub, 7.5, y + 0.5, 5.3, 0.45, { fontSize: 18, color: INK_SOFT });
  });
}

// ============ 3. 既存サービスの調査 ============
{
  const s = content('既存サービスの調査：「家族の見守り」は空白だった', notes(40, '厚生労働省が公開している電子版お薬手帳サービスの一覧、31サービスについて機能を調べました。\n薬の記録や閲覧、本人へのアラームはどのサービスにもありますが、家族の「別の端末」へ服薬状況を知らせる機能や、映像で服薬を確かめる機能は、調べた範囲では確認できませんでした。\n一部に多職種連携の機能はありますが、医療・介護の専門職どうしの連携が目的で、家族の日常的な見守りとは対象が違います。\nそこで、この空白を埋める機能を自分で設計して作ることにしました。', '操作しない。', '操作しない。'));
  card(s, 0.6, 1.7, 3.9, 4.9);
  T(s, '31', 0.6, 2.0, 3.9, 1.7, { fontSize: 110, bold: true, color: INDIGO, align: 'center', valign: 'middle' });
  T(s, 'サービスを比較', 0.6, 3.75, 3.9, 0.5, { fontSize: 24, bold: true, color: INDIGO, align: 'center' });
  T(s, '厚生労働省\n「電子版お薬手帳サービス一覧」\n（2025年12月1日現在）', 0.8, 4.6, 3.5, 1.2, { fontSize: 14, color: INK_SOFT, align: 'center' });
  const items = [
    ['薬の記録・閲覧、本人へのアラーム', 'ある', SAGE],
    ['家族の「別の端末」への服薬状況の通知', '確認できず', CLAY],
    ['映像による服薬の確認', '確認できず', CLAY],
  ];
  items.forEach(([label, state, color], i) => {
    const y = 1.7 + i * 1.25;
    card(s, 4.9, y, 7.8, 1.05, i === 0 ? PAPER_WARM : 'F6E3E0');
    T(s, label, 5.2, y, 5.0, 1.05, { fontSize: 20, valign: 'middle', bold: i > 0 });
    card(s, 10.3, y + 0.25, 2.1, 0.55, color);
    T(s, state, 10.3, y + 0.25, 2.1, 0.55, { fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  });
  T(s, '一部にある「多職種連携機能」は、医療・介護の専門職どうしの連携が目的。\n家族個人の端末への通知や、服薬の映像の共有とは対象が異なる。', 4.9, 5.55, 7.8, 1.0, { fontSize: 16, color: INK_SOFT });
}

// ============ 4. 目的と4つの機能 ============
{
  const s = content('目的：家族の「見守り」まで含めた服薬管理を実現する', notes(40,
    '本研究の目的は、薬を飲む本人だけでなく、離れて暮らす家族や介護に関わる人による見守りまでを含めた服薬管理を、Webアプリケーションとして実現することです。\nそのために、4つの機能を作りました。1つ目は、服薬の完了や飲み忘れを家族の端末へ自動で知らせる「見守り通知機能」。2つ目は、服薬時刻に全画面と音声で知らせ、内向きカメラで飲む様子を録画する「映像記録機能」。3つ目は、招待コードで家族がつながる「ケアグループ機能」。4つ目は、薬局のQRコードと手入力の両方に対応した「薬の登録機能」です。\nこのあと1つずつ、実際の画面と一緒に紹介し、最後に工夫した点を2つお話しします。',
    'ログイン後のホーム画面を映したままにしておく（まだ操作はしない）。',
    'scrcpy でスマホの画面を映すのは次のスライドから。ここでは操作しない。'));
  const feats = [
    ['1', '見守り通知', '服薬完了・飲み忘れを、家族・介護者の別の端末へ自動でプッシュ通知', INDIGO],
    ['2', '映像記録', '服薬時刻に全画面と音声で知らせ、内向きカメラで服薬の様子を録画。家族が後から確認', TERRA_DEEP],
    ['3', 'ケアグループ', '招待コードで家族がつながる。1人を複数の家族・介護者で見守れる', SAGE],
    ['4', '薬の登録', '薬局のQRコード（JAHIS形式）の読み取りと、手入力の両方に対応', INDIGO_DEEP],
  ];
  feats.forEach(([n, head, body, color], i) => {
    const x = 0.6 + (i % 2) * 6.2, y = 1.65 + Math.floor(i / 2) * 1.95;
    card(s, x, y, 5.9, 1.75, color);
    T(s, `機能 ${n}`, x + 0.35, y + 0.2, 1.6, 0.4, { fontSize: 15, color: WHITE });
    T(s, head, x + 0.35, y + 0.55, 5.2, 0.55, { fontSize: 26, bold: true, color: WHITE });
    T(s, body, x + 0.35, y + 1.1, 5.3, 0.6, { fontSize: 15, color: WHITE });
  });
  card(s, 0.6, 5.65, 12.1, 0.95, 'F8E4D9');
  T(s, '工夫したこと', 0.9, 5.65, 2.4, 0.95, { fontSize: 20, bold: true, color: TERRA_DEEP, valign: 'middle' });
  T(s, '① アラーム画面を、ひと目で分かるレイアウトにした\n② 1つのアカウントで「見守る側」と「見守られる側」を兼ねられる', 3.3, 5.65, 9.2, 0.95, { fontSize: 17, valign: 'middle' });
}

// ============ 5. 機能1 見守り通知 ============
{
  const s = content('機能1：見守り通知 ― 家族の端末へ自動で知らせる', notes(75,
    '1つ目の見守り通知機能です。本人が服薬を記録すると、見守っている家族の端末に、すぐプッシュ通知が届きます。通知はお薬1つにつき1通で、「8時のロキソニン」のように、どのお薬かが分かる文にしました。\n映像つきで記録したときは「服薬映像」、本人が「今回はスキップ」を選んだときは「スキップ」の通知が届きます。\nそして、服薬時刻から30分たっても記録が無いときは、サーバーが毎分の定期処理で見つけて、家族に「まだお薬の記録がありません」と知らせます。「飲み忘れ」と決めつけず、記録が無いという事実だけを伝える文言にしています。\n通知をタップすると、その家族のホーム画面が開き、知らせのあったお薬のカードが跳ねて示されます。\n通知は、ブラウザにはWeb Push、Android版にはFirebase Cloud Messagingで届けています。',
    '① 本人のアカウントで、ホーム画面の予定の「お薬を飲む」→「飲みました（映像なしで記録する）」を押す。\n② 家族のアカウントでログインしたPCのブラウザ（別のウィンドウ）に、画面右下の「服薬完了：○○さん」の通知が出るのを見せる。\n③ 通知をクリックし、家族の表示のホーム画面が開いて、そのお薬のカードが跳ねるのを見せる。',
    '① 家族のアカウントでログインしたスマホ（Android版）の scrcpy のウィンドウに、Meet の共有を切り替える。\n② 本人側で記録すると、スマホの画面上部に「服薬完了：○○さん」の通知が出ることを見せる。\n③ 通知をタップして、アプリのホーム画面でそのお薬のカードが跳ねるのを見せる。\n※ 事前に、マイページの「ご家族のお知らせ」で「お知らせを受け取る」を済ませておく。'));
  // 左：きっかけ
  const trig = [
    ['本人が「飲みました」と記録', '服薬完了', SAGE],
    ['映像つきで記録', '服薬映像', SAGE],
    ['本人が「今回はスキップ」', 'スキップ', INK_SOFT],
    ['30分たっても記録が無い', 'まだお薬の記録がありません', CLAY],
  ];
  T(s, 'こんなときに', 0.6, 1.6, 5.6, 0.4, { fontSize: 16, color: INK_SOFT });
  trig.forEach(([when, kind, color], i) => {
    const y = 2.05 + i * 0.92;
    card(s, 0.6, y, 5.6, 0.78);
    T(s, when, 0.85, y, 3.0, 0.78, { fontSize: 16, valign: 'middle' });
    card(s, 3.85, y + 0.135, 2.2, 0.51, color);
    T(s, kind, 3.85, y + 0.135, 2.2, 0.51, { fontSize: kind.length > 6 ? 11 : 15, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  });
  arrow(s, 6.35, 3.65, 0.75, TERRA_DEEP);
  // 右：家族の端末（通知の例）
  card(s, 7.25, 1.6, 5.45, 4.0, INDIGO);
  T(s, '家族・介護者の端末', 7.55, 1.75, 4.9, 0.45, { fontSize: 18, bold: true, color: WHITE });
  [['服薬完了：花子さん', '08:00の「ロキソニン」を服用したことが記録されました。'],
   ['まだお薬の記録がありません：花子さん', '08:00の「アムロジン」は、予定の時間を過ぎましたが、まだ記録がありません。']].forEach(([h, b], i) => {
    const y = 2.3 + i * 1.4;
    card(s, 7.55, y, 4.85, 1.25, WHITE);
    T(s, h, 7.75, y + 0.12, 4.5, 0.4, { fontSize: 15, bold: true, color: i ? CLAY : INDIGO });
    T(s, b, 7.75, y + 0.55, 4.5, 0.75, { fontSize: 13 });
  });
  T(s, '1つのお薬につき1通。どの薬かが文で分かる', 7.55, 5.05, 4.9, 0.4, { fontSize: 13, color: 'CFE0DC' });
  // 下：補足
  card(s, 0.6, 5.85, 12.1, 0.75, 'F8E4D9');
  T(s, '通知をタップ → 家族のホーム画面で、そのお薬のカードが跳ねて示される　／　届け方：ブラウザは Web Push、Android版は FCM', 0.85, 5.85, 11.7, 0.75, { fontSize: 15, valign: 'middle' });
}

// ============ 6. 機能2 映像記録 ============
{
  const s = content('機能2：映像記録 ― 服薬の様子を、家族が後から確認', notes(75,
    '2つ目の映像記録機能です。服薬時刻になると、アプリを開いていれば、どの画面にいても全画面のアラームが出て、チャイムと振動、そしてお薬の名前と用量の読み上げで知らせます。\n「カメラを起動する」を押すと内向きのカメラが起動し、飲む様子を録画します。飲み終えて「飲みました（映像つきで記録する）」を押せば記録されます。押し忘れても、30秒たつと自動で映像つきで記録されます。カメラを使いたくないときは、映像なしでも記録できます。\n家族は、記録や通知から「映像を見る」で再生できます。映像は個人情報なので、見せるかどうかを本人が家族ごとに決めます。再生には、見るたびに発行し、発行から1時間で切れる署名付きURLを使っています。',
    '① 事前に、本人のお薬の服薬時刻を「発表のこの場面の1〜2分後」に登録しておき、アラームの全画面が出るのを見せる（音を出すため、一度画面をクリックしておく）。\n② 「カメラを起動する」→ 内側のカメラで「● 記録中（あと○秒）」が出るのを見せ、「飲みました（映像つきで記録する）」を押す。\n③ 家族のアカウントの画面で、記録の「映像を見る」を押し、別のタブで映像が再生されるのを見せる。',
    '① スマホ（Android版・本人のアカウント）の scrcpy のウィンドウに、Meet の共有を切り替える。アプリを閉じた状態・ロック中でも、服薬時刻に全画面の「お薬の時間です」が出て、音と読み上げが鳴ることを見せる（ロック中を見せるときは、スマホの電源ボタンで画面を消しておく。scrcpy のウィンドウは黒くなるが、服薬時刻に画面が点くと映る）。\n② 「カメラを起動する」を押し、ロックを解除すると、アプリの撮影画面でカメラが起動することを見せる。\n③ 記録したあと、家族の端末に「服薬映像：○○さん」の通知が届くことを見せる。'));
  const steps = [
    ['1', '服薬時刻に知らせる', '全画面のアラーム\nチャイム・振動・\n薬の名前の読み上げ', INDIGO],
    ['2', '内向きカメラで録画', '飲む様子を録画して記録\n30秒たつと自動で記録\n映像なしでも記録できる', TERRA_DEEP],
    ['3', '家族が後から確認', '「映像を見る」で再生\n通知「服薬映像：○○さん」\nからも開ける', SAGE],
  ];
  steps.forEach(([n, head, body, color], i) => {
    const x = 0.6 + i * 4.13;
    card(s, x, 1.7, 3.84, 3.0, color);
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.3, y: 1.95, w: 0.6, h: 0.6, fill: { color: WHITE }, line: { color: WHITE, width: 0 } });
    s.addText(n, { x: x + 0.3, y: 1.95, w: 0.6, h: 0.6, fontFace: FONT, fontSize: 20, bold: true, color, align: 'center', valign: 'middle', margin: 0 });
    T(s, head, x + 1.05, 1.95, 2.7, 0.6, { fontSize: 20, bold: true, color: WHITE, valign: 'middle' });
    T(s, body, x + 0.3, 2.85, 3.3, 1.7, { fontSize: 17, color: WHITE });
    if (i < 2) arrow(s, x + 3.86, 3.2, 0.25);
  });
  const pts = [
    ['見せる相手は本人が決める', '服薬映像を見せるかどうかを、見守る家族ごとに設定できる'],
    ['期限つきのURLで再生', '見るたびに、発行から1時間で切れる署名付きURLを発行して再生する'],
  ];
  pts.forEach(([head, body], i) => {
    const x = 0.6 + i * 6.2;
    card(s, x, 4.95, 5.9, 1.65);
    T(s, head, x + 0.3, 5.1, 5.3, 0.5, { fontSize: 19, bold: true, color: INDIGO });
    T(s, body, x + 0.3, 5.65, 5.3, 0.85, { fontSize: 15 });
  });
}

// ============ 7. 機能3 ケアグループ ============
{
  const s = content('機能3：ケアグループ ― 1人を複数の人で見守る', notes(55,
    '3つ目はケアグループ機能です。見守ってもらう人が招待コードを発行して家族に伝え、家族がそのコードを入力すると見守りが始まります。\n1人を、離れて暮らす子どもや、近くに住む親族、介護に関わる人など、複数の人で見守ることができます。\n招待コードは、0とO、1とIのような見間違えやすい文字を除いた、英大文字と数字の8文字です。大文字・小文字のどちらで入力してもつながります。\nまた、本人が見守りを外すと、招待コードが自動的に新しくなり、外された人が前のコードで戻ってこられないようにしました。',
    '① 本人のアカウントで「見守り」タブ →「あなたを見守っているご家族」を開き、招待コードと、見守っている家族の一覧（2人以上）を見せる。\n② 家族のアカウントで「見守り」タブ →「招待コードを入力して見守りを始める」の入力欄を見せる（時間があれば実際に入力して「見守りを始めました。」を見せる）。',
    '操作は Web版と同じ画面なので、スマホでは行わない（時間を Web版のデモに使う）。'));
  // 中央に本人、周りに見守る人
  card(s, 0.6, 1.7, 6.6, 4.9);
  card(s, 2.55, 3.55, 2.7, 1.25, INDIGO);
  T(s, '見守られる本人', 2.55, 3.6, 2.7, 0.5, { fontSize: 17, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  T(s, 'K7M2 XQ9P', 2.55, 4.1, 2.7, 0.55, { fontSize: 20, bold: true, color: 'F2C9B4', align: 'center', valign: 'middle', fontFace: 'Consolas' });
  [['離れて暮らす子', 0.85, 1.95], ['近くの親族', 4.75, 1.95], ['介護に関わる人', 2.7, 5.55]].forEach(([label, x, y]) => {
    card(s, x, y, 2.2, 0.8, TERRA_DEEP);
    T(s, label, x, y, 2.2, 0.8, { fontSize: 15, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  });
  s.addShape(pres.ShapeType.line, { x: 2.3, y: 2.8, w: 0.8, h: 0.7, line: { color: TERRA_DEEP, width: 2.5, endArrowType: 'triangle' } });
  s.addShape(pres.ShapeType.line, { x: 4.7, y: 2.8, w: 0.8, h: 0.7, flipH: true, line: { color: TERRA_DEEP, width: 2.5, endArrowType: 'triangle' } });
  s.addShape(pres.ShapeType.line, { x: 3.9, y: 4.85, w: 0, h: 0.65, flipV: true, line: { color: TERRA_DEEP, width: 2.5, endArrowType: 'triangle' } });
  T(s, 'コードを入力して見守る', 4.1, 5.0, 3.0, 0.4, { fontSize: 13, color: TERRA_DEEP, bold: true });
  const pts = [
    ['1人を複数の人で見守る', '家族・介護者がそれぞれの端末で、予定・記録を見て通知を受け取る（見るだけ）'],
    ['伝えやすい招待コード', '英大文字と数字の8文字。0とO、1とIなど見間違えやすい文字は使わない'],
    ['外したらコードを更新', '本人が見守りを外すと、コードが自動で新しくなる'],
  ];
  pts.forEach(([head, body], i) => {
    const y = 1.7 + i * 1.67;
    card(s, 7.5, y, 5.2, 1.5);
    dot(s, 7.7, y + 0.2, 0.55, String(i + 1), SAGE);
    T(s, head, 8.4, y + 0.2, 4.1, 0.55, { fontSize: 18, bold: true, color: INDIGO, valign: 'middle' });
    T(s, body, 7.75, y + 0.8, 4.8, 0.65, { fontSize: 14 });
  });
}

// ============ 8. 機能4 薬の登録 ============
{
  const s = content('機能4：薬の登録 ― QRコードの読み取りと手入力', notes(55,
    '4つ目は薬の登録です。薬局でもらう明細書には、JAHIS形式という電子お薬手帳用のQRコードが印刷されています。これをスマートフォンのカメラで映すと、薬の名前・用量・単位・飲み方を読み取って、確認画面に並べます。内容を直してから登録できます。\n実物のQRコードは文字コードがShift_JISで、薬の情報も複数の行に分かれていたため、実物に合わせて解析を作りました。\nQRコードが無い薬や、読み取れないときのために、手入力でも登録できます。手入力では、飲む時刻を複数登録でき、この時刻がアラームと見守り通知のもとになります。',
    '① 「お薬」タブ →「手入力で登録」を押し、薬の名前・用量・単位・服薬時刻を入れて「保存する」→「登録しました。」を見せる。\n② PCのカメラではQRコードを読み取れないことがあるため、QRコードの読み取りはスマホで見せる。',
    '① スマホ（Android版）で「お薬」タブ →「QRコードで登録」を押し、薬局の明細書のQRコードを映す。\n② 自動で「読み取り内容の確認」画面に切り替わり、薬が1つずつ並ぶことを見せる。\n③ 「この内容で登録する」→ お薬の一覧に加わることを見せる。'));
  card(s, 0.6, 1.7, 5.9, 4.9, INDIGO);
  T(s, 'QRコードで登録', 0.9, 1.85, 5.3, 0.55, { fontSize: 24, bold: true, color: WHITE });
  T(s, '薬局の明細書の「JAHIS形式」のQRコード', 0.9, 2.4, 5.3, 0.4, { fontSize: 15, color: 'CFE0DC' });
  ['スマホのカメラで映すと自動で読み取る', '文字コード（Shift_JIS）を自動で判別', '薬の名前・用量・単位・飲み方を確認画面に並べる', '内容を直してから登録できる'].forEach((t, i) => {
    const y = 3.0 + i * 0.85;
    card(s, 0.9, y, 5.3, 0.7, INDIGO_DEEP);
    T(s, t, 1.1, y, 5.0, 0.7, { fontSize: 15, color: WHITE, valign: 'middle' });
    if (i < 3) varrow(s, 3.55, y + 0.7, 0.15, 'CFE0DC');
  });
  card(s, 6.8, 1.7, 5.9, 4.9);
  T(s, '手入力で登録', 7.1, 1.85, 5.3, 0.55, { fontSize: 24, bold: true, color: INDIGO });
  T(s, 'QRコードが無い薬・読み取れないとき', 7.1, 2.4, 5.3, 0.4, { fontSize: 15, color: INK_SOFT });
  s.addText([
    { text: '薬の名前・用量・単位を入力（必須）', options: { bullet: true, breakLine: true } },
    { text: '飲む時刻と食前・食後を、複数登録できる', options: { bullet: true, breakLine: true } },
    { text: '誤りがあれば、直す欄を文で示す', options: { bullet: true } },
  ], { x: 7.1, y: 3.0, w: 5.3, h: 2.0, fontFace: FONT, fontSize: 17, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 12, isTextBox: true });
  card(s, 7.1, 5.3, 5.3, 1.0, 'F8E4D9');
  T(s, '登録した飲む時刻が、アラームと\n見守り通知のもとになる', 7.3, 5.3, 5.0, 1.0, { fontSize: 16, bold: true, color: TERRA_DEEP, valign: 'middle' });
}

// ============ 9. 工夫① アラーム画面 ============
{
  const s = content('工夫①：ひと目で分かるアラーム画面', notes(70,
    '工夫した点の1つ目は、アラーム画面の分かりやすさです。高齢の利用者が、慌てずに、迷わず操作できることを目指しました。\nまず、時刻を2つに分けました。大きく「8時に飲む」と予定の時刻を出し、いまの時刻は上に小さく出します。「あとで」で後回しにしたときも、何時の薬なのかを取り違えません。\n次に、お薬の名前と用量は、白い地にテラコッタ色の枠で囲み、見出しと見分けられるようにしました。\nボタンは、いちばん押してほしい「カメラを起動する」を大きなテラコッタ色にし、「映像なしで記録」「あとで」と、下へ行くほど控えめな色にして、押す順番が見て分かるようにしています。ベルなどの飾りの絵は置かず、画面の高さを文字とボタンに使いました。\n音は、チャイムと、お薬の名前と用量の読み上げを交互に繰り返します。同じ時刻に薬が複数あるときは、薬ごとの枠に分けて、1つずつ記録できるようにしました。',
    '① スライド6で出したアラームを、もう一度出して見せる（服薬時刻を少しずらして2つ目のお薬を登録しておく）。\n② 「08:00 に飲む」と「いまの時刻」、薬の名前の枠、3つのボタンの並びを、マウスで指しながら説明する。\n③ お薬が2つあるときの、お薬ごとの枠の表示も見せる。',
    '① スマホ（Android版）の全画面のアラームを映し、アプリの中の画面と同じ並びになっていることを見せる。\n② 「あとで」を押し、「08:25 に／もう一度お知らせします」の表示が出ることを見せる。'));
  // 左：アラーム画面の模式図
  card(s, 0.6, 1.6, 4.3, 5.05, PAPER);
  s.addShape(pres.ShapeType.roundRect, { x: 0.6, y: 1.6, w: 4.3, h: 5.05, fill: { type: 'none' }, line: { color: LINE, width: 1.5 }, rectRadius: 0.12 });
  T(s, 'いまの時刻 08:20', 0.6, 1.72, 4.3, 0.3, { fontSize: 11, color: INK_SOFT, align: 'center' });
  s.addText([{ text: '08:00', options: { fontSize: 30, bold: true } }, { text: ' に飲む', options: { fontSize: 15, bold: true } }], { x: 0.6, y: 2.0, w: 4.3, h: 0.55, fontFace: FONT, color: INDIGO, align: 'center', valign: 'middle', margin: 0 });
  T(s, 'お薬の時間です', 0.6, 2.55, 4.3, 0.45, { fontSize: 20, bold: true, color: INDIGO, align: 'center', valign: 'middle' });
  s.addShape(pres.ShapeType.roundRect, { x: 0.95, y: 3.1, w: 3.6, h: 0.65, fill: { color: WHITE }, line: { color: TERRA, width: 2 }, rectRadius: 0.08 });
  T(s, 'ロキソニン 1錠', 0.95, 3.1, 3.6, 0.65, { fontSize: 17, bold: true, align: 'center', valign: 'middle' });
  card(s, 0.95, 3.9, 3.6, 0.95, TERRA);
  T(s, 'カメラを起動する', 0.95, 3.9, 3.6, 0.95, { fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle' });
  s.addShape(pres.ShapeType.roundRect, { x: 0.95, y: 5.0, w: 3.6, h: 0.55, fill: { color: WHITE }, line: { color: INDIGO, width: 1.5 }, rectRadius: 0.08 });
  T(s, '飲みました（映像なしで記録する）', 0.95, 5.0, 3.6, 0.55, { fontSize: 11, bold: true, color: INDIGO, align: 'center', valign: 'middle' });
  s.addShape(pres.ShapeType.roundRect, { x: 0.95, y: 5.7, w: 3.6, h: 0.5, fill: { color: WHITE }, line: { color: 'B9B3AA', width: 1 }, rectRadius: 0.08 });
  T(s, 'あとで（5分後にもう一度お知らせ）', 0.95, 5.7, 3.6, 0.5, { fontSize: 10, color: INK_SOFT, align: 'center', valign: 'middle' });
  T(s, '画面の並び（模式図）', 0.6, 6.25, 4.3, 0.35, { fontSize: 11, color: INK_SOFT, align: 'center' });
  // 右：工夫の4点
  const g = [
    ['「飲む時刻」と「いまの時刻」を分ける', '予定の時刻を大きく、いまの時刻は小さく。後回しにしても取り違えない'],
    ['薬の名前は枠で囲んで目立たせる', '白い地にテラコッタ色の枠。藍色の見出しと見分けられる'],
    ['ボタンの大きさと色で、押す順番を示す', '「カメラを起動する」を最も大きく、下ほど控えめな色に。飾りの絵は置かない'],
    ['音と声で知らせ、薬ごとに記録できる', 'チャイムと「○○を1錠服用してください」の読み上げを交互に。複数の薬は枠に分ける'],
  ];
  g.forEach(([head, body], i) => {
    const y = 1.6 + i * 1.28;
    card(s, 5.2, y, 7.5, 1.15);
    dot(s, 5.4, y + 0.27, 0.6, String(i + 1), [INDIGO, TERRA_DEEP, TERRA_DEEP, SAGE][i]);
    T(s, head, 6.2, y + 0.13, 6.35, 0.45, { fontSize: 18, bold: true, color: INDIGO });
    T(s, body, 6.2, y + 0.58, 6.35, 0.55, { fontSize: 14 });
  });
}

// ============ 10. 工夫② 1つのアカウントで両方の立場 ============
{
  const s = content('工夫②：1つのアカウントで、両方の立場を兼ねる', notes(55,
    '工夫した点の2つ目は、1つのアカウントで「見守る側」と「見守られる側」の両方になれるようにしたことです。\n当初は、登録のときに「患者」か「家族」かを選ぶ設計でした。しかしそれでは、自分も薬を飲みながら親を見守りたい、という人が使えません。高齢の夫婦が互いに見守り合う場合も同じです。\nそこで、役割で画面を分けるのをやめ、「家族に見守ってもらう」「家族を見守る」の2つの機能を、利用者ごとにオン・オフで選べるようにしました。使わない機能の操作は画面に出さないので、画面が複雑になりません。\n家族の情報を見ているあいだは画面全体の色が変わり、自分の情報と取り違えないようにしています。',
    '① ホーム画面の上の「自分」「○○さん」の切り替えボタンを押し、画面の色が藍色からテラコッタ色に変わり、「見守り中：○○さんの情報を見ています」の帯が出ることを見せる。\n② 「マイページ」→「使う機能」の「家族に見守ってもらう」「家族を見守る」の2つのチェックを見せる。',
    'Web版と同じ画面なので、スマホでは行わない。'));
  // 左：当初の設計 → 今
  card(s, 0.6, 1.7, 3.6, 2.35);
  T(s, '当初の設計', 0.85, 1.85, 3.1, 0.4, { fontSize: 15, color: INK_SOFT });
  T(s, '登録時に「患者」か\n「家族」かを選ぶ', 0.85, 2.25, 3.1, 0.8, { fontSize: 17, bold: true });
  T(s, '自分も薬を飲みながら\n親を見守る人が使えない', 0.85, 3.1, 3.1, 0.8, { fontSize: 15, bold: true, color: CLAY });
  arrow(s, 4.3, 2.85, 0.6, TERRA_DEEP);
  card(s, 5.0, 1.7, 7.7, 2.35, INDIGO);
  T(s, '使う機能を、利用者ごとに選ぶ', 5.3, 1.85, 7.1, 0.5, { fontSize: 20, bold: true, color: WHITE });
  [['家族に見守ってもらう', 'ON'], ['家族を見守る', 'ON']].forEach(([label, st], i) => {
    const x = 5.3 + i * 3.65;
    card(s, x, 2.5, 3.4, 0.75, INDIGO_DEEP);
    T(s, '☑ ' + label, x + 0.2, 2.5, 3.1, 0.75, { fontSize: 15, bold: true, color: WHITE, valign: 'middle' });
  });
  T(s, '両方ONにすれば、1つのアカウントで両方の立場になれる。使わない機能の操作は画面に出さない', 5.3, 3.35, 7.1, 0.65, { fontSize: 14, color: 'CFE0DC' });
  // 下：例
  card(s, 0.6, 4.3, 12.1, 2.3, PAPER_WARM);
  T(s, '例：自分も薬を飲みながら、母を見守る', 0.9, 4.42, 11.5, 0.4, { fontSize: 16, bold: true, color: INDIGO });
  card(s, 0.9, 5.0, 3.0, 1.35, SAGE); T(s, '配偶者', 0.9, 5.05, 3.0, 0.6, { fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle' }); T(s, '見守る側', 0.9, 5.65, 3.0, 0.5, { fontSize: 14, color: WHITE, align: 'center' });
  card(s, 5.15, 5.0, 3.0, 1.35, TERRA_DEEP); T(s, 'あなた', 5.15, 5.05, 3.0, 0.6, { fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle' }); T(s, '見守る側＋見守られる側', 5.15, 5.65, 3.0, 0.5, { fontSize: 14, color: WHITE, align: 'center' });
  card(s, 9.4, 5.0, 3.0, 1.35, INDIGO); T(s, '母', 9.4, 5.05, 3.0, 0.6, { fontSize: 18, bold: true, color: WHITE, align: 'center', valign: 'middle' }); T(s, '見守られる側', 9.4, 5.65, 3.0, 0.5, { fontSize: 14, color: WHITE, align: 'center' });
  arrow(s, 3.95, 5.67, 1.15, INK_SOFT); T(s, '見守る', 3.95, 5.25, 1.15, 0.35, { fontSize: 13, color: INK_SOFT, align: 'center' });
  arrow(s, 8.2, 5.67, 1.15, INK_SOFT); T(s, '見守る', 8.2, 5.25, 1.15, 0.35, { fontSize: 13, color: INK_SOFT, align: 'center' });
}

// ============ 11. Webの限界とAndroid版 ============
{
  const s = content('Webアプリの限界と、Android版の追加', notes(50,
    '開発を進める中で、Webアプリの限界も分かりました。アプリを閉じているあいだや画面のロック中は、音を鳴らし続けられません。\n服薬のアラームは確実に気付いてもらう必要があるので、Android版を追加しました。Capacitorを使ってWeb版の画面をそのままアプリに同梱し、アラームの部分だけをJavaで作っています。画面とサーバーとデータベースは共通です。\nAndroid版では、アプリを閉じていてもロック中でも、全画面のアラームが鳴ります。一方で、利用者に4種類の許可を設定してもらう必要があり、家族宛ての通知にはFirebase Cloud Messagingを加えました。',
    '操作はしない（時間が足りないときは、このスライドを短く話す）。',
    '時間に余裕があれば、マイページの「お薬の時間のアラーム」の欄で、4つの設定が「済み ✓」になっている画面を見せる。'));
  card(s, 0.6, 1.7, 5.9, 3.3);
  T(s, 'Web版（ブラウザ・PWA）', 0.9, 1.85, 5.3, 0.5, { fontSize: 22, bold: true, color: INDIGO });
  s.addText([
    { text: 'インストール不要。URLを伝えるだけで使える', options: { bullet: true, breakLine: true } },
    { text: '家族へのプッシュ通知を受け取れる', options: { bullet: true, breakLine: true } },
    { text: 'アプリを閉じている・ロック中は、音を鳴らし続けられない', options: { bullet: true, color: CLAY, bold: true } },
  ], { x: 0.9, y: 2.5, w: 5.3, h: 2.3, fontFace: FONT, fontSize: 17, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 12, isTextBox: true });
  card(s, 6.8, 1.7, 5.9, 3.3, INDIGO);
  T(s, 'Android版（Capacitor ＋ Java）', 7.1, 1.85, 5.3, 0.5, { fontSize: 22, bold: true, color: WHITE });
  s.addText([
    { text: '閉じていても、ロック中でも、全画面のアラームが鳴る', options: { bullet: true, bold: true, breakLine: true } },
    { text: '端末を再起動しても、アラームの予約が残る', options: { bullet: true, breakLine: true } },
    { text: '4種類の許可の設定が必要／家族宛ての通知は別の仕組み（FCM）で受け取る', options: { bullet: true, color: 'F2C9B4' } },
  ], { x: 7.1, y: 2.5, w: 5.3, h: 2.3, fontFace: FONT, fontSize: 17, color: WHITE, margin: 0, valign: 'top', paraSpaceAfter: 12, isTextBox: true });
  card(s, 0.6, 5.25, 12.1, 1.35, 'F8E4D9');
  T(s, '画面は1つ、届け方は2つ', 0.9, 5.4, 4.6, 1.05, { fontSize: 24, bold: true, color: TERRA_DEEP, valign: 'middle' });
  T(s, 'Web版の画面をそのままアプリに同梱。新しく作ったのはアラームの部分（Javaで約2,300行）だけで、画面・サーバー・データベースは共通。Web版を直せばAndroid版にも反映できる。', 5.5, 5.4, 7.0, 1.05, { fontSize: 15, valign: 'middle' });
}

// ============ 12. まとめと今後の課題 ============
{
  const s = pres.addSlide({ masterName: 'DARK' });
  T(s, 'まとめと今後の課題', 0.6, 0.4, 12.1, 0.9, { fontSize: 32, bold: true, color: WHITE, valign: 'middle' });
  card(s, 0.6, 1.6, 5.9, 4.5, INDIGO_DEEP);
  T(s, '実現したこと', 0.9, 1.8, 5.3, 0.5, { fontSize: 22, bold: true, color: 'F2C9B4' });
  s.addText([
    { text: '既存サービスにない、家族の端末への見守り通知と、映像による服薬の確認', options: { bullet: true, breakLine: true } },
    { text: '招待コードのケアグループと、QRコード・手入力による薬の登録', options: { bullet: true, breakLine: true } },
    { text: '工夫：ひと目で分かるアラーム画面／1つのアカウントで見守る側と見守られる側を兼ねる', options: { bullet: true } },
  ], { x: 0.9, y: 2.45, w: 5.3, h: 3.5, fontFace: FONT, fontSize: 18, color: WHITE, margin: 0, valign: 'top', paraSpaceAfter: 14, isTextBox: true });
  card(s, 6.8, 1.6, 5.9, 4.5, WHITE);
  T(s, '今後の課題', 7.1, 1.8, 5.3, 0.5, { fontSize: 22, bold: true, color: TERRA_DEEP });
  s.addText([
    { text: '高齢者を含む利用者による評価（Web版とAndroid版の比較）', options: { bullet: true, breakLine: true } },
    { text: 'ほかの薬局のQRコードでの検証', options: { bullet: true, breakLine: true } },
    { text: '映像を見せていない家族にも、服薬したことを知らせる', options: { bullet: true, breakLine: true } },
    { text: 'iOSでの検証と対応', options: { bullet: true, breakLine: true } },
    { text: 'マイナポータル連携による処方薬情報の自動取得', options: { bullet: true } },
  ], { x: 7.1, y: 2.45, w: 5.3, h: 3.5, fontFace: FONT, fontSize: 18, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 14, isTextBox: true });
  T(s, 'ご清聴ありがとうございました', 0.6, 6.4, 12.1, 0.6, { fontSize: 22, color: 'CFE0DC', align: 'center', valign: 'middle' });
  s.addNotes(notes(40,
    'まとめです。既存のサービスにない、家族の端末への見守り通知と、映像による服薬の確認を、Webアプリケーションとして実現しました。あわせて、招待コードによるケアグループと、QRコードと手入力による薬の登録を作りました。工夫した点は、ひと目で分かるアラーム画面と、1つのアカウントで見守る側と見守られる側を兼ねられる仕組みです。\n今後の課題は、高齢者を含む実際の利用者による評価、ほかの薬局のQRコードでの検証、iOSへの対応などです。\n以上で発表を終わります。ご清聴ありがとうございました。',
    'デモの画面から PowerPoint のスライドショーに画面共有を戻す。',
    '操作しない。'));
}

pres.writeFile({ fileName: OUT }).then((f) => console.log('saved', f));
