"use strict";

const CACHE_PREFIX = "qq-static-";
const LEGACY_CACHE_PREFIX = "qq-dsh-console-static-";
const CACHE_NAME = `${CACHE_PREFIX}v16`;
const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const staticPaths = [
  `${scopePath}/assets/htmx-2.0.10.min.js`,
  `${scopePath}/assets/htmx-ext-sse-2.2.4.js`,
  `${scopePath}/assets/console-v8.css`,
  `${scopePath}/assets/console-v9.css`,
  `${scopePath}/assets/console-v10.css`,
  `${scopePath}/assets/console-v11.css`,
  `${scopePath}/assets/console-v12.css`,
  `${scopePath}/assets/console-v13.css`,
  `${scopePath}/assets/console-v14.css`,
  `${scopePath}/assets/console-v15.css`,
  `${scopePath}/assets/console-v16.css`,
  `${scopePath}/assets/geist-latin-wght-normal-5.3.0.woff2`,
  `${scopePath}/assets/geist-latin-wght-italic-5.3.0.woff2`,
  `${scopePath}/assets/browser-v4.js`,
  `${scopePath}/assets/browser-v5.js`,
  `${scopePath}/assets/browser-v6.js`,
  `${scopePath}/assets/browser-v7.js`,
  `${scopePath}/assets/reconnect-v1.js`,
  `${scopePath}/assets/icon-v2-192.png`,
  `${scopePath}/assets/icon-v2-512.png`,
  `${scopePath}/assets/offline-v8.html`,
];
const staticPathSet = new Set(staticPaths);
const livePathSet = new Set([
  `${scopePath}/assets/console-v16.css`,
  `${scopePath}/assets/browser-v7.js`,
]);
const offlinePath = `${scopePath}/assets/offline-v8.html`;

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
            .filter(
              (name) =>
                name !== CACHE_NAME &&
                (name.startsWith(CACHE_PREFIX) || name.startsWith(LEGACY_CACHE_PREFIX)),
            )
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
    event.respondWith((async () => {
      const delays = [0, 250, 750, 1500];
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          /* Tailscale/PWA cold start can miss the first live fetch. */
        }
      }
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(offlinePath)) ?? Response.error();
    })());
    return;
  }

  // The qq host serves current chrome with Cache-Control: no-store. Do not let
  // the service worker's presentation cache hide HMR/live-asset changes.
  if (livePathSet.has(url.pathname)) return;
  if (!staticPathSet.has(url.pathname)) return;
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.match(request))
      .then((cached) => cached ?? fetch(request)),
  );
});
