// ============================================================
//  お薬管理ページ ロジック
//  - 薬一覧表示
//  - 手入力登録/編集
//  - QRコード（JAHISフォーマット）読み取り登録
//  - 「自分」と「見守っているご家族」を上部のボタンで切り替えて表示（js/viewTarget.js）
//    ご家族のお薬は見るだけ（登録・編集・削除はご本人だけ）
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('medications');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

let qrStream = null;
let qrScanRAF = null;
let editingMedicationId = null;

ViewTarget.init()
  .then(renderViewHeader)
  .catch((err) => console.error(err))
  .finally(loadMedications);

// 切り替えボタン・見出し・見守り中の帯・登録ボタンを、いま表示している人に合わせる
function renderViewHeader() {
  ViewTarget.renderSwitcher(document.getElementById('view-switcher'), () => {
    renderViewHeader();
    document.getElementById('medication-list').innerHTML = '<p class="text-muted">読み込み中…</p>';
    loadMedications();
  });
  document.getElementById('page-title').textContent = ViewTarget.title('お薬の管理', 'お薬');
  ViewTarget.renderBanner(
    document.getElementById('role-banner'),
    'お薬の登録・変更はご本人だけが行えます。'
  );
  document.getElementById('register-actions').hidden = !isSelfView();
}

function isSelfView() {
  return ViewTarget.get()?.isSelf !== false;
}

async function loadMedications() {
  const container = document.getElementById('medication-list');
  const target = ViewTarget.get();
  try {
    const { medications } = await Api.listMedications(target && !target.isSelf ? target.id : undefined);
    // 読み込み中に別の人へ切り替えられていたら、古い結果は捨てる
    if (ViewTarget.get() !== target) return;
    renderMedications(medications);
  } catch (err) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
    console.error(err);
  }
}

