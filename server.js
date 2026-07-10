// ============================================================
//  電子お薬手帳 Webアプリ（medi-watch）
//  エントリポイント（Express サーバー）
//  - public/ をフロントエンドとして静的配信
//  - /api/* をバックエンドAPIとして提供
//  - 服薬リマインダーのcronジョブを起動
// ============================================================
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./src/routes/auth');
const careGroupRoutes = require('./src/routes/careGroups');
const medicationRoutes = require('./src/routes/medications');
const scheduleRoutes = require('./src/routes/schedules');
const logRoutes = require('./src/routes/logs');
const pushRoutes = require('./src/routes/push');
const { startReminderCron } = require('./src/services/reminderCron');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- ミドルウェア ----
// helmet: セキュリティヘッダー付与。
// contentSecurityPolicy は、CDN(jsQR)やGoogle Fonts、カメラ等を使うため、
// 開発時は無効化しておく（本番では適切なCSPを設定することを推奨）。
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---- APIルート ----
// フロントの config.js が API_BASE_URL: '/api' で参照する
app.use('/api/auth', authRoutes);
app.use('/api/care-groups', careGroupRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/push', pushRoutes);

// ヘルスチェック（Renderの死活監視などに利用可能）
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- フロントエンド静的配信 ----
// public/ 以下（HTML・CSS・JS・sw.js・manifest.json・assets）をそのまま配信する。
// ルート( / )にアクセスすると public/index.html が返る。
app.use(express.static(path.join(__dirname, 'public')));

// ---- API用 404ハンドラ ----
// /api/ で存在しないパスへのアクセスにはJSONで404を返す
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'エンドポイントが見つかりません。' });
});

// ---- グローバルエラーハンドラ ----
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'サーバー内部でエラーが発生しました。' });
});

// ---- 起動 ----
app.listen(PORT, () => {
  console.log(`[server] medi-watch が起動しました: http://localhost:${PORT}`);
  // 服薬リマインダーのcronジョブを起動（毎分実行）
  startReminderCron();
});
