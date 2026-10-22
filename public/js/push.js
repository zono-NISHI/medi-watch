// ============================================================
//  プッシュ通知の有効化（マイページ・ホーム画面で共通）
//  - 端末・ブラウザの状態を調べ、許可されない理由に合わせた案内を出す
//  - iPhone は「ホーム画面に追加」したアプリからでないと Web Push を使えない
// ============================================================

const PushSetup = (() => {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  // LINE・Instagram・Facebook などのアプリ内ブラウザは通知を使えない
  const isInAppBrowser = /Line\/|FBAN|FBAV|Instagram/i.test(ua);

  // 通知を使えない理由を返す（使える場合は null）
  function unsupportedReason() {
    if (isInAppBrowser) {
      return 'アプリ内のブラウザでは通知を使えません。Chrome（iPhone は Safari）で開き直してください。';
    }
    if (isIOS && !isStandalone) {
      return 'iPhone では、Safari の共有ボタン →「ホーム画面に追加」で追加したアイコンからアプリを開くと、通知を有効にできます。';
    }
    if (!window.isSecureContext) {
      return '通知は https のページでのみ使えます。';
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return 'このブラウザは通知に対応していません。';
    }
    return null;
  }

  // 「ブロック」済みのときの解除方法
  function deniedGuide() {
    if (isIOS) {
      return '通知がオフになっています。iPhone の「設定」→「通知」→「お薬手帳」で「通知を許可」をオンにしてから、もう一度押してください。';
    }
    if (isAndroid) {
      return '通知がブロックされています。Chrome のアドレスバー左のアイコン →「権限」→「通知」を「許可」にし、Android の「設定」→「アプリ」→「Chrome」→「通知」もオンにしてから、もう一度押してください。';
    }
    return '通知がブロックされています。ブラウザのサイト設定で通知を「許可」にしてから、もう一度押してください。';
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // ボタンのクリック時に呼ぶ。成功したら true を返す。
  async function enable() {
    const reason = unsupportedReason();
    if (reason) {
      showToast(reason, 'error', 8000);
      return false;
    }

    // 以前「ブロック」した場合、requestPermission() はダイアログを出さずに即 'denied' を返す
    if (Notification.permission === 'denied') {
      showToast(deniedGuide(), 'error', 10000);
      return false;
    }

    // 許可ダイアログは、ボタンを押した直後（他の await より前）に出す必要がある
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast(
        permission === 'denied' ? deniedGuide() : '通知が許可されませんでした。もう一度押して「許可」を選んでください。',
        'info',
        10000
      );
      return false;
    }

    // どの段階で失敗したかを画面に出す（原因の切り分け用）
    let step = 'Service Worker の登録';
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;

      step = 'サーバーから公開鍵（VAPID）の取得';
      const { publicKey } = await Api.getVapidPublicKey();
      if (!publicKey || !/^B[A-Za-z0-9_-]{86}$/.test(publicKey.trim())) {
        throw new Error(`公開鍵の形式が正しくありません（先頭: ${String(publicKey).slice(0, 12)}…）`);
      }

      step = 'ブラウザでのプッシュ購読';
      // 既に購読していればそれをサーバーに登録し直す（端末の再登録・DB から消えた場合の復旧）
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey.trim()),
        });
      }

      step = 'サーバーへの端末登録';
      const subJson = sub.toJSON();
      await Api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        device_name: navigator.userAgent.slice(0, 60),
      });
      showToast('プッシュ通知を有効にしました。', 'success');
      return true;
    } catch (err) {
      console.error('[push] 失敗:', step, err);
      const detail = err?.status === 503
        ? 'サーバーに VAPID 鍵が設定されていません。'
        : `${err?.name && err.name !== 'Error' ? err.name + ': ' : ''}${err?.message || err}`;
      showToast(`通知の設定に失敗しました（${step}）。${detail}`, 'error', 15000);
      return false;
    }
  }

  // 既に有効かどうか（ボタン表示の切り替え用）
  // ブラウザ側の購読（端末）を取得する。無ければ null
  async function currentSubscription() {
    if (unsupportedReason() || Notification.permission !== 'granted') return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  // 「この端末」を「いまログインしている利用者」に結び付け直す。
  // ブラウザの購読は端末（ブラウザ）ごとに1つで、アカウントとは無関係に残る。
  // そのため、同じブラウザで別のアカウントにログインした場合も、ここで登録し直す。
  // 成功したら true（＝この利用者で通知が有効）。画面を開いたときに黙って呼ぶ。
  async function syncCurrentUser() {
    try {
      const sub = await currentSubscription();
      if (!sub) return false;
      const subJson = sub.toJSON();
      await Api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        device_name: navigator.userAgent.slice(0, 60),
      });
      return true;
    } catch (err) {
      console.warn('[push] 端末の再登録に失敗:', err);
      return false;
    }
  }

  // ログアウト時に呼ぶ。この端末と、ログアウトする利用者の結び付きをサーバーから消す
  // （消さないと、ログアウト後もその利用者宛ての通知がこの端末に届き続ける）
  async function unlinkCurrentUser() {
    try {
      const sub = await currentSubscription();
      if (sub) await Api.unsubscribePush(sub.endpoint);
    } catch (err) {
      console.warn('[push] 端末の登録解除に失敗:', err);
    }
  }

  // 互換用（ボタン表示の切り替え）。サーバー側の登録まで確認する
  const isEnabled = syncCurrentUser;

  return { enable, isEnabled, syncCurrentUser, unlinkCurrentUser, unsupportedReason };
})();
