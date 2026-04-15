// EduIntellect Service Worker — Cache-first for static, network-first for API
const CACHE_NAME = "eduintellect-v1";
const STATIC_ASSETS = ["/", "/favicon.ico", "/icons/icon.svg"];

// Install — pre-cache shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clear old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for navigation & API, cache-first for assets
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET and cross-origin
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Firebase / API calls — network only
  if (url.pathname.startsWith("/api") || url.hostname.includes("firebase")) return;

  // Navigation requests — network first, fall back to cached index
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/"))
    );
    return;
  }

  // Static assets — cache first, then network
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        // Cache successful responses for assets
        if (response.ok && (url.pathname.match(/\.(js|css|svg|png|ico|woff2?)$/) || url.pathname === "/")) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});