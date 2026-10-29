// ============================================================
//  マイページ ロジック
// ============================================================

if (!requireLoginOrRedirect()) {
  throw new Error('未ログイン');
}

renderBottomNav('mypage');
MedAlarm.start(); // 服薬時刻になったら、この画面でもアラームを出す

const profileForm = document.getElementById('profile-form');
const nameInput = document.getElementById('p-name');
const phoneInput = document.getElementById('p-phone');
const featuresForm = document.getElementById('features-form');
const beWatchedInput = document.getElementById('f-be-watched');
const watchInput = document.getElementById('f-watch');
const featuresSummary = document.getElementById('f-summary');

// プロフィール読み込み
(async () => {
  try {
    const { profile } = await Api.me();
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    nameInput.value = profile.name || '';
    phoneInput.value = profile.phone || '';
    beWatchedInput.checked = profile.can_be_watched !== false;
    watchInput.checked = profile.can_watch !== false;
    renderFeaturesSummary();
  } catch (err) {
    handleApiError(err, 'プロフィールの取得に失敗しました。');
  }
})();

// ---- 使う機能（見守る／見守ってもらう） ----
function renderFeaturesSummary() {
  const parts = [];
  if (beWatchedInput.checked) parts.push('ご家族に見守ってもらう');
  if (watchInput.checked) parts.push('ご家族を見守る');
  featuresSummary.textContent = parts.length
    ? `いまの設定：自分のお薬の記録 ＋ ${parts.join('・')}`
    : 'いまの設定：自分のお薬の管理だけ（「見守り」のボタンは表示されません）';
}

beWatchedInput.addEventListener('change', renderFeaturesSummary);
watchInput.addEventListener('change', renderFeaturesSummary);

featuresForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const before = Session.profile();
  const payload = { can_be_watched: beWatchedInput.checked, can_watch: watchInput.checked };

  // 新しく見守る機能を使い始めるときは、念のため確認する（ご本人の押し間違いを防ぐ）
  if (payload.can_watch && before?.can_watch === false) {
    const ok = window.confirm(
      '「家族を見守る」を使えるようにしますか？\n「見守り」画面に、ご家族の招待コードを入力する欄が表示されます。'
    );
    if (!ok) return;
  }

  const submitBtn = featuresForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const { profile } = await Api.updateMe(payload);
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    showToast('使う機能を保存しました。', 'success');
    // 下のボタン（「見守り」の表示・非表示）を新しい設定で描き直す
    document.querySelector('.bottom-nav')?.remove();
    renderBottomNav('mypage');
  } catch (err) {
    // 見守りの相手がいて外せなかった場合などは、元の設定に戻す
    beWatchedInput.checked = before?.can_be_watched !== false;
    watchInput.checked = before?.can_watch !== false;
    renderFeaturesSummary();
    handleApiError(err, '使う機能の保存に失敗しました。');
  } finally {
    submitBtn.disabled = false;
  }
});

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
  await PushSetup.unlinkCurrentUser(); // ログアウト後にこの端末へ通知が届かないようにする
  try { await Api.logout(); } catch {}
  Session.clear();
  location.href = 'login.html';
});
