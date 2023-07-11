
var cacheName = 'wurmterm';
var filesToCache = [
  '/',
  '/index.html',
  '/settings.html',
  '/css/styles.css',
  '/js/config.js',
  '/js/main.js',
  '/js/probeapi.js',
  '/js/settings.js',
  '/js/renderer/netmap.js',
  '/js/renderer/perf-flamegraph.js'
];

/* Start the service worker and cache all of the app's content */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(cacheName).then(function(cache) {
      return cache.addAll(filesToCache);
    })
  );
});

/* Serve cached content when offline */
self.addEventListener('fetch', function(e) {
  if(e.request.url.match(/\.(html|js|css)$/)) {
    e.respondWith(
      caches.match(e.request).then(function(response) {
        return response || fetch(e.request);
      })
    );
  } else {
    return;
  }
});
