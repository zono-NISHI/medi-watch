// ============================================================
//  認証関連 API
//  Supabase Auth を利用したサインアップ／ログイン／メール確認／
//  パスワード再設定／セッション更新／ログアウト
//
//  ★ 認証処理には必ず createAuthClient()（リクエストごとに新規作成）を使う。
//     supabaseAdmin で auth.refreshSession() などを呼ぶと、admin クライアントに
//     ユーザーのセッションが残り、cron や通知処理がそのユーザー権限で動いてしまう。
// ============================================================
const express = require('express');
const { supabaseAdmin, createAuthClient, createUserClient } = require('../supabase/supabase');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');

const router = express.Router();

// 認証デバッグログの有効/無効（.env の DEBUG_AUTH で切り替え）
const DEBUG_AUTH = process.env.DEBUG_AUTH === 'true';

// ----------------------------------------------------------
// 共通ヘルパー
// ----------------------------------------------------------

// フロント側で文言を出し分けるための識別子を必ず付ける。
// error は「そのまま画面に出しても大丈夫な日本語」だけを入れる。
const ERR_EMAIL_TAKEN = {
  code: 'EMAIL_ALREADY_REGISTERED',
  error: 'このメールアドレスは、すでに登録されています。',
};

// Supabase の「すでに登録済み」を表すエラーかどうかを判定する。
// メッセージ文言はバージョンで変わるため、code とメッセージの両方を見る。
function isAlreadyRegistered(error) {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '').toLowerCase();
  return (
    code === 'user_already_exists' ||
    code === 'email_exists' ||
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('user already exists')
  );
}

// res.status() に不正な値を渡すと例外になり、接続が切れて
// ブラウザ側が「Failed to fetch」になる。必ず 400〜599 に丸める。
function safeStatus(status, fallback = 400) {
  const n = Number(status);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : fallback;
}

// signup / login / 確認コード系で同じ正規化をかける（ずれるとログインできなくなる）
function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

// 確認コードの正規化。
// 全角数字（１２３）や、読みやすさのために入れた空白・ハイフンを取り除く。
function normalizeOtp(value) {
  return String(value ?? '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐－ー]/g, '');
}

// メール内リンクの token_hash として受け付ける形式
const TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;

// 新規登録とパスワード再設定で同じ条件を使う
function validatePassword(password) {
  if (!password) return 'パスワードを入力してください。';
  if (password.length < 8) return 'パスワードは8文字以上で設定してください。';
  if (password.length > 72) return 'パスワードは72文字以内で入力してください。';
  return null;
}

function logAuthError(tag, error) {
  console.error(`[${tag}] Supabaseエラー:`, {
    status: error?.status,
    name: error?.name,
    code: error?.code,
    message: error?.message,
  });
}

function sendUpstreamError(res, message) {
  return res.status(503).json({
    code: 'UPSTREAM_ERROR',
    error: message || 'ただいま受付ができませんでした。少し時間をおいて、もう一度お試しください。',
  });
}

// ログイン成功時・メール確認成功時に共通で返すプロフィール取得
async function fetchProfile(accessToken, userId) {
  const userClient = createUserClient(accessToken);
  const { data: profile, error } = await userClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('[auth] プロフィール取得エラー:', error.message);
    return null;
  }
  return profile;
}

