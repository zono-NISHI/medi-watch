// ============================================================
//  見守りページ ロジック
//
//  1つのアカウントで次の両方を扱う（登録時の役割では画面を分けない）。
//    ・あなたが見守っているご家族 … 招待コードの入力、見守りをやめる
//    ・あなたを見守っているご家族 … 招待コードの表示、映像閲覧の許可、見守りを外す
//  2つが並ぶと見分けにくいため、上部の2つの大きなボタンで選んだ側だけを表示する。
//  マイページの「使う機能」で外した側（can_watch / can_be_watched）はボタンを出さない。
//  最初に表示する側は ?show= → 前回選んだ側 → 登録時の役割（profile.role）の順で決める。
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('family');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

const profile = Session.profile();
const prefersWatching = profile?.role === 'caregiver';
const canWatch = profile?.can_watch !== false;
const canBeWatched = profile?.can_be_watched !== false;

const els = {
  sections: document.getElementById('family-sections'),
  viewButtons: document.getElementById('family-view-buttons'),
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

if (!canWatch && !canBeWatched) {
  els.sections.innerHTML = `
    <div class="card">
      <p>いまは「自分のお薬の管理だけ」の設定です。</p>
      <p class="text-sm text-muted">ご家族と見守り合うには、マイページの「使う機能」で設定を変えてください。</p>
      <a href="mypage.html" class="btn btn-outline">マイページを開く</a>
    </div>`;
  throw new Error('見守りの機能を使わない設定');
}

// ------------------------------------------------------------
// 表示する側の切り替え（2つの大きなボタン）
// ------------------------------------------------------------
const FAMILY_VIEW_KEY = 'medi_watch_family_view';
const sectionsByView = { watching: els.watchingSection, watchers: els.watchersSection };
const viewButton = (view) => els.viewButtons.querySelector(`[data-view="${view}"]`);

// 使わない設定の側はボタンを外す（片方だけでも、同じボタンの形で見せる）
if (!canWatch) viewButton('watching').remove();
if (!canBeWatched) viewButton('watchers').remove();
// 「見守られる側」として登録した人には、自分を見守っている人のボタンを左に置く
if (!prefersWatching && canWatch && canBeWatched) {
  els.viewButtons.prepend(viewButton('watchers'));
}

function isAvailableView(view) {
  return (view === 'watching' && canWatch) || (view === 'watchers' && canBeWatched);
}

function showView(view) {
  els.viewButtons.querySelectorAll('[data-view]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
  });
  Object.entries(sectionsByView).forEach(([key, section]) => {
    section.hidden = key !== view;
  });
}

let savedView = null;
try { savedView = localStorage.getItem(FAMILY_VIEW_KEY); } catch { /* 保存できなくても動く */ }
const requestedView = new URLSearchParams(location.search).get('show');
showView(
  [requestedView, savedView].find(isAvailableView)
    || els.viewButtons.querySelector('[data-view]').dataset.view
);

els.viewButtons.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  showView(btn.dataset.view);
  try { localStorage.setItem(FAMILY_VIEW_KEY, btn.dataset.view); } catch { /* noop */ }
});

let firstLoad = true;

loadAll();

async function loadAll() {
  const empty = (key) => Promise.resolve({ [key]: [] });
  const [mine, watchers, watching] = await Promise.allSettled([
    canBeWatched ? Api.getMyCareGroup() : Promise.resolve({ group: null }),
    canBeWatched ? Api.listWatchers() : empty('watchers'),
    canWatch ? Api.listWatching() : empty('watching'),
  ]);

  if (canBeWatched) {
    renderInviteCode(mine.status === 'fulfilled' ? mine.value.group : undefined);
    renderWatchers(watchers.status === 'fulfilled' ? watchers.value.watchers : null);
  }
  if (canWatch) {
    renderWatching(watching.status === 'fulfilled' ? watching.value.watching : null);
  }

  // 初回だけ、まだ誰もいない側の入力欄を開いておく
  // （表示されるのは選んだ側だけなので、両方開いても散らからない）
  if (firstLoad) {
    firstLoad = false;
    const noWatching = watching.status === 'fulfilled' && watching.value.watching.length === 0;
    const noWatchers = watchers.status === 'fulfilled' && watchers.value.watchers.length === 0;
    if (canWatch && noWatching) els.joinFold.open = true;
    if (canBeWatched && noWatchers) els.inviteFold.open = true;
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
