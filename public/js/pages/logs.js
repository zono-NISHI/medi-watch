// ============================================================
//  服薬記録履歴ページ ロジック
//  - 「自分」と「見守っているご家族」を上部のボタンで切り替えて表示（js/viewTarget.js）
//  - 自分の記録は、状態の変更（服薬済み／スキップ／取り消し）と、付け忘れた分の追加ができる
//    ホーム画面は開くたびに最新の記録を読み込むので、ここで変えた内容もそのまま反映される
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('logs');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

const dateFilter = document.getElementById('date-filter');
const statusFilter = document.getElementById('status-filter');
const addLogBtn = document.getElementById('add-log-btn');

let shownLogs = new Map(); // いま表示している記録（id → 記録）。変更画面を開くときに使う

dateFilter.addEventListener('change', loadLogs);
statusFilter.addEventListener('change', loadLogs);

ViewTarget.init()
  .then(renderViewHeader)
  .catch((err) => console.error(err))
  .finally(loadLogs);

// 切り替えボタン・見出し・見守り中の帯を、いま表示している人に合わせる
function renderViewHeader() {
  const target = ViewTarget.get();
  ViewTarget.renderSwitcher(document.getElementById('view-switcher'), () => {
    renderViewHeader();
    loadLogs();
  });
  document.getElementById('page-title').textContent = ViewTarget.title('服薬記録');
  addLogBtn.hidden = !isSelfView(); // 記録の操作は本人だけ
  ViewTarget.renderBanner(
    document.getElementById('role-banner'),
    `記録の操作はご本人だけが行えます。${target?.canViewVideo === false ? '服薬映像は、ご本人の設定により表示されません。' : ''}`
  );
}

async function loadLogs() {
  const container = document.getElementById('log-list');
  container.innerHTML = '<p class="text-muted">読み込み中…</p>';

  const target = ViewTarget.get();
  const params = {};
  if (target && !target.isSelf) params.patient_id = target.id;
  if (dateFilter.value) params.date = dateFilter.value;
  if (statusFilter.value) params.status = statusFilter.value;

  try {
    const { logs } = await Api.listLogs(params);
    // 読み込み中に別の人へ切り替えられていたら、古い結果は捨てる
    if (ViewTarget.get() !== target) return;
    renderLogs(logs);
  } catch (err) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
    console.error(err);
  }
}

// 自分の記録を表示しているか（家族の記録は見るだけ）
function isSelfView() {
  const target = ViewTarget.get();
  return !target || target.isSelf;
}

function renderLogs(logs) {
  const container = document.getElementById('log-list');
  shownLogs = new Map((logs || []).map((log) => [log.id, log]));
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>該当する記録がありません。</p></div>';
    return;
  }

  // 予定時刻の新しい順（降順）に並べる。
  // 記録した時刻を基準にすると、昨日の分をあとから直したときに「今日」のまとまりへ移ってしまうため、
  // 状態を変えても位置が変わらないよう、常に予定時刻を基準にする
  const sorted = [...logs].sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

  // 予定の日付（日本時間）ごとにまとめる。降順に並べ済みなので、日付が変わったら次のまとまりにする
  const days = [];
  for (const log of sorted) {
    const key = jstDateKey(log.scheduled_at);
    if (days.length === 0 || days[days.length - 1].key !== key) {
      days.push({ key, logs: [] });
    }
    days[days.length - 1].logs.push(log);
  }

  const now = Date.now();
  container.innerHTML = days
    .map(
      (day) => `
        <section class="log-day">
          <h2 class="log-day-title">${dayLabel(day.key)}</h2>
          <div class="stack stack--tight">${day.logs.map((log) => renderLogCard(log, now)).join('')}</div>
        </section>`
    )
    .join('');

  container.querySelectorAll('[data-action="video"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        const { url } = await Api.getVideoUrl(btn.dataset.logId);
        window.open(url, '_blank', 'noopener');
      } catch (err) {
        handleApiError(err, '映像を取得できませんでした。');
      }
    })
  );
  container.querySelectorAll('[data-action="edit"]').forEach((btn) =>
    btn.addEventListener('click', () => openStatusModal(shownLogs.get(btn.dataset.logId)))
  );
}

