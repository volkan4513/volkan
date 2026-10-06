// Mini music player for the main page: a little pixel disc docked next to the
// sound button that plays the PS Music Player's songs while you browse.
// Tap the disc to open the panel. The track and position are remembered.
// While a song plays the background ambience (ambient.js) pauses.
(function () {
    const BASE = 'projects/04/';
    const STORE = 'mini-player';
    const $ = (sel, root = document) => root.querySelector(sel);

    let tracks = [], idx = 0, audio = null, open = false, el = null, discRaf = 0, angle = 0;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { }
    idx = saved.idx | 0;

    // ---- playlist (same file the full player uses)
    let playlistPromise = null;
    function loadPlaylist() {
        if (!playlistPromise) playlistPromise = new Promise(resolve => {
            const s = document.createElement('script');
            s.src = BASE + 'playlist.js';
            s.onload = () => {
                const data = typeof hardcodedMusicData !== 'undefined' ? hardcodedMusicData : [];
                resolve(data.map(t => {
                    const file = t.filename.replace(/^\.\//, '');
                    const base = file.substring(file.lastIndexOf('/') + 1).replace(/\.[^/.]+$/, '');
                    return { title: t.title, artist: t.artist, src: BASE + file, cover: `${BASE}music/cover/${base}.webp` };
                }));
            };
            s.onerror = () => resolve([]);
            document.head.appendChild(s);
        });
        return playlistPromise;
    }

    // ---- pixel cover (downscale + nearest-neighbour upscale)
    const covers = new Map();
    function pixelCover(url) {
        if (!covers.has(url)) covers.set(url, new Promise(res => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = c.height = 24;
                c.getContext('2d').drawImage(img, 0, 0, 24, 24);
                res(c);
            };
            img.onerror = () => res(null);
            img.src = url;
        }));
        return covers.get(url);
    }

    async function drawCover() {
        const t = tracks[idx];
        if (!t) return;
        const c = await pixelCover(t.cover);
        [$('.mp-cover', el), $('.mp-disc', el)].forEach(cv => {
            const g = cv.getContext('2d');
            g.clearRect(0, 0, cv.width, cv.height);
            if (c) g.drawImage(c, 0, 0, cv.width, cv.height);
            if (cv.classList.contains('mp-disc')) {
                // punch the spindle hole
                g.globalCompositeOperation = 'destination-out';
                g.fillRect(cv.width / 2 - 2, cv.height / 2 - 2, 4, 4);
                g.globalCompositeOperation = 'source-over';
            }
        });
    }

    // the dock disc spins in chunky steps while playing
    function spin(on) {
        cancelAnimationFrame(discRaf);
        const disc = $('.mp-disc', el);
        if (!on) return;
        let last = 0;
        const tick = t => {
            discRaf = requestAnimationFrame(tick);
            if (t - last < 110) return;
            last = t;
            angle = (angle + 45) % 360;
            disc.style.transform = `rotate(${angle}deg)`;
        };
        discRaf = requestAnimationFrame(tick);
    }

    function save() {
        try { localStorage.setItem(STORE, JSON.stringify({ idx, time: audio ? Math.floor(audio.currentTime) : 0 })); } catch { }
    }

    function setTrack(i, keepTime) {
        if (!tracks.length) return;
        idx = (i + tracks.length) % tracks.length;
        const t = tracks[idx];
        audio.src = encodeURI(t.src).replace(/#/g, '%23');
        // resume where the visitor left off (only valid once metadata is in)
        if (keepTime && saved.time) {
            const t0 = saved.time;
            audio.addEventListener('loadedmetadata', () => { if (t0 < audio.duration) audio.currentTime = t0; }, { once: true });
        }
        $('.mp-title span', el).textContent = t.title;
        $('.mp-artist', el).textContent = t.artist;
        $('.mp-title', el).classList.remove('scroll');
        requestAnimationFrame(() => {
            const box = $('.mp-title', el), span = $('.mp-title span', el);
            box.classList.toggle('scroll', span.offsetWidth > box.clientWidth);
        });
        drawCover();
        save();
    }

    function play() {
        if (!tracks.length) return;
        window.Ambient?.stop();
        audio.play().catch(() => { });
    }
    function pause() {
        audio.pause();
    }

    function render() {
        const playing = audio && !audio.paused;
        el.classList.toggle('open', open);
        el.classList.toggle('playing', playing);
        $('.mp-dock', el).setAttribute('aria-expanded', String(open));
        $('.mp-dock', el).setAttribute('aria-label', playing ? `Music: playing ${tracks[idx]?.title || ''}` : 'Music player');
        $('.mp-play', el).innerHTML = playing ? ICON.pause : ICON.play;
        $('.mp-play', el).setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }

    const ICON = {
        play: '<svg viewBox="0 0 8 8" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 1h1v6H2zM3 2h1v4H3zM4 3h1v2H4z"/></svg>',
        pause: '<svg viewBox="0 0 8 8" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M2 1h1v6H2zM5 1h1v6H5z"/></svg>',
        prev: '<svg viewBox="0 0 8 8" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 1h1v6H1zM4 3h1v2H4zM5 2h1v4H5zM6 1h1v6H6zM3 4h1v0H3z"/></svg>',
        next: '<svg viewBox="0 0 8 8" width="14" height="14" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M6 1h1v6H6zM1 1h1v6H1zM2 2h1v4H2zM3 3h1v2H3z"/></svg>',
    };

    function mount() {
        const style = document.createElement('style');
        style.textContent = `
            .mini-player { position: fixed; left: max(66px, calc(env(safe-area-inset-left) + 66px)); bottom: max(12px, env(safe-area-inset-bottom)); z-index: 60;
                font: bold 12px/1.4 ui-monospace, 'Courier New', monospace; color: #f4f1e8; }
            .mp-dock { width: 44px; height: 44px; display: grid; place-items: center; padding: 0; cursor: pointer;
                background: #1b1d22; border: 3px solid #000; box-shadow: inset 3px 3px 0 rgba(255,255,255,.08), 3px 3px 0 #000;
                touch-action: manipulation; -webkit-tap-highlight-color: transparent; opacity: .92; }
            .mp-dock:hover { opacity: 1; }
            .mp-dock:active { transform: translate(3px, 3px); box-shadow: none; }
            .mp-dock:focus-visible, .mp-btn:focus-visible { outline: 3px solid #ffd23f; outline-offset: 2px; }
            .mp-disc { width: 30px; height: 30px; border-radius: 50%; image-rendering: pixelated; background: #555; box-shadow: 0 0 0 2px #000; }
            .mini-player.playing .mp-dock { background: #2a2d35; }
            .mp-panel { position: absolute; left: 0; bottom: 56px; width: min(290px, calc(100vw - 90px)); display: none; padding: 10px;
                background: #1b1d22; border: 3px solid #000; box-shadow: inset 3px 3px 0 rgba(255,255,255,.07), 5px 5px 0 #000;
                background-image: repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 4px); }
            .mini-player.open .mp-panel { display: block; animation: mp-pop .18s steps(3); }
            @keyframes mp-pop { from { transform: translateY(10px); opacity: 0; } }
            .mp-row { display: flex; gap: 10px; align-items: center; }
            .mp-cover { width: 56px; height: 56px; flex: none; image-rendering: pixelated; border: 3px solid #000; background: #333; }
            .mp-info { min-width: 0; flex: 1; }
            .mp-label { font-size: 10px; color: #3ddc84; letter-spacing: 1px; }
            .mp-title { overflow: hidden; white-space: nowrap; color: #ffd23f; }
            .mp-title span { display: inline-block; }
            .mp-title.scroll span { padding-left: 100%; animation: mp-marquee 10s linear infinite; }
            @keyframes mp-marquee { to { transform: translateX(-100%); } }
            .mp-artist { font-size: 11px; color: #8d93a0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .mp-progress { height: 8px; margin: 10px 0 8px; background: repeating-linear-gradient(90deg, #0f1013 0 5px, #2a2d35 5px 7px); border: 2px solid #000; cursor: pointer; touch-action: none; }
            .mp-progress i { display: block; height: 100%; width: 0; background: #ffd23f; }
            .mp-controls { display: flex; gap: 6px; align-items: center; }
            .mp-btn { width: 38px; height: 34px; display: grid; place-items: center; padding: 0; color: #f4f1e8; background: #2a2d35;
                border: 3px solid #000; box-shadow: inset -2px -2px 0 rgba(0,0,0,.45), inset 2px 2px 0 rgba(255,255,255,.16); cursor: pointer; touch-action: manipulation; }
            .mp-btn:active { transform: translate(2px, 2px); }
            .mp-play { background: #ffd23f; color: #0d0d0d; }
            .mp-full { margin-left: auto; font: inherit; font-size: 11px; color: #0d0d0d; background: #3ddc84; border: 3px solid #000; padding: 6px 8px; cursor: pointer; }
            body.popup-open .mini-player { display: none; }
            @media (max-width: 768px) {
                .mini-player { left: auto; bottom: auto; right: max(66px, calc(env(safe-area-inset-right) + 66px)); top: max(12px, env(safe-area-inset-top)); }
                .mp-panel { left: auto; right: -54px; bottom: auto; top: 56px; }
            }
            @media (prefers-reduced-motion: reduce) { .mp-title.scroll span { animation: none; padding-left: 0; } }
        `;
        document.head.appendChild(style);

        el = document.createElement('div');
        el.className = 'mini-player';
        el.innerHTML = `
            <button class="mp-dock" type="button" aria-expanded="false" aria-controls="mpPanel" title="Music"><canvas class="mp-disc" width="24" height="24"></canvas></button>
            <div class="mp-panel" id="mpPanel" role="dialog" aria-label="Mini music player">
                <div class="mp-row">
                    <canvas class="mp-cover" width="24" height="24" aria-hidden="true"></canvas>
                    <div class="mp-info">
                        <div class="mp-label">NOW PLAYING</div>
                        <div class="mp-title"><span>-</span></div>
                        <div class="mp-artist"></div>
                    </div>
                </div>
                <div class="mp-progress" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0"><i></i></div>
                <div class="mp-controls">
                    <button class="mp-btn mp-prev" type="button" aria-label="Previous">${ICON.prev}</button>
                    <button class="mp-btn mp-play" type="button" aria-label="Play">${ICON.play}</button>
                    <button class="mp-btn mp-next" type="button" aria-label="Next">${ICON.next}</button>
                    <button class="mp-full" type="button">FULL PLAYER &#9654;</button>
                </div>
            </div>`;
        document.body.appendChild(el);

        audio = new Audio();
        audio.preload = 'none';
        audio.volume = 0.6;
        audio.addEventListener('play', () => { spin(true); render(); });
        audio.addEventListener('pause', () => { spin(false); render(); save(); if (window.Ambient?.enabled) window.Ambient.start(); });
        audio.addEventListener('ended', () => { setTrack(idx + 1); play(); });
        let lastSave = 0;
        audio.addEventListener('timeupdate', () => {
            const p = audio.duration ? audio.currentTime / audio.duration * 100 : 0;
            $('.mp-progress i', el).style.width = p + '%';
            $('.mp-progress', el).setAttribute('aria-valuenow', String(Math.round(p)));
            if (Date.now() - lastSave > 3000) { lastSave = Date.now(); save(); }
        });

        $('.mp-dock', el).addEventListener('click', async e => {
            e.stopPropagation();
            open = !open;
            if (open && !tracks.length) {
                tracks = await loadPlaylist();
                if (tracks.length) setTrack(idx, true);
            }
            window.Ambient?.blip(open ? 760 : 560);
            render();
        });
        $('.mp-play', el).addEventListener('click', e => { e.stopPropagation(); audio.paused ? play() : pause(); });
        $('.mp-prev', el).addEventListener('click', e => { e.stopPropagation(); setTrack(idx - 1); play(); });
        $('.mp-next', el).addEventListener('click', e => { e.stopPropagation(); setTrack(idx + 1); play(); });
        $('.mp-full', el).addEventListener('click', e => {
            e.stopPropagation();
            pause();
            window.PixelTransition ? PixelTransition.go(BASE + 'index.html') : (location.href = BASE + 'index.html');
        });
        const seek = e => {
            const r = $('.mp-progress', el).getBoundingClientRect();
            if (audio.duration) audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
        };
        $('.mp-progress', el).addEventListener('pointerdown', e => { e.stopPropagation(); seek(e); });
        $('.mp-progress', el).addEventListener('keydown', e => {
            if (!audio.duration) return;
            if (e.key === 'ArrowRight') audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 5);
        });
        // close when clicking elsewhere / Escape
        document.addEventListener('pointerdown', e => { if (open && !el.contains(e.target)) { open = false; render(); } });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { open = false; render(); } });
        window.addEventListener('pagehide', save);

        // show the current track's cover on the dock straight away
        loadPlaylist().then(list => { tracks = list; if (tracks.length) setTrack(idx, true); });
        render();
    }

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