// ----------------------------------------------------------
// 確認コード／メール内リンクの検証（メール確認・パスワード再設定で共通）
//  - { email, token }  : メールに書かれた6桁のコードを入力した場合
//  - { token_hash }    : メール内のボタン（リンク）から来た場合
// 成功するとログイン状態になる（login と同じ形で返す）。
// ----------------------------------------------------------
async function verifyOtpAndRespond(req, res, { type, tag }) {
  const tokenHash = String(req.body.token_hash ?? '').trim();
  let params;

  if (tokenHash) {
    if (!TOKEN_HASH_PATTERN.test(tokenHash)) {
      return res.status(400).json({
        code: 'OTP_INVALID',
        error: 'このリンクは正しくないか、有効期限が切れています。',
      });
    }
    params = { token_hash: tokenHash, type };
  } else {
    const email = normalizeEmail(req.body.email);
    const token = normalizeOtp(req.body.token);
    const invalid = (field, message) =>
      res.status(400).json({ code: 'VALIDATION_ERROR', field, error: message });

    if (!email) return invalid('email', 'メールアドレスを入力してください。');
    if (!token) return invalid('token', '確認コードを入力してください。');
    // Supabase の既定は6桁。ダッシュボードで桁数を変えても通るよう 6〜10桁 を許容する
    if (!/^\d{6,10}$/.test(token)) {
      return invalid('token', '確認コードは、メールに書かれた数字（6桁）を入力してください。');
    }
    params = { email, token, type };
  }

  let data = null;
  let error = null;
  try {
    ({ data, error } = await createAuthClient().auth.verifyOtp(params));
  } catch (e) {
    console.error(`[${tag}] 予期しない例外:`, e);
    return sendUpstreamError(res, 'ただいま確認の受付ができませんでした。少し時間をおいて、もう一度お試しください。');
  }

  if (error) {
    logAuthError(tag, error);
    const status = safeStatus(error.status, 0);

    if (status === 429) {
      return res.status(429).json({
        code: 'RATE_LIMITED',
        error: '短い時間に何度もお試しいただいたため、しばらく確認できません。5分ほどおいてから、もう一度お試しください。',
      });
    }
    if (status === 0 || status >= 500) {
      return sendUpstreamError(res, 'ただいま確認の受付ができませんでした。少し時間をおいて、もう一度お試しください。');
    }
    // コードの誤り・有効期限切れ・使用済みは、Supabase ではすべて otp_expired（403）になる
    return res.status(400).json({
      code: 'OTP_INVALID',
      field: tokenHash ? undefined : 'token',
      error: tokenHash
        ? 'このリンクは、すでに使われたか、有効期限が切れています。'
        : '確認コードが正しくないか、有効期限が切れています。',
    });
  }

  if (!data?.session) {
    console.error(`[${tag}] セッションが返りませんでした`);
    return res.status(500).json({
      code: 'VERIFY_FAILED',
      error: '確認はできましたが、ログインに失敗しました。ログイン画面からログインしてください。',
    });
  }

  const profile = await fetchProfile(data.session.access_token, data.user.id);
  return res.json({ session: data.session, user: data.user, profile });
}

// 「送りました」系（再送・パスワード再設定メール）の共通処理。
// 登録の有無を第三者に推測されないよう、レート制限と送信障害以外は成功として返す。
async function sendMailAndRespond(res, { tag, send, successMessage }) {
  let error = null;
  try {
    ({ error } = await send());
  } catch (e) {
    console.error(`[${tag}] 予期しない例外:`, e);
    return sendUpstreamError(res, 'ただいまメールを送れませんでした。少し時間をおいて、もう一度お試しください。');
  }

  if (error) {
    logAuthError(tag, error);
    const status = safeStatus(error.status, 0);

    // 同じアドレスへの送信は、Supabase の既定で60秒に1回まで
    if (status === 429) {
      return res.status(429).json({
        code: 'RATE_LIMITED',
        error: '続けて送ることはできません。1分ほどおいてから、もう一度お試しください。',
      });
    }
    // SMTP（Brevo）の設定不備などで送信自体に失敗したケース
    if (status === 0 || status >= 500) {
      return res.status(503).json({
        code: 'EMAIL_SEND_FAILED',
        error: 'ただいまメールを送れませんでした。少し時間をおいて、もう一度お試しください。',
      });
    }
    // それ以外（未登録・確認済みなど）は成功と同じ応答にする
  }

  return res.json({ message: successMessage });
}