// 1件分のカード。大きく表示する時刻は並べ替えの基準と同じ予定時刻
function renderLogCard(log, now) {
  const recorded = recordedAt(log);
  const med = log.medication_schedules?.medications;
  // お薬タブで登録した用量・単位（お薬タブ・ホームと同じく「用量 単位」の形）。どちらも未登録なら出さない
  const amount = [med?.dosage, med?.unit].filter(Boolean).join(' ');
  const isMissed = isMissedLog(log, now);
  const statusBadge =
    log.status === 'taken'
      ? '<span class="badge badge-taken">服薬済み</span>'
      : log.status === 'skipped'
      ? '<span class="badge badge-skipped">スキップ</span>'
      : isMissed
      ? '<span class="badge badge-missed">飲み忘れ</span>'
      : '<span class="badge badge-pending">未記録</span>';

  // 記録済みは記録した時刻を小さく添える。あとから記録して、予定の日と記録した日が違うときは日付も付ける
  let recordNote = '';
  if (recorded) {
    const sameDay = jstDateKey(recorded) === jstDateKey(log.scheduled_at);
    const when = sameDay ? jstTime(recorded) : `${jstMonthDay(recorded)} ${jstTime(recorded)}`;
    recordNote = `<span class="text-sm text-muted">記録：${when}</span>`;
  }

  const videoBtn =
    log.status === 'taken' && log.video_url && ViewTarget.get()?.canViewVideo !== false
      ? `<button class="btn btn-outline btn--sm" data-log-id="${log.id}" data-action="video">映像を見る</button>`
      : '';
  const editBtn = isSelfView()
    ? `<button class="btn btn-outline btn--sm" data-log-id="${log.id}" data-action="edit">編集</button>`
    : '';
  const actions = videoBtn || editBtn ? `<div class="log-actions">${videoBtn}${editBtn}</div>` : '';

  return `
    <div class="log-card">
      <div class="log-time">
        <span class="log-time-value">${jstTime(log.scheduled_at)}</span>
        <span class="log-time-label">予定</span>
      </div>
      <div class="log-main">
        <h3>${escapeHtml(med?.name || '（薬名不明）')}</h3>
        ${amount ? `<p class="log-amount text-sm text-muted">${escapeHtml(amount)}</p>` : ''}
        <div class="row">${statusBadge} ${recordNote}</div>
      </div>
      ${actions}
    </div>`;
}

// 未記録のまま予定時刻を過ぎたもの（画面では「飲み忘れ」と表示する）
function isMissedLog(log, now = Date.now()) {
  return log.status === 'pending' && new Date(log.scheduled_at).getTime() < now;
}

function statusLabel(log) {
  if (log.status === 'taken') return '服薬済み';
  if (log.status === 'skipped') return 'スキップ';
  return isMissedLog(log) ? '飲み忘れ' : '未記録';
}

// 変えた内容を本人へ伝え、ご家族へのお知らせの有無も添える（サーバーは今日の予定のときだけ通知する）
// changed: 状態が実際に変わったか（変わっていなければ通知は送られない）
function changedMessage(scheduledAt, status, medName, changed = true) {
  const when = `${jstMonthDay(scheduledAt)} ${jstTime(scheduledAt)}`;
  const label = status === 'taken' ? '服薬済み' : status === 'skipped' ? 'スキップ' : null;
  const base = label
    ? `${when}の「${medName}」を${label}にしました。`
    : `${when}の「${medName}」の記録を取り消しました。`;
  const notifies =
    changed && label && jstDateKey(scheduledAt) === jstDateKey(new Date()) && Session.profile()?.can_be_watched !== false;
  return notifies ? `${base}ご家族にもお知らせします。` : base;
}

