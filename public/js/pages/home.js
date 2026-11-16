// ============================================================
//  ホーム画面ロジック
//  - 「自分」と「見守っているご家族」を上部のボタンで切り替えて表示
//    （1つのアカウントで見守る側・見守られる側の両方を行えるため）
//  - 本日の服薬スケジュールを表示
//  - 服薬時刻になったらアラーム（js/alarm.js）で知らせ、内向きカメラを起動できる
//  - 撮影した映像は Supabase Storage に署名付きURLでアップロード
// ============================================================

if (!requireLoginOrRedirect()) {
  // リダイレクトするため以降の処理は行わない
  throw new Error('未ログイン');
}

const profile = Session.profile();

// ---- 表示する人（自分／見守っているご家族）は js/viewTarget.js の ViewTarget で管理する ----
const SELF_TARGET = { id: profile.id, isSelf: true, canViewVideo: true };

// 服薬アラーム（js/alarm.js）の「カメラを起動する」から来たとき（?take=スケジュールID）
const takeFromUrl = new URLSearchParams(location.search).get('take');
if (takeFromUrl) history.replaceState(null, '', location.pathname);
// アラームから来て、撮影画面を開くまでのあいだ true。このあいだは画面のアラームを出さない
// （撮影画面より先に、アラームの画面が一瞬出てしまうため）
let takePending = !!takeFromUrl;

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentLogId = null;
let currentScheduleId = null;
let currentMedName = '';
let lastMerged = []; // 最後に表示した自分の予定（アラームから撮影を始めるときに使う）

document.getElementById('today-label').textContent = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});

renderBottomNav('home');
setupPushToggle();
PushSetup.syncCurrentUser(); // この端末を、いまログインしている利用者に結び付け直す
// ネイティブ版：アラームの設定が済んでいなければ、マイページへの案内を出す
const nativeAlarmNotice = document.getElementById('native-alarm-notice');
NativeAlarm.renderSetupNotice(nativeAlarmNotice);

// 失敗したら間隔を後退させ、タブが非表示の間は止める
let pollTimer = null;
let pollFailures = 0;

function scheduleNextPoll() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  const base = 30000;
  const delay = Math.min(base * 2 ** pollFailures, 5 * 60 * 1000); // 最大5分
  pollTimer = setTimeout(runPoll, delay);
}

async function runPoll() {
  try {
    await loadTodaySchedules();
    pollFailures = 0;
  } catch {
    pollFailures = Math.min(pollFailures + 1, 4);
  }
  scheduleNextPoll();
}

// ブラウザの「戻る」で、前に開いていたホーム画面がそのまま復元されたとき（bfcache）も、
// 記録タブで変えた内容を反映するため、最新の予定と記録を読み直す
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  pollFailures = 0;
  runPoll();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
  } else {
    pollFailures = 0;
    runPoll();
    NativeAlarm.renderSetupNotice(nativeAlarmNotice); // 設定の画面から戻ってきたとき
  }
});

ViewTarget.init()
  .then(() => {
    // アラームから来たときは、自分の予定を表示して撮影を始める
    if (takeFromUrl) ViewTarget.select(profile.id);
    renderViewHeader();
  })
  .catch((err) => console.error(err))
  .finally(async () => {
    await runPoll();
    if (!takeFromUrl) return;
    try {
      await startTakeFromAlarm(takeFromUrl);
    } catch (err) {
      console.error(err);
    } finally {
      takePending = false; // 撮影画面を開けなかったときは、画面のアラームで知らせる
    }
  });

// 服薬アラーム：ホームでは画面を移らずに、この画面の撮影モーダルを開く
MedAlarm.start({
  isBusy: () => modal.open || takePending,
  onStartCamera: ({ schedule, log }) => {
    if (!ViewTarget.get()?.isSelf) {
      ViewTarget.select(profile.id);
      renderViewHeader();
      runPoll();
    }
    openTakeModal({ logId: log?.id, scheduleId: schedule.id, medName: schedule.medications?.name })
      .then(() => startCameraBtn.click());
  },
  onRecorded: () => loadTodaySchedules().catch(() => {}),
});

