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
    data: { logId: payload.logId, type: payload.type },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const targetUrl = 'home.html';
      const existing = clientsArr.find((c) => c.url.includes(targetUrl));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
