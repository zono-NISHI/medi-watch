// ============================================================
//  服薬アラーム（アプリを画面に表示しているあいだ）
//  - 服薬時刻になったら、画面いっぱいに「カメラを起動する」ボタンを出し、
//    記録するか「あとで」を押すまで、音（と読み上げ・振動）を繰り返す
//  - ログイン後のすべての画面（ホーム・お薬・記録・見守り・マイページ）で動く
//  Web の制約:
//  - アプリを閉じている・画面ロック中・別のアプリを前面にしているときは鳴らせない
//    （その場合はプッシュ通知で知らせる）
//  - ブラウザは、利用者が一度も画面に触れていないページでは音を出させない。
//    そのため、画面に触れた時点で鳴り始める（それまでは画面の表示と案内文だけ）
//  ネイティブ版（mobile/ の Android アプリ）では:
//  - 取得した予定を NativeAlarm で端末に渡し、アプリを閉じていても・ロック中でも・
//    別のアプリを使っていても、端末が時刻どおりに全画面で知らせて音を鳴らす
//  - 音と読み上げは端末のアラームが鳴らすので、この画面のアラームはチャイムを鳴らさない
//    （端末が読み上げる文は、sync で渡す speech から作る）
//  - 端末のアラームが鳴っていないあいだにこの画面を出すとき（1つ目を記録したあとの、残りのお薬の案内など）は、
//    表示中のお薬だけを、端末の読み上げ機能で読み上げる（NativeAlarm.announce）
//  - 「あとで」と「記録待ち」は端末のアラームが持ち、この画面はそれに合わせる
//    ・端末のアラームで「あとで」にしたあいだは、この画面のアラームも出さない（NativeAlarm.isSnoozed）
//    ・「カメラを起動する」を押したあと・撮影画面を開いたあとは、知らせていた予定を「記録待ち」にし、
//      記録しないままになった予定を、5分後に端末のアラームが音つきで鳴らし直す
//  - この画面で知らせている（撮影画面で記録しようとしている）お薬は、端末にも伝えておく（NativeAlarm.setAppAlarm）。
//    記録しないままアプリを離れたら（ホームに戻る・ほかのアプリを開く・画面を消す）、数秒後に端末のアラームが
//    音と画面上部の帯で知らせ続け、アプリに戻ると、またこの画面が声で知らせる（MainActivity・AlarmRinger.onAppHidden）
// お薬が 2 つ以上あるときは、お薬ごとにチェックを付けて並べ、チェックしたお薬を 1 回の撮影（または映像なし）でまとめて記録する。
// 同じ時刻のお薬は、実際には一度に飲むことが多いため。飲んでいないお薬まで「飲んだ」にならないよう、
// どのお薬を記録するかはチェックで見せ、前の時刻から残っているお薬は、最初はチェックを外しておく。
// ============================================================

// ------------------------------------------------------------
//  読み上げる文（アラーム・撮影画面・ネイティブ版のアラームで同じ言い方にする）
// ------------------------------------------------------------
// お薬 1 つ分の「○○を3錠」（用量が登録されていなければ「○○を」）
function medSpeechPhrase(med) {
  const name = med?.name || 'お薬';
  const amount = `${med?.dosage || ''}${med?.unit || ''}`.trim();
  return `${name}を${amount}`;
}

// 「お薬の時間です。○○を3錠、□□を1包服用してください。」
function medAnnouncement(meds) {
  const phrases = (meds || []).map(medSpeechPhrase);
  return `お薬の時間です。${phrases.length > 0 ? phrases.join('、') : 'お薬を'}服用してください。`;
}

