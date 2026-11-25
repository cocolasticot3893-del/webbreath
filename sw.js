/**
 * Service Worker offline-first pour WebBreath.
 * Stratégie Cache-First sur les assets statiques versionnés de même origine
 * pour un fonctionnement instantané et 100 % autonome hors-ligne.
 * Network-Only strict sur Intervals.icu, Gemini API et Google Apps Script.
 */

const CACHE_NAME = "webbreath-v1";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./catalog.js",
  "./svgHelper.js",
  "./k5Parser.js",
  "./telemetryFusion.js",
  "./engine.js",
  "./vault.js",
  "./outbox.js",
  "./intervalsClient.js",
  "./driveSync.js",
  "./fallbackGenerator.js",
  "./geminiClient.js",
  "./mdParser.js",
  "./pacer.js",
  "./directoryBuilder.js",
  "./errorGuard.js",
  "./icon.svg",
  "./manifest.webmanifest",
];

/**
 * Pré-cache tous les assets applicatifs locaux lors de l'installation
 * en contournant le cache HTTP navigateur.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_ASSETS.map(async (assetUrl) => {
            const response = await fetch(assetUrl, { cache: "no-cache" });
            if (!response.ok) {
              throw new Error(
                `Échec du pré-cache (${response.status}) : ${assetUrl}`
              );
            }
            return cache.put(assetUrl, response);
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

/**
 * Purge les anciens caches lors de l'activation et prend le contrôle des clients.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Vérifie si la requête cible un hôte API externe à traiter en Network-Only strict.
 * @param {URL} url
 * @returns {boolean}
 */
function isNetworkOnlyHost(url) {
  const host = url.hostname.toLowerCase();
  return (
    host === "intervals.icu" ||
    host.endsWith(".intervals.icu") ||
    host === "generativelanguage.googleapis.com" ||
    host === "script.google.com" ||
    host === "script.googleusercontent.com"
  );
}

/**
 * Stratégie Cache-First pour les assets statiques de même origine,
 * avec repli réseau et mise en cache opportuniste des ressources valides.
 * Network-Only pour les API externes exclues.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Network-Only strict sur les API externes ou requêtes cross-origin
  if (isNetworkOnlyHost(url) || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.type === "basic"
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, copy).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          if (request.mode === "navigate") {
            const shell = await caches.match("./index.html");
            if (shell) {
              return shell;
            }
          }
          return new Response("Ressource indisponible hors-ligne.", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        });
    })
  );
});
