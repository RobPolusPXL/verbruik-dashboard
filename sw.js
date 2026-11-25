// Eenvoudige service worker: app-bestanden cachen zodat de app snel opent en offline start.
// Data komt uit Firestore (die heeft een eigen offline cache) en wordt hier niet gecachet.
const CACHE = 'verbruik-v37';
const BESTANDEN = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/fluvius.js', 'js/kosten.js',
  'js/tarieven.js', 'js/indexen.js', 'js/charts.js', 'js/berekeningen.js', 'js/water.js', 'js/plaats.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BESTANDEN.map((b) => new Request(b, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Eigen bestanden: eerst netwerk (altijd de nieuwste versie), cache als je offline bent.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // cache: 'no-cache' zodat de browsercache van GitHub Pages (10 min) een nieuwe versie niet tegenhoudt.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    const kopie = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, kopie));
    return r;
  }).catch(() => caches.match(e.request)));
});
