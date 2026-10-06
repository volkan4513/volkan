// Service worker: keeps the portfolio working offline once it has loaded.
//
// - CORE files (sw-manifest.js) are saved on the first visit.
// - HEAVY files (game builds, songs) are saved the first time they are used,
//   or all at once when a page posts {type: 'save-all'}.
// - Pages are fetched fresh while online and fall back to the saved copy
//   offline; other files are served from the cache and refreshed quietly.
// - Audio is requested in byte ranges, so those are answered by slicing the
//   saved file.
importScripts('sw-manifest.js');

const CORE_CACHE = 'volkan-core-' + self.OFFLINE_VERSION;
const HEAVY_CACHE = 'volkan-heavy';        // kept across versions; stale files pruned by hash
const RUNTIME_CACHE = 'volkan-runtime';    // fonts and anything else fetched along the way
const HASH_RECORD = 'https://offline.invalid/heavy-hashes.json';
// One canonical key per same-origin file: no query string, and the path
// encoded the same way however the page spelled it ("a b[1].mp3",
// "a%20b%5B1%5D.mp3" and "a%20b[1].mp3" all match).
function canon(u) {
    const x = new URL(u, self.registration.scope);
    if (x.origin !== self.location.origin) return x.href;
    let path = x.pathname;
    try { path = decodeURI(path); } catch { }
    return x.origin + encodeURI(path);
}
const abs = canon;
const OFFLINE_PAGE = canon('offline.html');

const CORE_URLS = new Set(Object.keys(self.OFFLINE_CORE).map(abs));
const HEAVY_URLS = new Set(Object.keys(self.OFFLINE_HEAVY).map(abs));
const HEAVY_EXT = /\.(wasm|pck|data|mp3)$/i;
const cacheFor = key => CORE_URLS.has(key) ? CORE_CACHE : HEAVY_URLS.has(key) ? HEAVY_CACHE : RUNTIME_CACHE;

// ---------------------------------------------------------------- install
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CORE_CACHE);
        const urls = Object.keys(self.OFFLINE_CORE).map(abs);
        // one at a time-ish so a single failure doesn't abort everything
        await Promise.all(urls.map(async u => {
            try {
                const res = await fetch(u, { cache: 'reload' });
                if (res.ok) await cache.put(u, res);
            } catch (err) { console.warn('[sw] skip', u, err); }
        }));
        await cacheFonts();
        await self.skipWaiting();
    })());
});

async function cacheFonts() {
    const cache = await caches.open(RUNTIME_CACHE);
    for (const cssUrl of self.OFFLINE_FONT_CSS) {
        try {
            const res = await fetch(cssUrl, { mode: 'cors' });
            if (!res.ok) continue;
            await cache.put(cssUrl, res.clone());
            const css = await res.text();
            const fontUrls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
            await Promise.all(fontUrls.map(f => cache.add(f).catch(() => { })));
        } catch { /* offline during install: fonts get cached on first use */ }
    }
}

// ---------------------------------------------------------------- activate
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = [CORE_CACHE, HEAVY_CACHE, RUNTIME_CACHE];
        for (const name of await caches.keys())
            if (name.startsWith('volkan-') && !keep.includes(name)) await caches.delete(name);
        await pruneHeavy();
        await self.clients.claim();
        broadcast({ type: 'offline-ready', version: self.OFFLINE_VERSION });
    })());
});

// drop saved game/song files whose contents changed (or were removed)
async function pruneHeavy() {
    const cache = await caches.open(HEAVY_CACHE);
    const recRes = await cache.match(HASH_RECORD);
    const old = recRes ? await recRes.json() : {};
    for (const req of await cache.keys()) {
        if (req.url === HASH_RECORD) continue;
        let path = req.url.slice(self.registration.scope.length);
        try { path = decodeURI(path); } catch { }
        const now = self.OFFLINE_HEAVY[path];
        if (!now || (old[path] && old[path] !== now)) await cache.delete(req);
    }
    await cache.put(HASH_RECORD, new Response(JSON.stringify(self.OFFLINE_HEAVY)));
}

