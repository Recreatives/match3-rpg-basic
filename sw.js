// PWA service worker - installability + a bit of resilience on a flaky
// connection, NOT an offline-first game (the game needs Supabase for
// everything that matters - economy, realtime PvP/co-op - so there's no
// meaningful "play with no network" mode to build toward here).
//
// Deliberately NETWORK-FIRST, not cache-first: this project fought real,
// time-costing staleness bugs from browser HTTP caching all through
// development (see CLAUDE.md) - a cache-first service worker would
// reintroduce that exact failure mode, permanently, for every installed
// user, which is a much worse outcome than "no offline support." Network-
// first means the cache is only ever a fallback for when the network
// request itself fails, never a substitute for a working one.
const CACHE_NAME = 'pixel-dungeon-v0.72';
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './manifest.json',
    './sound.js',
    './economy.js',
    './items.js',
    './achievements.js',
    './game.js',
    './sharedboard.js',
    './pvp.js',
    './coop.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => {})
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names =>
            Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Only ever handle same-origin GETs for the app shell itself - anything
    // to supabase.co (or any other origin/method) passes straight through,
    // untouched, exactly as if this service worker didn't exist.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
