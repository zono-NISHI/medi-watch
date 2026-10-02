// ============================================================
//  API クライアント
//  バックエンドへのfetch呼び出しと、セッション（トークン）の管理を行う
// ============================================================

const SESSION_KEY = 'okusuri_techo_session';

// 確認コード入力画面へ、確認待ちのメールアドレスを受け渡すためのキー。
// URL に載せるとサーバーのアクセスログ（morgan）に残るため、sessionStorage を使う。
const PENDING_EMAIL_KEY = 'okusuri_techo_pending_email';

const PendingVerification = {
  set(email) {
    try { sessionStorage.setItem(PENDING_EMAIL_KEY, email); } catch { /* 保存できなくても画面で入力できる */ }
  },
  get() {
    try { return sessionStorage.getItem(PENDING_EMAIL_KEY) || ''; } catch { return ''; }
  },
  clear() {
    try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* noop */ }
  },
};

const Session = {
  get() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(session, user, profile) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ session, user, profile }));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
  accessToken() {
    return Session.get()?.session?.access_token || null;
  },
  profile() {
    return Session.get()?.profile || null;
  },
  user() {
    return Session.get()?.user || null;
  },
  isLoggedIn() {
    return !!Session.accessToken();
  },
};

// ------------------------------------------------------------
// アプリ共通のエラー型
// code / status を持たせることで、画面側が「文言の一致」ではなく
// 「意味」で分岐できるようにする。
// ------------------------------------------------------------
class ApiError extends Error {
  constructor(message, { code = null, status = null, field = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.field = field;
    this.cause = cause;
  }
}

// ------------------------------------------------------------
// セッション（アクセストークン）の自動更新
//
// Supabase のアクセストークンは約1時間で切れる。切れるたびにログイン画面へ
// 戻すと、高齢の方は1日に何度もパスワードを入れ直すことになるため、
// リフレッシュトークンで自動的に更新して、ログイン状態を保つ。
// ------------------------------------------------------------

// 期限切れの少し前に更新しておく（秒）
const REFRESH_MARGIN_SEC = 60;

// 同時に複数の API が期限切れを検知しても、更新は1回だけにする。
// 同じリフレッシュトークンで並行して更新すると、使用済み扱いになって
// ログアウトされてしまうため。
let refreshInFlight = null;

// 戻り値: 'ok' | 'expired'（再ログインが必要） | 'unavailable'（通信不良など一時的）
function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const current = Session.get();
    const refreshToken = current?.session?.refresh_token;
    if (!refreshToken) return 'expired';