// ----------------------------------------------------------
// POST /api/auth/signup
// 新規ユーザー登録（患者 or 介護者）
// body: { email, password, name, role: 'patient' | 'caregiver' }
// ----------------------------------------------------------
router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    // API を直接叩かれる場合に備え、サーバー側でも正規化してから検証する
    const email = normalizeEmail(req.body.email);
    const name = String(req.body.name ?? '').trim();
    const password = String(req.body.password ?? '');
    const role = String(req.body.role ?? '');

    // 検証エラーは field を返し、フロント側で該当欄に赤字を出せるようにする
    const invalid = (field, message) =>
      res.status(400).json({ code: 'VALIDATION_ERROR', field, error: message });

    if (!name) return invalid('name', 'お名前を入力してください。');
    if (name.length > 50) return invalid('name', 'お名前は50文字以内で入力してください。');
    if (!email) return invalid('email', 'メールアドレスを入力してください。');
    if (!role) return invalid('role', 'ご利用の立場を選択してください。');
    if (!['patient', 'caregiver'].includes(role)) {
      return invalid('role', 'ご利用の立場を選択してください。');
    }
    const passwordError = validatePassword(password);
    if (passwordError) return invalid('password', passwordError);

    // ユーザー作成（DBトリガーが public.profiles に行を自動作成する）
    let data = null;
    let error = null;
    try {
      ({ data, error } = await createAuthClient().auth.signUp({
        email,
        password,
        options: {
          data: { name, role },
        },
      }));
    } catch (e) {
      // ネットワーク断や Supabase 側の異常。ここで握らないとプロセスが落ち、
      // ブラウザには「Failed to fetch」しか届かなくなる。
      console.error('[signup] 予期しない例外:', e);
      return res.status(503).json({
        code: 'UPSTREAM_ERROR',
        error: 'ただいま登録の受付ができませんでした。少し時間をおいて、もう一度お試しください。',
      });
    }

    if (error) {
      // ★ 重複メールは 409 + 専用コードで返す（sendSupabaseError には渡さない）
      if (isAlreadyRegistered(error)) {
        return res.status(409).json(ERR_EMAIL_TAKEN);
      }

      console.error('[signup] Supabaseエラー:', {
        status: error.status,
        name: error.name,
        code: error.code,
        message: error.message,
      });

      // 送信回数の上限（Supabase のレート制限）
      if (safeStatus(error.status, 0) === 429) {
        return res.status(429).json({
          code: 'RATE_LIMITED',
          error: '短い時間に何度もお試しいただいたため、しばらく登録できません。5分ほどおいてから、もう一度お試しください。',
        });
      }

      return res.status(safeStatus(error.status)).json({
        code: 'SIGNUP_FAILED',
        error: '登録できませんでした。入力内容をご確認のうえ、もう一度お試しください。',
      });
    }

    // ★ 「メール確認ON」の設定では、重複登録でも error にならず、
    //    identities が空配列のダミーユーザーが返る（Supabase の仕様）。
    //    ここを見ないと「登録できました」と誤って表示してしまう。
    if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
      return res.status(409).json(ERR_EMAIL_TAKEN);
    }

    res.status(201).json({
      message: '登録が完了しました。',
      user: data.user,
      session: data.session, // メール確認設定がOFFの場合は即時セッションが返る
      // メール確認ONの場合は session が null。フロントは確認コード入力画面へ進む
      needsEmailVerification: !data.session,
    });
  })
);

// ----------------------------------------------------------
// POST /api/auth/login
// body: { email, password }
// ----------------------------------------------------------
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    // signup 側と同じ正規化をかけないと、大文字で登録した人がログインできなくなる
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password ?? '');

    if (!email || !password) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        error: 'メールアドレスとパスワードを入力してください。',
      });
    }

    // デバッグ時のみ出力。本番では有効化されないようガードし、
    // メールアドレスもマスクしてログに残さない。
    if (DEBUG_AUTH && process.env.NODE_ENV !== 'production') {
      const masked = email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
      console.log('[login] 認証試行:', masked);
    }

    let data = null;
    let error = null;
    try {
      ({ data, error } = await createAuthClient().auth.signInWithPassword({ email, password }));
    } catch (e) {
      console.error('[login] 予期しない例外:', e);
      return res.status(503).json({
        code: 'UPSTREAM_ERROR',
        error: 'ただいまログインの受付ができませんでした。少し時間をおいて、もう一度お試しください。',
      });
    }

    if (error) {
      // エラー内容は常に出力する（原因追跡のため恒久的に残す）
      console.error('[login] Supabaseエラー:', {
        status: error.status,
        name: error.name,
        code: error.code,
        message: error.message,
      });

      // ★ メール確認が済んでいないユーザー。
      //    Supabase はパスワードが正しい場合にだけこのエラーを返すため、
      //    「登録の有無」を第三者に教えることにはならない。
      if (error.code === 'email_not_confirmed') {
        return res.status(403).json({
          code: 'EMAIL_NOT_CONFIRMED',
          error: 'メールアドレスの確認がまだ済んでいません。確認のメールのボタンを押すか、確認コードを入力してください。',
        });
      }

      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        error: 'メールアドレスまたはパスワードが正しくありません。',
      });
    }

    if (DEBUG_AUTH) {
      console.log('[login] 認証成功 user_id:', data.user.id);
    }

    // プロフィール情報も合わせて返す
    const profile = await fetchProfile(data.session.access_token, data.user.id);

    res.json({ session: data.session, user: data.user, profile });
  })
);

