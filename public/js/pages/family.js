// ============================================================
//  見守りページ ロジック
//
//  1つのアカウントで次の両方を扱う（登録時の役割では画面を分けない）。
//    ・あなたが見守っているご家族 … 招待コードの入力、見守りをやめる
//    ・あなたを見守っているご家族 … 招待コードの表示、映像閲覧の許可、見守りを外す
//  登録時の役割（profile.role）は「どちらを上に表示するか」だけに使う。
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('family');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

const profile = Session.profile();
const prefersWatching = profile?.role === 'caregiver';

const els = {
  sections: document.getElementById('family-sections'),
  watchingSection: document.getElementById('watching-section'),
  watchersSection: document.getElementById('watchers-section'),
  watchingList: document.getElementById('watching-list'),
  watchersList: document.getElementById('watchers-list'),
  joinFold: document.getElementById('join-fold'),
  joinForm: document.getElementById('join-form'),
  codeInput: document.getElementById('invite-code-input'),
  relationInput: document.getElementById('relation-input'),
  inviteFold: document.getElementById('invite-fold'),
  codeBox: document.getElementById('invite-code-box'),
  createBtn: document.getElementById('create-group-btn'),
  copyBtn: document.getElementById('copy-code-btn'),
};

// 「見守られる側」として登録した人には、自分を見守っている人を先に見せる
if (!prefersWatching) {
  els.sections.insertBefore(els.watchersSection, els.watchingSection);
}

let firstLoad = true;

loadAll();

async function loadAll() {
  const [mine, watchers, watching] = await Promise.allSettled([
    Api.getMyCareGroup(),
    Api.listWatchers(),
    Api.listWatching(),
  ]);

  renderInviteCode(mine.status === 'fulfilled' ? mine.value.group : undefined);
  renderWatchers(watchers.status === 'fulfilled' ? watchers.value.watchers : null);
  renderWatching(watching.status === 'fulfilled' ? watching.value.watching : null);

  // 初回だけ、まだ何もしていない側の入力欄を開いておく
  if (firstLoad) {
    firstLoad = false;
    const noWatching = watching.status === 'fulfilled' && watching.value.watching.length === 0;
    const noWatchers = watchers.status === 'fulfilled' && watchers.value.watchers.length === 0;
    if (prefersWatching && noWatching) els.joinFold.open = true;
    if (!prefersWatching && noWatchers) els.inviteFold.open = true;
  }
}

// ------------------------------------------------------------
// あなたの招待コード（見守られる側）
// ------------------------------------------------------------
function renderInviteCode(group) {
  if (group === undefined) {
    els.codeBox.hidden = false;
    els.codeBox.textContent = '読み込みに失敗しました';
    return;
  }
  if (!group) {
    els.codeBox.hidden = true;
    els.copyBtn.hidden = true;
    els.createBtn.hidden = false;
    return;
  }
  els.createBtn.hidden = true;
  els.codeBox.hidden = false;
  els.codeBox.textContent = group.invite_code;
  els.copyBtn.hidden = !navigator.clipboard;
}

els.createBtn.addEventListener('click', async () => {
  els.createBtn.disabled = true;
  try {
    await Api.createCareGroup({ name: `${profile?.name || ''}さんの見守り` });
    showToast('招待コードを発行しました。ご家族に伝えてください。', 'success');
    await loadAll();
  } catch (err) {
    handleApiError(err, '招待コードの発行に失敗しました。');
  } finally {
    els.createBtn.disabled = false;
  }
});

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.codeBox.textContent.trim());
    showToast('招待コードをコピーしました。', 'success');
  } catch {
    showToast('コピーできませんでした。コードを書き写してお伝えください。', 'error');
  }
});

// ------------------------------------------------------------
// あなたを見守っているご家族（見守られる側）
// ------------------------------------------------------------
function renderWatchers(watchers) {
  if (!watchers) {
    els.watchersList.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
    return;
  }
  if (watchers.length === 0) {
    els.watchersList.innerHTML =
      '<p class="text-muted">まだ誰にも見守られていません。上の招待コードをご家族に伝えると、ここに表示されます。</p>';
    return;
  }

  els.watchersList.innerHTML = watchers
    .map((w) => {
      const name = w.name || '名前未設定';
      return `
        <div class="member-card member-card--stack">
          <div class="member-head">
            <div class="member-avatar" aria-hidden="true">${escapeHtml(name.charAt(0))}</div>
            <div class="member-info">
              <strong>${escapeHtml(name)}さん</strong>
              <p class="text-sm text-muted">服薬映像：${w.can_view_video ? '見せています' : '見せていません'}</p>
            </div>
          </div>
          <div class="member-actions">
            <button class="btn btn-outline btn--sm" data-action="toggle-video"
                    data-member-id="${w.member_id}" data-next="${w.can_view_video ? 'false' : 'true'}"
                    aria-pressed="${w.can_view_video}">
              ${w.can_view_video ? '映像を見せないようにする' : '映像を見せるようにする'}
            </button>
            <button class="btn btn-danger-outline btn--sm" data-action="remove-watcher"
                    data-member-id="${w.member_id}" data-name="${escapeHtml(name)}">
              見守りを外す
            </button>
          </div>
        </div>`;
    })
    .join('');
}

