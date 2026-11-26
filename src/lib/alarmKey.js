// ============================================================
//  端末のアラーム用の鍵（ネイティブ版）
//
//  ネイティブ版の端末のアラーム（Java）は、アプリの画面を開かなくても鳴る。
//  アカウントが消されたあとに鳴り続けないよう、鳴らす前などに、端末から
//  「このアカウントはまだあるか」をサーバーへ確かめる（POST /api/auth/alarm-status）。
//
//  そのための鍵を、ログイン中にアプリの画面が受け取り（POST /api/auth/alarm-key）、端末に保存する。
//  ログインのトークン（約1時間で切れる・使うたびに入れ替わる）とは別にするのは、
//  ログインが切れていても、アカウントがあるかどうかは確かめられるようにするため
//  （ログインが切れただけでアラームを止めると、飲み忘れにつながる）。
//
//  鍵は「v1.<ユーザーID>.<署名>」の形。署名はサーバーだけが知る値（service_role キー）から作るので、
//  DB に保存しなくても、サーバーが発行した鍵かどうかを確かめられる。
//  この鍵でできるのは「アカウントがあるか」を確かめることだけで、お薬などの情報は読めない。
// ============================================================
const crypto = require('crypto');

const VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 署名に使う秘密の値。service_role キーをそのまま使わず、用途の名前と組み合わせて別の値にする
function secret() {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base) return null;
  return crypto.createHmac('sha256', base).update('medi-watch:alarm-device-key').digest();
}

function sign(userId) {
  const s = secret();
  if (!s) return null;
  return crypto.createHmac('sha256', s).update(`${VERSION}.${userId}`).digest('base64url');
}

// 鍵を作る。作れない（サーバーの設定不足）ときは null
function issueAlarmKey(userId) {
  const signature = sign(userId);
  return signature ? `${VERSION}.${userId}.${signature}` : null;
}

// 鍵を確かめ、正しければユーザー ID を返す。正しくなければ null
function verifyAlarmKey(key) {
  const parts = String(key ?? '').split('.');
  if (parts.length !== 3 || parts[0] !== VERSION || !UUID_PATTERN.test(parts[1])) return null;
  const expected = sign(parts[1]);
  if (!expected) return null;
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return parts[1];
}

module.exports = { issueAlarmKey, verifyAlarmKey };