    let res;
    try {
      res = await fetch(`${window.APP_CONFIG.API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      return 'unavailable';
    }

    if (res.status === 401) {
      // 別のタブが先に更新を済ませていれば、それを使う
      const latest = Session.get();
      if (latest?.session?.refresh_token && latest.session.refresh_token !== refreshToken) {
        return 'ok';
      }
      return 'expired';
    }
    if (!res.ok) return 'unavailable';

    const data = await res.json().catch(() => null);
    if (!data?.session) return 'unavailable';

    // プロフィールは更新応答に含まれないので、保存済みのものを引き継ぐ
    const latest = Session.get() || current;
    Session.set(data.session, data.user || latest.user, latest.profile);
    return 'ok';
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

function isSessionExpiringSoon() {
  const expiresAt = Number(Session.get()?.session?.expires_at); // 秒単位の UNIX 時刻
  if (!expiresAt) return false;
  return Date.now() / 1000 >= expiresAt - REFRESH_MARGIN_SEC;
}

function redirectToLogin() {
  Session.clear();
  const path = location.pathname;
  if (!path.endsWith('login.html') && !path.endsWith('index.html') && path !== '/') {
    location.href = 'login.html';
  }
}

async function apiRequest(path, { method = 'GET', body, auth = true, _retried = false } = {}) {
  // 期限切れが近ければ、先に更新しておく（無駄な401の往復を減らす）
  if (auth && !_retried && Session.isLoggedIn() && isSessionExpiringSoon()) {
    const result = await refreshSession();
    if (result === 'expired') {
      redirectToLogin();
      throw new ApiError('もう一度ログインしてください。', { code: 'SESSION_EXPIRED', status: 401 });
    }
    // 'unavailable' のときは今のトークンのまま試す
  }

  // body に関数を渡した場合は、送信直前に評価する（更新後のトークンを載せるため）
  const payload = typeof body === 'function' ? body() : body;

  const headers = { 'Content-Type': 'application/json' };
  const usedToken = auth ? Session.accessToken() : null;
  if (usedToken) headers['Authorization'] = `Bearer ${usedToken}`;

  let res;
  try {
    res = await fetch(`${window.APP_CONFIG.API_BASE_URL}${path}`, {
      method,
      headers,
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
  } catch (networkError) {
    // fetch がここで失敗するのは「サーバーに届かなかった」ときだけ。
    // ブラウザ既定の "Failed to fetch" をそのまま画面に出さない。
    console.error('[api] 通信失敗:', path, networkError);
    throw new ApiError(
      'サーバーとの通信ができませんでした。',
      { code: 'NETWORK_ERROR', cause: networkError }
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401 && auth) {
      // 401 はサーバーが処理を始める前（認証の段階）で返るので、やり直しても二重登録にはならない
      if (!_retried) {
        const latestToken = Session.accessToken();
        const retry = () => apiRequest(path, { method, body, auth, _retried: true });

        // 別のタブなどで、すでに新しいトークンに更新済み
        if (latestToken && latestToken !== usedToken) return retry();

        const result = await refreshSession();
        if (result === 'ok') return retry();
        if (result === 'unavailable') {
          // 通信が不安定なだけなら、ログアウトさせない
          throw new ApiError(
            'サーバーとの通信ができませんでした。',
            { code: 'NETWORK_ERROR', status: 401 }
          );
        }
      }
      redirectToLogin();
    }
    const message = data?.error || `エラーが発生しました（${res.status}）`;
    throw new ApiError(message, {
      code: data?.code || null,
      status: res.status,
      field: data?.field || null,
    });
  }

  return data;
}

const Api = {
  // ---- 認証 ----
  signup: (payload) => apiRequest('/auth/signup', { method: 'POST', body: payload, auth: false }),
  login: (payload) => apiRequest('/auth/login', { method: 'POST', body: payload, auth: false }),
  // payload: { email, token }（コード入力）または { token_hash }（メールのボタンから）
  verifyEmail: (payload) =>
    apiRequest('/auth/verify-email', { method: 'POST', body: payload, auth: false }),
  resendVerification: (email) =>
    apiRequest('/auth/resend-verification', { method: 'POST', body: { email }, auth: false }),
  forgotPassword: (email) =>
    apiRequest('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),
  verifyRecovery: (payload) =>
    apiRequest('/auth/verify-recovery', { method: 'POST', body: payload, auth: false }),
  updatePassword: (password) =>
    apiRequest('/auth/password', {
      method: 'PUT',
      body: () => ({ password, refresh_token: Session.get()?.session?.refresh_token }),
    }),
  logout: () => apiRequest('/auth/logout', { method: 'POST' }),
  me: () => apiRequest('/auth/me'),
  updateMe: (payload) => apiRequest('/auth/me', { method: 'PATCH', body: payload }),

  // ---- ケアグループ ----
  createCareGroup: (payload) => apiRequest('/care-groups', { method: 'POST', body: payload }),
  listCareGroups: () => apiRequest('/care-groups'),
  listGroupMembers: (groupId) => apiRequest(`/care-groups/${groupId}/members`),
  joinCareGroup: (payload) => apiRequest('/care-groups/join', { method: 'POST', body: payload }),

  // ---- 薬情報 ----
  listMedications: (patientId) =>
    apiRequest(`/medications${patientId ? `?patient_id=${patientId}` : ''}`),
  getMedication: (id) => apiRequest(`/medications/${id}`),
  createMedication: (payload) => apiRequest('/medications', { method: 'POST', body: payload }),
  scanQr: (qr_raw_data) => apiRequest('/medications/scan-qr', { method: 'POST', body: { qr_raw_data } }),
  confirmQr: (payload) => apiRequest('/medications/scan-qr/confirm', { method: 'POST', body: payload }),
  updateMedication: (id, payload) => apiRequest(`/medications/${id}`, { method: 'PATCH', body: payload }),
  deleteMedication: (id) => apiRequest(`/medications/${id}`, { method: 'DELETE' }),

  // ---- スケジュール ----
  listSchedules: (patientId) =>
    apiRequest(`/schedules${patientId ? `?patient_id=${patientId}` : ''}`),
  createSchedule: (payload) => apiRequest('/schedules', { method: 'POST', body: payload }),
  updateSchedule: (id, payload) => apiRequest(`/schedules/${id}`, { method: 'PATCH', body: payload }),
  deleteSchedule: (id) => apiRequest(`/schedules/${id}`, { method: 'DELETE' }),

  // ---- 服薬記録 ----
  listLogs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/logs${qs ? `?${qs}` : ''}`);
  },
  createLog: (payload) => apiRequest('/logs', { method: 'POST', body: payload }),
  takeLog: (id, payload) => apiRequest(`/logs/${id}/take`, { method: 'PATCH', body: payload }),
  skipLog: (id, payload) => apiRequest(`/logs/${id}/skip`, { method: 'PATCH', body: payload }),
  getVideoUploadUrl: (id) => apiRequest(`/logs/${id}/video-upload-url`, { method: 'POST' }),
  getVideoUrl: (id) => apiRequest(`/logs/${id}/video-url`),

  // ---- プッシュ通知 ----
  getVapidPublicKey: () => apiRequest('/push/vapid-public-key', { auth: false }),
  subscribePush: (payload) => apiRequest('/push/subscribe', { method: 'POST', body: payload }),
  unsubscribePush: (endpoint) => apiRequest('/push/subscribe', { method: 'DELETE', body: { endpoint } }),
};
