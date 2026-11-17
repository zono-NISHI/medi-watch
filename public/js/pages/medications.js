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
let qrHintTimer = null;
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
        .map((s) => {
          // 「指定なし」のときは「08:00」だけにする（「08:00 ・ 指定なし」とは書かない）
          const note = mealTimingNote(s.meal_timing);
          return `<span class="med-schedule-tag">${formatTime(s.scheduled_time)}${note ? ` ・ ${note}` : ''}</span>`;
        })
        .join('');
      return `
        <div class="med-card">
          <div class="med-card-head">
            <div style="flex:1">
              <h3>${escapeHtml(m.name)}</h3>
              ${amountLineHtml(m, editable)}
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

// 用量・単位の行。用量・単位を必須にする前に登録したお薬で、どちらかが空のものには入力を促す
function amountLineHtml(m, editable) {
  const dosage = (m.dosage || '').trim();
  const unit = (m.unit || '').trim();
  if (dosage && unit) {
    return `<p class="text-sm text-muted" style="margin:0">${escapeHtml(dosage)} ${escapeHtml(unit)}</p>`;
  }
  const missing = !dosage && !unit ? '用量と単位' : !dosage ? '用量' : '単位';
  return `<p class="text-sm med-amount-missing">${missing}が登録されていません。${editable ? '鉛筆のボタンから登録してください。' : ''}</p>`;
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

// 「選んでください」は、まだ選んでいないときに欄に出す案内だけにする。
// 選ぶ一覧には出さない（hidden）・選べない（disabled）ので、単位の1つのように見えない
function unitOptionsHtml() {
  return [
    '<option value="" disabled hidden>選んでください</option>',
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

// 用量は数（0.5 などの小数も可）だけにする。「1錠」のように単位まで書くと、単位の欄と二重になり、
// 読み上げが「1錠錠」になるため。決まった量の無い塗り薬などは「1 回」とし、量はメモに書いてもらう
// （サーバーの src/routes/medications.js でも同じ決まりで確かめる）
function normalizeDosage(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function isValidDosage(value) {
  return /^\d+(\.\d+)?$/.test(value) && Number(value) > 0;
}

// 用量・単位は必須。空の欄があれば、お知らせを出してその欄へ移り、false を返す
// （読み上げ・アラーム・家族が見る記録で「何をどれだけ飲むか」が伝わるようにするため。サーバーでも確かめる）
// medName: 複数のお薬を一度に登録するとき（QRコード）に、どのお薬の欄かを示す
function checkAmountFilled(dosageInput, picker, medName) {
  const who = medName ? `「${medName}」の` : '';
  const select = picker.querySelector('.unit-select');
  const other = picker.querySelector('.unit-other');
  // 全角で入力した数字（「１」「０．５」）は半角にそろえて、欄にも書き戻す
  dosageInput.value = normalizeDosage(dosageInput.value);
  let message = null;
  let target = null;
  if (!dosageInput.value) {
    message = `${who}用量を数字で入力してください。（例：1、0.5）`;
    target = dosageInput;
  } else if (!isValidDosage(dosageInput.value)) {
    message = `${who}用量は数字だけで入力してください。（例：1、0.5）「錠」などは「単位」の欄で選びます。`;
    target = dosageInput;
  } else if (!select.value) {
    message = `${who}単位を選んでください。一覧に無いときは「その他（入力する）」を選んでください。`;
    target = select;
  } else if (select.value === UNIT_OTHER && !other.value.trim()) {
    message = `${who}単位を入力してください。`;
    target = other;
  }
  if (!message) return true;
  showToast(message, 'error');
  target.focus();
  return false;
}

async function deleteMedication(id) {
  if (!confirm('このお薬を削除しますか？\nこれまでの服薬の記録は「記録」タブに残ります。')) return;
  try {
    await Api.deleteMedication(id);
    showToast('削除しました。', 'success');
    loadMedications();
    MedAlarm.refresh(); // 変えた服薬時刻を、すぐアラームに反映する
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

// 「+ 時間を追加」で増やす行の時刻。すでにある時刻と重ならないよう、朝・昼・夕・寝る前の順に空いている時刻を使う
const DEFAULT_TIMES = ['08:00', '12:00', '18:00', '21:00'];

function scheduleRowTimes() {
  return [...scheduleRowsEl.querySelectorAll('.s-time')].map((input) => input.value);
}

function nextFreeTime() {
  const used = new Set(scheduleRowTimes());
  return DEFAULT_TIMES.find((t) => !used.has(t)) || DEFAULT_TIMES[0];
}

// 同じ時刻の行に印を付け、重複している時刻（なければ null）を返す
function markDuplicateRows() {
  const rows = [...scheduleRowsEl.querySelectorAll('.schedule-row')];
  const counts = {};
  rows.forEach((row) => {
    const t = row.querySelector('.s-time').value;
    counts[t] = (counts[t] || 0) + 1;
  });
  let duplicate = null;
  rows.forEach((row) => {
    const t = row.querySelector('.s-time').value;
    const isDup = counts[t] > 1;
    row.classList.toggle('is-duplicate', isDup);
    if (isDup && !duplicate) duplicate = t;
  });
  return duplicate;
}

function addScheduleRow(existing) {
  const row = document.createElement('div');
  row.className = 'schedule-row';
  if (existing?.id) row.dataset.scheduleId = existing.id; // 編集時、既存のスケジュールを更新するため
  row.innerHTML = `
    <input type="time" class="s-time" value="${existing?.scheduled_time?.slice(0, 5) || nextFreeTime()}" required />
    <select class="s-meal">
      <option value="before" ${existing?.meal_timing === 'before' ? 'selected' : ''}>食前</option>
      <option value="after" ${!existing || existing?.meal_timing === 'after' ? 'selected' : ''}>食後</option>
      <option value="between" ${existing?.meal_timing === 'between' ? 'selected' : ''}>食間</option>
      <option value="anytime" ${existing?.meal_timing === 'anytime' ? 'selected' : ''}>指定なし</option>
    </select>
    <button type="button" class="remove-row" aria-label="この時間を削除">×</button>
  `;
  row.querySelector('.remove-row').addEventListener('click', () => {
    row.remove();
    // 重なっていた相手の行を消したら、残った行の印も外す
    if (scheduleRowsEl.querySelector('.is-duplicate')) markDuplicateRows();
  });
  // 時刻を直したら、印をその場で付け直す（印が出ているときだけ。入力の途中で赤くしないため）
  row.querySelector('.s-time').addEventListener('change', () => {
    if (scheduleRowsEl.querySelector('.is-duplicate')) markDuplicateRows();
  });
  scheduleRowsEl.appendChild(row);
}

manualForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('m-name').value.trim(),
    dosage: normalizeDosage(document.getElementById('m-dosage').value),
    unit: getUnitValue(document.getElementById('m-unit-picker')),
    notes: document.getElementById('m-notes').value.trim(),
  };

  if (!checkAmountFilled(document.getElementById('m-dosage'), document.getElementById('m-unit-picker'))) return;

  // 同じお薬に同じ時刻が2つあると、通知やアラームが2回ずつになるため、保存させない
  const duplicate = markDuplicateRows();
  if (duplicate) {
    showToast(`${duplicate} の服薬時刻が2つあります。時刻を変えるか、「×」で1つにまとめてください。`, 'error');
    scheduleRowsEl.querySelector('.is-duplicate .s-time')?.focus();
    return;
  }

  // 服薬時刻は必須にしない（頓服薬など、決まった時刻に飲まないお薬もあるため）。
  // ただし「×」で全部消したまま気付かずに保存すると、ホームにも出ずアラームも鳴らないので、保存の前に確かめる
  if (!scheduleRowsEl.querySelector('.schedule-row')) {
    const ok = confirm(
      '服薬時刻が1つも入っていません。\n' +
        'このまま保存すると、このお薬はホーム画面に出ず、お薬の時間のアラームも鳴りません。\n' +
        '（痛いときだけ飲むお薬など、決まった時刻に飲まないお薬は、このままで大丈夫です）\n\n' +
        'このまま保存しますか？'
    );
    if (!ok) {
      document.getElementById('add-schedule-row').focus();
      return;
    }
  }

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
    MedAlarm.refresh(); // 変えた服薬時刻を、すぐアラームに反映する
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
    // お薬手帳のQRコードは情報量が多く、細かい模様になる。解像度を指定しないとPCのカメラは
    // 640×480 程度になり、模様がつぶれて読み取れないことがあるため、できるだけ高い解像度を求める。
    // （ideal なので、対応していないカメラでも起動はでき、そのカメラで出せる解像度になる）
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    qrVideo.srcObject = qrStream;
    qrStatus.textContent = 'QRコードを枠内に映してください。';
    startQrScanning();
  } catch (err) {
    console.error(err);
    qrStatus.textContent = 'カメラを起動できませんでした。下の欄に内容を貼り付けて解析できます。';
  }
});

// jsQR の結果からQRコードの文字列を取り出す。
// JAHIS形式（お薬手帳）のQRコードは Shift_JIS で書かれているが、jsQR は UTF-8 として
// 読もうとして失敗すると code.data を空にしてしまう（読み取れているのに反応しない原因）。
// そのため、元のバイト列（code.binaryData）から自分で文字に戻す。
// 順番は UTF-8 → Shift_JIS。Shift_JIS のデータを UTF-8 として読むとほぼ必ずエラーになるが、
// 逆（UTF-8 のデータを Shift_JIS として読む）はエラーにならず文字化けすることがあるため。
function decodeQrText(code) {
  const bytes = code.binaryData && code.binaryData.length ? new Uint8Array(code.binaryData) : null;
  if (bytes) {
    for (const encoding of ['utf-8', 'shift_jis']) {
      try {
        return new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch (_) {
        // この文字コードでは読めない（またはブラウザが未対応）ので次を試す
      }
    }
  }
  return code.data || '';
}

function startQrScanning() {
  const canvas = document.createElement('canvas');
  // 毎フレーム getImageData で画素を読み出すため、読み出し向けの設定にする（ブラウザの警告と処理の重さを防ぐ）
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // しばらく読み取れないときは、映し方のコツを表示する。
  // ノートPCの内蔵カメラはピントが固定（顔の距離向け）のものが多く、近づけるとぼやけ、
  // 離すと小さすぎて、細かいお薬手帳のQRコードは読めないことがある（スマホなら読める）。
  qrHintTimer = setTimeout(() => {
    qrStatus.textContent =
      '読み取れないときは、QRコードを明るい場所で、画面いっぱいに大きく、まっすぐ映してください。' +
      'パソコンのカメラでは読み取れないことがあります。そのときはスマートフォンでお試しください。';
  }, 10000);

  function tick() {
    if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA && window.jsQR) {
      canvas.width = qrVideo.videoWidth;
      canvas.height = qrVideo.videoHeight;
      ctx.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, imageData.width, imageData.height);
      const text = code ? decodeQrText(code) : '';
      if (text) {
        stopQrScanning();
        qrModal.close();
        handleQrData(text);
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
  clearTimeout(qrHintTimer);
  qrHintTimer = null;
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
          <label>薬の名前<span class="required-mark">（必須）</span></label>
          <input type="text" class="qr-edit-name" data-index="${i}" value="${escapeHtml(m.name)}" />
        </div>
        <div class="amount-row">
          <div class="field">
            <label>用量<span class="required-mark">（必須）</span></label>
            <input type="text" class="qr-edit-dosage" inputmode="decimal" autocomplete="off" placeholder="例：1" data-index="${i}" value="${escapeHtml(m.dosage || '')}" />
          </div>
          <div class="field unit-picker" data-unit="${escapeHtml(m.unit || '')}">
            <label>単位<span class="required-mark">（必須）</span></label>
            <select class="unit-select" aria-label="単位"></select>
            <input type="text" class="unit-other" placeholder="単位を入力" aria-label="単位（その他）" hidden />
          </div>
        </div>
        <div class="field">
          <label>メモ（飲み方など）</label>
          <textarea class="qr-edit-notes" data-index="${i}">${escapeHtml(m.notes || '')}</textarea>
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
  // QRコードに用量・単位が載っていないお薬もあるので、登録する前に1つずつ確かめる
  for (const row of rows) {
    const nameInput = row.querySelector('.qr-edit-name');
    if (!nameInput.value.trim()) {
      showToast('薬の名前を入力してください。', 'error');
      nameInput.focus();
      return;
    }
    if (!checkAmountFilled(row.querySelector('.qr-edit-dosage'), row.querySelector('.unit-picker'), nameInput.value.trim())) return;
  }
  const medications = rows.map((row, i) => ({
    name: row.querySelector('.qr-edit-name').value.trim(),
    dosage: normalizeDosage(row.querySelector('.qr-edit-dosage').value),
    unit: getUnitValue(row.querySelector('.unit-picker')),
    notes: row.querySelector('.qr-edit-notes').value.trim(),
  }));

  try {
    await Api.confirmQr({ medications, qr_raw_data: lastQrRaw });
    showToast('お薬を登録しました。', 'success');
    qrPreviewModal.close();
    loadMedications();
    MedAlarm.refresh(); // 変えた服薬時刻を、すぐアラームに反映する
  } catch (err) {
    handleApiError(err, '登録に失敗しました。');
  }
});
