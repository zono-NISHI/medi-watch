// ============================================================
//  ホーム画面ロジック
//  - 本日の服薬スケジュールを表示
//  - 服薬時刻になったら音声で案内し、内向きカメラを起動できる
//  - 撮影した映像は Supabase Storage に署名付きURLでアップロード
// ============================================================

if (!requireLoginOrRedirect()) {
  // リダイレクトするため以降の処理は行わない
  throw new Error('未ログイン');
}

const profile = Session.profile();
const isPatient = profile?.role === 'patient';

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentLogId = null;
let currentMedName = '';
let spokenLogIds = new Set(); // 1セッション中に音声案内済みのログ

document.getElementById('today-label').textContent = new Date().toLocaleDateString('ja-JP', {
  year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});

renderBottomNav('home');
renderRoleBanner();
setupPushToggle();

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

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimer);
  } else {
    pollFailures = 0;
    runPoll();
  }
});

runPoll();

function renderRoleBanner() {
  const banner = document.getElementById('role-banner');
  if (isPatient) {
    banner.innerHTML = '';
    return;
  }
  banner.innerHTML = `
    <div class="card card--warm row">
      <div>
        <strong>見守りモードです。</strong>
        <p class="text-sm text-muted" style="margin:0">ご家族のお薬の様子をこちらで確認できます。「家族」タブから対象を選んでください。</p>
      </div>
    </div>`;
}

async function loadTodaySchedules() {
  const container = document.getElementById('schedule-list');
  try {
    const targetPatientId = isPatient ? undefined : await getFirstWatchedPatientId();

    if (!isPatient && !targetPatientId) {
      container.innerHTML = `
        <div class="empty-state">
          <p>まだ見守り対象のご家族がいません。</p>
          <a href="family.html" class="btn btn-accent btn--auto">招待コードを入力する</a>
        </div>`;
      return;
    }

    const [{ schedules }, { logs }] = await Promise.all([
      Api.listSchedules(targetPatientId),
      Api.listLogs({ patient_id: targetPatientId || profile.id, date: todayStr() }),
    ]);

    const merged = mergeSchedulesWithLogs(schedules, logs);
    renderSchedules(merged, isPatient);

    if (isPatient) {
      maybeAnnounceDue(merged);
    }
  } catch (err) {
    container.innerHTML = `<p class="text-muted">読み込みに失敗しました。再読み込みしてください。</p>`;
    console.error(err);
    throw err; // ポーリング側でリトライ間隔を後退させるために再送出する
  }
}

