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
const featuresForm = document.getElementById('features-form');
const beWatchedInput = document.getElementById('f-be-watched');
const watchInput = document.getElementById('f-watch');

// ネイティブ版：「ご家族のお知らせ」の欄は、「家族を見守る」を使う人にだけ出す
// （見守られる側・自分のお薬の管理だけの人には関係がないため。保存した設定に合わせる）
// Web 版では「通知設定」として、いつも表示する（自分のお薬の時間のお知らせにも使うため）
function renderNativeFamilyCard(profile) {
  if (!PushSetup.isNative) return;
  document.getElementById('web-push-card').hidden = profile?.can_watch === false;
}

// プロフィール読み込み
(async () => {
  try {
    const { profile } = await Api.me();
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    nameInput.value = profile.name || '';
    beWatchedInput.checked = profile.can_be_watched !== false;
    watchInput.checked = profile.can_watch !== false;
    renderNativeFamilyCard(profile);
  } catch (err) {
    handleApiError(err, 'プロフィールの取得に失敗しました。');
  }
})();

// ---- 使う機能（見守る／見守ってもらう） ----
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
    renderNativeFamilyCard(profile);
    // 下のボタン（「見守り」の表示・非表示）を新しい設定で描き直す
    document.querySelector('.bottom-nav')?.remove();
    renderBottomNav('mypage');
  } catch (err) {
    // 見守りの相手がいて外せなかった場合などは、元の設定に戻す
    beWatchedInput.checked = before?.can_be_watched !== false;
    watchInput.checked = before?.can_watch !== false;
    handleApiError(err, '使う機能の保存に失敗しました。');
  } finally {
    submitBtn.disabled = false;
  }
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { name: nameInput.value.trim() };
  try {
    const { profile } = await Api.updateMe(payload);
    const current = Session.get();
    Session.set(current.session, current.user, profile);
    showToast('プロフィールを更新しました。', 'success');
  } catch (err) {
    handleApiError(err, '更新に失敗しました。');
  }
});

// ---- ネイティブ版（Android アプリ）：お薬の時間のアラームの設定 ----
// アプリでは、自分のお薬の時間は端末のアラームで知らせる（サーバーからの「お薬の時間です」の通知は送らない）。
// 通知の欄は、ご家族のお知らせ（飲み忘れなど）を受け取るためだけに使う
if (PushSetup.isNative) {
  document.getElementById('push-card-title').textContent = 'ご家族のお知らせ';
  document.getElementById('push-card-desc').textContent =
    'ご家族がお薬を飲み忘れたときや、お薬を飲んだときに、このスマホに通知でお知らせします。ご自分のお薬の時間は、上のアラームでお知らせします。';
  document.getElementById('enable-notif-btn').textContent = 'お知らせを受け取る';
  renderNativeFamilyCard(Session.profile());
}
if (NativeAlarm.available()) {
  const nativeCard = document.getElementById('native-alarm-card');
  const renderNativeChecks = () => NativeAlarm.renderChecks(document.getElementById('native-alarm-checks'));
  nativeCard.hidden = false;
  renderNativeChecks().then(() => {
    if (location.hash === '#native-alarm-card') nativeCard.scrollIntoView({ block: 'start' });
  });
  // 設定の画面から戻ってきたら、状態を確認し直す
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderNativeChecks();
  });
}

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
    const enableLabel = notifBtn.textContent.includes('✓') ? '' : ` ← 「${notifBtn.textContent}」を押す`;
    const lines = [
      `サーバー時刻（日本時間）：${s.server_time_jst}`,
      `VAPID 鍵（ブラウザへの通知）：${s.vapid_configured ? '設定済み' : '未設定 ← Render の環境変数を確認'}`,
      `Firebase の鍵（アプリへの通知）：${s.fcm_configured ? '設定済み' : '未設定 ← Render の環境変数 FIREBASE_SERVICE_ACCOUNT を確認'}`,
      `登録済みの端末：${s.devices} 台（うちアプリ ${s.devices_fcm ?? 0} 台）${s.devices === 0 ? enableLabel : ''}`,
      `この端末の通知の許可：${await PushSetup.permissionState()}`,
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
  await NativeAlarm.clear(); // ネイティブ版：ログアウト後にこの端末でアラームが鳴らないようにする
  try { await Api.logout(); } catch {}
  Session.clear();
  location.href = 'login.html';
});

// ---- アカウントの削除 ----
// サーバーが、お薬・記録・映像・見守りのつながりを消し、ほかのスマホのアプリにも「アラームを止めて」と知らせる。
// 知らせが届かないスマホも、アラームを鳴らす前にサーバーへ確かめて、鳴らさずに予定を消す（mobile/ の AlarmAccount）
const deleteForm = document.getElementById('delete-account-form');
const deletePassword = document.getElementById('delete-password');
const deleteBtn = document.getElementById('delete-account-btn');

deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!deletePassword.value) {
    showToast('確認のため、パスワードを入力してください。', 'error');
    deletePassword.focus();
    return;
  }
  if (!confirm('アカウントを削除します。元に戻すことはできません。\n本当に削除しますか？')) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = '削除しています…';
  try {
    await Api.deleteAccount(deletePassword.value);
  } catch (err) {
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'アカウントを削除する';
    if (err.code === 'WRONG_PASSWORD') {
      deletePassword.value = '';
      deletePassword.focus();
    }
    handleApiError(err, 'アカウントを削除できませんでした。');
    return;
  }

  // この端末のアラームを止めて、予定を消す（通知の宛先の登録は、サーバーでアカウントと一緒に消えている）
  await NativeAlarm.clear();
  Session.clear();
  alert('アカウントを削除しました。ご利用ありがとうございました。');
  location.href = 'login.html';
});
