// ============================================================
//  ケアグループ（見守り）関連 API
//
//  1つのアカウントで次の両方を行える。
//    ・見守られる側: 自分のグループ（招待コード）を作り、見守る人を管理する
//    ・見守る側    : 家族の招待コードを入力して、その人を見守る
//  care_groups は「見守られる人1人につき1つ」（0004で一意制約を追加）。
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');

const router = express.Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 自分が見守られる側として持っているグループ（無ければ null）
async function findOwnGroup(supabase, userId) {
  const { data, error } = await supabase
    .from('care_groups')
    .select('*')
    .eq('patient_id', userId)
    .maybeSingle();
  return { data, error };
}

// ----------------------------------------------------------
// GET /api/care-groups/mine
// 自分のグループ（招待コード）を取得。未作成なら group: null
// ----------------------------------------------------------
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const { data, error } = await findOwnGroup(req.supabase, req.user.id);
    if (error) return sendSupabaseError(res, error);
    res.json({ group: data || null });
  })
);

// ----------------------------------------------------------
// POST /api/care-groups
// 自分のグループを作成（既にあれば、それをそのまま返す）
// body: { name }（省略時は「〇〇さんの見守り」）
// ----------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const existing = await findOwnGroup(req.supabase, req.user.id);
    if (existing.error) return sendSupabaseError(res, existing.error);
    if (existing.data) return res.status(200).json({ group: existing.data });

    const name = String(req.body?.name || '').trim() || '見守り';

    const { data, error } = await req.supabase
      .from('care_groups')
      .insert({ patient_id: req.user.id, name })
      .select()
      .single();

    if (error) {
      // 同時に2回押された等で一意制約に当たった場合は、作成済みのものを返す
      if (error.code === '23505') {
        const again = await findOwnGroup(req.supabase, req.user.id);
        if (again.data) return res.status(200).json({ group: again.data });
      }
      return sendSupabaseError(res, error, '招待コードの発行に失敗しました。');
    }
    res.status(201).json({ group: data });
  })
);

// ----------------------------------------------------------
// GET /api/care-groups
// 互換用: 自分のグループと、参加しているグループ
// ----------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { data: ownGroups, error: ownErr } = await req.supabase
      .from('care_groups')
      .select('*')
      .eq('patient_id', req.user.id);
    if (ownErr) return sendSupabaseError(res, ownErr);

    const { data: memberRows, error: memberErr } = await req.supabase
      .from('care_group_members')
      .select('group_id, relation, can_view_video, care_groups(*)')
      .eq('user_id', req.user.id);
    if (memberErr) return sendSupabaseError(res, memberErr);

    const memberGroups = (memberRows || []).map((row) => row.care_groups).filter(Boolean);
    res.json({ ownedGroups: ownGroups, memberGroups });
  })
);

// ----------------------------------------------------------
// GET /api/care-groups/watchers
// 自分を見守っている人の一覧（名前・映像閲覧権限）
// ----------------------------------------------------------
router.get(
  '/watchers',
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase.rpc('list_my_watchers');
    if (error) return sendSupabaseError(res, error, '見守っている方の一覧を取得できませんでした。');
    res.json({ watchers: data || [] });
  })
);

// ----------------------------------------------------------
// GET /api/care-groups/watching
// 自分が見守っている人の一覧（ホーム画面の切り替えにも使用）
// ----------------------------------------------------------
router.get(
  '/watching',
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase.rpc('list_my_watching');
    if (error) return sendSupabaseError(res, error, '見守り中のご家族を取得できませんでした。');
    res.json({ watching: data || [] });
  })
);

// ----------------------------------------------------------
// POST /api/care-groups/join
// 招待コードで家族を見守り始める
// body: { invite_code, relation }
//   ※ 映像閲覧権限は見守られる側が決めるため、ここでは受け付けない
//     （DBの既定値で作成し、変更は PATCH /members/:memberId で行う）
// ----------------------------------------------------------
router.post(
  '/join',
  asyncHandler(async (req, res) => {
    const invite_code = String(req.body?.invite_code || '').trim();
    const relation = String(req.body?.relation || '').trim().slice(0, 20);
    if (!invite_code) return res.status(400).json({ error: '招待コードを入力してください。' });

    // 未参加ユーザーは care_groups を SELECT できないため、
    // 招待コード完全一致時のみ最小限の情報を返すRPCを使う（0002で定義）
    const { data: groupRows, error: groupErr } = await req.supabase.rpc('find_group_by_invite_code', {
      p_invite_code: invite_code,
    });
    if (groupErr) return sendSupabaseError(res, groupErr);

    const group = groupRows?.[0];
    if (!group) {
      return res.status(404).json({ error: '招待コードが見つかりません。コードをご確認ください。' });
    }

    // 自分の招待コードを入力した場合（DBのトリガーでも防止している）
    if (group.patient_id === req.user.id) {
      return res.status(400).json({
        code: 'SELF_JOIN',
        error: 'これはあなた自身の招待コードです。見守ってほしいご家族にお伝えください。',
      });
    }

    const { data, error } = await req.supabase
      .from('care_group_members')
      .insert({ group_id: group.id, user_id: req.user.id, relation: relation || null })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'すでにこのご家族を見守っています。' });
      }
      return sendSupabaseError(res, error, '見守りの開始に失敗しました。');
    }

    res.status(201).json({ membership: data, group: { id: group.id, patient_id: group.patient_id } });
  })
);

// ----------------------------------------------------------
// PATCH /api/care-groups/members/:memberId
// 映像閲覧権限の切り替え（見守られる側だけが実行できる）
// body: { can_view_video: boolean }
// ----------------------------------------------------------
router.patch(
  '/members/:memberId',
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    if (!UUID_RE.test(memberId)) return res.status(400).json({ error: '対象が正しくありません。' });

    const canView = req.body?.can_view_video;
    if (typeof canView !== 'boolean') {
      return res.status(400).json({ error: '映像閲覧の設定（can_view_video）を指定してください。' });
    }

    const { data: updated, error } = await req.supabase.rpc('set_member_video_permission', {
      p_member_id: memberId,
      p_can_view: canView,
    });
    if (error) return sendSupabaseError(res, error, '設定の変更に失敗しました。');
    if (!updated) {
      return res.status(404).json({ error: '対象の方が見つからないか、変更する権限がありません。' });
    }
    res.json({ member_id: memberId, can_view_video: canView });
  })
);

// ----------------------------------------------------------
// DELETE /api/care-groups/members/:memberId
// 見守りの解除
//   ・見守っている本人 → 見守りをやめる
//   ・見守られている本人 → その人の見守りを解除する
// （どちらに当たるかはRLSが判定。該当しなければ0件削除）
// ----------------------------------------------------------
router.delete(
  '/members/:memberId',
  asyncHandler(async (req, res) => {
    const { memberId } = req.params;
    if (!UUID_RE.test(memberId)) return res.status(400).json({ error: '対象が正しくありません。' });

    const { data, error } = await req.supabase
      .from('care_group_members')
      .delete()
      .eq('id', memberId)
      .select('id');

    if (error) return sendSupabaseError(res, error, '見守りの解除に失敗しました。');
    if (!data || data.length === 0) {
      return res.status(404).json({ error: '対象の見守りが見つからないか、解除する権限がありません。' });
    }
    res.json({ removed: memberId });
  })
);

module.exports = router;
