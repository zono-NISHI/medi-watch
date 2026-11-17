// ============================================================
//  プッシュ通知の有効化（ログイン後の各画面で共通）
//  - ブラウザ（Web 版・PWA）… Web Push。端末・ブラウザの状態を調べ、許可されない理由に合わせた案内を出す
//    iPhone は「ホーム画面に追加」したアプリからでないと Web Push を使えない
//  - ネイティブ版（Android アプリ）… Firebase Cloud Messaging（FCM）。
//    アプリの画面（WebView）は Web Push に対応していないため、@capacitor/push-notifications を使う。
//    バンドラーを使わないので、Capacitor が用意する nativePromise / addListener で直接呼ぶ。
// ============================================================

const PushSetup = (() => {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  // LINE・Instagram・Facebook などのアプリ内ブラウザは通知を使えない
  const isInAppBrowser = /Line\/|FBAN|FBAV|Instagram/i.test(ua);

  // ---- ネイティブ版（FCM） ----
  const isNative = !!window.APP_CONFIG?.IS_NATIVE_APP && typeof window.Capacitor?.nativePromise === 'function';
  // 通知のプラグインが入っているか（入っていない古い版のアプリでは、呼ぶとエラーになるため確かめる）
  const nativePushAvailable =
    isNative && (window.Capacitor.PluginHeaders || []).some((h) => h.name === 'PushNotifications');
  // この端末の FCM のトークン。ログアウト時に、サーバーの登録を消すために覚えておく
  const FCM_TOKEN_KEY = 'medi_watch_fcm_token';
  // 通知チャンネル（サーバーの notificationService.js の FCM_CHANNEL_ID と同じ値）
  const FCM_CHANNEL = {
    id: 'family_notice',
    name: 'ご家族のお知らせ',
    description: 'ご家族のお薬の飲み忘れ・服薬の記録などのお知らせ',
    importance: 4, // 高（画面の上に表示し、音を鳴らす）
    visibility: 1, // ロック画面にも内容を表示する
    vibration: true,
    lights: false,
  };

  function nativeCall(method, options = {}) {
    return window.Capacitor.nativePromise('PushNotifications', method, options);
  }

  function storeToken(token) {
    try { localStorage.setItem(FCM_TOKEN_KEY, token); } catch {}
  }
  function storedToken() {
    try { return localStorage.getItem(FCM_TOKEN_KEY); } catch { return null; }
  }

  // FCM に登録し、この端末のトークンを受け取る（結果はイベントで届く）
  function registerNative() {
    return new Promise((resolve, reject) => {
      let done = false;
      const listeners = [];
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        listeners.forEach((l) => l.remove());
        fn(value);
      };
      const timer = setTimeout(() => finish(reject, new Error('端末の宛先を受け取れませんでした（時間切れ）')), 20000);
      listeners.push(
        window.Capacitor.addListener('PushNotifications', 'registration', (data) => {
          if (data?.value) finish(resolve, data.value);
        }),
        window.Capacitor.addListener('PushNotifications', 'registrationError', (data) => {
          finish(reject, new Error(data?.error || '端末の登録に失敗しました'));
        })
      );
      nativeCall('createChannel', FCM_CHANNEL)
        .catch((err) => console.warn('[push] 通知チャンネルを作れませんでした:', err))
        .then(() => nativeCall('register'))
        .catch((err) => finish(reject, err));
    });
  }

  // 通知の許可の状態（'granted' / 'denied' / 'prompt' など）。調べられないときは null
  async function nativePermission() {
    try {
      return (await nativeCall('checkPermissions')).receive;
    } catch {
      return null;
    }
  }

  // トークンを受け取って、いまログインしている利用者の端末としてサーバーに登録する
  async function linkNative() {
    const token = await registerNative();
    await Api.subscribePush({ kind: 'fcm', token, device_name: 'Android アプリ' });
    storeToken(token);
    return token;
  }

  const nativeDeniedGuide =
    '通知がオフになっています。スマホの「設定」→「アプリ」→「お薬手帳」→「通知」をオンにしてから、もう一度押してください。';

  async function enableNative() {
    let permission = await nativePermission();
    // 以前「許可しない」を選んだ場合、許可の画面はもう出ないため、設定の場所を案内する
    if (permission === 'denied') {
      showToast(nativeDeniedGuide, 'error', 10000);
      return false;
    }
    if (permission !== 'granted') {
      try {
        permission = (await nativeCall('requestPermissions')).receive;
      } catch {
        permission = null;
      }
    }
    if (permission !== 'granted') {
      showToast(
        permission === 'denied' ? nativeDeniedGuide : '通知が許可されませんでした。もう一度押して「許可」を選んでください。',
        'info',
        10000
      );
      return false;
    }
    try {
      await linkNative();
      showToast('ご家族のお知らせを受け取れるようにしました。', 'success');
      return true;
    } catch (err) {
      console.error('[push] アプリの通知の登録に失敗:', err);
      showToast(`通知の設定に失敗しました。${err?.message || err}`, 'error', 15000);
      return false;
    }
  }

  // 通知をタップしてアプリが開いたら、通知の内容に合った画面を開く（sw.js の notificationclick と同じ行き先）
  // アプリが閉じていたときは、通知の情報はプラグインが預かっていて、ここで受け取り口を作ったときに届く
  function listenNativeTaps() {
    window.Capacitor.addListener('PushNotifications', 'pushNotificationActionPerformed', (action) => {
      const data = action?.notification?.data || {};
      if (data.url) {
        location.href = data.url;
      } else if (data.patientId) {
        // その人のホームを開き、お知らせのお薬（記録）のカードを示す（home.js の showNotifiedCard）
        const focus = data.logId ? `&focus=${encodeURIComponent(data.logId)}` : '';
        location.href = `home.html?view=${encodeURIComponent(data.patientId)}${focus}`;
      } else if (data.type) {
        location.href = 'home.html';
      }
    });
  }
  if (nativePushAvailable) listenNativeTaps();

  // ---- ブラウザ（Web Push） ----

  // 通知を使えない理由を返す（使える場合は null）
  function unsupportedReason() {
    if (isNative) {
      return nativePushAvailable
        ? null
        : 'このアプリの版では、ご家族のお知らせを受け取れません。アプリを新しい版に更新してください。';
    }
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
    if (isNative) return enableNative();

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
    if (isNative || unsupportedReason() || Notification.permission !== 'granted') return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  // 「この端末」を「いまログインしている利用者」に結び付け直す。
  // ブラウザの購読は端末（ブラウザ）ごとに1つで、アカウントとは無関係に残る。
  // そのため、同じブラウザで別のアカウントにログインした場合も、ここで登録し直す。
  // ネイティブ版では、通知が許可されていれば（アラームの設定で許可していることが多い）、
  // ボタンを押さなくても登録する。アプリを更新しただけで、ご家族のお知らせが届くようにするため。
  // 成功したら true（＝この利用者で通知が有効）。画面を開いたときに黙って呼ぶ。
  async function syncCurrentUser() {
    try {
      if (isNative) {
        if (!nativePushAvailable || (await nativePermission()) !== 'granted') return false;
        await linkNative();
        return true;
      }
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
      if (isNative) {
        const token = storedToken();
        if (token) await Api.unsubscribePush(token);
        return;
      }
      const sub = await currentSubscription();
      if (sub) await Api.unsubscribePush(sub.endpoint);
    } catch (err) {
      console.warn('[push] 端末の登録解除に失敗:', err);
    }
  }

  // この端末の通知の許可の状態（「通知の状態を確認する」の表示用）
  async function permissionState() {
    if (isNative) return nativePushAvailable ? (await nativePermission()) || '不明' : '非対応（古い版のアプリ）';
    return 'Notification' in window ? Notification.permission : '非対応';
  }

  // 互換用（ボタン表示の切り替え）。サーバー側の登録まで確認する
  const isEnabled = syncCurrentUser;

  return { enable, isEnabled, syncCurrentUser, unlinkCurrentUser, unsupportedReason, permissionState, isNative };
})();
