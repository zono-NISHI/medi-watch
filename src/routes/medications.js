// ============================================================
//  薬情報（medications）関連 API
//  QRコード読み取り登録・手動登録・編集・削除
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');
const { parseJahisQr } = require('../services/jahisParser');
const { syncTodayLog } = require('../lib/scheduleLogs');

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------
// GET /api/medications
// 自分（患者）の薬一覧、または閲覧権限のある患者の薬一覧
// 削除した薬（is_active = false）は出さない
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
      .eq('is_active', true)
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
      // cron を待たずに、今日の分を「記録」タブへすぐ出す
      for (const schedule of insertedSchedules) await syncTodayLog(req.supabase, schedule);
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
// body: { name, dosage, unit, notes, start_date, end_date, is_active,
//         schedules?: [{ id?, scheduled_time, meal_timing, days_of_week?, reminder_minutes? }] }
// schedules を渡すと、服薬スケジュールをその内容にそろえる
//   id あり → 時刻・食事との関係を更新 ／ id なし → 追加 ／ 渡されなかったもの → 停止
// 外したスケジュールは削除せず停止（is_active = false）にする。削除すると
// それまでの服薬記録まで消えてしまうため（medication_logs は ON DELETE CASCADE）。
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
    if (!Array.isArray(req.body.schedules)) return res.json({ medication: data });

    const { data: current, error: curErr } = await req.supabase
      .from('medication_schedules')
      .select('*')
      .eq('medication_id', data.id)
      .eq('is_active', true);
    if (curErr) return sendSupabaseError(res, curErr, 'スケジュールの取得に失敗しました。');

    const changed = []; // 今日の記録をそろえ直すスケジュール
    const keepIds = new Set(req.body.schedules.filter((s) => s.id).map((s) => s.id));

    const removedIds = current.filter((c) => !keepIds.has(c.id)).map((c) => c.id);
    if (removedIds.length > 0) {
      const { data: stopped, error: stopErr } = await req.supabase
        .from('medication_schedules')
        .update({ is_active: false })
        .in('id', removedIds)
        .select();
      if (stopErr) return sendSupabaseError(res, stopErr, 'スケジュールの削除に失敗しました。');
      changed.push(...stopped);
    }

    for (const s of req.body.schedules) {
      if (s.id) {
        const before = current.find((c) => c.id === s.id);
        if (!before) continue;
        // 変わっていない行は更新しない（updated_at を動かさないため。cron の判定に使う）
        const timeChanged = String(before.scheduled_time).slice(0, 5) !== String(s.scheduled_time).slice(0, 5);
        const mealChanged = !!s.meal_timing && before.meal_timing !== s.meal_timing;
        if (!timeChanged && !mealChanged) continue;

        const { data: updated, error: updErr } = await req.supabase
          .from('medication_schedules')
          .update({ scheduled_time: s.scheduled_time, meal_timing: s.meal_timing || before.meal_timing })
          .eq('id', s.id)
          .select()
          .single();
        if (updErr) return sendSupabaseError(res, updErr, 'スケジュールの更新に失敗しました。');
        if (timeChanged) changed.push(updated);
      } else {
        const { data: inserted, error: insErr } = await req.supabase
          .from('medication_schedules')
          .insert({
            medication_id: data.id,
            patient_id: data.patient_id,
            scheduled_time: s.scheduled_time,
            days_of_week: s.days_of_week || [0, 1, 2, 3, 4, 5, 6],
            meal_timing: s.meal_timing || 'after',
            reminder_minutes: s.reminder_minutes ?? 5,
          })
          .select()
          .single();
        if (insErr) return sendSupabaseError(res, insErr, 'スケジュールの登録に失敗しました。');
        changed.push(inserted);
      }
    }

    for (const schedule of changed) await syncTodayLog(req.supabase, schedule);

    const { data: schedules, error: listErr } = await req.supabase
      .from('medication_schedules')
      .select('*')
      .eq('medication_id', data.id)
      .eq('is_active', true)
      .order('scheduled_time', { ascending: true });
    if (listErr) return sendSupabaseError(res, listErr, 'スケジュールの取得に失敗しました。');

    res.json({ medication: { ...data, medication_schedules: schedules } });
  })
);

// ----------------------------------------------------------
// DELETE /api/medications/:id
// 行は消さずに停止（is_active = false）にする。行を消すとスケジュール経由で
// 服薬記録まで消えてしまうため（ON DELETE CASCADE）。
// これからの「未記録」だけを消し、服薬済み・スキップ・飲み忘れ（予定時刻を過ぎた未記録）は履歴として残す。
// ----------------------------------------------------------
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { error } = await req.supabase
      .from('medications')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .single();
    if (error) return sendSupabaseError(res, error, '薬の削除に失敗しました。');

    const { data: stopped, error: stopErr } = await req.supabase
      .from('medication_schedules')
      .update({ is_active: false })
      .eq('medication_id', req.params.id)
      .select('id');
    if (stopErr) return sendSupabaseError(res, stopErr, 'スケジュールの停止に失敗しました。');

    if (stopped.length > 0) {
      const { error: logErr } = await req.supabase
        .from('medication_logs')
        .delete()
        .in('schedule_id', stopped.map((s) => s.id))
        .eq('status', 'pending')
        .gt('scheduled_at', new Date().toISOString());
      if (logErr) return sendSupabaseError(res, logErr, '未記録の予定の削除に失敗しました。');
    }

    res.json({ message: '削除しました。' });
  })
);

module.exports = router;
