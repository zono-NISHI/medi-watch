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

document.getElementById('enable-notif-btn').addEventListener('click', async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showToast('このブラウザは通知に対応していません。', 'error');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('通知が許可されませんでした。', 'info');
      return;
    }
    const reg = await navigator.serviceWorker.register('sw.js');
    const { publicKey } = await Api.getVapidPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const subJson = sub.toJSON();
    await Api.subscribePush({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
      device_name: navigator.userAgent.slice(0, 60),
    });
    showToast('プッシュ通知を有効にしました。', 'success');
    document.getElementById('enable-notif-btn').textContent = '通知は有効です ✓';
    document.getElementById('enable-notif-btn').disabled = true;
  } catch (err) {
    console.error(err);
    showToast('通知の設定に失敗しました。', 'error');
  }
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!confirm('ログアウトしますか？')) return;
  try { await Api.logout(); } catch {}
  Session.clear();
  location.href = 'login.html';
});
