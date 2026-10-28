// オフラインでも使えるようにアプリ本体をキャッシュする（データ自体は IndexedDB）
// アプリを更新したら VERSION を上げる
const VERSION = 'v2';
const CACHE = `ap-study-cards-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/util.js',
  'js/db.js',
  'js/srs.js',
  'js/questions.js',
  'js/store.js',
  'js/components.js',
  'js/views.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// ネットワーク優先・失敗したらキャッシュ（更新がすぐ反映され、オフラインでも動く）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