// ----------------------------------------------------------
// POST /api/auth/verify-email
// 新規登録の確認。body: { email, token } または { token_hash }
// ----------------------------------------------------------
router.post(
  '/verify-email',
  asyncHandler((req, res) => verifyOtpAndRespond(req, res, { type: 'email', tag: 'verify-email' }))
);

// ----------------------------------------------------------
// POST /api/auth/resend-verification
// 確認メールの再送。body: { email }
// ----------------------------------------------------------
router.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res
        .status(400)
        .json({ code: 'VALIDATION_ERROR', field: 'email', error: 'メールアドレスを入力してください。' });
    }
    return sendMailAndRespond(res, {
      tag: 'resend-verification',
      send: () => createAuthClient().auth.resend({ type: 'signup', email }),
      successMessage: '確認のメールを送りました。',
    });
  })
);

// ----------------------------------------------------------
// POST /api/auth/forgot-password
// パスワード再設定メールの送信。body: { email }
// ----------------------------------------------------------
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res
        .status(400)
        .json({ code: 'VALIDATION_ERROR', field: 'email', error: 'メールアドレスを入力してください。' });
    }
    return sendMailAndRespond(res, {
      tag: 'forgot-password',
      send: () => createAuthClient().auth.resetPasswordForEmail(email),
      successMessage: 'パスワード再設定のメールを送りました。',
    });
  })
);

// ----------------------------------------------------------
// POST /api/auth/verify-recovery
// パスワード再設定メールの確認。成功するとログイン状態になり、
// 続けて PUT /api/auth/password で新しいパスワードを設定する。
// body: { email, token } または { token_hash }
// ----------------------------------------------------------
router.post(
  '/verify-recovery',
  asyncHandler((req, res) => verifyOtpAndRespond(req, res, { type: 'recovery', tag: 'verify-recovery' }))
);