// ------------------------------------------------------------
//  ネイティブ版のアラーム（mobile/android の MediAlarmPlugin とのやり取り）
//  Web 版（ブラウザ）では何もしない
// ------------------------------------------------------------
const NativeAlarm = (() => {
  // バンドラーを使わないため @capacitor/core は読み込まず、アプリが用意する
  // Capacitor.nativePromise でネイティブの MediAlarmPlugin のメソッドを呼ぶ
  const plugin = window.APP_CONFIG?.IS_NATIVE_APP && typeof window.Capacitor?.nativePromise === 'function'
    ? new Proxy({}, { get: (_, method) => (options = {}) => window.Capacitor.nativePromise('MediAlarm', method, options) })
    : null;
  let lastStatus = null;

  // アラームに必要な許可（マイページの「アラームの設定」に順に並べる）
  const CHECKS = [
    {
      key: 'notifications',
      label: '通知を許可する',
      why: 'お薬の時間に音を鳴らすために必要です。',
    },
    {
      key: 'fullScreen',
      label: '全画面での通知を許可する',
      why: '画面が消えているときや、ロック中に、画面いっぱいに知らせるために必要です。',
    },
    {
      key: 'overlay',
      label: 'ほかのアプリの上に重ねて表示を許可する',
      why: 'スマホでほかのアプリを使っている最中でも、画面いっぱいに知らせるために必要です。設定の画面で「お薬手帳」を選び、オンにしてください。',
    },
    {
      key: 'exactAlarm',
      label: 'アラームとリマインダーを許可する',
      why: 'お薬の時刻ちょうどに鳴らすために必要です。',
    },
  ];

  function available() {
    return !!plugin;
  }

  // 予定と「今日もう記録した予定」を端末に渡し、アラームを予約し直す
  async function sync(schedules, logs, dateStr) {
    if (!plugin) return null;
    try {
      lastStatus = await plugin.sync({
        date: dateStr,
        schedules: schedules.map((s) => ({
          id: s.id,
          time: String(s.scheduled_time).slice(0, 5),
          days: s.days_of_week || [0, 1, 2, 3, 4, 5, 6],
          label: medLabel(s),
          // 端末の全画面のアラームが、この画面と同じように「名前（大きく）＋用量（小さく）」で出すために分けて渡す
          name: s.medications?.name || 'お薬',
          amount: `${s.medications?.dosage || ''}${s.medications?.unit || ''}`,
          speech: medSpeechPhrase(s.medications), // 端末のアラームが読み上げる「○○を3錠」
          // 電源を入れ直したあとに鳴らし直すとき、時刻を過ぎてから登録・変更した予定を除くために渡す
          updatedAt: s.updated_at ? new Date(s.updated_at).getTime() : 0,
        })),
        doneIds: logs.filter((l) => l.schedule_id && l.status !== 'pending').map((l) => l.schedule_id),
      });
      return lastStatus;
    } catch (err) {
      console.warn('[alarm] 端末のアラームの更新に失敗しました:', err);
      return null;
    }
  }

  // 画面から、5分後に端末のアラームを音つきでもう一度鳴らす予約を入れる
  // items: MedAlarm が知らせている予定 [{ schedule, at }]
  // hold: false … 「あとで」にする（そのあいだは画面のアラームも出さない）
  //       true  … 記録待ちにする（撮影画面を開いたとき。記録しないままアプリを離れても、5分後に鳴る）
  async function snooze(items, hold = false) {
    if (!plugin) return;
    try {
      lastStatus = await plugin.snooze({
        items: items.map(({ schedule, at }) => ({ id: schedule.id, origin: at.getTime() })),
        hold,
      });
    } catch (err) {
      // 古い版のアプリには snooze が無い。その場合は画面のアラームだけが 5 分後に出る
      console.warn('[alarm] 端末のアラームを「あとで」にできませんでした:', err);
    }
  }

  // この画面で知らせている（撮影画面で記録しようとしている）予定を端末に伝える。
  // 記録しないままアプリを離れたら、端末のアラームが数秒後に引き継いで鳴らす。空の配列で「知らせていない」に戻す
  // items: [{ schedule, at }]。同じ内容のときは送らない
  let appAlarmKey = null;
  function setAppAlarm(items) {
    if (!plugin) return;
    const list = items.map(({ schedule, at }) => ({ id: schedule.id, origin: at.getTime() }));
    const key = list.map((i) => `${i.id}@${i.origin}`).join(',');
    if (key === appAlarmKey) return;
    appAlarmKey = key;
    // 古い版のアプリには appAlarm が無い（そのときは、これまでどおり 5 分後の鳴らし直しだけになる）
    plugin.appAlarm({ items: list }).catch((err) => console.warn('[alarm] 知らせているお薬を端末に伝えられませんでした:', err));
  }

  // 端末のアラーム（全画面・通知・画面上部の帯）の「あとで」ボタンで先延ばしにした予定か。そのあいだは画面のアラームも出さない
  // （通知を横に払って消しただけのときは含まない。その場合は、アプリを開けば画面のアラームで知らせる）
  // （端末で「あとで」を押したことは、画面側の localStorage には残らないため、端末に聞く）
  function isSnoozed(scheduleId) {
    return !!plugin && Number(lastStatus?.snoozed?.[scheduleId] || 0) > Date.now();
  }

  // 端末の読み上げ機能で、文を1回読み上げる（アプリの画面は、自分では読み上げられないため）
  // 端末のアラームが鳴っているあいだは、端末側が読み上げない（アラームの音・読み上げと重ならないように）
  // 声は「アラーム」の音量で鳴る。読み上げを頼むと、stopAnnounce を呼ぶまで、音量ボタンで「アラーム」の音量を変えられる
  function announce(text) {
    if (!plugin) return;
    plugin.announce({ text }).catch((err) => console.warn('[alarm] 読み上げを頼めませんでした:', err));
  }

  function stopAnnounce() {
    if (!plugin) return;
    plugin.stopAnnounce().catch(() => { /* 古い版のアプリには無い */ });
  }

  // 端末のアラームが音を鳴らせる状態か（このときは、画面のアラームはチャイムを鳴らさず、端末の読み上げだけを使う）
  function ringsNatively() {
    return !!plugin && !!lastStatus?.notifications;
  }

  async function status() {
    if (!plugin) return null;
    try {
      lastStatus = await plugin.getStatus();
    } catch (err) {
      console.warn('[alarm] アラームの設定の確認に失敗しました:', err);
    }
    return lastStatus;
  }

  // まだ済んでいない設定
  function missing(st) {
    return st ? CHECKS.filter((c) => st[c.key] === false) : [];
  }

  // 「設定する」を押したとき。通知だけは、まずアプリの中で許可を求める
  async function fix(key) {
    if (!plugin) return;
    if (key === 'notifications') {
      const st = await plugin.requestNotificationPermission().catch(() => null);
      if (st?.notifications) {
        lastStatus = st;
        return;
      }
    }
    await plugin.openSettings({ target: key });
  }

  // 「済み」の設定を変える（オフにする）とき。アプリからは許可を取り消せないため、端末の設定画面を開く
  async function openSettings(key) {
    if (!plugin) return;
    await plugin.openSettings({ target: key }).catch((err) =>
      console.warn('[alarm] 設定の画面を開けませんでした:', err));
  }

  // ログアウトしたら、この端末で鳴らさないようにする
  async function clear() {
    if (!plugin) return;
    try {
      await plugin.clear();
    } catch (err) {
      console.warn('[alarm] 端末のアラームの取り消しに失敗しました:', err);
    }
  }

  // ホーム：設定が済んでいなければ、マイページへの案内を出す
  async function renderSetupNotice(container) {
    if (!plugin || !container) return;
    const todo = missing(await status());
    container.hidden = todo.length === 0;
    if (todo.length === 0) return;
    container.innerHTML = `
      <div class="card card--warm native-alarm-notice">
        <p><strong>お薬の時間のアラームの設定が、まだ終わっていません。</strong></p>
        <p class="text-sm">このままでは、アプリを閉じているときにお知らせできないことがあります。</p>
        <a class="btn btn-accent" href="mypage.html#native-alarm-card">アラームを設定する</a>
      </div>`;
  }

  // マイページ：設定の一覧（済み／設定する）を描く
  // （以前は「次のアラーム：○月○日 ○○:○○」も出していたが、利用者には不要で文が多くなるため出さない。
  //   開発者が確かめるときは、chrome://inspect のコンソールで NativeAlarm.status() の nextAlarmAt を見る）
  async function renderChecks(listEl) {
    if (!plugin || !listEl) return;
    const st = await status();
    if (!st) return;
    listEl.innerHTML = CHECKS.map((c) => {
      const ok = st[c.key] !== false;
      // Android の版によっては、いつも許可されていて、設定画面でも変えられない許可がある
      // （例: Android 13 以降の「アラームとリマインダー」は、設定画面のスイッチがオフのまま変えられない表示になるが、アラームは鳴る）
      // 古い版のアプリは changeable を返さないので、そのときは変えられるものとして扱う
      const changeable = st.changeable?.[c.key] !== false;
      let action;
      if (!ok) {
        action = `<button type="button" class="btn btn-accent" data-fix="${c.key}">設定する</button>`;
      } else if (changeable) {
        // 済みの設定も、端末の設定画面を開いてオフにできるようにする（戻ってきたら mypage.js が状態を確認し直す）
        action = `<div class="native-alarm-ok-row">
                    <span class="native-alarm-ok">済み ✓</span>
                    <button type="button" class="btn btn-outline btn--sm btn--auto" data-change="${c.key}">設定を変える</button>
                  </div>`;
      } else {
        action = `<div>
                    <span class="native-alarm-ok">済み ✓</span>
                    <p class="text-sm text-muted">このスマホでは、いつも許可されています（変える必要はありません）。</p>
                  </div>`;
      }
      return `
        <li class="native-alarm-check ${ok ? 'is-ok' : ''}">
          <div>
            <strong>${escapeHtml(c.label)}</strong>
            <p class="text-sm text-muted">${escapeHtml(c.why)}</p>
          </div>
          ${action}
        </li>`;
    }).join('');
    listEl.querySelectorAll('[data-fix]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await fix(btn.dataset.fix);
        renderChecks(listEl);
      })
    );
    listEl.querySelectorAll('[data-change]').forEach((btn) =>
      btn.addEventListener('click', () => openSettings(btn.dataset.change))
    );
  }

  function medLabel(schedule) {
    const med = schedule.medications || {};
    const amount = `${med.dosage || ''}${med.unit || ''}`;
    return `${med.name || 'お薬'}${amount ? ` ${amount}` : ''}`;
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  return {
    available, sync, snooze, setAppAlarm, isSnoozed, announce, stopAnnounce, ringsNatively,
    status, missing, fix, openSettings, clear, renderSetupNotice, renderChecks,
  };
})();

