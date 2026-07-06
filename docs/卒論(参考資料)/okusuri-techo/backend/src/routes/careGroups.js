// ============================================================
//  ケアグループ関連 API
//  患者を中心としたグループ作成・家族/介護者の招待コード参加
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------
// POST /api/care-groups
// 患者がケアグループを新規作成
// body: { name }
// ----------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'グループ名は必須です。' });

    const { data, error } = await req.supabase
      .from('care_groups')
      .insert({ patient_id: req.user.id, name })
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, 'グループの作成に失敗しました。');
    res.status(201).json({ group: data });
  })
);

// ----------------------------------------------------------
// GET /api/care-groups
// 自分が患者または参加者になっているグループ一覧
// ----------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // 患者として所有しているグループ
    const { data: ownGroups, error: ownErr } = await req.supabase
      .from('care_groups')
      .select('*')
      .eq('patient_id', req.user.id);
    if (ownErr) return sendSupabaseError(res, ownErr);

    // メンバーとして参加しているグループ
    const { data: memberRows, error: memberErr } = await req.supabase
      .from('care_group_members')
      .select('group_id, relation, can_view_video, care_groups(*)')
      .eq('user_id', req.user.id);
    if (memberErr) return sendSupabaseError(res, memberErr);

    const memberGroups = (memberRows || [])
      .map((row) => row.care_groups)
      .filter(Boolean);

    res.json({ ownedGroups: ownGroups, memberGroups });
  })
);

// ----------------------------------------------------------
// GET /api/care-groups/:groupId/members
// グループメンバー一覧（患者・関係者のみ閲覧可、RLSが保証）
// ----------------------------------------------------------
router.get(
  '/:groupId/members',
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase
      .from('care_group_members')
      .select('*, profiles(name, phone)')
      .eq('group_id', req.params.groupId);

    if (error) return sendSupabaseError(res, error);
    res.json({ members: data });
  })
);

// ----------------------------------------------------------
// POST /api/care-groups/join
// 家族・介護者が招待コードでグループに参加
// body: { invite_code, relation, can_view_video }
// ----------------------------------------------------------
router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const { invite_code, relation, can_view_video } = req.body;
    if (!invite_code) return res.status(400).json({ error: '招待コードを入力してください。' });

    // 招待コードからグループを特定する。
    // 通常のRLSでは未参加ユーザーはcare_groupsをSELECTできないため、
    // invite_code完全一致のときのみ最小限の情報を返すRPC関数を使用する
    // （0002_invite_code_rls.sql で定義）。
    const { data: groupRows, error: groupErr } = await req.supabase.rpc('find_group_by_invite_code', {
      p_invite_code: invite_code,
    });

    if (groupErr) return sendSupabaseError(res, groupErr);
    const group = groupRows?.[0];
    if (!group) return res.status(404).json({ error: '招待コードが見つかりません。コードをご確認ください。' });

    const { data, error } = await req.supabase
      .from('care_group_members')
      .insert({
        group_id: group.id,
        user_id: req.user.id,
        relation: relation || null,
        can_view_video: can_view_video !== undefined ? can_view_video : true,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'すでにこのグループに参加しています。' });
      }
      return sendSupabaseError(res, error, 'グループへの参加に失敗しました。');
    }

    res.status(201).json({ membership: data, group });
  })
);

module.exports = router;
