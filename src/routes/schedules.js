// ============================================================
//  服薬スケジュール（medication_schedules）関連 API
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------
// GET /api/schedules?patient_id=xxx
// 当日の服薬スケジュール一覧（曜日でフィルタ）
// ----------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const patientId = req.query.patient_id || req.user.id;

    const { data, error } = await req.supabase
      .from('medication_schedules')
      .select('*, medications(name, dosage, unit, notes)')
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .order('scheduled_time', { ascending: true });

    if (error) return sendSupabaseError(res, error, 'スケジュールの取得に失敗しました。');
    res.json({ schedules: data });
  })
);

// ----------------------------------------------------------
// POST /api/schedules
// body: { medication_id, scheduled_time, days_of_week, meal_timing, reminder_minutes }
// ----------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { medication_id, scheduled_time, days_of_week, meal_timing, reminder_minutes } = req.body;
    if (!medication_id || !scheduled_time) {
      return res.status(400).json({ error: '薬とスケジュール時刻は必須です。' });
    }

    const { data, error } = await req.supabase
      .from('medication_schedules')
      .insert({
        medication_id,
        patient_id: req.user.id,
        scheduled_time,
        days_of_week: days_of_week || [0, 1, 2, 3, 4, 5, 6],
        meal_timing: meal_timing || 'after',
        reminder_minutes: reminder_minutes ?? 5,
      })
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, 'スケジュールの登録に失敗しました。');
    res.status(201).json({ schedule: data });
  })
);

// ----------------------------------------------------------
// PATCH /api/schedules/:id
// ----------------------------------------------------------
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const allowed = ['scheduled_time', 'days_of_week', 'meal_timing', 'reminder_minutes', 'is_active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await req.supabase
      .from('medication_schedules')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, 'スケジュールの更新に失敗しました。');
    res.json({ schedule: data });
  })
);

// ----------------------------------------------------------
// DELETE /api/schedules/:id
// ----------------------------------------------------------
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase.from('medication_schedules').delete().eq('id', req.params.id);
    if (error) return sendSupabaseError(res, error, 'スケジュールの削除に失敗しました。');
    res.json({ message: '削除しました。' });
  })
);

module.exports = router;
