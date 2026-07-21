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

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'メールアドレス・パスワード・氏名・役割は必須です。' });
    }
    if (!['patient', 'caregiver'].includes(role)) {
      return res.status(400).json({ error: '役割は patient または caregiver を指定してください。' });
    }
    if (name.length > 50) {
      return res.status(400).json({ error: 'お名前は50文字以内で入力してください。' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'パスワードは8文字以上で設定してください。' });
    }
    if (password.length > 72) {
      return res.status(400).json({ error: 'パスワードは72文字以内で入力してください。' });
    }

    // ユーザー作成（DBトリガーが public.profiles に行を自動作成する）
    const { data, error } = await supabaseAnon.auth.signUp({
      email,
      password,
      options: {
        data: { name, role },
      },
    });

    if (error) return sendSupabaseError(res, error, '登録に失敗しました。');

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
      return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください。' });
    }

    // デバッグ時のみ出力。本番では有効化されないようガードし、
    // メールアドレスもマスクしてログに残さない。
    if (DEBUG_AUTH && process.env.NODE_ENV !== 'production') {
      const masked = email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
      console.log('[login] 認証試行:', masked);
    }

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error) {
      // エラー内容は常に出力する（原因追跡のため恒久的に残す）
      console.error('[login] Supabaseエラー:', {
        status: error.status,
        name: error.name,
        code: error.code,
        message: error.message,
      });
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません。' });
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
