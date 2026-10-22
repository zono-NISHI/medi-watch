// ============================================================
//  プッシュ通知サブスクリプション関連 API
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');
const webpush = require('web-push');
const { supabaseAdmin } = require('../supabase/supabase');
const { VAPID_PUBLIC_KEY, vapidConfigured } = require('../services/notificationService');

const router = express.Router();

// ----------------------------------------------------------
// GET /api/push/vapid-public-key
// フロントエンドがブラウザのPush APIを購読する際に必要な公開鍵
// ----------------------------------------------------------
router.get('/vapid-public-key', (req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'プッシュ通知が設定されていません。' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

router.use(requireAuth);

// ----------------------------------------------------------
// POST /api/push/subscribe
// body: { endpoint, keys: { p256dh, auth }, device_name }
// ----------------------------------------------------------
router.post(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { endpoint, keys, device_name } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'プッシュ購読情報が不正です。' });
    }

    // 1つの端末（endpoint）は、最後にログインした1人の利用者だけに結び付ける。
    // 同じブラウザで以前ログインしていた別の利用者の登録が残っていると、
    // その人宛ての通知（服薬リマインドなど）がこの端末に届いてしまうため。
    // 他人の行は RLS で消せないので、ここだけ supabaseAdmin を使う。
    const { error: cleanupErr } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .neq('user_id', req.user.id);
    if (cleanupErr) console.error('[push/subscribe] 他の利用者の登録の削除に失敗:', cleanupErr);

    const { data, error } = await req.supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: req.user.id,
          endpoint,
          p256dh: keys.p256dh,
          auth_key: keys.auth,
          device_name: device_name || null,
        },
        { onConflict: 'user_id,endpoint' }
      )
      .select()
      .single();

    if (error) return sendSupabaseError(res, error, '通知登録に失敗しました。');
    res.status(201).json({ subscription: data });
  })
);

// ----------------------------------------------------------
// DELETE /api/push/subscribe
// body: { endpoint }
// ----------------------------------------------------------
router.delete(
  '/subscribe',
  asyncHandler(async (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpointが必要です。' });

    const { error } = await req.supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', req.user.id)
      .eq('endpoint', endpoint);

    if (error) return sendSupabaseError(res, error, '通知解除に失敗しました。');
    res.json({ message: '通知を解除しました。' });
  })
);

// ----------------------------------------------------------
// GET /api/push/status
// 通知が届かないときの原因の切り分け用。ログイン中の本人の情報だけを返す。
// ----------------------------------------------------------
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = jst.toISOString().slice(0, 10);

    const { data: subs, error: subErr } = await req.supabase
      .from('push_subscriptions')
      .select('id, device_name, created_at')
      .eq('user_id', req.user.id);
    if (subErr) return sendSupabaseError(res, subErr, '端末情報の取得に失敗しました。');

    const { data: schedules } = await req.supabase
      .from('medication_schedules')
      .select('id, scheduled_time, days_of_week, reminder_minutes, is_active, medications(name)')
      .eq('patient_id', req.user.id);

    const { data: logs } = await req.supabase
      .from('medication_logs')
      .select('id, schedule_id, scheduled_at, status')
      .eq('patient_id', req.user.id)
      .gte('scheduled_at', `${today}T00:00:00+09:00`)
      .lte('scheduled_at', `${today}T23:59:59+09:00`)
      .order('scheduled_at');

    const toJst = (iso) =>
      new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });

    res.json({
      server_time_jst: toJst(now),
      vapid_configured: vapidConfigured,
      devices: (subs || []).length,
      schedules: (schedules || []).map((s) => ({
        name: s.medications?.name,
        time: s.scheduled_time,
        reminder_minutes: s.reminder_minutes,
        days_of_week: s.days_of_week,
        is_active: s.is_active,
      })),
      today_logs: (logs || []).map((l) => ({ scheduled_at_jst: toJst(l.scheduled_at), status: l.status })),
    });
  })
);

// ----------------------------------------------------------
// POST /api/push/test
// ログイン中の本人の全端末へ、今すぐテスト通知を送る（cron を待たずに配信だけを確認する）
// ----------------------------------------------------------
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    if (!vapidConfigured) {
      return res.status(503).json({ error: 'サーバーに VAPID 鍵が設定されていません。' });
    }
    const { data: subs, error } = await req.supabase
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', req.user.id);
    if (error) return sendSupabaseError(res, error, '端末情報の取得に失敗しました。');
    if (!subs || subs.length === 0) {
      return res.status(400).json({ error: 'この利用者の端末が登録されていません。先に「プッシュ通知を有効にする」を押してください。' });
    }

    const results = await Promise.all(
      subs.map(async (sub) => {
        try {
          const r = await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ title: 'テスト通知', body: 'medi-watch からの通知は正しく届いています。', type: 'test' }),
            { TTL: 60, urgency: 'high' }
          );
          return { ok: true, status: r.statusCode };
        } catch (err) {
          console.error('[push/test] 送信失敗:', err.statusCode, err.body || err.message);
          return { ok: false, status: err.statusCode || null, message: String(err.body || err.message).slice(0, 200) };
        }
      })
    );
    res.json({ sent: results.filter((r) => r.ok).length, total: results.length, results });
  })
);

module.exports = router;
