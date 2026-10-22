// ============================================================
//  マイページ ロジック
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('mypage');

const profileForm = document.getElementById('profile-form');
const nameInput = document.getElementById('p-name');
const phoneInput = document.getElementById('p-phone');
const roleEl = document.getElementById('p-role');

// プロフィール読み込み
(async () => {
  try {
    const { profile } = await Api.me();
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    nameInput.value = profile.name || '';
    phoneInput.value = profile.phone || '';
    roleEl.textContent = profile.role === 'patient' ? '患者本人' : '家族・介護者';
  } catch (err) {
    handleApiError(err, 'プロフィールの取得に失敗しました。');
  }
})();

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: nameInput.value.trim(),
    phone: phoneInput.value.trim() || null,
  };
  try {
    const { profile } = await Api.updateMe(payload);
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    showToast('プロフィールを更新しました。', 'success');
  } catch (err) {
    handleApiError(err, '更新に失敗しました。');
  }
});

// ---- プッシュ通知（処理は js/push.js の PushSetup にまとめている） ----
const notifBtn = document.getElementById('enable-notif-btn');

function markNotifEnabled() {
  notifBtn.textContent = '通知は有効です ✓';
  notifBtn.disabled = true;
}

PushSetup.isEnabled().then((on) => { if (on) markNotifEnabled(); }).catch(() => {});

notifBtn.addEventListener('click', async () => {
  if (await PushSetup.enable()) markNotifEnabled();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!confirm('ログアウトしますか？')) return;
  try { await Api.logout(); } catch {}
  Session.clear();
  location.href = 'login.html';
});
