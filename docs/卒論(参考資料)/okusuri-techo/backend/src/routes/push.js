// ============================================================
//  プッシュ通知サブスクリプション関連 API
// ============================================================
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, sendSupabaseError } = require('../lib/utils');
const { VAPID_PUBLIC_KEY } = require('../services/notificationService');

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

module.exports = router;
