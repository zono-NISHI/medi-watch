// ============================================================
//  服薬記録（medication_logs）関連 API
//  服薬の実施記録、服薬映像のアップロード、家族への通知トリガー
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');
const { notifyCareGroup } = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

// ----------------------------------------------------------
// GET /api/logs?patient_id=xxx&date=YYYY-MM-DD&status=pending
// 服薬記録の一覧取得（日付・ステータスで絞り込み可）
// ----------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const patientId = req.query.patient_id || req.user.id;
    const { date, status } = req.query;

    let query = req.supabase
      .from('medication_logs')
      .select('*, medication_schedules(scheduled_time, meal_timing, medications(name, dosage, unit))')
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false });

    if (date) {
      const start = `${date}T00:00:00`;
      const end = `${date}T23:59:59`;
      query = query.gte('scheduled_at', start).lte('scheduled_at', end);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) return sendSupabaseError(res, error, '服薬記録の取得に失敗しました。');
    res.json({ logs: data });
  })
);

// ----------------------------------------------------------
// POST /api/logs
// スケジュールに基づく服薬記録の手動作成（通常はcronジョブが自動生成する想定）
// body: { schedule_id, scheduled_at }
// ----------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { schedule_id, scheduled_at } = req.body;
    if (!schedule_id || !scheduled_at) {
      return res.status(400).json({ error: 'スケジュールIDと予定時刻は必須です。' });
    }

    const { data, error } = await req.supabase
      .from('medication_logs')
      .insert({
        schedule_id,
        patient_id: req.user.id,
        scheduled_at,
        status: 'pending',
      })
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, '服薬記録の作成に失敗しました。');
    res.status(201).json({ log: data });
  })
);

// ----------------------------------------------------------
// PATCH /api/logs/:id/take
// 「飲んだ」操作。video_url が渡された場合は映像記録とセットで保存し、
// ケアグループメンバーへ通知を送る。
// body: { video_url, notes }
// ----------------------------------------------------------
router.patch(
  '/:id/take',
  asyncHandler(async (req, res) => {
    const { video_url, notes } = req.body;

    const { data: log, error } = await req.supabase
      .from('medication_logs')
      .update({
        status: 'taken',
        taken_at: new Date().toISOString(),
        video_url: video_url || null,
        notes: notes || null,
      })
      .eq('id', req.params.id)
      .select('*, medications:medication_schedules(medications(name))')
      .single();

    if (error) return sendSupabaseError(res, error, '服薬記録の更新に失敗しました。');

    // 家族・介護者へ通知（失敗してもメイン処理は成功扱いにする）
    notifyCareGroup({
      patientId: req.user.id,
      logId: log.id,
      type: video_url ? 'video_recorded' : 'medication_taken',
    }).catch((e) => console.error('[notify] 服薬完了通知の送信に失敗:', e));

    res.json({ log });
  })
);

// ----------------------------------------------------------
// PATCH /api/logs/:id/skip
// 「スキップ」操作（家族への飲み忘れ通知トリガーにも使用）
// ----------------------------------------------------------
router.patch(
  '/:id/skip',
  asyncHandler(async (req, res) => {
    const { notes } = req.body;

    const { data: log, error } = await req.supabase
      .from('medication_logs')
      .update({ status: 'skipped', notes: notes || null })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, '服薬記録の更新に失敗しました。');

    notifyCareGroup({
      patientId: req.user.id,
      logId: log.id,
      type: 'medication_missed',
    }).catch((e) => console.error('[notify] 飲み忘れ通知の送信に失敗:', e));

    res.json({ log });
  })
);

// ----------------------------------------------------------
// POST /api/logs/:id/video-upload-url
// Supabase Storage への直接アップロード用に署名付きアップロードURLを発行
// パス規則: {patient_id}/{log_id}.mp4
// ----------------------------------------------------------
router.post(
  '/:id/video-upload-url',
  asyncHandler(async (req, res) => {
    const path = `${req.user.id}/${req.params.id}.mp4`;

    const { data, error } = await req.supabase.storage
      .from('medication-videos')
      .createSignedUploadUrl(path);

    if (error) return sendSupabaseError(res, error, 'アップロードURLの発行に失敗しました。');

    res.json({ signedUrl: data.signedUrl, path: data.path, token: data.token });
  })
);

// ----------------------------------------------------------
// GET /api/logs/:id/video-url
// 映像の署名付き閲覧URLを発行（1時間有効）
// ----------------------------------------------------------
router.get(
  '/:id/video-url',
  asyncHandler(async (req, res) => {
    const { data: log, error: logErr } = await req.supabase
      .from('medication_logs')
      .select('patient_id, video_url')
      .eq('id', req.params.id)
      .single();

    if (logErr) return sendSupabaseError(res, logErr, '服薬記録が見つかりません。');
    if (!log.video_url) return res.status(404).json({ error: 'この記録に映像はありません。' });

    const path = `${log.patient_id}/${req.params.id}.mp4`;
    const { data, error } = await req.supabase.storage
      .from('medication-videos')
      .createSignedUrl(path, 3600);

    if (error) return sendSupabaseError(res, error, '映像URLの発行に失敗しました。');
    res.json({ url: data.signedUrl });
  })
);

module.exports = router;
