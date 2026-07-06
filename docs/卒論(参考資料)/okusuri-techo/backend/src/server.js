// ============================================================
//  電子お薬手帳 Webアプリ — バックエンドサーバー (Express)
// ============================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const careGroupRoutes = require('./routes/careGroups');
const medicationRoutes = require('./routes/medications');
const scheduleRoutes = require('./routes/schedules');
const logRoutes = require('./routes/logs');
const pushRoutes = require('./routes/push');
const { startReminderCron } = require('./services/reminderCron');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

// ---- ミドルウェア ----
app.use(helmet());
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- ヘルスチェック ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- APIルート ----
app.use('/api/auth', authRoutes);
app.use('/api/care-groups', careGroupRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/push', pushRoutes);

// ---- 404ハンドラ ----
app.use((req, res) => {
  res.status(404).json({ error: 'エンドポイントが見つかりません。' });
});

// ---- グローバルエラーハンドラ ----
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
});

app.listen(PORT, () => {
  console.log(`[server] 電子お薬手帳バックエンドが起動しました: http://localhost:${PORT}`);
  // 服薬リマインダーのcronジョブを起動（本番運用時は別プロセス/ワーカー分離も検討）
  startReminderCron();
});