async function getFirstWatchedPatientId() {
  const { memberGroups } = await Api.listCareGroups();
  return memberGroups?.[0]?.patient_id || null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function mergeSchedulesWithLogs(schedules, logs) {
  // その日のログがあればステータスを反映、なければ「未記録」として予定時刻のみ表示
  return (schedules || [])
    .map((s) => {
      const log = (logs || []).find((l) => l.schedule_id === s.id);
      return { schedule: s, log };
    })
    .sort((a, b) => a.schedule.scheduled_time.localeCompare(b.schedule.scheduled_time));
}

function renderSchedules(merged, editable) {
  const container = document.getElementById('schedule-list');

  if (merged.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/></svg>
        <p>登録されているお薬がまだありません。</p>
        ${editable ? '<a href="medications.html" class="btn btn-accent btn--auto">お薬を登録する</a>' : ''}
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
          ? '<span class="badge badge-skipped">時間が過ぎています</span>'
          : '<span class="badge badge-pending">これから</span>';

      const actionHtml =
        editable && status === 'pending'
          ? `<button class="btn btn-accent btn--sm" data-action="take" data-log-id="${log?.id || ''}" data-schedule-id="${schedule.id}" data-med-name="${escapeHtml(med.name || '')}">飲んだ</button>`
          : status === 'taken' && log?.video_url
          ? `<button class="btn btn-outline btn--sm" data-action="view-video" data-log-id="${log.id}">映像を見る</button>`
          : '';

      return `
        <div class="schedule-card ${status === 'taken' ? 'is-taken' : ''} ${isOverdue ? 'is-overdue' : ''}">
          <div class="schedule-time">${formatTime(schedule.scheduled_time)}</div>
          <div class="schedule-main">
            <h3>${escapeHtml(med.name || '（薬名未設定）')}</h3>
            <div class="schedule-meta">
              <span class="text-sm text-muted">${med.dosage || ''} ${med.unit || ''} ・ ${mealTimingLabel(schedule.meal_timing)}</span>
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

function isPastDue(scheduledTime) {
  const now = new Date();
  const [h, m] = scheduledTime.split(':').map(Number);
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  return now > scheduled;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- 音声案内（服薬時刻になったスケジュールを読み上げる） ----
function maybeAnnounceDue(merged) {
  if (!('speechSynthesis' in window)) return;
  const now = new Date();

  for (const { schedule, log } of merged) {
    if (log?.status && log.status !== 'pending') continue;
    const [h, m] = schedule.scheduled_time.split(':').map(Number);
    const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    const diffMin = (now - scheduled) / 60000;

    // 服薬時刻ちょうど（0〜2分以内）かつ未読み上げのものだけ案内する
    const key = schedule.id;
    if (diffMin >= 0 && diffMin <= 2 && !spokenLogIds.has(key)) {
      spokenLogIds.add(key);
      speakReminder(schedule.medications?.name || 'お薬');
    }
  }
}

function speakReminder(medName) {
  try {
    const utter = new SpeechSynthesisUtterance(
      `お薬の時間です。${medName}を服用してください。`
    );
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

async function openTakeModal({ logId, scheduleId, medName }) {
  currentLogId = logId || (await ensureLogExists(scheduleId));
  currentMedName = medName || 'お薬';

  document.getElementById('take-modal-title').textContent = `「${currentMedName}」を服用しましょう`;
  document.getElementById('take-modal-sub').textContent = '服用後、ボタンを押して記録してください。カメラの利用は任意です。';
  uploadStatus.textContent = '';
  resetCameraUi();

  modal.showModal();
  speakReminder(currentMedName);
}

async function ensureLogExists(scheduleId) {
  // ホーム表示時点でその日のログがまだ無い場合（cronがまだ走っていない等）に備えたフォールバック
  const now = new Date();
  const scheduledAt = now.toISOString();
  const { log } = await Api.createLog({ schedule_id: scheduleId, scheduled_at: scheduledAt });
  return log.id;
}

function resetCameraUi() {
  videoEl.style.display = 'none';
  placeholderEl.style.display = 'flex';
  recordIndicator.hidden = true;
  startCameraBtn.hidden = false;
  finishTakeBtn.hidden = true;
  recordedChunks = [];
}

document.getElementById('modal-close-btn').addEventListener('click', () => closeModal());
modal.addEventListener('cancel', () => closeModal());

function closeModal() {
  stopCamera();
  modal.close();
}

startCameraBtn.addEventListener('click', async () => {
  try {
    // フロントカメラ（内向き）を優先して起動
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
    videoEl.srcObject = mediaStream;
    videoEl.style.display = 'block';
    placeholderEl.style.display = 'none';
    recordIndicator.hidden = false;
    startCameraBtn.hidden = true;
    finishTakeBtn.hidden = false;

    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start();
  } catch (err) {
    console.error(err);
    showToast('カメラを起動できませんでした。映像なしで記録することもできます。', 'error');
  }
});

finishTakeBtn.addEventListener('click', async () => {
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
    showToast('服薬を記録しました。ご家族にもお知らせします。', 'success');
    modal.close();
    loadTodaySchedules();
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
  } finally {
    finishTakeBtn.disabled = false;
    finishTakeBtn.textContent = '飲みました（記録する）';
  }
});

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
  takeWithoutVideoBtn.disabled = true;
  try {
    stopCamera();
    await Api.takeLog(currentLogId, {});
    showToast('服薬を記録しました。', 'success');
    modal.close();
    loadTodaySchedules();
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
  } finally {
    takeWithoutVideoBtn.disabled = false;
  }
});

skipBtn.addEventListener('click', async () => {
  try {
    stopCamera();
    await Api.skipLog(currentLogId, {});
    showToast('今回はスキップとして記録しました。', 'info');
    modal.close();
    loadTodaySchedules();
  } catch (err) {
    handleApiError(err, '記録に失敗しました。');
  }
});

function stopCamera() {
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

// ---- プッシュ通知の購読設定 ----
function setupPushToggle() {
  document.getElementById('notif-toggle-btn').addEventListener('click', async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast('お使いのブラウザは通知に対応していません。', 'error');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('通知が許可されませんでした。', 'info');
        return;
      }
      const reg = await navigator.serviceWorker.register('sw.js');
      const { publicKey } = await Api.getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const subJson = sub.toJSON();
      await Api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        device_name: navigator.userAgent.slice(0, 60),
      });
      showToast('通知を有効にしました。', 'success');
    } catch (err) {
      console.error(err);
      showToast('通知の設定に失敗しました。', 'error');
    }
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}
