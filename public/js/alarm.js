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
// ============================================================

const MedAlarm = (() => {
  const ALARM_WINDOW_MIN = 60; // 服薬時刻から何分間アラームを出すか（それ以降はホームの「時間が過ぎています」で案内）
  const SNOOZE_MIN = 5;
  const FETCH_INTERVAL_MS = 60 * 1000; // 予定と記録を取り直す間隔
  const CHECK_INTERVAL_MS = 10 * 1000; // 鳴らすかどうかを判定する間隔
  const SOUND_INTERVAL_MS = 2500;
  const SPEAK_INTERVAL_MS = 20 * 1000;
  const SNOOZE_KEY = 'medi_watch_alarm_snooze';

  let options = {};
  let schedules = [];
  let logs = [];
  let fetchedAt = 0;
  let checkTimer = null;
  let holdUntil = 0; // カメラの画面を開くまでのあいだ、出し直さない
  let dialog = null;
  let items = []; // いま知らせている予定 [{ schedule, log, at }]
  let audioCtx = null;
  let soundTimer = null;
  let lastSpokenAt = 0;
  let wakeLock = null;

  // options:
  //   onStartCamera(item) … 「カメラを起動する」を押したとき（省略時はホームへ移動して撮影を始める）
  //   onRecorded()        … 映像なしで記録したあと（ホームの一覧を更新するため）
  //   isBusy()            … true のあいだは出さない（ホームで撮影中など）
  function start(opts = {}) {
    options = opts;
    // 画面に触れたら音を出せるようにする（ブラウザの自動再生の制限への対応）
    ['pointerdown', 'touchend', 'click', 'keydown'].forEach((type) =>
      document.addEventListener(type, unlockAudio, { capture: true, passive: true })
    );
    document.addEventListener('visibilitychange', onVisibilityChange);
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
    if (Date.now() - fetchedAt >= FETCH_INTERVAL_MS) {
      try {
        const [{ schedules: s }, { logs: l }] = await Promise.all([
          Api.listSchedules(),
          Api.listLogs({ date: localDateStr(new Date()) }),
        ]);
        schedules = s || [];
        logs = l || [];
        fetchedAt = Date.now();
      } catch (err) {
        console.warn('[alarm] 予定の取得に失敗しました:', err);
      }
    }
    evaluate();
  }

  function evaluate() {
    if (Date.now() < holdUntil || isSnoozed() || options.isBusy?.()) {
      hide();
      return;
    }
    const due = dueItems();
    if (due.length > 0) show(due);
    else hide();
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
        <div class="alarm-bell" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        </div>
        <p class="alarm-time" id="alarm-time"></p>
        <h2 id="alarm-title">お薬の時間です</h2>
        <ul class="alarm-meds" id="alarm-meds"></ul>
        <button type="button" class="alarm-camera-btn" data-alarm="camera">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          カメラを起動する
        </button>
        <p class="text-sm alarm-note" id="alarm-multi-note" hidden>カメラでの記録は、お薬1つずつ行います。</p>
        <button type="button" class="btn btn-outline" data-alarm="no-video">映像なしで「飲んだ」を記録</button>
        <button type="button" class="btn btn-ghost" data-alarm="snooze">あとで（${SNOOZE_MIN}分後にもう一度お知らせ）</button>
        <p class="text-sm alarm-note" id="alarm-sound-hint" hidden>音が鳴らないときは、画面のどこかに一度触れてください。</p>
      </div>`;
    // Esc キーなどで閉じられないようにする（ボタンで操作してもらうため）
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    dialog.querySelector('[data-alarm="camera"]').addEventListener('click', onCamera);
    dialog.querySelector('[data-alarm="no-video"]').addEventListener('click', onRecordWithoutVideo);
    dialog.querySelector('[data-alarm="snooze"]').addEventListener('click', onSnooze);
    document.body.appendChild(dialog);
  }

  function show(due) {
    if (!dialog) buildDialog();
    items = due;
    dialog.querySelector('#alarm-time').textContent = formatClock(due[0].at);
    dialog.querySelector('#alarm-meds').innerHTML = due
      .map(({ schedule }) => {
        const med = schedule.medications || {};
        const amount = `${med.dosage || ''}${med.unit || ''}`;
        return `<li>${escapeText(med.name || 'お薬')}${amount ? `<span>${escapeText(amount)}</span>` : ''}</li>`;
      })
      .join('');
    dialog.querySelector('#alarm-multi-note').hidden = due.length <= 1;

    if (!dialog.open) {
      dialog.showModal();
      startSound();
      requestWakeLock();
    }
  }

  function hide() {
    stopSound();
    releaseWakeLock();
    if (dialog?.open) dialog.close();
    items = [];
  }

  // ---- ボタン ----
  function onCamera() {
    const item = items[0];
    if (!item) return;
    holdUntil = Date.now() + 15 * 1000;
    hide();
    if (options.onStartCamera) {
      options.onStartCamera(item);
    } else {
      location.href = `home.html?take=${encodeURIComponent(item.schedule.id)}`;
    }
  }

  async function onRecordWithoutVideo(e) {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      for (const { schedule, log } of items) {
        const logId = log?.id || (await Api.createLog({ schedule_id: schedule.id, date: localDateStr(new Date()) })).log.id;
        await Api.takeLog(logId, {});
      }
      hide();
      showToast('服薬を記録しました。', 'success');
      options.onRecorded?.();
      await refresh();
    } catch (err) {
      handleApiError(err, '記録に失敗しました。');
    } finally {
      btn.disabled = false;
    }
  }

  function onSnooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MIN * 60 * 1000));
    } catch { /* 保存できない場合は、このページを開いているあいだだけ止める */ }
    holdUntil = Date.now() + SNOOZE_MIN * 60 * 1000;
    hide();
  }

  // 「あとで」は画面を移っても続くよう localStorage に保存する
  function isSnoozed() {
    try {
      return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0);
    } catch {
      return false;
    }
  }

  // ---- 音・読み上げ・振動 ----
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  function startSound() {
    if (soundTimer) return;
    lastSpokenAt = 0;
    playOnce();
    soundTimer = setInterval(playOnce, SOUND_INTERVAL_MS);
  }

  function stopSound() {
    clearInterval(soundTimer);
    soundTimer = null;
    try { speechSynthesis?.cancel(); } catch { /* noop */ }
  }

  function playOnce() {
    const canPlay = audioCtx && audioCtx.state === 'running';
    const hint = dialog?.querySelector('#alarm-sound-hint');
    if (hint) hint.hidden = !!canPlay;
    if (!canPlay) {
      unlockAudio(); // 以前に画面に触れていれば、これで鳴らせるようになる
      return;
    }

    try { navigator.vibrate?.([300, 150, 300]); } catch { /* noop */ }

    // 読み上げ中はチャイムを止める（声が聞き取りにくくなるため）
    if ('speechSynthesis' in window && speechSynthesis.speaking) return;
    if ('speechSynthesis' in window && Date.now() - lastSpokenAt >= SPEAK_INTERVAL_MS) {
      lastSpokenAt = Date.now();
      speak();
      return;
    }
    chime();
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

  function speak() {
    try {
      const names = items.map(({ schedule }) => schedule.medications?.name || 'お薬').join('、');
      const utter = new SpeechSynthesisUtterance(`お薬の時間です。${names}を服用してください。`);
      utter.lang = 'ja-JP';
      utter.rate = 0.95;
      speechSynthesis.speak(utter);
    } catch (err) {
      console.warn('[alarm] 読み上げに失敗しました:', err);
    }
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

  return { start, refresh };
})();
