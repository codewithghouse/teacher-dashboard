/**
 * Edullent Teacher — Service Worker v2
 *
 * Caching strategy:
 *   Static assets (JS/CSS/HTML/fonts/images) -> Cache-First   (precached on install)
 *   Firebase Firestore / Auth APIs           -> Network-First (8 s timeout -> cache)
 *   Firebase Storage                         -> Cache-First   (long TTL)
 *   Everything else                          -> Network-First
 *
 * Native-app extras:
 *   - Offline fallback HTML (no white screen / broken page)
 *   - SKIP_WAITING on message (instant update)
 *   - Push notifications ready
 */

const CACHE_VERSION  = 'v2';
const STATIC_CACHE   = `edullent-teacher-static-${CACHE_VERSION}`;
const API_CACHE      = `edullent-teacher-api-${CACHE_VERSION}`;
const STORAGE_CACHE  = `edullent-teacher-storage-${CACHE_VERSION}`;

// App shell — cached on install so first paint is always instant
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-32x32.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// ── Offline fallback HTML ────────────────────────────────────────────────────
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"/>
  <meta name="theme-color" content="#1e3272"/>
  <title>Edullent Teacher — Offline</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overscroll-behavior:none;-webkit-tap-highlight-color:transparent}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;
         background:#1e3272;color:#fff;font-family:system-ui,sans-serif;padding:2rem;text-align:center}
    .icon{width:80px;height:80px;border-radius:24px;background:rgba(255,255,255,.12);
          display:flex;align-items:center;justify-content:center;margin-bottom:1.5rem;font-size:2.5rem}
    h1{font-size:1.5rem;font-weight:700;margin-bottom:.5rem}
    p{font-size:.95rem;color:rgba(255,255,255,.65);margin-bottom:2rem;max-width:280px}
    button{background:#fff;color:#1e3272;border:none;border-radius:999px;
           padding:.75rem 2rem;font-size:1rem;font-weight:600;cursor:pointer;
           -webkit-tap-highlight-color:transparent}
  </style>
</head>
<body>
  <div class="icon">🎓</div>
  <h1>You're Offline</h1>
  <p>Please check your internet connection and try again.</p>
  <button onclick="location.reload()">Try Again</button>
</body>
</html>`;

// ── Install: precache shell ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  const VALID = [STATIC_CACHE, API_CACHE, STORAGE_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !VALID.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function isStaticAsset(url) {
  return /\.(js|css|woff2?|ttf|otf|ico|png|jpg|jpeg|svg|webp|gif)(\?.*)?$/.test(url.pathname);
}
function isFirebaseAPI(url) {
  return url.hostname.includes('firestore.googleapis.com') ||
         url.hostname.includes('identitytoolkit.googleapis.com') ||
         url.hostname.includes('securetoken.googleapis.com');
}
function isFirebaseStorage(url) {
  return url.hostname.includes('firebasestorage.googleapis.com');
}

/** Network-first with timeout; falls back to cache, then offline response */
async function networkFirst(request, cacheName, timeoutMs = 8000) {
  const cache = await caches.open(cacheName);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** Cache-first; fetches and stores on miss */
async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const req = event.request;

  // Skip non-GET and chrome-extension requests
  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.protocol === 'data:') return;

  // Never intercept Firebase auth handler / iframe paths — they need fresh
  // cookies + same-origin treatment for OAuth redirect (esp. iOS PWA).
  if (url.pathname.startsWith('/__/auth') ||
      url.pathname.startsWith('/__/firebase')) {
    return;
  }

  // Never intercept the teacher's serverless API routes (send-email, _auth) —
  // they must be network-fresh and not be served from a stale cache.
  if (url.pathname.startsWith('/api/')) return;

  // SPA navigation — any HTML page request (deep link refresh, share-link open).
  // Always fall back to cached app shell so the React router can resolve the route.
  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isNavigation && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) return fresh;
        throw new Error(`nav status ${fresh && fresh.status}`);
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('/index.html') || await cache.match('/');
        if (cached) return cached;
        return new Response(OFFLINE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  if (isFirebaseAPI(url)) {
    event.respondWith(networkFirst(req, API_CACHE, 8000));
  } else if (isFirebaseStorage(url)) {
    event.respondWith(cacheFirst(req, STORAGE_CACHE));
  } else if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, API_CACHE));
  } else {
    event.respondWith(networkFirst(req, API_CACHE));
  }
});

// ── Push notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const { title = 'Edullent Teacher', body = '', icon = '/icons/icon-192x192.png', url = '/' } =
    event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icons/icon-96x96.png',
      data: { url },
      vibrate: [100, 50, 100],
    })
  );
});

// ── Skip waiting (triggered by PWAUpdatePrompt) ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
