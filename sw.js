/**
 * Service worker of Icesights: lets the app open at once and without a connection (the app shell), and keeps
 * a copy of Chart.js. Live data is never kept here: the MYLAPS proxy answers (and caches) those requests itself.
 *
 *  - Pages, scripts and styles of this site: network first, so a new deploy shows up at once; the copy in the
 *    cache is only used when the network is not available.
 *  - Chart.js from the CDN: the cached copy is used at once and refreshed in the background.
 *  - Everything else (the proxy, avatars) goes straight to the network.
 *
 * Change VERSION when the list of files below changes: the caches of older versions are removed.
 */
const VERSION = 'v1';
const SHELL_CACHE = `icesights-shell-${VERSION}`;
const CDN_CACHE = `icesights-cdn-${VERSION}`;

const SHELL = [
    './',
    'index.html', 'replay.html', 'search_user.html', 'live.html', 'marathon.html',
    'style.css', 'dashboards.css',
    'theme.js', 'pwa.js', 'dashboards.js', 'utils.js', 'api.js', 'gpx-generator.js', 'chart-factory.js', 'stats.js',
    'replay-track.js', 'replay-model.js', 'live-model.js', 'live-graph.js', 'fetch_overlapping_sessions.js', 'script.js', 'replay.js', 'search_user.js', 'live.js',
    'manifest.webmanifest',
    'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names.filter(name => name !== SHELL_CACHE && name !== CDN_CACHE).map(name => caches.delete(name))))
            .then(() => self.clients.claim())
    );
});

/** A page is stored under its path only, so a replay link with a long address does not fill the cache. */
function cacheKey(request) {
    if (request.mode !== 'navigate') return request;
    const url = new URL(request.url);
    return new Request(url.origin + url.pathname);
}

async function networkFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(cacheKey(request), response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(cacheKey(request));
        if (cached) return cached;
        if (request.mode === 'navigate') {
            const shell = await cache.match('index.html');
            if (shell) return shell;
        }
        return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
    }
}

async function staleWhileRevalidate(request) {
    const cache = await caches.open(CDN_CACHE);
    const cached = await cache.match(request);
    const update = fetch(request).then(response => {
        if (response.ok || response.type === 'opaque') cache.put(request, response.clone());   // a script tag gets an opaque answer
        return response;
    });
    if (cached) { update.catch(() => {}); return cached; }
    return update;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) event.respondWith(networkFirst(request));
    else if (url.hostname === 'cdn.jsdelivr.net') event.respondWith(staleWhileRevalidate(request));
    // anything else is not touched: the browser handles it as usual
});
