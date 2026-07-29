// ============================================================
//  認証関連 API
//  Supabase Auth を利用したサインアップ／サインイン／サインアウト
// ============================================================
const express = require('express');
const { supabaseAdmin, supabaseAnon, createUserClient } = require('../supabase/supabase');
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

// ----------------------------------------------------------
// POST /api/auth/signup
// 新規ユーザー登録（患者 or 介護者）
// body: { email, password, name, role: 'patient' | 'caregiver' }
// ----------------------------------------------------------
router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    // API を直接叩かれる場合に備え、サーバー側でも正規化してから検証する
    const email = String(req.body.email ?? '').trim().toLowerCase();
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
    if (!password) return invalid('password', 'パスワードを入力してください。');
    if (password.length < 8) return invalid('password', 'パスワードは8文字以上で設定してください。');
    if (password.length > 72) return invalid('password', 'パスワードは72文字以内で入力してください。');

    // ユーザー作成（DBトリガーが public.profiles に行を自動作成する）
    let data = null;
    let error = null;
    try {
      ({ data, error } = await supabaseAnon.auth.signUp({
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
    const email = String(req.body.email ?? '').trim().toLowerCase();
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
      ({ data, error } = await supabaseAnon.auth.signInWithPassword({ email, password }));
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
      return res.status(401).json({
        code: 'INVALID_CREDENTIALS',
        error: 'メールアドレスまたはパスワードが正しくありません。',
      });
    }

    if (DEBUG_AUTH) {
      console.log('[login] 認証成功 user_id:', data.user.id);
    }

    // プロフィール情報も合わせて返す
    const userClient = createUserClient(data.session.access_token);
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      console.error('[login] プロフィール取得エラー:', profileError.message);
    }

    res.json({ session: data.session, user: data.user, profile });
  })
);

// ----------------------------------------------------------
// POST /api/auth/logout
// ----------------------------------------------------------
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase.auth.signOut();
    if (error) return sendSupabaseError(res, error, 'ログアウトに失敗しました。');
    res.json({ message: 'ログアウトしました。' });
  })
);

// ----------------------------------------------------------
// POST /api/auth/refresh
// body: { refresh_token }
// ----------------------------------------------------------
router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token が必要です。' });
    }
    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: 'セッションの更新に失敗しました。再度ログインしてください。' });
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