async function startTakeFromAlarm(scheduleId) {
  const item = lastMerged.find(({ schedule }) => schedule.id === scheduleId);
  if (!item || (item.log?.status && item.log.status !== 'pending')) return;
  await openTakeModal({
    logId: item.log?.id,
    scheduleId,
    medName: item.schedule.medications?.name,
  });
  startCameraBtn.click();
}

// 切り替えボタン・見出し・見守り中の帯を、いま表示している人に合わせる
function renderViewHeader() {
  const target = ViewTarget.get();
  ViewTarget.renderSwitcher(document.getElementById('view-switcher'), () => {
    renderViewHeader();
    document.getElementById('schedule-list').innerHTML = '<p class="text-muted">読み込み中…</p>';
    pollFailures = 0;
    clearTimeout(pollTimer);
    runPoll();
  });
  document.getElementById('page-title').textContent = ViewTarget.title('今日のお薬');
  ViewTarget.renderBanner(
    document.getElementById('role-banner'),
    `記録の操作はご本人だけが行えます。${target?.canViewVideo === false ? '服薬映像は、ご本人の設定により表示されません。' : ''}`
  );
}

async function loadTodaySchedules() {
  const container = document.getElementById('schedule-list');
  const target = ViewTarget.get() || SELF_TARGET;
  try {
    const [{ schedules }, { logs: fetchedLogs }] = await Promise.all([
      Api.listSchedules(target.isSelf ? undefined : target.id),
      Api.listLogs({ patient_id: target.id, date: todayStr() }),
    ]);
    // 自分の予定で、時刻を過ぎたのに記録がまだ無いものは、ここで「未記録」の記録を作る
    const logs = target.isSelf ? await ensureOverdueLogs(schedules, fetchedLogs) : fetchedLogs;

    // 読み込み中に別の人へ切り替えられていたら、古い結果は捨てる
    if ((ViewTarget.get() || SELF_TARGET).id !== target.id) return;

    const merged = mergeSchedulesWithLogs(schedules, logs);
    renderSchedules(merged, target, (schedules || []).length > 0);
    if (target.isSelf) lastMerged = merged;
  } catch (err) {
    container.innerHTML = `<p class="text-muted">読み込みに失敗しました。再読み込みしてください。</p>`;
    console.error(err);
    throw err; // ポーリング側でリトライ間隔を後退させるために再送出する
  }
}

