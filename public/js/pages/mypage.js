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

// ---- 通知が届かないときの確認用 ----
document.getElementById('test-notif-btn').addEventListener('click', async () => {
  try {
    const r = await Api.sendTestPush();
    if (r.sent > 0) {
      showToast(`テスト通知を送りました（${r.sent}/${r.total} 台）。数秒以内に届くか確認してください。`, 'success', 8000);
    } else {
      showToast(`送信に失敗しました：${r.results.map((x) => `${x.status} ${x.message || ''}`).join(' / ')}`, 'error', 15000);
    }
  } catch (err) {
    showToast(err.message || 'テスト通知を送れませんでした。', 'error', 10000);
  }
});

document.getElementById('status-notif-btn').addEventListener('click', async () => {
  const out = document.getElementById('notif-status');
  try {
    const s = await Api.getPushStatus();
    const lines = [
      `サーバー時刻（日本時間）：${s.server_time_jst}`,
      `VAPID 鍵：${s.vapid_configured ? '設定済み' : '未設定 ← Render の環境変数を確認'}`,
      `登録済みの端末：${s.devices} 台${s.devices === 0 ? ' ← 「プッシュ通知を有効にする」を押す' : ''}`,
      `この端末の通知の許可：${'Notification' in window ? Notification.permission : '非対応'}`,
      '',
      '【服薬スケジュール】',
      ...(s.schedules.length
        ? s.schedules.map((x) => `・${x.name}　${x.time}　${x.reminder_minutes}分前に通知　${x.is_active ? '' : '（無効）'}`)
        : ['（なし）']),
      '',
      '【今日の服薬予定（サーバーが作成したもの）】',
      ...(s.today_logs.length
        ? s.today_logs.map((l) => `・${l.scheduled_at_jst}　${l.status}`)
        : ['（なし） ← サーバーの定期処理が動いていない可能性']),
    ];
    out.textContent = lines.join('\n');
    out.hidden = false;
  } catch (err) {
    showToast(err.message || '状態を取得できませんでした。', 'error', 10000);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  if (!confirm('ログアウトしますか？')) return;
  try { await Api.logout(); } catch {}
  Session.clear();
  location.href = 'login.html';
});
