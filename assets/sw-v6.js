"use strict";

const CACHE_PREFIX = "qq-dsh-console-static-";
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const staticPaths = [
  `${scopePath}/assets/htmx-2.0.10.min.js`,
  `${scopePath}/assets/htmx-ext-sse-2.2.4.js`,
  `${scopePath}/assets/console-v5.css`,
  `${scopePath}/assets/geist-latin-wght-normal-5.3.0.woff2`,
  `${scopePath}/assets/geist-latin-wght-italic-5.3.0.woff2`,
  `${scopePath}/assets/browser-v3.js`,
  `${scopePath}/assets/icon-v1-192.png`,
  `${scopePath}/assets/icon-v1-512.png`,
  `${scopePath}/assets/offline-v5.html`,
];
const staticPathSet = new Set(staticPaths);
const offlinePath = `${scopePath}/assets/offline-v5.html`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(staticPaths)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(offlinePath);
        return shell ?? Response.error();
      }),
    );
    return;
  }

  if (!staticPathSet.has(url.pathname)) return;
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((cached) => cached ?? fetch(request)),
  );
});
