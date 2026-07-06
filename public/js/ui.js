// ============================================================
//  UI共通ユーティリティ
// ============================================================

function ensureToastArea() {
  let area = document.querySelector('.toast-area');
  if (!area) {
    area = document.createElement('div');
    area.className = 'toast-area';
    area.setAttribute('aria-live', 'polite');
    document.body.appendChild(area);
  }
  return area;
}

function showToast(message, type = 'info', duration = 3200) {
  const area = ensureToastArea();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  area.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function handleApiError(err, fallback = '処理中にエラーが発生しました。') {
  console.error(err);
  showToast(err?.message || fallback, 'error');
}

// ナビゲーションガード: 未ログインなら login.html へ
function requireLoginOrRedirect() {
  if (!Session.isLoggedIn()) {
    location.href = 'login.html';
    return false;
  }
  return true;
}

// 下部ナビゲーションを描画する
function renderBottomNav(activeKey) {
  const profile = Session.profile();
  const isPatient = profile?.role === 'patient';

  const items = [
    { key: 'home', href: 'home.html', label: 'ホーム', icon: iconHome() },
    { key: 'medications', href: 'medications.html', label: 'お薬', icon: iconPill() },
    { key: 'logs', href: 'logs.html', label: '記録', icon: iconCheck() },
    { key: 'family', href: 'family.html', label: isPatient ? '家族' : '見守り', icon: iconUsers() },
    { key: 'mypage', href: 'mypage.html', label: 'マイページ', icon: iconUser() },
  ];

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'メインナビゲーション');
  nav.innerHTML = items
    .map(
      (item) => `
      <a href="${item.href}" class="${item.key === activeKey ? 'active' : ''}">
        ${item.icon}
        <span>${item.label}</span>
      </a>`
    )
    .join('');
  document.body.appendChild(nav);
}

function iconHome() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>';
}
function iconPill() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M9 9l6 6" /></svg>';
}
function iconCheck() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/></svg>';
}
function iconUsers() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="17" cy="8" r="2.5"/><path d="M17 14c2.8 0.3 5 2.4 5 6"/></svg>';
}
function iconUser() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.slice(0, 5);
}

function mealTimingLabel(value) {
  const map = { before: '食前', after: '食後', between: '食間', anytime: '指定なし' };
  return map[value] || value;
}

function dowLabel(arr) {
  const labels = ['日', '月', '火', '水', '木', '金', '土'];
  if (!arr || arr.length === 7) return '毎日';
  return arr
    .slice()
    .sort()
    .map((d) => labels[d])
    .join('・');
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