// ---------------------------------------------------------------- fetch
self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    if (url.origin !== self.location.origin) {
        if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) event.respondWith(staleWhileRevalidate(req, req.url, RUNTIME_CACHE));
        return; // other cross-origin traffic (iTunes, lyrics...) goes straight to the network
    }
    const key = canon(req.url);
    if (req.headers.has('range')) return event.respondWith(rangeResponse(req, key));
    if (req.mode === 'navigate' || req.destination === 'document' || req.destination === 'iframe') return event.respondWith(networkFirst(req, key));
    if (HEAVY_URLS.has(key) || HEAVY_EXT.test(url.pathname)) return event.respondWith(cacheFirst(req, key));
    event.respondWith(staleWhileRevalidate(req, key));
});

const fromCaches = key => caches.match(key);

async function networkFirst(req, key) {
    try {
        const res = await fetchWithTimeout(req, 4000);
        if (res.ok && res.status === 200) (await caches.open(cacheFor(key))).put(key, res.clone());
        return res;
    } catch {
        const hit = await fromCaches(key);
        if (hit) return hit;
        if (req.mode === 'navigate') return offlinePage();
        return Response.error();
    }
}

// the fallback page, with a <base> so its links work from any folder
async function offlinePage() {
    const res = await caches.match(OFFLINE_PAGE);
    if (!res) return Response.error();
    const html = (await res.text()).replace('<head>', `<head><base href="${self.registration.scope}">`);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function cacheFirst(req, key) {
    const hit = await fromCaches(key);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.status === 200) (await caches.open(HEAVY_CACHE)).put(key, res.clone());
    return res;
}

// serve the saved copy, refresh it in the background
async function staleWhileRevalidate(req, key, cacheName = cacheFor(key)) {
    const hit = await fromCaches(key);
    const update = fetch(req).then(async res => {
        if ((res.ok && res.status === 200) || res.type === 'opaque') (await caches.open(cacheName)).put(key, res.clone());
        return res;
    }).catch(() => null);
    if (hit) return hit;
    return (await update) || Response.error();
}

function fetchWithTimeout(req, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        fetch(req).then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
    });
}

// Audio/video ask for byte ranges. Serve them from the saved full file; if
// it isn't saved yet, play from the network and save the whole file in the
// background for next time.
async function rangeResponse(req, key) {
    const hit = await caches.match(key);
    if (!hit) {
        if (HEAVY_URLS.has(key) || HEAVY_EXT.test(new URL(key).pathname)) saveHeavy([key]);
        return fetch(req);
    }
    const blob = await hit.blob();
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : blob.size - 1;
    if (m && !m[1] && m[2]) { start = blob.size - parseInt(m[2], 10); end = blob.size - 1; }
    end = Math.min(end, blob.size - 1);
    if (start > end || start >= blob.size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
    }
    return new Response(blob.slice(start, end + 1), {
        status: 206,
        headers: {
            'Content-Type': hit.headers.get('Content-Type') || 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${blob.size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
        },
    });
}

// ---------------------------------------------------------------- save everything
let saving = null;
async function saveHeavy(urls, onProgress) {
    const cache = await caches.open(HEAVY_CACHE);
    let done = 0;
    for (const u of urls) {
        if (!(await cache.match(u))) {
            try {
                const res = await fetch(u, { cache: 'reload' });
                if (res.ok && res.status === 200) await cache.put(u, res);
            } catch { /* offline: try again next time */ }
        }
        onProgress?.(++done, urls.length);
    }
}

async function heavyStatus() {
    const cache = await caches.open(HEAVY_CACHE);
    let saved = 0;
    for (const u of HEAVY_URLS) if (await cache.match(u)) saved++;
    return { saved, total: HEAVY_URLS.size, bytes: self.OFFLINE_HEAVY_BYTES };
}

self.addEventListener('message', event => {
    const msg = event.data || {};
    if (msg.type === 'status') {
        event.waitUntil(heavyStatus().then(s => event.source?.postMessage({ type: 'status', ...s })));
    } else if (msg.type === 'save-all') {
        if (!saving) {
            saving = saveHeavy([...HEAVY_URLS], (done, total) => broadcast({ type: 'save-progress', done, total }))
                .then(heavyStatus)
                .then(s => broadcast({ type: 'save-done', ...s }))
                .finally(() => { saving = null; });
        }
        event.waitUntil(saving);
    }
});

async function broadcast(msg) {
    for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg);
}
