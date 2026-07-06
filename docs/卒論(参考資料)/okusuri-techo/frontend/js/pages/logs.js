// ============================================================
//  服薬記録履歴ページ ロジック
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('logs');

const dateFilter = document.getElementById('date-filter');
const statusFilter = document.getElementById('status-filter');

dateFilter.addEventListener('change', loadLogs);
statusFilter.addEventListener('change', loadLogs);

loadLogs();

async function loadLogs() {
  const container = document.getElementById('log-list');
  container.innerHTML = '<p class="text-muted">読み込み中…</p>';

  const params = {};
  if (dateFilter.value) params.date = dateFilter.value;
  if (statusFilter.value) params.status = statusFilter.value;

  try {
    const { logs } = await Api.listLogs(params);
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

  container.innerHTML = logs
    .map((log) => {
      const med = log.medication_schedules?.medications;
      const statusBadge =
        log.status === 'taken'
          ? '<span class="badge badge-taken">服薬済み</span>'
          : log.status === 'skipped'
          ? '<span class="badge badge-skipped">スキップ</span>'
          : '<span class="badge badge-pending">未記録</span>';

      const videoBtn =
        log.status === 'taken' && log.video_url
          ? `<button class="btn btn-outline btn--sm" data-log-id="${log.id}" data-action="video" style="width:auto">映像を見る</button>`
          : '';

      return `
        <div class="log-card">
          <div class="log-date">${formatDateTime(log.scheduled_at)}</div>
          <div class="log-main">
            <h3>${med?.name || '（薬名不明）'}</h3>
            <div class="row">${statusBadge} ${log.taken_at ? `<span class="text-sm text-muted">${formatDateTime(log.taken_at)} に記録</span>` : ''}</div>
          </div>
          ${videoBtn}
        </div>`;
    })
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