// ----------------------------------------------------------
// PUT /api/auth/password
// ログイン中のユーザーのパスワードを変更する（再設定画面から使用）。
// body: { password, refresh_token }
//
// ※ 現在のパスワードを確認しないため、将来マイページに「パスワード変更」を
//    作る場合は、現在のパスワードの確認を別途追加すること。
// ----------------------------------------------------------
router.put(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const password = String(req.body.password ?? '');
    const refreshToken = String(req.body.refresh_token ?? '');

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', field: 'password', error: passwordError });
    }
    if (!refreshToken) {
      return res.status(401).json({ code: 'SESSION_EXPIRED', error: 'もう一度、最初からやり直してください。' });
    }

    // このリクエスト専用のクライアントにセッションを載せてから更新する
    const client = createAuthClient();
    try {
      const { error: sessionError } = await client.auth.setSession({
        access_token: req.accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        logAuthError('password', sessionError);
        return res.status(401).json({ code: 'SESSION_EXPIRED', error: 'もう一度、最初からやり直してください。' });
      }

      const { error } = await client.auth.updateUser({ password });
      if (error) {
        logAuthError('password', error);
        const status = safeStatus(error.status, 0);

        if (error.code === 'same_password') {
          return res.status(400).json({
            code: 'SAME_PASSWORD',
            field: 'password',
            error: 'このパスワードは、今までお使いのものと同じです。',
          });
        }
        if (error.code === 'weak_password') {
          return res.status(400).json({
            code: 'WEAK_PASSWORD',
            field: 'password',
            error: 'このパスワードは使えません。もう少し長く、推測されにくいものにしてください。',
          });
        }
        if (status === 429) {
          return res.status(429).json({
            code: 'RATE_LIMITED',
            error: '短い時間に何度もお試しいただいたため、しばらく変更できません。5分ほどおいてから、もう一度お試しください。',
          });
        }
        if (status === 0 || status >= 500) {
          return sendUpstreamError(res, 'ただいまパスワードを変更できませんでした。少し時間をおいて、もう一度お試しください。');
        }
        return res.status(400).json({
          code: 'PASSWORD_UPDATE_FAILED',
          error: 'パスワードを変更できませんでした。もう一度、最初からやり直してください。',
        });
      }

      // setSession の中でトークンが更新されている場合があるため、最新のセッションを返す
      const { data: latest } = await client.auth.getSession();
      return res.json({ message: 'パスワードを変更しました。', session: latest.session, user: latest.session?.user });
    } catch (e) {
      console.error('[password] 予期しない例外:', e);
      return sendUpstreamError(res, 'ただいまパスワードを変更できませんでした。少し時間をおいて、もう一度お試しください。');
    }
  })
);

// ----------------------------------------------------------
// POST /api/auth/logout
// サーバー側でもこの端末のセッション（リフレッシュトークン）を無効にする
// ----------------------------------------------------------
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      // admin API はクライアントにセッションを保持しないので supabaseAdmin で呼んでよい
      const { error } = await supabaseAdmin.auth.admin.signOut(req.accessToken, 'local');
      if (error) logAuthError('logout', error);
    } catch (e) {
      console.error('[logout] 予期しない例外:', e);
    }
    // 失敗しても端末側のログアウトは必ず完了させる
    res.json({ message: 'ログアウトしました。' });
  })
);

// ----------------------------------------------------------
// POST /api/auth/refresh
// アクセストークン（約1時間で失効）を、リフレッシュトークンで更新する。
// body: { refresh_token }
// 応答: 401 = 再ログインが必要 / 503・429 = 一時的に更新できない（ログアウトさせない）
// ----------------------------------------------------------
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const refreshToken = String(req.body.refresh_token ?? '');
    if (!refreshToken) {
      return res.status(401).json({ code: 'SESSION_EXPIRED', error: 'もう一度ログインしてください。' });
    }

    let data = null;
    let error = null;
    try {
      ({ data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken }));
    } catch (e) {
      console.error('[refresh] 予期しない例外:', e);
      return sendUpstreamError(res);
    }

    if (error) {
      logAuthError('refresh', error);
      const status = safeStatus(error.status, 0);
      if (status === 429) {
        return res.status(429).json({ code: 'RATE_LIMITED', error: 'しばらくおいてから、もう一度お試しください。' });
      }
      if (status === 0 || status >= 500) return sendUpstreamError(res);
      return res.status(401).json({ code: 'SESSION_EXPIRED', error: 'もう一度ログインしてください。' });
    }

    if (!data?.session) {
      return res.status(401).json({ code: 'SESSION_EXPIRED', error: 'もう一度ログインしてください。' });
    }

    res.json({ session: data.session, user: data.user });
  })
);

// ----------------------------------------------------------
// GET /api/auth/me
// ログイン中ユーザーのプロフィールを取得
// ----------------------------------------------------------
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();
    if (error) return sendSupabaseError(res, error, 'プロフィールの取得に失敗しました。');
    res.json({ profile: data });
  })
);

// ----------------------------------------------------------
// PATCH /api/auth/me
// プロフィール更新（氏名・電話番号）
// ----------------------------------------------------------
router.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, phone } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;

    const { data, error } = await req.supabase
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, 'プロフィールの更新に失敗しました。');
    res.json({ profile: data });
  })
);

module.exports = router;