const MedAlarm = (() => {
  const ALARM_WINDOW_MIN = 60; // 服薬時刻から何分間アラームを出すか（それ以降はホームの「時間が過ぎています」で案内）
  const SNOOZE_MIN = 5;
  const FETCH_INTERVAL_MS = 60 * 1000; // 予定と記録を取り直す間隔
  const CHECK_INTERVAL_MS = 10 * 1000; // 鳴らすかどうかを判定する間隔
  const SOUND_INTERVAL_MS = 2500;
  const SPEAK_INTERVAL_MS = 20 * 1000; // ネイティブ版で、端末の読み上げだけで知らせるときの間隔
  // ブラウザ版の読み上げの間合いと速さは、ネイティブ版の端末のアラーム（AlarmSound.java）にそろえる
  // （鳴り始めて約3秒後に1回目 → 読み終わってから約8秒チャイム → また読み上げ、を繰り返す）
  const FIRST_SPEECH_DELAY_MS = 3000;
  const SPEECH_GAP_MS = 8000;
  const SPEECH_RATE = 0.9;
  // 「あとで」にしたお薬（予定の id → もう一度知らせる時刻）。画面を移っても続くよう localStorage に保存する。
  // 以前はお薬を区別せずに 1 つの時刻だけを保存していたため、そのあいだに時刻になった別のお薬も出なかった
  const SNOOZE_KEY = 'medi_watch_alarm_snooze';

  let options = {};
  let schedules = [];
  let logs = [];
  let fetchedAt = 0;
  let fetchSeq = 0; // 予定と記録の取得の番号（あとから始めた取得の結果だけを使う）
  let checkTimer = null;
  let holdUntil = 0; // 「カメラを起動する」を押してから、撮影画面が開くまでのあいだ、出し直さない
  let memSnoozes = {}; // localStorage を使えないときの「あとで」
  let dialog = null;
  let items = []; // いま知らせている予定 [{ schedule, log, at }]
  const checked = new Map(); // お薬が 2 つ以上のときの、お薬ごとのチェック（予定の id → 記録するか）
  let shownKey = ''; // いま画面に描いているお薬（予定の id をつないだもの）
  let nowTimer = null; // 画面の「いまの時刻」を進めるタイマー
  let audioCtx = null;
  let audioPausedForSpeech = false; // 読み上げのために audioCtx を止めているか
  let soundTimer = null;
  let voiceOnly = false; // ネイティブ版で、端末の読み上げだけで知らせているか（startSound で決める）
  let speechTimer = null; // 次の読み上げを待つタイマー（ブラウザ版）
  let speaking = false; // ブラウザ版で読み上げている最中か（speechSynthesis.speaking は端末によって当てにならないので、自分で持つ）
  let finishSpeech = null; // いまの読み上げを終わったことにする関数（止めるとき・終わりの知らせが来たときに呼ぶ）
  let currentUtterance = null; // Chrome は、どこからも参照されていない読み上げの終わりの知らせを落とすことがあるので、読み終わるまで持っておく
  let wakeLock = null;

  // options:
  //   onStartCamera(selected, all) … 「カメラを起動する」を押したとき（省略時はホームへ移動して撮影を始める）。
  //                                   selected: 記録するお薬（チェックしたもの）、all: 知らせていたお薬すべて
  //   onRecorded()        … 映像なしで記録したあと（ホームの一覧を更新するため）
  //   isBusy()            … true のあいだは出さない（ホームで撮影中など）
  function start(opts = {}) {
    options = opts;
    // 画面に触れたら音を出せるようにする（ブラウザの自動再生の制限への対応）
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) =>
      document.addEventListener(type, unlockAudio, { capture: true, passive: true })
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
    // ネイティブ版：前の画面が読み上げの途中で切り替わったときに備えて、読み上げを止め、
    // 音量ボタンで変わる音量をいつもの音量に戻しておく（読み上げているあいだだけ「アラーム」の音量になる。Web 版では何もしない）
    NativeAlarm.stopAnnounce();
    tick();
    checkTimer = setInterval(tick, CHECK_INTERVAL_MS);
  }

  // 記録した直後などに呼ぶと、すぐに取り直して判定する
  async function refresh() {
    fetchedAt = 0;
    await tick();
  }

  async function tick() {
    if (document.hidden) return;
    let synced = false;
    if (Date.now() - fetchedAt >= FETCH_INTERVAL_MS) {
      const seq = ++fetchSeq;
      try {
        const [{ schedules: s }, { logs: l }] = await Promise.all([
          Api.listSchedules(),
          Api.listLogs({ date: localDateStr(new Date()) }),
        ]);
        // 記録する前に始めた取得が、記録したあとに届いたときは使わない（記録したお薬が、また出てしまうため）
        if (seq === fetchSeq) {
          schedules = s || [];
          logs = l || [];
          fetchedAt = Date.now();
          // ネイティブ版：アプリを閉じていても鳴らせるよう、端末のアラームを予約し直す
          await NativeAlarm.sync(schedules, logs, localDateStr(new Date()));
          synced = true;
        }
      } catch (err) {
        console.warn('[alarm] 予定の取得に失敗しました:', err);
      }
    }
    // ネイティブ版：端末のアラームで「あとで」を押したかどうかを、判定のたびに確かめる
    // （sync したときは、その戻り値に含まれている。Web 版では何もしない）
    if (!synced) await NativeAlarm.status();
    evaluate();
  }

  function evaluate() {
    // 「あとで」にしたお薬（この画面・端末のアラームのどちらで押したものも）は、そのあいだ知らせない
    const due = dueItems().filter(({ schedule }) => !isSnoozed(schedule.id) && !NativeAlarm.isSnoozed(schedule.id));
    // ネイティブ版：知らせている（撮影画面で記録しようとしている）お薬を端末に伝える。
    // 記録しないままアプリを離れたら、端末のアラームが引き継いで鳴らす
    NativeAlarm.setAppAlarm(due);
    if (due.length === 0 || Date.now() < holdUntil || options.isBusy?.()) {
      hide();
      return;
    }
    show(due);
  }

  // 記録したお薬を、サーバーから取り直すのを待たずに外す（残りのお薬があれば、すぐに続けて知らせる）。
  // 撮影画面・この画面で記録したあとに呼ぶ。そのあとでサーバーの記録を取り直して確かめる
  function markRecorded(scheduleIds, status = 'taken') {
    const ids = new Set(scheduleIds);
    logs = logs
      .filter((l) => !(ids.has(l.schedule_id) && l.status === 'pending'))
      .concat([...ids].map((id) => ({ id: `local-${id}`, schedule_id: id, status })));
    holdUntil = 0;
    evaluate();
    refresh();
  }

  // 服薬時刻を過ぎていて、まだ記録していない予定（ホームの表示と同じく端末の時刻で判定する）
  function dueItems() {
    const now = new Date();
    return schedules
      .filter((s) => (s.days_of_week || [0, 1, 2, 3, 4, 5, 6]).includes(now.getDay()))
      .map((schedule) => {
        const [h, m] = schedule.scheduled_time.split(':').map(Number);
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
        // 服薬済み・スキップか、今の服薬時刻と同じ予定時刻の記録だけを対応させる
        // （時刻を変えた日に残る、変更前の時刻の「飲み忘れ」では鳴らさない。ホームと同じ考え方）
        const own = logs.filter((l) => l.schedule_id === schedule.id);
        const log =
          own.find((l) => l.status !== 'pending') ||
          own.find((l) => new Date(l.scheduled_at).getTime() === at.getTime());
        return { schedule, log, at };
      })
      .filter(({ schedule, log, at }) => {
        if (log && log.status !== 'pending') return false;
        const diffMin = (now - at) / 60000;
        if (diffMin < 0 || diffMin > ALARM_WINDOW_MIN) return false;
        // 時刻を過ぎてから登録・変更した予定は鳴らさない（サーバーの cron と同じ考え方）
        if (!log && schedule.updated_at && new Date(schedule.updated_at) > at) return false;
        return true;
      })
      .sort((a, b) => a.at - b.at);
  }

  // ---- 画面 ----
  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'alarm-dialog';
    dialog.setAttribute('aria-labelledby', 'alarm-title');
    dialog.innerHTML = `
      <div class="alarm-inner">
        <p class="alarm-now">いまの時刻 <span id="alarm-now"></span></p>
        <p class="alarm-time"><span id="alarm-time"></span><span class="alarm-time-of">に飲む</span></p>
        <h2 id="alarm-title">お薬の時間です</h2>
        <ul class="alarm-meds" id="alarm-meds"></ul>
        <ul class="alarm-checks" id="alarm-checks" hidden></ul>
        <p class="text-sm alarm-note" id="alarm-multi-note" hidden>チェックの入っているお薬を記録します。飲まないお薬は、チェックを外してください。</p>
        <button type="button" class="alarm-camera-btn" data-alarm="camera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          カメラを起動する
          <span class="alarm-camera-sub" id="alarm-camera-sub" hidden></span>
        </button>
        <button type="button" class="btn btn-outline" data-alarm="no-video">飲みました（映像なしで記録する）</button>
        <p class="text-sm alarm-note">飲まないときは、「カメラを起動する」の先で選べます。</p>
        <button type="button" class="btn btn-ghost alarm-snooze-btn" data-alarm="snooze">あとで<span id="alarm-snooze-sub"></span></button>
        <p class="text-sm alarm-note" id="alarm-sound-hint" hidden>音が鳴らないときは、画面のどこかに一度触れてください。</p>
      </div>`;
    // Esc キーなどで閉じられないようにする（ボタンで操作してもらうため）
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    dialog.querySelector('[data-alarm="camera"]').addEventListener('click', onCamera);
    dialog.querySelector('[data-alarm="no-video"]').addEventListener('click', onRecordWithoutVideo);
    dialog.querySelector('[data-alarm="snooze"]').addEventListener('click', onSnooze);
    // お薬が 2 つ以上のときの、お薬ごとのチェック
    dialog.querySelector('#alarm-checks').addEventListener('change', (e) => {
      const box = e.target.closest('input[type="checkbox"][data-id]');
      if (!box) return;
      checked.set(box.dataset.id, box.checked);
      box.closest('.alarm-check')?.classList.toggle('is-off', !box.checked);
      updateSelection();
    });
    document.body.appendChild(dialog);
  }

  function show(due) {
    if (!dialog) buildDialog();
    items = due;

    // 知らせるお薬が変わったときだけ描き直す（10秒ごとの判定のたびに描き直すと、押している最中のボタンや、
    // 付け外ししたチェックが作り直されてしまう）
    const key = due.map(({ schedule }) => schedule.id).join(',');
    if (key !== shownKey) {
      shownKey = key;
      render(due);
      // 表示中にお薬が変わった（1つ記録して残りだけになった など）ときは、新しい内容ですぐ読み上げ直す
      if (dialog.open) restartSound();
    }

    if (!dialog.open) {
      dialog.showModal();
      // いまの時刻を出し、表示しているあいだは進める（大きな時刻は「飲む予定の時刻」なので、取り違えないように分けて出す）
      updateNow();
      clearInterval(nowTimer);
      nowTimer = setInterval(updateNow, 1000);
      startSound();
      requestWakeLock();
    }
  }

  // いちばん新しい服薬時刻（大きく出す「08:00 に飲む」と、最初からチェックを付けるお薬に使う）
  function latestAt(due) {
    return new Date(Math.max(...due.map(({ at }) => at.getTime())));
  }

  // お薬が 1 つのとき … お薬の名前と、大きな「カメラを起動する」「映像なしで記録」のボタン
  // お薬が 2 つ以上のとき … お薬ごとにチェックを付けて並べ、同じボタンで、チェックしたお薬をまとめて記録する。
  //   いちばん新しい時刻のお薬（いま鳴っている時刻のお薬）は最初からチェックを付け、前の時刻から残っているお薬は外しておく
  //   （残っていたお薬まで、まとめて「飲んだ」にならないように）。前の時刻のお薬には、その時刻も添える
  function render(due) {
    const multi = due.length > 1;
    const latest = latestAt(due);
    const amountHtml = (med) => {
      const amount = `${med.dosage || ''}${med.unit || ''}`;
      return amount ? `<span>${escapeText(amount)}</span>` : '';
    };

    dialog.querySelector('#alarm-time').textContent = formatClock(latest);
    const medsEl = dialog.querySelector('#alarm-meds');
    medsEl.hidden = multi;
    medsEl.innerHTML = multi
      ? ''
      : `<li>${escapeText(due[0].schedule.medications?.name || 'お薬')}${amountHtml(due[0].schedule.medications || {})}</li>`;
    dialog.querySelector('#alarm-multi-note').hidden = !multi;
    dialog.querySelector('#alarm-snooze-sub').textContent = multi
      ? `（${due.length}つとも${SNOOZE_MIN}分後にもう一度お知らせ）`
      : `（${SNOOZE_MIN}分後にもう一度お知らせ）`;

    // チェックは、知らせているあいだは付け外しした状態を保つ（新しく加わったお薬だけ、最初の状態にする）
    const ids = new Set(due.map(({ schedule }) => schedule.id));
    [...checked.keys()].forEach((id) => { if (!ids.has(id)) checked.delete(id); });
    due.forEach(({ schedule, at }) => {
      if (!checked.has(schedule.id)) checked.set(schedule.id, at.getTime() === latest.getTime());
    });

    const checksEl = dialog.querySelector('#alarm-checks');
    checksEl.hidden = !multi;
    checksEl.innerHTML = multi
      ? due
          .map(({ schedule, at }) => {
            const med = schedule.medications || {};
            const on = checked.get(schedule.id);
            const time = at.getTime() === latest.getTime() ? '' : `<span class="alarm-check-time">${formatClock(at)}</span>`;
            return `
              <li>
                <label class="alarm-check ${on ? '' : 'is-off'}">
                  <input type="checkbox" data-id="${escapeText(schedule.id)}" ${on ? 'checked' : ''} />
                  <span class="alarm-check-name">${time}${escapeText(med.name || 'お薬')}${amountHtml(med)}</span>
                </label>
              </li>`;
          })
          .join('')
      : '';
    updateSelection();
  }

  // 記録するお薬（お薬が 1 つならそのお薬、2 つ以上ならチェックしたお薬）
  function selectedItems() {
    if (items.length <= 1) return items.slice();
    return items.filter(({ schedule }) => checked.get(schedule.id));
  }

  // チェックの数に合わせて、ボタンの説明と押せるかどうかを変える
  function updateSelection() {
    if (!dialog) return;
    const multi = items.length > 1;
    const count = selectedItems().length;
    const sub = dialog.querySelector('#alarm-camera-sub');
    sub.hidden = !multi;
    sub.textContent = count > 0 ? `チェックした${count}つをまとめて記録します` : '記録するお薬にチェックを入れてください';
    dialog.querySelector('[data-alarm="camera"]').disabled = count === 0;
    dialog.querySelector('[data-alarm="no-video"]').disabled = count === 0;
  }

  function updateNow() {
    const text = formatClock(new Date());
    const el = dialog?.querySelector('#alarm-now');
    if (el && el.textContent !== text) el.textContent = text;
  }

  function hide() {
    clearInterval(nowTimer);
    nowTimer = null;
    stopSound();
    releaseWakeLock();
    if (dialog?.open) dialog.close();
    items = [];
    shownKey = '';
  }

  // ---- ボタン ----
  function onCamera() {
    startCamera(selectedItems());
  }

  // selected: 記録するお薬（チェックしたもの）。撮影画面では、知らせていたお薬すべてを並べ、selected にチェックを付けて出す
  function startCamera(selected) {
    if (!selected || selected.length === 0) return;
    const all = items.slice();
    holdUntil = Date.now() + 15 * 1000; // 撮影画面が開くまでのあいだ（開いたら holdDue で解除する）
    // ネイティブ版：端末のアラームの音を止め、知らせていた予定を記録待ちにする
    //（記録しないままアプリを離れても、端末のアラームが鳴る）
    NativeAlarm.snooze(all, true);
    hide();
    if (options.onStartCamera) {
      options.onStartCamera(selected, all);
    } else {
      const ids = (list) => encodeURIComponent(list.map(({ schedule }) => schedule.id).join(','));
      location.href = `home.html?take=${ids(all)}&pick=${ids(selected)}`;
    }
  }

  function onRecordWithoutVideo(e) {
    recordWithoutVideo(selectedItems(), e.currentTarget);
  }

  // 選んだお薬を、映像なしで「飲んだ」とまとめて記録する（家族への通知は 1 通）。
  // ほかに知らせるお薬（チェックを外したもの）が残っていれば、画面はそのまま続ける
  async function recordWithoutVideo(targets, btn) {
    if (targets.length === 0) return;
    const names = targets.map(({ schedule }) => `「${schedule.medications?.name || 'お薬'}」`).join('');
    const message = items.length > 1 ? `${names}の服薬を記録しました。` : '服薬を記録しました。';
    btn.disabled = true;
    try {
      const logIds = await Promise.all(
        targets.map(({ schedule, log }) =>
          log?.id ||
          Api.createLog({ schedule_id: schedule.id, date: localDateStr(new Date()) }).then(({ log: created }) => created.id)
        )
      );
      await Api.takeLogs(logIds);
      markRecorded(targets.map(({ schedule }) => schedule.id)); // 記録したお薬を外す（残りがあれば続けて知らせ、無ければ閉じる）
      showToast(message, 'success');
      options.onRecorded?.();
    } catch (err) {
      handleApiError(err, '記録に失敗しました。');
    } finally {
      btn.disabled = false;
      updateSelection();
    }
  }

  // 「あとで」… 知らせていたお薬すべてを 5 分後にもう一度知らせる（ボタンにも「2つとも」と書いてある）。
  // どのお薬をいつ知らせるかを、お知らせでも伝える
  function onSnooze() {
    const targets = items.slice();
    if (targets.length === 0) return;
    const until = snoozeItems(targets);
    const names = targets.map(({ schedule }) => schedule.medications?.name || 'お薬').join('・');
    showToast(`${formatClock(new Date(until))} に、もう一度お知らせします（${names}）。`, 'info', 6000);
  }

  // 「あとで」にする。ネイティブ版では、端末のアラームも 5 分後に鳴らし直す
  // （端末のアラームにも「あとで」と伝え、そのあいだは端末側の全画面・通知も出ないようにする）。
  // もう一度知らせる時刻を返す
  function snoozeItems(targets) {
    const until = Date.now() + SNOOZE_MIN * 60 * 1000;
    const map = readSnoozes();
    Object.keys(map).forEach((id) => { if (Number(map[id]) <= Date.now()) delete map[id]; });
    targets.forEach(({ schedule }) => { map[schedule.id] = until; });
    writeSnoozes(map);
    NativeAlarm.snooze(targets);
    evaluate();
    return until;
  }

  // 撮影画面を記録せずに閉じたときに呼ぶ（scheduleIds: 撮影画面に出していたお薬）。そのどれかがいま知らせる対象
  // （服薬時刻から60分以内で未記録）なら、知らせる対象のお薬すべてを「あとで」と同じ扱いにして true を返す。
  // 対象でなければ何もしない（時刻より前に開いて閉じただけ、など）
  function snoozeIfDue(scheduleIds) {
    const ids = [].concat(scheduleIds);
    const due = dueItems();
    if (!due.some(({ schedule }) => ids.includes(schedule.id))) return false;
    snoozeItems(due);
    return true;
  }

  // 撮影画面を開いたときに呼ぶ。いま知らせる対象の予定を、端末のアラームの「記録待ち」にする
  // （ネイティブ版だけ。5分を数え直すので、撮影の最中に端末のアラームが鳴り出しにくくなる。
  //   記録が済んだ予定は sync で外れ、記録しないままの予定だけが5分後に鳴る）。
  // 撮影画面が開いたので、「カメラを起動する」を押したときの「出し直さない」も解除する
  // （そのままにすると、すぐに記録したとき、残りのお薬の画面がしばらく出なかった）
  function holdDue() {
    holdUntil = 0;
    const due = dueItems();
    if (due.length > 0) NativeAlarm.snooze(due, true);
  }

  // 「あとで」にしたお薬か
  function isSnoozed(scheduleId) {
    return Number(readSnoozes()[scheduleId] || 0) > Date.now();
  }

  function readSnoozes() {
    try {
      const saved = JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}');
      // 以前の版が保存した、お薬を区別しない時刻（数値）は使わない
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
    } catch { /* 読めないときは、このページを開いているあいだの分を使う */ }
    return { ...memSnoozes };
  }

  function writeSnoozes(map) {
    memSnoozes = { ...map };
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
    } catch { /* 保存できない場合は、このページを開いているあいだだけ止める */ }
  }

  // ---- 音・読み上げ・振動 ----
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    // 読み上げのために止めているあいだは、画面に触れても動かさない（読み終わったら resumeAudioAfterSpeech で戻す）
    if (audioCtx.state === 'suspended' && !audioPausedForSpeech) audioCtx.resume().catch(() => {});
  }

  // 読み上げているあいだは、チャイム用の音の出口（Web Audio）を止めておく。
  // 鳴らす音が無くても、開いたままだとスマホのブラウザでは読み上げの声に雑音が入ることがあるため
  // （ネイティブ版は同じ端末の読み上げ機能でも雑音が入らず、違いはブラウザ版だけがこれを開いたままにしていたこと）
  function pauseAudioForSpeech() {
    if (!audioCtx || audioCtx.state !== 'running') return Promise.resolve();
    audioPausedForSpeech = true;
    return audioCtx.suspend().catch(() => {});
  }

  function resumeAudioAfterSpeech() {
    if (!audioPausedForSpeech) return;
    audioPausedForSpeech = false;
    // 戻せなかった端末では、次のチャイムのときに「画面に一度触れてください」の案内が出て、触れれば鳴り始める
    audioCtx?.resume().catch(() => {});
  }

  // 知らせ方は 2 通り
  // - ブラウザ版（と、ネイティブ版で通知が許可されていないとき）… この画面がチャイム・読み上げ・振動で知らせる
  // - ネイティブ版 … 音と振動は端末のアラームが鳴らすので、この画面はチャイムを鳴らさない。
  //   端末のアラームが鳴っていないあいだ（1つ目を記録したあとの、残りのお薬の案内など）だけ、
  //   端末の読み上げ機能で「お薬の時間です。○○を3錠服用してください。」と、表示中のお薬を読み上げる
  // firstSpeechDelay: 1回目の読み上げまでの時間（ブラウザ版。お薬が変わって読み上げ直すときは 0）
  function startSound(firstSpeechDelay = FIRST_SPEECH_DELAY_MS) {
    if (soundTimer) return;
    voiceOnly = NativeAlarm.ringsNatively();
    if (voiceOnly) {
      announceNatively();
      soundTimer = setInterval(announceNatively, SPEAK_INTERVAL_MS);
      return;
    }
    // すぐ読み上げるときは、チャイムを鳴らさない（チャイムの残りが声の出だしに重ならないように）
    if (firstSpeechDelay > 0) playOnce();
    soundTimer = setInterval(playOnce, SOUND_INTERVAL_MS);
    scheduleSpeech(firstSpeechDelay);
  }

  function stopSound() {
    const wasOn = !!soundTimer;
    clearInterval(soundTimer);
    soundTimer = null;
    clearTimeout(speechTimer);
    speechTimer = null;
    if (wasOn && voiceOnly) NativeAlarm.stopAnnounce();
    finishSpeech?.(false);
    try { speechSynthesis?.cancel(); } catch { /* noop */ }
    try { navigator.vibrate?.(0); } catch { /* noop */ }
  }

  // 鳴らしている最中なら、いったん止めて最初からやり直す（読み上げる内容を、いまのお薬に合わせ、すぐ読み上げ直す）
  function restartSound() {
    if (!soundTimer) return;
    stopSound();
    startSound(0);
  }

  // いま表示しているお薬だけを読み上げる文（例: 「お薬の時間です。ロキソニンを3錠、ガスターを1包服用してください。」）
  function announcementText() {
    return medAnnouncement(items.map(({ schedule }) => schedule.medications));
  }

  function announceNatively() {
    if (items.length > 0) NativeAlarm.announce(announcementText());
  }

  // 音を鳴らせる状態か（ブラウザは、利用者が画面に触れるまで音を出させない。読み上げも同じ）
  function canPlaySound() {
    return !!audioCtx && audioCtx.state === 'running';
  }

  // 2.5秒ごとに呼ぶ。チャイムと振動
  function playOnce() {
    // 読み上げているあいだは、チャイムも振動も止めて声だけにする
    // （振動の音やチャイムが声に重なると、雑音が入ったように聞こえるため。ネイティブ版も読み上げ中はアラームの音を消す）
    if (speaking) return;

    const canPlay = canPlaySound();
    const hint = dialog?.querySelector('#alarm-sound-hint');
    if (hint) hint.hidden = canPlay;
    if (!canPlay) {
      unlockAudio(); // 以前に画面に触れていれば、これで鳴らせるようになる
      return;
    }

    try { navigator.vibrate?.([300, 150, 300]); } catch { /* noop */ }
    chime();
  }

  // delay ミリ秒後に読み上げる。まだ音を出せない（画面に触れていない）ときは、出せるようになるまで1秒ごとに待つ
  function scheduleSpeech(delay) {
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => {
      speechTimer = null;
      if (!soundTimer || voiceOnly || !('speechSynthesis' in window)) return;
      if (!canPlaySound()) {
        scheduleSpeech(1000);
        return;
      }
      speak();
    }, delay);
  }

  // ピピピッという短い音を3回
  function chime() {
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.6, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.22);
    });
  }

  // 1回読み上げる。読み終わったら（終わりの知らせが来なくても、長くとも決まった時間で）チャイムに戻り、
  // SPEECH_GAP_MS 後にもう一度読み上げる
  function speak() {
    const text = announcementText();
    // 終わりの知らせ（onend）が来ない端末でも、チャイムが止まったままにならないよう、読み終わるころに戻す
    // （日本語はおよそ1秒に6文字。少し余裕を持たせ、長くても40秒まで。ネイティブ版と同じ上限）
    const watchdog = setTimeout(() => finish(true), Math.min(40000, 4000 + text.length * 300));
    let done = false;
    // again: true … 読み終わった（次の読み上げを予約する）／ false … 止めた
    function finish(again) {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      if (finishSpeech === finish) finishSpeech = null;
      currentUtterance = null;
      speaking = false;
      resumeAudioAfterSpeech();
      if (again && soundTimer && !voiceOnly) scheduleSpeech(SPEECH_GAP_MS);
    }
    finishSpeech = finish;
    speaking = true;
    try { navigator.vibrate?.(0); } catch { /* noop */ } // 鳴っている振動も止める
    // 音の出口を止め終わってから読み上げ始める
    pauseAudioForSpeech().then(() => {
      if (done) return; // 止め終わるまでのあいだに、アラームを閉じた
      try {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'ja-JP';
        utter.rate = SPEECH_RATE;
        utter.onend = () => finish(true);
        utter.onerror = () => finish(true);
        currentUtterance = utter;
        speechSynthesis.speak(utter);
      } catch (err) {
        console.warn('[alarm] 読み上げに失敗しました:', err);
        finish(true);
      }
    });
  }

  // ---- 鳴っているあいだは画面を消さない ----
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch { /* 対応していない端末では何もしない */ }
  }

  function releaseWakeLock() {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  // 別のアプリに切り替えたら音を止め、戻ってきたらすぐに確認し直す
  function onVisibilityChange() {
    if (document.hidden) {
      stopSound();
    } else {
      fetchedAt = 0;
      tick().then(() => {
        if (dialog?.open) {
          startSound();
          requestWakeLock();
        }
      });
    }
  }

  // ---- 小物 ----
  function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatClock(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function escapeText(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  return { start, refresh, markRecorded, snoozeIfDue, holdDue, SNOOZE_MIN };
})();