els.watchersList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, memberId } = btn.dataset;

  if (action === 'toggle-video') {
    const next = btn.dataset.next === 'true';
    btn.disabled = true;
    try {
      await Api.setMemberVideoPermission(memberId, next);
      showToast(next ? '服薬映像を見せるようにしました。' : '服薬映像を見せないようにしました。', 'success');
      await loadAll();
    } catch (err) {
      handleApiError(err, '設定の変更に失敗しました。');
      btn.disabled = false;
    }
  }

  if (action === 'remove-watcher') {
    const ok = window.confirm(
      `${btn.dataset.name}さんの見守りを外しますか？\n${btn.dataset.name}さんは、あなたのお薬の情報を見られなくなります。`
    );
    if (!ok) return;
    btn.disabled = true;
    try {
      await Api.removeMember(memberId);
      showToast('見守りを外しました。', 'success');
      await loadAll();
    } catch (err) {
      handleApiError(err, '見守りを外せませんでした。');
      btn.disabled = false;
    }
  }
});

// ------------------------------------------------------------
// あなたが見守っているご家族（見守る側）
// ------------------------------------------------------------
function renderWatching(watching) {
  if (!watching) {
    els.watchingList.innerHTML = '<p class="text-muted">読み込みに失敗しました。</p>';
    return;
  }
  if (watching.length === 0) {
    els.watchingList.innerHTML =
      '<p class="text-muted">まだ見守っているご家族はいません。ご家族から招待コードを教えてもらい、下から入力してください。</p>';
    return;
  }

  els.watchingList.innerHTML = watching
    .map((w) => {
      const name = w.name || '名前未設定';
      const relation = w.relation ? `（${escapeHtml(w.relation)}）` : '';
      return `
        <div class="member-card member-card--stack">
          <div class="member-head">
            <div class="member-avatar" aria-hidden="true">${escapeHtml(name.charAt(0))}</div>
            <div class="member-info">
              <strong>${escapeHtml(name)}さん${relation}</strong>
              <p class="text-sm text-muted">服薬映像：${w.can_view_video ? '見られます' : '見られません（ご本人の設定）'}</p>
            </div>
          </div>
          <div class="member-actions">
            <a class="btn btn-accent btn--sm" href="home.html?view=${encodeURIComponent(w.patient_id)}">
              お薬の様子を見る
            </a>
            <button class="btn btn-danger-outline btn--sm" data-action="leave"
                    data-member-id="${w.member_id}" data-name="${escapeHtml(name)}">
              見守りをやめる
            </button>
          </div>
        </div>`;
    })
    .join('');
}

els.watchingList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action="leave"]');
  if (!btn) return;

  const ok = window.confirm(
    `${btn.dataset.name}さんの見守りをやめますか？\nもう一度見守るには、招待コードの入力が必要です。`
  );
  if (!ok) return;

  btn.disabled = true;
  try {
    await Api.removeMember(btn.dataset.memberId);
    showToast('見守りをやめました。', 'success');
    await loadAll();
  } catch (err) {
    handleApiError(err, '見守りをやめられませんでした。');
    btn.disabled = false;
  }
});

els.joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = els.codeInput.value.trim();
  if (!code) return;

  const submitBtn = els.joinForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await Api.joinCareGroup({ invite_code: code, relation: els.relationInput.value.trim() });
    showToast('見守りを始めました。', 'success');
    els.codeInput.value = '';
    els.relationInput.value = '';
    els.joinFold.open = false;
    await loadAll();
  } catch (err) {
    handleApiError(err, '見守りを始められませんでした。コードをご確認ください。');
  } finally {
    submitBtn.disabled = false;
  }
});

// 本文にも属性値（data-name="..."）にも使うため、引用符まで置き換える
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
