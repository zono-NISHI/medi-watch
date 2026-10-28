// ============================================================
//  表示する人（自分／見守っているご家族）の切り替え
//  ホーム・お薬・記録の3つのタブで共通。選んだ人はタブを移っても引き継ぐ。
//  家族を表示しているときは、画面の色を変え、見守り中であることを帯で示す
//  （自分のお薬と取り違えないようにするため）。
// ============================================================

const ViewTarget = (() => {
  const VIEW_KEY = 'medi_watch_home_view';
  let targets = []; // [{ id, label, isSelf, canViewVideo }]
  let current = null;

  // 表示する人の一覧を作り、最初に表示する人を決める
  //   優先順位: URLの ?view=（通知・見守り画面から） → 前回選んだ人 → 登録時の役割
  async function init() {
    const profile = Session.profile();
    const self = { id: profile.id, label: '自分', isSelf: true, canViewVideo: true };
    let watching = [];
    try {
      ({ watching } = await Api.listWatching());
    } catch (err) {
      console.error('見守り中のご家族を取得できませんでした:', err);
    }

    targets = [
      self,
      ...(watching || []).map((w) => ({
        id: w.patient_id,
        label: `${w.name || '名前未設定'}さん`,
        isSelf: false,
        canViewVideo: !!w.can_view_video,
      })),
    ];

    const fromUrl = new URLSearchParams(location.search).get('view');
    let saved = null;
    try { saved = localStorage.getItem(VIEW_KEY); } catch { /* 保存できなくても動く */ }

    const roleDefault = profile?.role === 'caregiver' && targets.length > 1 ? targets[1].id : self.id;

    current =
      targets.find((t) => t.id === fromUrl) ||
      targets.find((t) => t.id === saved) ||
      targets.find((t) => t.id === roleDefault) ||
      self;

    // URLの指定は1回限り（再読み込みで固定されないよう消しておく）
    if (fromUrl) {
      const params = new URLSearchParams(location.search);
      params.delete('view');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
    }
    applyTheme();
    return current;
  }

  function get() {
    return current;
  }

  function hasFamily() {
    return targets.length > 1;
  }

  function select(id) {
    const next = targets.find((t) => t.id === id);
    if (!next) return null;
    current = next;
    try { localStorage.setItem(VIEW_KEY, next.id); } catch { /* noop */ }
    applyTheme();
    return current;
  }

  // 家族を表示しているときは画面の色を変える（CSS の body.is-watching）
  function applyTheme() {
    document.body.classList.toggle('is-watching', !!current && !current.isSelf);
  }

  // 切り替えボタン。onChange(target) は別の人を選んだときに呼ぶ
  function renderSwitcher(nav, onChange) {
    if (targets.length <= 1) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }
    nav.hidden = false;
    nav.innerHTML = targets
      .map(
        (t) => `
        <button type="button" class="view-chip ${t.isSelf ? '' : 'is-family'}" data-target-id="${t.id}"
                aria-pressed="${t.id === current.id}">${escapeAttr(t.label)}</button>`
      )
      .join('');
    nav.onclick = (e) => {
      const btn = e.target.closest('.view-chip');
      if (!btn || btn.dataset.targetId === current.id) return;
      select(btn.dataset.targetId);
      renderSwitcher(nav, onChange);
      onChange(current);
    };
  }

  // 見出しの文言。自分なら selfTitle、家族なら「〇〇さんの」＋ familyTitle
  function title(selfTitle, familyTitle = selfTitle) {
    return !current || current.isSelf ? selfTitle : `${current.label}の${familyTitle}`;
  }

  // 家族を表示しているときの帯。note には、その画面でできないことを書く
  function renderBanner(el, note) {
    if (!current || current.isSelf) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="watch-banner">
        <strong>見守り中：${escapeAttr(current.label)}の情報を見ています</strong>
        <p class="text-sm" style="margin:0">${note}</p>
      </div>`;
  }

  function escapeAttr(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  return { init, get, hasFamily, select, renderSwitcher, title, renderBanner };
})();
