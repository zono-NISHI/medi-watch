// ============================================================
//  卒論発表のスライド（.pptx）を作る
//  使い方: scripts/thesis/slides で  node build_slides.js [出力先.pptx]
//  - 持ち時間 12分・13枚（1枚あたり約55秒）。話す内容は各スライドのノートに入れている
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
  s.addNotes('【約20秒】\n「家族見守り型 電子お薬手帳Webアプリケーション medi-watch の設計と開発」について発表します。システム情報学科の西薗正彦です。よろしくお願いします。');
}

// ============ 2. 背景 ============
{
  const s = content('背景：薬を飲めたかを、離れた家族は確かめられない', '【約50秒】\n日本は高齢社会で、複数の薬を毎日飲む高齢者が増えています。記憶力の低下や生活リズムの乱れで、飲み忘れや重複服薬が起こりやすくなります。\n一方で、核家族化が進み、離れて暮らす家族には「今日、薬をきちんと飲めたのか」を確かめる手段がほとんどありません。\nこの「家族による見守り」を、手持ちのスマートフォンで実現できないかと考えたのが、本研究の出発点です。');
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
  const s = content('既存サービスの調査：「家族の見守り」は空白だった', '【約55秒】\n厚生労働省が公開している電子版お薬手帳サービスの一覧、31サービスについて機能を調べました。\n薬の記録や閲覧、本人へのアラームはどのサービスにもありますが、家族の「別の端末」へ服薬状況を知らせる機能や、映像で服薬を確かめる機能は、調べた範囲では確認できませんでした。\n一部に多職種連携の機能はありますが、医療・介護の専門職どうしの連携が目的で、家族の日常的な見守りとは対象が違います。\nそこで、この空白を埋める機能を自分で設計して作ることにしました。');
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

// ============ 4. 目的と提案する機能 ============
{
  const s = content('目的：家族の「見守り」まで含めた服薬管理を実現する', '【約50秒】\n本研究の目的は、薬を飲む本人だけでなく、離れて暮らす家族による見守りまでを含めた服薬管理を、Webアプリケーションとして実現することです。\n柱は2つです。1つ目は、服薬完了や飲み忘れを家族の端末へプッシュ通知する機能。2つ目は、服薬時刻に音声で知らせ、内向きカメラで飲む様子を録画して、家族が後から確認できる機能です。\nこれを支える機能として、招待コードによる見守りのグループと、薬局のQRコードからの薬の登録を用意しました。主な利用者は高齢者なので、画面の分かりやすさも重視しています。');
  const pillars = [
    ['見守り通知', '服薬完了・飲み忘れを\n家族の別の端末へ\nプッシュ通知する', INDIGO],
    ['映像記録', '服薬時刻に音声で知らせ、\n内向きカメラで服薬の様子を\n録画して家族が確認できる', TERRA_DEEP],
  ];
  pillars.forEach(([head, body, color], i) => {
    const x = 0.6 + i * 6.2;
    card(s, x, 1.7, 5.9, 2.9, color);
    T(s, `柱 ${i + 1}`, x + 0.4, 1.95, 2, 0.4, { fontSize: 16, color: WHITE });
    T(s, head, x + 0.4, 2.35, 5.1, 0.7, { fontSize: 32, bold: true, color: WHITE });
    T(s, body, x + 0.4, 3.1, 5.1, 1.4, { fontSize: 19, color: WHITE });
  });
  const subs = [
    ['ケアグループ', '招待コードで家族がつながる。1人を複数の家族が見守れる'],
    ['薬の登録', '薬局のQRコード（JAHIS形式）の読み取りと、手入力の2方式'],
    ['高齢者向けの画面', '大きな文字とボタン、分かりやすい導線'],
  ];
  subs.forEach(([head, body], i) => {
    const x = 0.6 + i * 4.13;
    card(s, x, 4.9, 3.84, 1.7);
    T(s, head, x + 0.25, 5.05, 3.4, 0.45, { fontSize: 19, bold: true, color: INDIGO });
    T(s, body, x + 0.25, 5.55, 3.4, 1.0, { fontSize: 15 });
  });
}

// ============ 5. システム構成 ============
{
  const s = content('システム構成：1つのサーバーが画面とAPIを配信する', '【約55秒】\nシステムの構成です。画面はライブラリを使わない素のHTML・CSS・JavaScriptで作りました。画面数が10画面と限られるため、ビルド環境を入れるより見通しがよいと判断しました。\nサーバーはNode.jsのExpressで、Renderに公開しています。画面の配信とAPIの両方を1つのサーバーで行います。\nデータベース・認証・映像の保存には、BaaSのSupabaseを使いました。確認メールはBrevo経由で送ります。\nサーバーの中では毎分の定期処理が動いていて、服薬時刻の前の通知と、飲み忘れの検知を行い、Web Pushで本人と家族の端末へ知らせます。');
  // 左：利用者の端末
  card(s, 0.6, 1.7, 3.3, 4.9);
  T(s, '利用者の端末', 0.6, 1.85, 3.3, 0.45, { fontSize: 18, bold: true, color: INDIGO, align: 'center' });
  [['Web版（PWA）', 'HTML / CSS / JavaScript'], ['Android版', '同じ画面を同梱＋Javaのアラーム'], ['Service Worker', 'プッシュ通知の受信・表示']].forEach(([h, b], i) => {
    const y = 2.45 + i * 1.35;
    card(s, 0.85, y, 2.8, 1.15, WHITE);
    T(s, h, 1.0, y + 0.12, 2.5, 0.45, { fontSize: 16, bold: true });
    T(s, b, 1.0, y + 0.58, 2.5, 0.5, { fontSize: 13, color: INK_SOFT });
  });
  // 中央：サーバー
  card(s, 5.0, 1.7, 3.5, 4.9, INDIGO);
  T(s, 'サーバー（Render）', 5.0, 1.85, 3.5, 0.45, { fontSize: 18, bold: true, color: WHITE, align: 'center' });
  T(s, 'Node.js / Express', 5.0, 2.3, 3.5, 0.4, { fontSize: 15, color: 'CFE0DC', align: 'center' });
  [['REST API', '認証・薬・予定・記録・見守り・通知'], ['定期処理（毎分）', '服薬前の通知・飲み忘れの検知'], ['QRコードの解析', 'JAHIS形式から薬の情報を抽出']].forEach(([h, b], i) => {
    const y = 2.85 + i * 1.22;
    card(s, 5.25, y, 3.0, 1.05, INDIGO_DEEP);
    T(s, h, 5.4, y + 0.1, 2.7, 0.42, { fontSize: 16, bold: true, color: WHITE });
    T(s, b, 5.4, y + 0.53, 2.7, 0.45, { fontSize: 13, color: 'CFE0DC' });
  });
  // 右：Supabase ほか
  card(s, 9.6, 1.7, 3.1, 3.55);
  T(s, 'Supabase（BaaS）', 9.6, 1.85, 3.1, 0.45, { fontSize: 18, bold: true, color: INDIGO, align: 'center' });
  ['PostgreSQL（8テーブル・RLS）', 'Auth（認証・メール確認）', 'Storage（服薬映像）'].forEach((t, i) => {
    const y = 2.45 + i * 0.9;
    card(s, 9.85, y, 2.6, 0.72, WHITE);
    T(s, t, 9.95, y, 2.4, 0.72, { fontSize: 14, valign: 'middle', align: 'center' });
  });
  card(s, 9.6, 5.5, 3.1, 1.1);
  T(s, 'Brevo（メール送信）', 9.6, 5.6, 3.1, 0.45, { fontSize: 16, bold: true, color: INDIGO, align: 'center' });
  T(s, '確認コードのメール', 9.6, 6.05, 3.1, 0.4, { fontSize: 13, color: INK_SOFT, align: 'center' });
  // 矢印
  arrow(s, 3.95, 3.3, 1.0, INK_SOFT); T(s, 'HTTPS', 3.95, 2.9, 1.0, 0.35, { fontSize: 13, color: INK_SOFT, align: 'center' });
  s.addShape(pres.ShapeType.line, { x: 3.95, y: 5.7, w: 1.0, h: 0, line: { color: TERRA_DEEP, width: 2.5, beginArrowType: 'triangle' } });
  T(s, 'Web Push', 3.9, 5.8, 1.1, 0.35, { fontSize: 13, color: TERRA_DEEP, align: 'center', bold: true });
  arrow(s, 8.55, 3.5, 1.0, INK_SOFT);
}

// ============ 6. 服薬の流れ ============
{
  const s = content('服薬の流れ：知らせる手段を3段階に重ねた', '【約60秒】\n服薬の流れです。たとえば朝8時の薬の場合、5分前に本人の端末へプッシュ通知が届きます。\n8時になると、アプリを開いていれば画面いっぱいにアラームが出て、音と読み上げと振動で知らせます。\n「お薬を飲む」を押すと内向きカメラが起動し、飲む様子を録画できます。止め忘れても30秒で自動的に記録されます。記録されると、家族の端末に「服薬完了」や「服薬映像」の通知が届きます。\nもし30分たっても記録がなければ、家族に「まだお薬の記録がありません」と通知されます。飲み忘れと決めつけず、記録が無いという事実だけを伝えます。本人が気付かなかった場合の、最後の安全策です。');
  const steps = [
    ['7:55', '5分前', 'プッシュ通知\n「お薬の時間です」', INDIGO],
    ['8:00', '服薬時刻', '全画面のアラーム\n音・読み上げ・振動', TERRA_DEEP],
    ['記録', '「お薬を飲む」', '内向きカメラで録画\n（30秒で自動記録）', SAGE],
  ];
  steps.forEach(([big, small, body, color], i) => {
    const x = 0.6 + i * 3.13;
    card(s, x, 1.75, 2.7, 2.75, color);
    T(s, small, x + 0.25, 1.9, 2.4, 0.4, { fontSize: 15, color: WHITE });
    T(s, big, x + 0.25, 2.25, 2.4, 0.9, { fontSize: 40, bold: true, color: WHITE, valign: 'middle' });
    T(s, body, x + 0.25, 3.25, 2.4, 1.1, { fontSize: 16, color: WHITE });
    arrow(s, x + 2.75, 3.1, 0.33);
  });
  card(s, 9.99, 1.75, 2.71, 2.75);
  T(s, '家族の端末へ', 10.2, 1.9, 2.3, 0.4, { fontSize: 15, color: INK_SOFT });
  T(s, '「服薬完了」\n「服薬映像」', 10.2, 2.4, 2.3, 1.1, { fontSize: 20, bold: true, color: SAGE });
  T(s, '映像は、許可された家族だけが再生できる', 10.2, 3.55, 2.3, 0.9, { fontSize: 14 });
  // 飲み忘れの分岐
  varrow(s, 5.08, 4.55, 0.55, CLAY);
  card(s, 0.6, 5.15, 12.1, 1.45, 'F6E3E0');
  dot(s, 0.9, 5.47, 0.8, '!', CLAY);
  T(s, '8:30 になっても記録がないとき', 2.0, 5.3, 5.2, 0.5, { fontSize: 20, bold: true, color: CLAY });
  T(s, '家族の端末へ「まだお薬の記録がありません」と通知する', 2.0, 5.85, 5.4, 0.5, { fontSize: 18 });
  T(s, '本人が気付かなかった場合の、最後の安全策。\n記録は未記録のまま残し、後から記録できる。', 7.6, 5.35, 4.9, 1.1, { fontSize: 15, color: INK_SOFT, valign: 'middle' });
}

// ============ 7. 見守りの仕組み ============
{
  const s = content('見守りの仕組み：1つのアカウントで両方の立場になれる', '【約55秒】\n見守りの仕組みです。見守ってもらう人が招待コードを発行し、家族がそのコードを入力すると見守りが始まります。\n当初は、登録時に「患者」か「家族」かの役割を選ぶ設計でした。しかし、自分も薬を飲みながら親を見守りたい、という人に対応できません。そこで役割で画面を分けるのをやめ、「見守ってもらう」「見守る」の2つの機能を、利用者ごとに選べるようにしました。\n映像を見せるかどうかは、見守られる本人が家族ごとに決められます。また、見守りを外したときは招待コードを自動的に作り直し、外した人が同じコードで戻ってこられないようにしました。');
  card(s, 0.6, 1.75, 3.6, 2.5, INDIGO);
  T(s, '見守ってもらう人', 0.85, 1.95, 3.1, 0.45, { fontSize: 20, bold: true, color: WHITE });
  T(s, '招待コードを発行して\n家族に伝える', 0.85, 2.5, 3.1, 0.9, { fontSize: 17, color: WHITE });
  card(s, 0.85, 3.45, 3.1, 0.6, WHITE);
  T(s, 'K7M2 XQ9P', 0.85, 3.45, 3.1, 0.6, { fontSize: 22, bold: true, color: INDIGO, align: 'center', valign: 'middle', fontFace: 'Consolas' });
  arrow(s, 4.3, 2.6, 1.3, TERRA_DEEP);
  T(s, 'コードを\n入力', 4.3, 2.75, 1.3, 0.8, { fontSize: 14, color: TERRA_DEEP, align: 'center', bold: true });
  card(s, 5.7, 1.75, 3.6, 2.5, TERRA_DEEP);
  T(s, '見守る人（家族）', 5.95, 1.95, 3.1, 0.45, { fontSize: 20, bold: true, color: WHITE });
  T(s, '家族の今日の予定・記録を見る\n通知を受け取る\n（見るだけ。記録はできない）', 5.95, 2.5, 3.2, 1.6, { fontSize: 15, color: WHITE });
  card(s, 9.7, 1.75, 3.0, 2.5);
  T(s, '当初の設計', 9.9, 1.9, 2.6, 0.4, { fontSize: 15, color: INK_SOFT });
  T(s, '「患者」か「家族」かを\n登録時に選ぶ', 9.9, 2.3, 2.6, 0.9, { fontSize: 16 });
  T(s, '自分も飲みながら\n親を見守りたい人が\n使えない', 9.9, 3.2, 2.6, 1.0, { fontSize: 14, color: CLAY, bold: true });
  const pts = [
    ['使う機能を選ぶ', '「見守ってもらう」「見守る」を利用者ごとにON／OFF。使わない操作は画面に出さない'],
    ['映像は本人が決める', '服薬映像を見せるかどうかを、見守られる本人が家族ごとに設定する'],
    ['外したらコードを更新', '外された人が、前の招待コードで見守りを再開できないようにする'],
  ];
  pts.forEach(([head, body], i) => {
    const x = 0.6 + i * 4.13;
    card(s, x, 4.6, 3.84, 2.0);
    dot(s, x + 0.25, 4.8, 0.55, String(i + 1), INDIGO);
    T(s, head, x + 0.95, 4.8, 2.75, 0.55, { fontSize: 18, bold: true, color: INDIGO, valign: 'middle' });
    T(s, body, x + 0.25, 5.5, 3.4, 1.0, { fontSize: 15 });
  });
}

// ============ 8. 実際の画面 ============
{
  const s = content('実際の画面（デモ）', '【約90秒・デモ】\n実際の画面をお見せします。（スマートフォンの画面を映すか、このスライドに貼った画面の写真で説明する）\n①ホーム画面です。今日の予定が時刻順に並び、「これから」「服薬済み」などの状態が色と文字で分かります。\n②「お薬を飲む」を押すと撮影画面が開き、カメラを起動して記録します。\n③家族の側では通知が届き、ホーム画面を家族の表示に切り替えると、配色が変わって、いま誰の情報を見ているかが分かります。\n※ 発表前に、枠の中へ実際の画面の写真（スクリーンショット）を貼ってください。');
  const shots = [['① ホーム', '今日の服薬予定と状態'], ['② 撮影画面', '「お薬を飲む」→ カメラで記録'], ['③ 家族の表示', '通知と、色が変わる見守り表示']];
  shots.forEach(([head, body], i) => {
    const x = 0.6 + i * 4.13;
    s.addShape(pres.ShapeType.roundRect, { x, y: 1.7, w: 3.84, h: 3.9, fill: { color: PAPER }, line: { color: LINE, width: 2, dashType: 'dash' }, rectRadius: 0.1 });
    T(s, 'ここに画面の写真を貼る', x, 1.7, 3.84, 3.9, { fontSize: 16, color: INK_SOFT, align: 'center', valign: 'middle' });
    T(s, head, x, 5.75, 3.84, 0.45, { fontSize: 20, bold: true, color: INDIGO, align: 'center' });
    T(s, body, x, 6.2, 3.84, 0.4, { fontSize: 15, color: INK_SOFT, align: 'center' });
  });
}

// ============ 9. 工夫① 高齢者向けの画面 ============
{
  const s = content('工夫①：高齢の利用者が迷わない画面', '【約55秒】\n工夫した点の1つ目は、高齢の利用者が迷わない画面づくりです。\n文字を大きくし、ボタンは指で押しやすい大きさにしました。状態は色だけでなく文字でも示し、色の見え方によらず分かるようにしています。WCAG 2.2と総務省のガイドラインを参考にしました。\n家族の情報を見ているあいだは画面全体の色を変えて、自分の情報と取り違えないようにしました。\n使わない機能の操作は画面に出しません。機能を増やすことと、画面を分かりやすく保つことは対立しやすいので、利用者ごとに見せる範囲を絞ることで両立を図りました。');
  const g = [
    ['大きな文字と、押しやすいボタン', '基本の文字サイズを大きくし、主なボタンは画面の幅いっぱいに。場面ごとに必要なボタンだけを出す', INDIGO],
    ['状態は「色」と「文字」の両方で', '「服薬済み」「これから」「時間が過ぎています」。色の見え方によらず判別できる', SAGE],
    ['見ている人を、画面の色で区別', '自分は藍色、家族はテラコッタ色。情報の取り違えを防ぐ', TERRA_DEEP],
    ['使わない機能は、画面に出さない', '登録時に選んだ使い方に合わせて、招待コードの入力などの操作を隠す', INDIGO],
  ];
  g.forEach(([head, body, color], i) => {
    const x = 0.6 + (i % 2) * 6.2, y = 1.7 + Math.floor(i / 2) * 2.3;
    card(s, x, y, 5.9, 2.05);
    dot(s, x + 0.3, y + 0.3, 0.7, String(i + 1), color);
    T(s, head, x + 1.2, y + 0.3, 4.5, 0.7, { fontSize: 20, bold: true, color: INDIGO, valign: 'middle' });
    T(s, body, x + 1.2, y + 1.05, 4.5, 0.9, { fontSize: 15 });
  });
  T(s, '参考：W3C「WCAG 2.2」、総務省「みんなの公共サイト運用ガイドライン」', 0.6, 6.35, 11.0, 0.35, { fontSize: 13, color: INK_SOFT });
}

// ============ 10. 工夫② 安全性と正確さ ============
{
  const s = content('工夫②：服薬の記録と映像を、安全に・正確に扱う', '【約55秒】\n2つ目は、安全性と正確さです。\n服薬の記録や映像は個人情報です。全てのテーブルで行レベルセキュリティ、RLSを有効にし、本人と、本人を見守る家族だけが見られるよう、データベース側で制限しました。APIの書き方に誤りがあっても、他人のデータは返りません。\n映像は、見るたびに、見ることを許された人にだけ、発行から1時間で切れる署名付きURLを発行して再生します。URLが他の人に知られても、時間が過ぎれば見られません。映像そのものは残るので、あとから何度でも見直せます。\nまた、公開サーバーは協定世界時で動くため、そのままでは日本時間と9時間ずれます。日時の計算を1か所にまとめて日本時間に統一し、サーバーの遅れがあっても通知を取りこぼさず、二重にも送らない仕組みにしました。');
  const cols = [
    ['データベース側で守る', 'RLS（行レベルセキュリティ）', ['全テーブルで有効化', '見られるのは「本人」と「本人を見守る家族」だけ', 'APIに不備があっても他人のデータは返らない（多層防御）'], INDIGO],
    ['映像を守る', '署名付きURL・閲覧権限', ['見るたびに、1時間で切れるURLを発行', '映像を見せる家族を、本人が1人ずつ決められる', '見守りを外すと招待コードを作り直す'], TERRA_DEEP],
    ['時刻を正しく扱う', '日本時間への統一', ['サーバーはUTCで動く（9時間のずれ）', '日時の計算を1つのモジュールにまとめた', '遅れても取りこぼさず、二重にも送らない'], SAGE],
  ];
  cols.forEach(([head, sub, items, color], i) => {
    const x = 0.6 + i * 4.13;
    card(s, x, 1.7, 3.84, 1.35, color);
    T(s, head, x + 0.25, 1.82, 3.4, 0.6, { fontSize: 22, bold: true, color: WHITE, valign: 'middle' });
    T(s, sub, x + 0.25, 2.45, 3.4, 0.45, { fontSize: 15, color: WHITE });
    card(s, x, 3.2, 3.84, 3.0);
    s.addText(items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.2, y: 3.4, w: 3.45, h: 2.6, fontFace: FONT, fontSize: 17, color: INK, margin: 0, valign: 'top', paraSpaceAfter: 12, isTextBox: true });
  });
}