// ---- 記録の状態を変える画面 ----
const statusModal = document.getElementById('status-modal');
let editingLog = null;

function openStatusModal(log) {
  if (!log || !isSelfView()) return;
  editingLog = log;
  const med = log.medication_schedules?.medications;
  document.getElementById('status-modal-title').textContent = `「${med?.name || 'お薬'}」の記録を編集する`;
  document.getElementById('status-modal-sub').textContent =
    `${jstMonthDay(log.scheduled_at)} ${jstTime(log.scheduled_at)} の予定です。いまは「${statusLabel(log)}」になっています。`;

  // いまと同じ状態にするボタンは出さない
  statusModal.querySelectorAll('[data-status]').forEach((btn) => {
    btn.hidden = btn.dataset.status === log.status;
    btn.disabled = false;
  });
  // 取り消すと、予定時刻を過ぎていれば「飲み忘れ」、まだなら「未記録」になる
  document.getElementById('status-pending-btn').textContent =
    new Date(log.scheduled_at).getTime() < Date.now() ? '記録を取り消す（飲み忘れに戻す）' : '記録を取り消す（未記録に戻す）';
  document.getElementById('status-modal-note').textContent =
    log.status === 'taken' && log.video_url
      ? 'ほかの状態にしても、服薬映像は消えません。「服薬済み」に戻すと、また見られます。'
      : '';
  statusModal.showModal();
}

statusModal.querySelectorAll('[data-status]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const log = editingLog;
    if (!log) return;
    const status = btn.dataset.status;
    statusModal.querySelectorAll('[data-status]').forEach((b) => { b.disabled = true; });
    try {
      await Api.updateLogStatus(log.id, status);
      showToast(changedMessage(log.scheduled_at, status, log.medication_schedules?.medications?.name || 'お薬'), 'success', 4000);
      statusModal.close();
      afterRecordChanged();
    } catch (err) {
      handleApiError(err, '記録を変更できませんでした。');
    } finally {
      statusModal.querySelectorAll('[data-status]').forEach((b) => { b.disabled = false; });
    }
  })
);

// ---- 服薬の記録を追加する画面 ----
const addModal = document.getElementById('add-modal');
const addForm = document.getElementById('add-form');
const addDate = document.getElementById('add-date');
const addSchedule = document.getElementById('add-schedule');
const addScheduleNote = document.getElementById('add-schedule-note');
let mySchedules = []; // 自分の服薬スケジュール（追加画面を開くたびに読み込む）
const ADD_DAYS_BACK = 30; // あとから記録できるのは、今日から30日前まで

// 日付の選択肢（今日から過去へ）。カレンダー（input type="date"）では明日以降の日付を
// 画面から消せない（iPhone の Safari は選べないようにする指定 max にも従わない）ため、選択肢から選ぶ形にしている
function renderDateOptions() {
  const today = jstDateKey(new Date());
  const keys = [];
  for (let i = 0; i <= ADD_DAYS_BACK; i += 1) {
    keys.push(jstDateKey(new Date(`${today}T12:00:00+09:00`).getTime() - i * 24 * 60 * 60 * 1000));
  }
  addDate.innerHTML = keys.map((key) => `<option value="${key}">${dayLabel(key)}</option>`).join('');
  // 日付で絞り込んでいて、その日が選択肢にあれば、その日を初めから選んでおく
  addDate.value = keys.includes(dateFilter.value) ? dateFilter.value : today;
}

addLogBtn.addEventListener('click', async () => {
  if (!isSelfView()) return;
  renderDateOptions();
  addLogBtn.disabled = true;
  try {
    const { schedules } = await Api.listSchedules();
    mySchedules = schedules || [];
  } catch (err) {
    handleApiError(err, 'お薬の予定を読み込めませんでした。');
    return;
  } finally {
    addLogBtn.disabled = false;
  }
  renderScheduleOptions();
  addModal.showModal();
});

