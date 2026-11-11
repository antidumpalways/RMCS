// Service worker RCMS: hanya menyimpan file statis (JS/CSS/ikon) agar buka aplikasi cepat.
// Halaman, API, dan data TIDAK di-cache supaya stok/harga selalu terbaru.
const CACHE = 'rcms-static-v1';
const PRECACHE = ['/icon.svg', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.json';
  if (!isStatic) return; // halaman & API selalu ke jaringan

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
