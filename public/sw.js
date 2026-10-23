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
    data: { logId: payload.logId, type: payload.type, patientId: payload.patientId },
    vibrate: [300, 100, 300, 100, 300],
    tag: payload.logId ? `log-${payload.logId}` : undefined, // 同じ予定の通知は1件にまとめる
    renotify: true,
    requireInteraction: true, // 対応端末（PC 等）では、タップするまで通知を消さない
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // 家族宛ての通知は、その人の服薬状況を表示した状態でホームを開く
  const patientId = event.notification.data?.patientId;
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
