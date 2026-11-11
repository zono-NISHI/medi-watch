// ============================================================
//  Service Worker
//  プッシュ通知の受信と表示を行う
// ============================================================

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'お薬手帳からのお知らせ', body: event.data.text() };
  }

  const title = payload.title || 'お薬手帳からのお知らせ';
  const options = {
    body: payload.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    data: { logId: payload.logId, type: payload.type, patientId: payload.patientId, url: payload.url },
    vibrate: [300, 100, 300, 100, 300],
    tag: payload.logId ? `log-${payload.logId}` : undefined, // 同じ予定の通知は1件にまとめる
    renotify: true,
    requireInteraction: true, // 対応端末（PC 等）では、タップするまで通知を消さない
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // 通知に開く画面の指定（url）があればそこを開く（例：見守りの終了 → 見守り画面）。
  // 家族宛ての服薬の通知は、その人の服薬状況を表示した状態でホームを開く
  const data = event.notification.data || {};
  if (data.url) {
    event.waitUntil(self.clients.openWindow(data.url));
    return;
  }
  const patientId = data.patientId;
  const targetUrl = patientId ? `home.html?view=${encodeURIComponent(patientId)}` : 'home.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes('home.html'));
      if (existing) {
        return existing.focus().then((c) => (patientId && c.navigate ? c.navigate(targetUrl) : c));
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