// ============ 11. Webの限界とAndroid版 ============
{
  const s = content('Webアプリの限界と、Android版の追加', '【約60秒】\n開発を進める中で、Webアプリには限界があることが分かりました。アプリを閉じているあいだや、画面のロック中は、音を鳴らし続けることができません。その間はプッシュ通知に頼ることになります。\n服薬のアラームは確実に気付いてもらう必要があるので、Android版を追加しました。Capacitorを使ってWeb版の画面をそのままアプリに同梱し、アラームの部分だけをJavaで、コメントを除いておよそ2,300行で実装しています。画面とサーバーとデータベースは共通です。\nAndroid版では、アプリを閉じていてもロック中でも、全画面のアラームが鳴ります。\n一方で、利用者に4種類の許可を設定してもらう必要があり、また、アプリの中ではWeb Pushが使えないため、家族宛ての通知にはFirebase Cloud Messagingという別の仕組みを加える必要がありました。');
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

// ============ 12. 動作確認で分かったこと ============
{
  const s = content('動作確認：公開環境と実機で、初めて分かった問題', '【約60秒】\n動作確認は、Renderに公開したサイトを、PCのブラウザとAndroidスマートフォンで実際に操作して行いました。カメラや通知はHTTPSでないと動かないためです。機能要件に対応する12項目について、仕様どおりに動くことを確認しました。\nその過程で、手元のPCでは現れない問題が見つかりました。\n1つ目は時刻のずれです。サーバーが協定世界時で動くため、8時の予定が17時に通知されるような状態でした。\n2つ目はQRコードです。実物は文字コードがShift_JISで、薬の情報も複数の行に分かれていて、仕様書から推測した実装では1件も読み取れませんでした。\n3つ目は通知です。サーバーは送信に成功しているのに、端末側の処理がエラーになって表示されていませんでした。\n実際の環境と実際のデータで確かめることの大切さを、強く感じました。');
  card(s, 0.6, 1.7, 3.6, 4.9, INDIGO);
  T(s, '確認方法', 0.9, 1.9, 3.0, 0.45, { fontSize: 18, color: 'CFE0DC' });
  T(s, '公開環境（Render）を\nPCとAndroid\nスマートフォンで操作', 0.9, 2.4, 3.0, 1.6, { fontSize: 20, bold: true, color: WHITE });
  T(s, '12', 0.9, 4.1, 3.0, 1.2, { fontSize: 72, bold: true, color: WHITE, valign: 'middle' });
  T(s, '項目すべてを確認\n（機能要件に対応）', 0.9, 5.4, 3.0, 0.9, { fontSize: 16, color: 'CFE0DC' });
  const probs = [
    ['時刻が9時間ずれる', 'サーバーはUTCで動く。8時の予定が17時に通知される', '日本時間の計算を1か所にまとめた'],
    ['実物のQRコードが読めない', '文字コードがShift_JIS。薬・飲み方が別々の行に分かれていた', '実データに合わせて解析を作り直した'],
    ['送れた通知が表示されない', 'サーバーは成功。端末側の表示処理がエラーになっていた', '段階ごとにログで切り分けて修正した'],
  ];
  probs.forEach(([head, cause, fix], i) => {
    const y = 1.7 + i * 1.4;
    card(s, 4.5, y, 8.2, 1.25);
    dot(s, 4.7, y + 0.3, 0.65, String(i + 1), CLAY);
    T(s, head, 5.55, y + 0.12, 3.4, 1.0, { fontSize: 18, bold: true, color: INDIGO, valign: 'middle' });
    T(s, cause, 9.0, y + 0.12, 3.55, 0.6, { fontSize: 13, color: INK_SOFT });
    T(s, '→ ' + fix, 9.0, y + 0.75, 3.55, 0.42, { fontSize: 13, bold: true, color: SAGE });
  });
  card(s, 4.5, 5.9, 8.2, 0.7, 'F8E4D9');
  T(s, '手元のPCや仕様書では気付けない。実環境・実データで確かめることが重要', 4.7, 5.9, 7.8, 0.7, { fontSize: 16, bold: true, color: TERRA_DEEP, valign: 'middle' });
}

// ============ 13. まとめと今後の課題 ============
{
  const s = pres.addSlide({ masterName: 'DARK' });
  T(s, 'まとめと今後の課題', 0.6, 0.4, 12.1, 0.9, { fontSize: 32, bold: true, color: WHITE, valign: 'middle' });
  card(s, 0.6, 1.6, 5.9, 4.5, INDIGO_DEEP);
  T(s, '実現したこと', 0.9, 1.8, 5.3, 0.5, { fontSize: 22, bold: true, color: 'F2C9B4' });
  s.addText([
    { text: '既存サービスにない、家族の端末への通知と映像による服薬確認を、ブラウザの標準技術で実現した', options: { bullet: true, breakLine: true } },
    { text: '1つのアカウントで「見守る」「見守ってもらう」を兼ねられる仕組みにした', options: { bullet: true, breakLine: true } },
    { text: 'アプリを閉じていても知らせるAndroid版を、画面を共通にしたまま追加した', options: { bullet: true } },
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
  s.addNotes('【約45秒】\nまとめです。既存のサービスにない「家族の端末への通知」と「映像による服薬確認」を、専用のアプリを入れなくても使えるWebアプリケーションとして実現しました。さらに、1つのアカウントで見守る側と見守られる側を兼ねられる仕組みと、アプリを閉じていても知らせるAndroid版を加えました。\n今後の課題は、高齢者を含む実際の利用者による評価、ほかの薬局のQRコードでの検証、映像を見せていない家族への服薬の知らせ、iOSへの対応などです。\n以上で発表を終わります。ご清聴ありがとうございました。');
}

pres.writeFile({ fileName: OUT }).then((f) => console.log('saved', f));
