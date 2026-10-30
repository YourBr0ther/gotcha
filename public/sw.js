/*
 * Gotcha service worker.
 *
 * Cache names carry the build version from the registration URL
 * (/sw.js?v=<build id>), so a redeploy gets fresh caches and the old ones
 * are dropped on activate. The shell (/_next/static, fonts, icons) is
 * served stale-while-revalidate so a stale chunk never outlives the next
 * visit. The extracted asset bundle under /api/assets/* is immutable by
 * URL (it carries a content hash) and is cached first. Every other /api/*
 * request goes to the network and is never stored: live state must not
 * come from a cache. Navigations are network first with the cached page
 * as the offline fallback.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `gotcha-shell-${VERSION}`;
const ASSET_CACHE = "gotcha-assets-v1";
const SHELL = ["/", "/party", "/pc", "/store", "/games", "/more", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];
const LOCAL = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  if (LOCAL) {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isAssetBundle(url) {
  return url.pathname.startsWith("/api/assets/");
}

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isShellAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/bg/") ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || refresh;
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) || (await cache.match("/")) || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || LOCAL) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isAssetBundle(url)) {
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }
  if (isApi(url)) return;
  if (isShellAsset(url)) {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(SHELL_CACHE, request));
  }
});
