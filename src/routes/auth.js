// ============================================================
//  認証関連 API
//  Supabase Auth を利用したサインアップ／サインイン／サインアウト
// ============================================================
const express = require('express');
const { supabaseAdmin, createUserClient } = require('../supabase/supabase');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');

const router = express.Router();

// ----------------------------------------------------------
// POST /api/auth/signup
// 新規ユーザー登録（患者 or 介護者）
// body: { email, password, name, role: 'patient' | 'caregiver' }
// ----------------------------------------------------------
router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'メールアドレス・パスワード・氏名・役割は必須です。' });
    }
    if (!['patient', 'caregiver'].includes(role)) {
      return res.status(400).json({ error: '役割は patient または caregiver を指定してください。' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'パスワードは8文字以上で設定してください。' });
    }

    // ユーザー作成（DBトリガーが public.profiles に行を自動作成する）
    const { data, error } = await supabaseAdmin.auth.signUp({
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
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください。' });
    }

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません。' });
    }

    // プロフィール情報も合わせて返す
    const userClient = createUserClient(data.session.access_token);
    const { data: profile } = await userClient
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

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