addDate.addEventListener('change', renderScheduleOptions);

// 選んだ日の曜日に飲む予定のお薬だけを選択肢に出す
function renderScheduleOptions() {
  const date = addDate.value;
  const dow = date ? new Date(`${date}T12:00:00+09:00`).getUTCDay() : null;
  const list = mySchedules.filter((s) => dow !== null && (s.days_of_week || []).includes(dow));

  addSchedule.innerHTML = list
    .map((s) => {
      const med = s.medications || {};
      return `<option value="${s.id}">${formatTime(s.scheduled_time)}　${escapeHtml(med.name || '（薬名未設定）')}（${escapeHtml(mealTimingLabel(s.meal_timing))}）</option>`;
    })
    .join('');

  const empty = list.length === 0;
  addSchedule.disabled = empty;
  addScheduleNote.hidden = !empty;
  addScheduleNote.textContent = !date
    ? '日付を選んでください。'
    : mySchedules.length === 0
    ? '服薬時刻が登録されたお薬がありません。「お薬」タブで服薬時刻を登録してください。'
    : 'この日に飲む予定のお薬はありません。';
  addForm.querySelectorAll('[data-status]').forEach((b) => { b.disabled = empty; });
}

// Enter キーで送信されても、どちらの状態で記録するか分からないので何もしない
addForm.addEventListener('submit', (e) => e.preventDefault());
addForm.querySelectorAll('[data-status]').forEach((btn) =>
  btn.addEventListener('click', () => addLog(btn.dataset.status))
);

async function addLog(status) {
  const date = addDate.value;
  const scheduleId = addSchedule.value;
  if (!date || !scheduleId) return;
  if (date > jstDateKey(new Date())) {
    showToast('明日以降の記録はまだ登録できません。', 'error');
    return;
  }

  const buttons = addForm.querySelectorAll('[data-status]');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    // その予定の記録がすでにあれば、それが返ってくる（同じ予定の記録が二重にできない）
    const { log } = await Api.createLog({ schedule_id: scheduleId, date });
    const changed = log.status !== status;
    if (changed) await Api.updateLogStatus(log.id, status);
    const medName = mySchedules.find((s) => s.id === scheduleId)?.medications?.name || 'お薬';
    showToast(changedMessage(log.scheduled_at, status, medName, changed), 'success', 4000);
    addModal.close();
    afterRecordChanged();
  } catch (err) {
    handleApiError(err, '記録を追加できませんでした。');
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// 「×」ボタンで閉じる
document.querySelectorAll('dialog [data-close]').forEach((btn) =>
  btn.addEventListener('click', () => btn.closest('dialog').close())
);

// 記録を変えたら、一覧とアラームを最新にする（ホーム画面は開いたときに最新の内容を読み込む）
function afterRecordChanged() {
  loadLogs();
  MedAlarm.refresh();
}

// 記録した時刻を返す（未記録なら null）。
// 以前のスキップ記録は taken_at を保存していないため、更新時刻（updated_at）で代用する
function recordedAt(log) {
  if (log.status === 'pending') return null;
  return log.taken_at || (log.status === 'skipped' ? log.updated_at : null);
}

// 薬の名前は家族の端末にも表示するため、HTML として解釈されないようにする
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ---- 日付・時刻の表示（端末のタイムゾーンに関係なく、日本時間で表示する） ----

// 日付のまとまりを判定するためのキー（YYYY-MM-DD）
function jstDateKey(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function jstTime(iso) {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
}

function jstMonthDay(iso) {
  return new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' });
}

// 日付の見出し（例：「今日　10月28日（水）」）
function dayLabel(key) {
  const date = new Date(`${key}T12:00:00+09:00`);
  const text = date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short' })
    .replace(/\((.)\)$/, '（$1）');
  const today = jstDateKey(new Date());
  const yesterday = jstDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  if (key === today) return `今日　${text}`;
  if (key === yesterday) return `昨日　${text}`;
  return text;
}
