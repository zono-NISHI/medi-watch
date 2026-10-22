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

    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      const { publicKey } = await Api.getVapidPublicKey();

      // 既に購読していればそれをサーバーに登録し直す（端末の再登録・DB から消えた場合の復旧）
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const subJson = sub.toJSON();
      await Api.subscribePush({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        device_name: navigator.userAgent.slice(0, 60),
      });
      showToast('プッシュ通知を有効にしました。', 'success');
      return true;
    } catch (err) {
      console.error('[push] 購読に失敗:', err);
      const msg = err?.status === 503
        ? 'サーバーで通知が設定されていません（VAPID 鍵が未設定）。'
        : '通知の設定に失敗しました。';
      showToast(msg, 'error', 8000);
      return false;
    }
  }

  // 既に有効かどうか（ボタン表示の切り替え用）
  async function isEnabled() {
    if (unsupportedReason() || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (await reg.pushManager.getSubscription()));
  }

  return { enable, isEnabled, unsupportedReason };
})();