function renderMedications(medications) {
  const container = document.getElementById('medication-list');
  const editable = isSelfView();
  if (!medications || medications.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${editable ? 'まだお薬が登録されていません。' : `${escapeHtml(ViewTarget.get().label)}のお薬はまだ登録されていません。`}</p>
      </div>`;
    return;
  }

  container.innerHTML = medications
    .map((m) => {
      const tags = activeSchedules(m)
        .map((s) => `<span class="med-schedule-tag">${formatTime(s.scheduled_time)} ・ ${mealTimingLabel(s.meal_timing)}</span>`)
        .join('');
      return `
        <div class="med-card">
          <div class="med-card-head">
            <div style="flex:1">
              <h3>${escapeHtml(m.name)}</h3>
              <p class="text-sm text-muted" style="margin:0">${escapeHtml(m.dosage)} ${escapeHtml(m.unit)}</p>
              ${m.notes ? `<p class="text-sm text-muted" style="margin-top:4px">${escapeHtml(m.notes)}</p>` : ''}
            </div>
            <div class="med-card-actions" ${editable ? '' : 'hidden'}>
              <button data-action="edit" data-id="${m.id}" aria-label="編集">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button data-action="delete" data-id="${m.id}" aria-label="削除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
              </button>
            </div>
          </div>
          ${tags ? `<div class="med-schedule-tags">${tags}</div>` : '<p class="text-sm text-muted" style="margin-top:8px">服薬スケジュール未設定</p>'}
        </div>`;
    })
    .join('');

  container.querySelectorAll('[data-action="edit"]').forEach((btn) =>
    btn.addEventListener('click', () => openManualModal(btn.dataset.id, medications))
  );
  container.querySelectorAll('[data-action="delete"]').forEach((btn) =>
    btn.addEventListener('click', () => deleteMedication(btn.dataset.id))
  );
}

// 外した（停止した）スケジュールは表示しない。時刻順に並べる
function activeSchedules(medication) {
  return (medication.medication_schedules || [])
    .filter((s) => s.is_active !== false)
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---- 単位のプルダウン ----
// 一覧にない単位は「その他」を選ぶと入力欄が出る（QRコードで読み取った単位もそのまま残せる）
const UNIT_OPTIONS = ['錠', 'カプセル', '包', 'mL', 'g', '滴', '枚', '本', '個', '吸入', '回'];
const UNIT_OTHER = '__other__';

function unitOptionsHtml() {
  return [
    '<option value="">選んでください</option>',
    ...UNIT_OPTIONS.map((u) => `<option value="${u}">${u}</option>`),
    `<option value="${UNIT_OTHER}">その他（入力する）</option>`,
  ].join('');
}

// picker: .unit-select と .unit-other を含む要素
function setupUnitPicker(picker, value) {
  const select = picker.querySelector('.unit-select');
  const other = picker.querySelector('.unit-other');
  const v = (value || '').trim();
  const known = UNIT_OPTIONS.find((u) => u.toLowerCase() === v.toLowerCase()); // ml → mL など

  select.innerHTML = unitOptionsHtml();
  select.value = !v ? '' : known || UNIT_OTHER;
  other.value = !v || known ? '' : v;
  other.hidden = select.value !== UNIT_OTHER;

  select.onchange = () => {
    other.hidden = select.value !== UNIT_OTHER;
    if (!other.hidden) other.focus();
  };
}

function getUnitValue(picker) {
  const select = picker.querySelector('.unit-select');
  return select.value === UNIT_OTHER ? picker.querySelector('.unit-other').value.trim() : select.value;
}

async function deleteMedication(id) {
  if (!confirm('このお薬を削除しますか？\nこれまでの服薬の記録は「記録」タブに残ります。')) return;
  try {
    await Api.deleteMedication(id);
    showToast('削除しました。', 'success');
    loadMedications();
  } catch (err) {
    handleApiError(err, '削除に失敗しました。');
  }
}

// ---- 手入力モーダル ----
const manualModal = document.getElementById('manual-modal');
const manualForm = document.getElementById('manual-form');
const scheduleRowsEl = document.getElementById('schedule-rows');

document.getElementById('open-manual-btn').addEventListener('click', () => openManualModal(null, []));
document.getElementById('add-schedule-row').addEventListener('click', () => addScheduleRow());

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dialog = document.getElementById(btn.dataset.close);
    stopQrScanning();
    dialog.close();
  });
});

function openManualModal(id, knownMedications) {
  editingMedicationId = id;
  document.getElementById('manual-modal-title').textContent = id ? 'お薬を編集' : 'お薬を登録';
  manualForm.reset();
  scheduleRowsEl.innerHTML = '';
  const unitPicker = document.getElementById('m-unit-picker');

  if (id) {
    const med = knownMedications.find((m) => m.id === id);
    if (med) {
      document.getElementById('m-name').value = med.name || '';
      document.getElementById('m-dosage').value = med.dosage || '';
      setupUnitPicker(unitPicker, med.unit);
      document.getElementById('m-notes').value = med.notes || '';
      activeSchedules(med).forEach((s) => addScheduleRow(s));
    }
  } else {
    setupUnitPicker(unitPicker, '');
    addScheduleRow();
  }

  manualModal.showModal();
}

function addScheduleRow(existing) {
  const row = document.createElement('div');
  row.className = 'schedule-row';
  if (existing?.id) row.dataset.scheduleId = existing.id; // 編集時、既存のスケジュールを更新するため
  row.innerHTML = `
    <input type="time" class="s-time" value="${existing?.scheduled_time?.slice(0, 5) || '08:00'}" required />
    <select class="s-meal">
      <option value="before" ${existing?.meal_timing === 'before' ? 'selected' : ''}>食前</option>
      <option value="after" ${!existing || existing?.meal_timing === 'after' ? 'selected' : ''}>食後</option>
      <option value="between" ${existing?.meal_timing === 'between' ? 'selected' : ''}>食間</option>
      <option value="anytime" ${existing?.meal_timing === 'anytime' ? 'selected' : ''}>指定なし</option>
    </select>
    <button type="button" class="remove-row" aria-label="この時間を削除">×</button>
  `;
  row.querySelector('.remove-row').addEventListener('click', () => row.remove());
  scheduleRowsEl.appendChild(row);
}

manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('m-name').value.trim(),
    dosage: document.getElementById('m-dosage').value.trim(),
    unit: getUnitValue(document.getElementById('m-unit-picker')),
    notes: document.getElementById('m-notes').value.trim(),
  };

  const schedules = [...scheduleRowsEl.querySelectorAll('.schedule-row')].map((row) => ({
    ...(row.dataset.scheduleId ? { id: row.dataset.scheduleId } : {}),
    scheduled_time: row.querySelector('.s-time').value,
    meal_timing: row.querySelector('.s-meal').value,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    reminder_minutes: 5,
  }));

  try {
    if (editingMedicationId) {
      // スケジュールも一緒に送り、時刻の変更・追加・「×」で外した分をまとめて反映する
      await Api.updateMedication(editingMedicationId, { ...payload, schedules });
      showToast('更新しました。', 'success');
    } else {
      await Api.createMedication({ ...payload, schedules });
      showToast('登録しました。', 'success');
    }
    manualModal.close();
    loadMedications();
  } catch (err) {
    handleApiError(err, '保存に失敗しました。');
  }
});

// ---- QRスキャンモーダル ----
const qrModal = document.getElementById('qr-modal');
const qrVideo = document.getElementById('qr-video');
const qrStatus = document.getElementById('qr-status');

document.getElementById('open-qr-btn').addEventListener('click', async () => {
  qrModal.showModal();
  qrStatus.textContent = 'カメラを起動しています…';
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    qrVideo.srcObject = qrStream;
    qrStatus.textContent = 'QRコードを枠内に映してください。';
    startQrScanning();
  } catch (err) {
    console.error(err);
    qrStatus.textContent = 'カメラを起動できませんでした。下の欄に内容を貼り付けて解析できます。';
  }
});

function startQrScanning() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  function tick() {
    if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = qrVideo.videoWidth;
      canvas.height = qrVideo.videoHeight;
      ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        stopQrScanning();
        qrModal.close();
        handleQrData(code.data);
        return;
      }
    }
    qrScanRAF = requestAnimationFrame(tick);
  }
  qrScanRAF = requestAnimationFrame(tick);
}

function stopQrScanning() {
  if (qrScanRAF) cancelAnimationFrame(qrScanRAF);
  qrScanRAF = null;
  if (qrStream) {
    qrStream.getTracks().forEach((t) => t.stop());
    qrStream = null;
  }
}

document.getElementById('qr-manual-submit').addEventListener('click', () => {
  const text = document.getElementById('qr-manual-text').value.trim();
  if (!text) return;
  stopQrScanning();
  qrModal.close();
  handleQrData(text);
});

let lastQrRaw = '';

async function handleQrData(rawData) {
  lastQrRaw = rawData;
  try {
    const { preview } = await Api.scanQr(rawData);
    showQrPreview(preview);
  } catch (err) {
    handleApiError(err, 'QRコードの解析に失敗しました。手入力をご利用ください。');
  }
}

const qrPreviewModal = document.getElementById('qr-preview-modal');
const qrPreviewList = document.getElementById('qr-preview-list');

function showQrPreview(medications) {
  qrPreviewList.innerHTML = medications
    .map(
      (m, i) => `
      <div class="card card--warm">
        <div class="field">
          <label>薬の名前</label>
          <input type="text" class="qr-edit-name" data-index="${i}" value="${escapeHtml(m.name)}" />
        </div>
        <div class="row">
          <div class="field" style="flex:1">
            <label>用量</label>
            <input type="text" class="qr-edit-dosage" data-index="${i}" value="${escapeHtml(m.dosage || '')}" />
          </div>
          <div class="field unit-picker" style="flex:1" data-unit="${escapeHtml(m.unit || '')}">
            <label>単位</label>
            <select class="unit-select" aria-label="単位"></select>
            <input type="text" class="unit-other" placeholder="単位を入力" aria-label="単位（その他）" hidden />
          </div>
        </div>
      </div>`
    )
    .join('');
  qrPreviewList.querySelectorAll('.unit-picker').forEach((picker) => setupUnitPicker(picker, picker.dataset.unit));

  qrPreviewModal._data = medications;
  qrPreviewModal.showModal();
}

document.getElementById('qr-confirm-btn').addEventListener('click', async () => {
  const rows = [...qrPreviewList.querySelectorAll('.card')];
  const medications = rows.map((row, i) => ({
    name: row.querySelector('.qr-edit-name').value.trim(),
    dosage: row.querySelector('.qr-edit-dosage').value.trim(),
    unit: getUnitValue(row.querySelector('.unit-picker')),
  }));

  try {
    await Api.confirmQr({ medications, qr_raw_data: lastQrRaw });
    showToast('お薬を登録しました。', 'success');
    qrPreviewModal.close();
    loadMedications();
  } catch (err) {
    handleApiError(err, '登録に失敗しました。');
  }
});
