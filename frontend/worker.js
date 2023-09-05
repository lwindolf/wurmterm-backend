// vim: set ts=4 sw=4:
/* jshint esversion: 6 */

var cacheName = 'wurmterm';
var filesToCache = [
  '/node_modules/jquery/dist/jquery.min.js',
  '/node_modules/mermaid/dist/mermaid.min.js',
  '/node_modules/starboard-notebook/dist/starboard-notebook.js',
  '/node_modules/starboard-notebook/dist/starboard-notebook.css',
  '/node_modules/starboard-notebook/dist/bootstrap-icons.woff2',
  '/node_modules/starboard-notebook/dist/inter.var.woff2',

  // additional starboard stuff that cannot be served from subpath
  '/babel-precompile.chunk.js',
  '/codemirrorEditor.chunk.js',
  '/codemirrorHighlight.chunk.js',
  '/console-output.chunk.js',
  
  '/',
  '/index.html',
  '/css/styles.css',  
  '/js/app.js',
  '/js/notebook.js',
  '/js/probeapi.js',
  '/js/settings.js',
  '/js/renderer/netmap.js',
  '/js/renderer/perf-flamegraph.js',

  '/notebooks/default.md',
  '/notebooks/arp.md',
  '/notebooks/systemd.md',
  'default.json'
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

  // https://stackoverflow.com/questions/35809653/ignore-query-params-in-service-worker-requests
  const url = new URL(e.request.url);
  url.search = '';
  url.fragment = '';

  let cleanRequest = new Request(url, {
    method: e.request.method,
    headers: e.request.headers,
    credentials: e.request.credentials,
    cache: e.request.cache,
    redirect: e.request.redirect,
    referrer: e.request.referrer,
    integrity: e.request.integrity,
  });

  console.log(cleanRequest);

  if(url.pathname.match(/(^\/$|\.(html|js|css|png|woff2|json|md)$)/)) {
    e.respondWith(
      caches.match(cleanRequest).then(function(response) {
        return response || fetch(e.request);
      })
    );
  } else {
    return;
  }
});
