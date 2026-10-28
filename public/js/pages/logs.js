// ============================================================
//  服薬記録履歴ページ ロジック
//  - 「自分」と「見守っているご家族」を上部のボタンで切り替えて表示（js/viewTarget.js）
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('logs');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

const dateFilter = document.getElementById('date-filter');
const statusFilter = document.getElementById('status-filter');

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

function renderLogs(logs) {
  const container = document.getElementById('log-list');
  if (!logs || logs.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>該当する記録がありません。</p></div>';
    return;
  }

  // 新しい順（降順）に並べる。記録済みは記録した時刻、未記録（pending）は予定時刻を基準にする
  const sorted = [...logs].sort((a, b) => new Date(sortKey(b)) - new Date(sortKey(a)));

  // 並べ替えの基準時刻の日付（日本時間）ごとにまとめる。降順に並べ済みなので、日付が変わったら次のまとまりにする
  const days = [];
  for (const log of sorted) {
    const key = jstDateKey(sortKey(log));
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
}

// 1件分のカード。大きく表示する時刻は並べ替えの基準と同じ（記録済みは記録した時刻、未記録は予定時刻）
function renderLogCard(log, now) {
  const recorded = recordedAt(log);
  const med = log.medication_schedules?.medications;
  const isMissed = log.status === 'pending' && new Date(log.scheduled_at).getTime() < now;
  const statusBadge =
    log.status === 'taken'
      ? '<span class="badge badge-taken">服薬済み</span>'
      : log.status === 'skipped'
      ? '<span class="badge badge-skipped">スキップ</span>'
      : isMissed
      ? '<span class="badge badge-missed">飲み忘れ</span>'
      : '<span class="badge badge-pending">未記録</span>';

  // 記録済みは予定時刻を小さく添える。記録した日と予定の日が違うときは日付も付ける
  let scheduleNote = '';
  if (recorded) {
    const sameDay = jstDateKey(recorded) === jstDateKey(log.scheduled_at);
    const when = sameDay ? jstTime(log.scheduled_at) : `${jstMonthDay(log.scheduled_at)} ${jstTime(log.scheduled_at)}`;
    scheduleNote = `<span class="text-sm text-muted">予定：${when}</span>`;
  }

  const videoBtn =
    log.status === 'taken' && log.video_url && ViewTarget.get()?.canViewVideo !== false
      ? `<button class="btn btn-outline btn--sm" data-log-id="${log.id}" data-action="video" style="width:auto">映像を見る</button>`
      : '';

  return `
    <div class="log-card">
      <div class="log-time">
        <span class="log-time-value">${jstTime(sortKey(log))}</span>
        <span class="log-time-label">${recorded ? '記録' : '予定'}</span>
      </div>
      <div class="log-main">
        <h3>${escapeHtml(med?.name || '（薬名不明）')}</h3>
        <div class="row">${statusBadge} ${scheduleNote}</div>
      </div>
      ${videoBtn}
    </div>`;
}

// 記録した時刻を返す（未記録なら null）。
// 以前のスキップ記録は taken_at を保存していないため、更新時刻（updated_at）で代用する
function recordedAt(log) {
  if (log.status === 'pending') return null;
  return log.taken_at || (log.status === 'skipped' ? log.updated_at : null);
}

// 並べ替えの基準となる時刻（記録した時刻。未記録なら予定時刻）
function sortKey(log) {
  return recordedAt(log) || log.scheduled_at;
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
