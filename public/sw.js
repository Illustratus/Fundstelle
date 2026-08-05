/* Keep the shell of the application available offline. Data always goes over
   the network, because it lies on disk and must not go stale. */
const CACHE = "fundstelle-v4";
/* Every module the interface imports, not only the ones it used to have: a
   shell missing one of them is not a shell, it is a page that fails at the
   first import once the network is gone. */
const SHELL = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "charts.js",
  "docs.html",
  "docs.css",
  "docs.js",
  "scatter.js",
  "search.js",
  "sentences.js",
  "texts.js",
  "icon.svg",
  "manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((hit) => hit ?? caches.match("index.html")),
    ),
  );
});
