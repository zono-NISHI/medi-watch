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

  // 記録した時刻の昇順に並べる。未記録（pending）は最後に、予定時刻の昇順で並べる
  const sorted = [...logs].sort((a, b) => {
    const ra = recordedAt(a);
    const rb = recordedAt(b);
    if (ra && rb) return new Date(ra) - new Date(rb);
    if (ra) return -1;
    if (rb) return 1;
    return new Date(a.scheduled_at) - new Date(b.scheduled_at);
  });

  container.innerHTML = sorted
    .map((log) => {
      const recorded = recordedAt(log);
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
            <div class="row">${statusBadge} ${recorded ? `<span class="text-sm text-muted">${formatDateTime(recorded)} に記録</span>` : ''}</div>
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

// 記録した時刻を返す（未記録なら null）。
// 以前のスキップ記録は taken_at を保存していないため、更新時刻（updated_at）で代用する
function recordedAt(log) {
  if (log.status === 'pending') return null;
  return log.taken_at || (log.status === 'skipped' ? log.updated_at : null);
}
