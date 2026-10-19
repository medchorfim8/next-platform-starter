// عامل الخدمة: يحفظ واجهة التطبيقة لتفتح بسرعة وحتى بدون شبكة؛ المعطيات تُجلب دائماً من الخادم.
const CACHE = 'otlati-v3';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // طلبات قاعدة البيانات لا تُخزَّن
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
