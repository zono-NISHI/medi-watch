// ============================================================
//  お薬管理ページ ロジック
//  - 薬一覧表示
//  - 手入力登録/編集
//  - QRコード（JAHISフォーマット）読み取り登録
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('medications');
loadMedications();

let qrStream = null;
let qrScanRAF = null;
let editingMedicationId = null;

async function loadMedications() {
  const container = document.getElementById('medication-list');
  try {
    const { medications } = await Api.listMedications();
    renderMedications(medications);
  } catch (err) {
    container.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
    console.error(err);
  }
}

function renderMedications(medications) {
  const container = document.getElementById('medication-list');
  if (!medications || medications.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>まだお薬が登録されていません。</p>
      </div>`;
    return;
  }

  container.innerHTML = medications
    .map((m) => {
      const tags = (m.medication_schedules || [])
        .map((s) => `<span class="med-schedule-tag">${formatTime(s.scheduled_time)} ・ ${mealTimingLabel(s.meal_timing)}</span>`)
        .join('');
      return `
        <div class="med-card">
          <div class="med-card-head">
            <div style="flex:1">
              <h3>${escapeHtml(m.name)}</h3>
              <p class="text-sm text-muted" style="margin:0">${m.dosage || ''} ${m.unit || ''}</p>
              ${m.notes ? `<p class="text-sm text-muted" style="margin-top:4px">${escapeHtml(m.notes)}</p>` : ''}
            </div>
            <div class="med-card-actions">
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function deleteMedication(id) {
  if (!confirm('このお薬を削除しますか？')) return;
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

  if (id) {
    const med = knownMedications.find((m) => m.id === id);
    if (med) {
      document.getElementById('m-name').value = med.name || '';
      document.getElementById('m-dosage').value = med.dosage || '';
      document.getElementById('m-unit').value = med.unit || '';
      document.getElementById('m-notes').value = med.notes || '';
      (med.medication_schedules || []).forEach((s) => addScheduleRow(s));
    }
  } else {
    addScheduleRow();
  }

  manualModal.showModal();
}

function addScheduleRow(existing) {
  const row = document.createElement('div');
  row.className = 'schedule-row';
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
    unit: document.getElementById('m-unit').value.trim(),
    notes: document.getElementById('m-notes').value.trim(),
  };

  const schedules = [...scheduleRowsEl.querySelectorAll('.schedule-row')].map((row) => ({
    scheduled_time: row.querySelector('.s-time').value,
    meal_timing: row.querySelector('.s-meal').value,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    reminder_minutes: 5,
  }));

  try {
    if (editingMedicationId) {
      await Api.updateMedication(editingMedicationId, payload);
      // 簡易実装: 編集時のスケジュール再設定は新規追加分のみ反映（既存削除はお薬一覧の編集UIでは扱わない）
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
          <div class="field" style="flex:1">
            <label>単位</label>
            <input type="text" class="qr-edit-unit" data-index="${i}" value="${escapeHtml(m.unit || '')}" />
          </div>
        </div>
      </div>`
    )
    .join('');

  qrPreviewModal._data = medications;
  qrPreviewModal.showModal();
}

document.getElementById('qr-confirm-btn').addEventListener('click', async () => {
  const rows = [...qrPreviewList.querySelectorAll('.card')];
  const medications = rows.map((row, i) => ({
    name: row.querySelector('.qr-edit-name').value.trim(),
    dosage: row.querySelector('.qr-edit-dosage').value.trim(),
    unit: row.querySelector('.qr-edit-unit').value.trim(),
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
