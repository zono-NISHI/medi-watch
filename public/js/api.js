// ============================================================
//  API クライアント
//  バックエンドへのfetch呼び出しと、セッション（トークン）の管理を行う
// ============================================================

const SESSION_KEY = 'okusuri_techo_session';

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

async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = Session.accessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${window.APP_CONFIG.API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
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
    // セッション切れの場合はログイン画面へ
    if (res.status === 401 && auth) {
      Session.clear();
      if (!location.pathname.endsWith('login.html') && !location.pathname.endsWith('index.html')) {
        location.href = 'login.html';
      }
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