// 服薬時刻を過ぎたのに、今日の記録（medication_logs）がまだ無い自分の予定について、「未記録」の記録を作る。
// 今日の記録はふだんサーバーの cron が作るが、サーバーが止まっていた（しばらく誰も使わず休止していた）
// あいだに時刻を過ぎると、記録が無いままになる。するとホームには「時間が過ぎています」と出るのに、
// 記録タブには何も出ない、という食い違いが起きる。ホームを開いた時点で作り、記録タブにも「飲み忘れ」と出るようにする。
// （サーバーは同じ予定の記録を二重に作らない。作れなくても表示は続け、cron が後で作る）
async function ensureOverdueLogs(schedules, logs) {
  const dow = new Date().getDay();
  const missing = (schedules || []).filter(
    (s) =>
      (s.days_of_week || [0, 1, 2, 3, 4, 5, 6]).includes(dow) &&
      isPastDue(s.scheduled_time) &&
      !isChangedAfterDue(s) && // 時刻を過ぎてから登録・変更した予定は、明日から記録する
      !findTodayLog(s, logs)
  );
  if (missing.length === 0) return logs || [];
  const created = await Promise.all(
    missing.map((s) =>
      Api.createLog({ schedule_id: s.id, date: todayStr() })
        .then(({ log }) => log)
        .catch((err) => {
          console.warn('未記録の記録を作れませんでした:', err);
          return null;
        })
    )
  );
  return [...(logs || []), ...created.filter(Boolean)];
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mergeSchedulesWithLogs(schedules, logs) {
  // その日のログがあればステータスを反映、なければ「未記録」として予定時刻のみ表示
  return (schedules || [])
    .map((s) => ({ schedule: s, log: findTodayLog(s, logs) }))
    // 今日の服薬時刻を過ぎてから登録・変更した予定は、今日は出さない（明日から。サーバーの cron・アラームと同じ考え方）
    .filter(({ schedule, log }) => log || !isChangedAfterDue(schedule))
    .sort((a, b) => a.schedule.scheduled_time.localeCompare(b.schedule.scheduled_time));
}

function renderSchedules(merged, target, hasSchedules) {
  const container = document.getElementById('schedule-list');
  const editable = target.isSelf; // 記録の操作は本人だけ

  // お薬は登録されているが、今日の分がすべて明日からになっている場合
  if (merged.length === 0 && hasSchedules) {
    container.innerHTML = `
      <div class="empty-state">
        <p>今日のお薬の予定はありません。<br />服薬時刻を過ぎてから登録・変更したお薬は、明日から表示されます。</p>
      </div>`;
    return;
  }

  if (merged.length === 0) {
    // 自分のお薬が無く、まだ誰も見守っていない人には、見守りの始め方も案内する
    // （「家族を見守る」を使わない設定の人には出さない）
    const showJoinHint = target.isSelf && !ViewTarget.hasFamily() && profile.can_watch !== false;
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/></svg>
        <p>${editable ? '登録されているお薬がまだありません。' : `${escapeHtml(target.label)}のお薬はまだ登録されていません。`}</p>
        ${editable ? '<a href="medications.html" class="btn btn-accent btn--auto">お薬を登録する</a>' : ''}
        ${showJoinHint ? '<a href="family.html?show=watching" class="btn btn-outline btn--auto">ご家族を見守る（招待コードを入力）</a>' : ''}
      </div>`;
    return;
  }

  container.innerHTML = merged
    .map(({ schedule, log }) => {
      const status = log?.status || 'pending';
      const isOverdue = status === 'pending' && isPastDue(schedule.scheduled_time);
      const med = schedule.medications || {};

      const statusBadge =
        status === 'taken'
          ? '<span class="badge badge-taken">服薬済み</span>'
          : status === 'skipped'
          ? '<span class="badge badge-skipped">スキップ</span>'
          : isOverdue
          // 「スキップ」と同じ色だと、何もしていないのにスキップしたように見えるため、記録タブの「飲み忘れ」と同じ濃い色にする
          ? '<span class="badge badge-missed">時間が過ぎています</span>'
          : '<span class="badge badge-pending">これから</span>';

      const actionHtml =
        editable && status === 'pending'
          ? `<button class="btn btn-accent btn--sm" data-action="take" data-log-id="${log?.id || ''}" data-schedule-id="${schedule.id}" data-med-name="${escapeHtml(med.name || '')}">飲んだ</button>`
          : status === 'taken' && log?.video_url && target.canViewVideo
          ? `<button class="btn btn-outline btn--sm" data-action="view-video" data-log-id="${log.id}">映像を見る</button>`
          : '';

      return `
        <div class="schedule-card ${status === 'taken' ? 'is-taken' : ''} ${isOverdue ? 'is-overdue' : ''}">
          <div class="schedule-time">${formatTime(schedule.scheduled_time)}</div>
          <div class="schedule-main">
            <h3>${escapeHtml(med.name || '（薬名未設定）')}</h3>
            <div class="schedule-meta">
              <span class="text-sm text-muted">${escapeHtml(med.dosage)} ${escapeHtml(med.unit)} ・ ${mealTimingLabel(schedule.meal_timing)}</span>
              ${statusBadge}
            </div>
          </div>
          <div class="schedule-action">${actionHtml}</div>
        </div>`;
    })
    .join('');

  container.querySelectorAll('[data-action="take"]').forEach((btn) => {
    btn.addEventListener('click', () => openTakeModal(btn.dataset));
  });
  container.querySelectorAll('[data-action="view-video"]').forEach((btn) => {
    btn.addEventListener('click', () => viewVideo(btn.dataset.logId));
  });
}

// スケジュールに対応する今日の記録。服薬済み・スキップか、今の服薬時刻と同じ予定時刻の記録だけを対応させる
// 時刻を変えた日に残る、変更前の時刻の「飲み忘れ」は記録タブにだけ出す（今日の予定とは別の履歴として扱う）
function findTodayLog(schedule, logs) {
  const at = todayAt(schedule.scheduled_time).getTime();
  const own = (logs || []).filter((l) => l.schedule_id === schedule.id);
  return own.find((l) => l.status !== 'pending') || own.find((l) => new Date(l.scheduled_at).getTime() === at);
}

// 今日のその時刻（端末の時刻で判定する）
function todayAt(scheduledTime) {
  const now = new Date();
  const [h, m] = scheduledTime.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
}

function isPastDue(scheduledTime) {
  return new Date() > todayAt(scheduledTime);
}

// 今日の服薬時刻を過ぎてから登録・変更したスケジュールか
function isChangedAfterDue(schedule) {
  if (!schedule.updated_at) return false;
  return new Date(schedule.updated_at) > todayAt(schedule.scheduled_time);
}

// 本文にも属性値（data-med-name="..."）にも使うため、引用符まで置き換える
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---- 音声案内（撮影画面を開いたときに読み上げる。服薬時刻になったときのアラームは js/alarm.js） ----
// med: { name, dosage, unit }。アラームと同じ言い方で、用量も読み上げる（例: 「お薬の時間です。ロキソニンを3錠服用してください。」）
function speakReminder(med) {
  const medName = med?.name || 'お薬';
  try {
    const utter = new SpeechSynthesisUtterance(medAnnouncement([med]));
    utter.lang = 'ja-JP';
    utter.rate = 0.95;
    speechSynthesis.speak(utter);
    showToast(`🔔「${medName}」を服用する時間です。`, 'info', 5000);
  } catch (err) {
    console.warn('音声案内に失敗しました:', err);
  }
}

// ---- 服薬モーダル ----
const modal = document.getElementById('take-modal');
const videoEl = document.getElementById('camera-preview');
const placeholderEl = document.getElementById('camera-placeholder');
const recordIndicator = document.getElementById('record-indicator');
const startCameraBtn = document.getElementById('start-camera-btn');
const finishTakeBtn = document.getElementById('finish-take-btn');
const takeWithoutVideoBtn = document.getElementById('take-without-video-btn');
const skipBtn = document.getElementById('skip-btn');
const uploadStatus = document.getElementById('upload-status');

// 録画は長くても30秒で自動的に止め、そのまま「服薬済み（映像つき）」として記録する
// （「飲みました」の押し忘れで録画が続くと、保存先の上限 50MB を超えて映像が保存できなくなるため）
const MAX_RECORD_SECONDS = 30;
const VIDEO_BITS_PER_SECOND = 1000000; // 約1Mbps（30秒で約4MB）
let recordTimer = null;
let finishing = false; // 自動の記録とボタンの記録が重ならないようにする

const takeSubEl = document.getElementById('take-modal-sub');
// 「映像なしで記録」のボタンは、録画中は「映像つき」のボタンと対になる言い方にする
const LABEL_NO_VIDEO = '映像なしで「飲んだ」を記録';
const LABEL_NO_VIDEO_RECORDING = '飲みました（映像なしで記録する）';

async function openTakeModal({ logId, scheduleId, medName }) {
  currentLogId = logId || (await ensureLogExists(scheduleId));
  currentScheduleId = scheduleId || null;
  currentMedName = medName || 'お薬';

  document.getElementById('take-modal-title').textContent = `「${currentMedName}」を服用しましょう`;
  uploadStatus.textContent = '';
  resetCameraUi();

  modal.showModal();
  // 用量・単位は、表示中の予定から探す（見つからなければ名前だけを読み上げる）
  const med = lastMerged.find(({ schedule }) => schedule.id === scheduleId)?.schedule.medications;
  speakReminder({ ...med, name: currentMedName });
}

async function ensureLogExists(scheduleId) {
  // ホーム表示時点でその日のログがまだ無い場合（cronがまだ走っていない等）に備えたフォールバック
  // 予定時刻はサーバーがスケジュールの服薬時刻から決める（押した時刻で作ると、
  // cron が作る本来の予定の記録と別物になり「未記録」が残ってしまうため）
  const { log } = await Api.createLog({ schedule_id: scheduleId, date: todayStr() });
  return log.id;
}

function resetCameraUi() {
  videoEl.style.display = 'none';
  placeholderEl.style.display = 'flex';
  recordIndicator.hidden = true;
  recordIndicator.textContent = '● 記録中';
  startCameraBtn.hidden = false;
  finishTakeBtn.hidden = true;
  takeWithoutVideoBtn.hidden = false;
  takeWithoutVideoBtn.textContent = LABEL_NO_VIDEO;
  takeSubEl.textContent = `服用後、ボタンを押して記録してください。カメラの利用は任意です。録画は${MAX_RECORD_SECONDS}秒たつと自動で終わり、そのまま記録されます。`;
  modal.classList.remove('is-recording');
  recordedChunks = [];
}

document.getElementById('modal-close-btn').addEventListener('click', () => closeModal());
modal.addEventListener('cancel', (e) => {
  e.preventDefault(); // 閉じるかどうかは closeModal で決める
  closeModal();
});

// 「×」などで、記録せずに閉じたとき
function closeModal() {
  if (finishing) return; // 記録の送信中は閉じない（記録されたのに「あとで」になるのを防ぐ）
  stopCamera();
  modal.close();
  // お薬の時間になっている予定なら、アラームの「あとで」と同じ扱いにする
  // （閉じた直後にアラームの画面へ戻すと迷う。何もしないと、ネイティブ版では今日はもう鳴らない）
  if (currentScheduleId && MedAlarm.snoozeIfDue(currentScheduleId)) {
    showToast(`記録せずに閉じました。${MedAlarm.SNOOZE_MIN}分後にもう一度お知らせします。`, 'info', 6000);
  }
}

startCameraBtn.addEventListener('click', async () => {
  try {
    // フロントカメラ（内向き）を優先して起動
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = mediaStream;
    videoEl.style.display = 'block';
    placeholderEl.style.display = 'none';
    recordIndicator.hidden = false;
    startCameraBtn.hidden = true;
    finishTakeBtn.hidden = false;
    // 録画中も「映像なしで記録」を選べるようにする（アラームから来るとカメラがすぐ起動するため、
    // 隠すと「×」で閉じない限り映像なしを選べない）。ボタンが1つ増える分、映像の枠を低くし、
    // 説明文を短くして、ボタンが画面に収まるようにする（css/home.css の .is-recording）
    takeWithoutVideoBtn.textContent = LABEL_NO_VIDEO_RECORDING;
    takeSubEl.textContent = `服用後、下のボタンを押して記録してください。${MAX_RECORD_SECONDS}秒たつと、自動で映像つきで記録されます。`;
    modal.classList.add('is-recording');

    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start();
    startRecordCountdown();
  } catch (err) {
    console.error(err);
    showToast('カメラを起動できませんでした。映像なしで記録することもできます。', 'error');
  }
});

// 録画の残り時間を表示し、0秒になったら自動で記録する
function startRecordCountdown() {
  clearInterval(recordTimer);
  let remaining = MAX_RECORD_SECONDS;
  recordIndicator.textContent = `● 記録中（あと${remaining}秒）`;
  recordTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      recordIndicator.textContent = `● 記録中（あと${remaining}秒）`;
      return;
    }
    clearInterval(recordTimer);
    recordTimer = null;
    finishTake(true);
  }, 1000);
}

finishTakeBtn.addEventListener('click', () => finishTake(false));

// auto: 録画が30秒に達して自動で記録するとき true
async function finishTake(auto) {
  if (finishing) return;
  finishing = true;
  clearInterval(recordTimer);
  recordTimer = null;
  finishTakeBtn.disabled = true;
  finishTakeBtn.textContent = '記録しています…';

  try {
    let videoUrl = null;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      const blob = await stopRecordingAndGetBlob();
      videoUrl = await uploadVideo(blob);
    }
    stopCamera();

    await Api.takeLog(currentLogId, { video_url: videoUrl });
    showToast(
      auto
        ? `${MAX_RECORD_SECONDS}秒たったので、服薬を記録しました。ご家族にもお知らせします。`
        : '服薬を記録しました。ご家族にもお知らせします。',
      'success',
      auto ? 6000 : 3200
    );
    modal.close();
    loadTodaySchedules();
    MedAlarm.refresh(); // 記録した予定のアラームを止める
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
  } finally {
    finishing = false;
    finishTakeBtn.disabled = false;
    finishTakeBtn.textContent = '飲みました（映像つきで記録する）';
  }
}

function stopRecordingAndGetBlob() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      resolve(new Blob(recordedChunks, { type: 'video/webm' }));
    };
    mediaRecorder.stop();
  });
}

async function uploadVideo(blob) {
  uploadStatus.textContent = '映像をアップロードしています…';
  try {
    const { signedUrl, path } = await Api.getVideoUploadUrl(currentLogId);
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
    if (!uploadRes.ok) throw new Error('アップロードに失敗しました');
    uploadStatus.textContent = 'アップロードが完了しました。';
    return path;
  } catch (err) {
    console.error('動画アップロードエラー:', err);
    uploadStatus.textContent = '映像のアップロードに失敗しましたが、服薬記録は保存します。';
    return null;
  }
}

takeWithoutVideoBtn.addEventListener('click', async () => {
  if (finishing) return; // 映像つきの記録（ボタン・30秒の自動）と重ならないようにする
  finishing = true;
  takeWithoutVideoBtn.disabled = true;
  finishTakeBtn.disabled = true;
  const wasRecording = !!mediaStream;
  try {
    stopCamera(); // 録画中だった場合、撮った映像は保存せずに捨てる
    await Api.takeLog(currentLogId, {});
    showToast(wasRecording ? '映像なしで服薬を記録しました。' : '服薬を記録しました。', 'success');
    modal.close();
    loadTodaySchedules();
    MedAlarm.refresh(); // 記録した予定のアラームを止める
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
    // カメラは止めたので、録画中だった場合はカメラ起動前の表示に戻す
    if (wasRecording) resetCameraUi();
  } finally {
    finishing = false;
    takeWithoutVideoBtn.disabled = false;
    finishTakeBtn.disabled = false;
  }
});

skipBtn.addEventListener('click', async () => {
  try {
    stopCamera();
    await Api.skipLog(currentLogId, {});
    showToast('今回はスキップとして記録しました。', 'info');
    modal.close();
    loadTodaySchedules();
    MedAlarm.refresh(); // 記録した予定のアラームを止める
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
  }
});

function stopCamera() {
  clearInterval(recordTimer);
  recordTimer = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch {}
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

async function viewVideo(logId) {
  try {
    const { url } = await Api.getVideoUrl(logId);
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    handleApiError(err, '映像を取得できませんでした。');
  }
}

// ---- プッシュ通知の購読設定（処理は js/push.js の PushSetup にまとめている） ----
function setupPushToggle() {
  document.getElementById('notif-toggle-btn').addEventListener('click', () => {
    // ネイティブ版は Web Push を使えないので、アラームの設定を開く
    if (NativeAlarm.available()) {
      location.href = 'mypage.html#native-alarm-card';
      return;
    }
    PushSetup.enable();
  });
}
