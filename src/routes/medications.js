// ============================================================
//  薬情報（medications）関連 API
//  QRコード読み取り登録・手動登録・編集・削除
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');
const { parseJahisQr } = require('../services/jahisParser');

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------
// GET /api/medications
// 自分（患者）の薬一覧、または閲覧権限のある患者の薬一覧
// query: ?patient_id=xxx （介護者がグループの患者の薬を見る場合）
// ----------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const patientId = req.query.patient_id || req.user.id;

    const { data, error } = await req.supabase
      .from('medications')
      .select('*, medication_schedules(*)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) return sendSupabaseError(res, error, '薬情報の取得に失敗しました。');
    res.json({ medications: data });
  })
);

// ----------------------------------------------------------
// GET /api/medications/:id
// ----------------------------------------------------------
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { data, error } = await req.supabase
      .from('medications')
      .select('*, medication_schedules(*)')
      .eq('id', req.params.id)
      .single();

    if (error) return sendSupabaseError(res, error, '薬情報が見つかりません。');
    res.json({ medication: data });
  })
);

// ----------------------------------------------------------
// POST /api/medications
// 手動登録
// body: { name, dosage, unit, notes, start_date, end_date,
//         schedules: [{ scheduled_time, days_of_week, meal_timing, reminder_minutes }] }
// ----------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, dosage, unit, notes, start_date, end_date, schedules } = req.body;
    if (!name) return res.status(400).json({ error: '薬の名前は必須です。' });

    const { data: medication, error } = await req.supabase
      .from('medications')
      .insert({
        patient_id: req.user.id,
        name,
        dosage: dosage || null,
        unit: unit || null,
        notes: notes || null,
        start_date: start_date || null,
        end_date: end_date || null,
      })
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, '薬の登録に失敗しました。');

    let insertedSchedules = [];
    if (Array.isArray(schedules) && schedules.length > 0) {
      const rows = schedules.map((s) => ({
        medication_id: medication.id,
        patient_id: req.user.id,
        scheduled_time: s.scheduled_time,
        days_of_week: s.days_of_week || [0, 1, 2, 3, 4, 5, 6],
        meal_timing: s.meal_timing || 'after',
        reminder_minutes: s.reminder_minutes ?? 5,
      }));
      const { data: schedData, error: schedErr } = await req.supabase
        .from('medication_schedules')
        .insert(rows)
        .select();
      if (schedErr) return sendSupabaseError(res, schedErr, 'スケジュールの登録に失敗しました。');
      insertedSchedules = schedData;
    }

    res.status(201).json({ medication: { ...medication, medication_schedules: insertedSchedules } });
  })
);

// ----------------------------------------------------------
// POST /api/medications/scan-qr
// 薬局QRコード（JAHISフォーマット）の生データを解析して登録
// body: { qr_raw_data }
// ----------------------------------------------------------
router.post(
  '/scan-qr',
  asyncHandler(async (req, res) => {
    const { qr_raw_data } = req.body;
    if (!qr_raw_data) return res.status(400).json({ error: 'QRコードのデータが空です。' });

    const parsed = parseJahisQr(qr_raw_data);
    if (!parsed.success) {
      return res.status(422).json({ error: parsed.message || 'QRコードの解析に失敗しました。手動入力をお試しください。' });
    }

    // 解析結果をそのまま登録するのではなく、編集確認用にクライアントへ返す
    res.json({
      preview: parsed.medications, // [{ name, dosage, unit, notes }]
      raw: qr_raw_data,
    });
  })
);

// ----------------------------------------------------------
// POST /api/medications/scan-qr/confirm
// QRプレビュー確認後の一括登録
// body: { medications: [{ name, dosage, unit, notes }], qr_raw_data }
// ----------------------------------------------------------
router.post(
  '/scan-qr/confirm',
  asyncHandler(async (req, res) => {
    const { medications, qr_raw_data } = req.body;
    if (!Array.isArray(medications) || medications.length === 0) {
      return res.status(400).json({ error: '登録する薬がありません。' });
    }

    const rows = medications.map((m) => ({
      patient_id: req.user.id,
      name: m.name,
      dosage: m.dosage || null,
      unit: m.unit || null,
      notes: m.notes || null,
      qr_raw_data: qr_raw_data || null,
    }));

    const { data, error } = await req.supabase.from('medications').insert(rows).select();
    if (error) return sendSupabaseError(res, error, '薬の一括登録に失敗しました。');

    res.status(201).json({ medications: data });
  })
);

// ----------------------------------------------------------
// PATCH /api/medications/:id
// ----------------------------------------------------------
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const allowed = ['name', 'dosage', 'unit', 'notes', 'start_date', 'end_date', 'is_active'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await req.supabase
      .from('medications')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, '薬情報の更新に失敗しました。');
    res.json({ medication: data });
  })
);

// ----------------------------------------------------------
// DELETE /api/medications/:id
// ----------------------------------------------------------
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase.from('medications').delete().eq('id', req.params.id);
    if (error) return sendSupabaseError(res, error, '薬の削除に失敗しました。');
    res.json({ message: '削除しました。' });
  })
);

module.exports = router;
