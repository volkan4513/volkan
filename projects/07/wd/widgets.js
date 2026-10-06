// Widget Desktop - the widget registry.
// Each widget: { id, name, icon, color, w (default width), big (resizable),
//   body() -> html, init(el, api), start(), stop(), tick(now) }
// start/stop run when the widget becomes visible/hidden (desktop) or its
// app opens/closes (phones), so nothing animates off-screen. tick runs once
// a second while active.
'use strict';
const WIDGETS = [];
const def = w => WIDGETS.push(w);
const qs = (el, s) => el.querySelector(s);

// -----------------------------------------------------------------------
// 1. Clock
// -----------------------------------------------------------------------
def((() => {
    let el, digits, h24 = store.get('h24', true);
    return {
        id: 'clock', name: 'Clock', icon: '⏰', color: '#ff8a5b', w: 300,
        body: () => `<div class="clock"></div><div class="clock-sub"><span class="tz"></span><button class="btn fmt" style="min-height:24px;padding:1px 7px"></button></div>`,
        init(b) {
            el = b;
            qs(b, '.clock').innerHTML = ['h1', 'h2', ':', 'm1', 'm2', ':', 's1', 's2'].map(k => k === ':' ? '<b>:</b>' : '<div class="digit"><span>0</span></div>').join('') + '<span class="ampm"></span>';
            digits = [...b.querySelectorAll('.digit')];
            qs(b, '.tz').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            const fmt = qs(b, '.fmt');
            fmt.textContent = h24 ? '24H' : '12H';
            fmt.onclick = () => { h24 = !h24; store.set('h24', h24); fmt.textContent = h24 ? '24H' : '12H'; this.tick(new Date()); };
        },
        tick(now) {
            let h = now.getHours();
            qs(el, '.ampm').textContent = h24 ? '' : (h < 12 ? 'AM' : 'PM');
            if (!h24) h = h % 12 || 12;
            const s = pad(h) + pad(now.getMinutes()) + pad(now.getSeconds());
            digits.forEach((d, i) => {
                if (d.firstChild.textContent !== s[i]) {
                    d.firstChild.textContent = s[i];
                    d.classList.remove('flip'); void d.offsetWidth; d.classList.add('flip');
                }
            });
        },
    };
})());

// -----------------------------------------------------------------------
// 2. Calendar
// -----------------------------------------------------------------------
def((() => {
    let el, off = 0, lastDay = -1;
    function render() {
        const now = new Date(), v = new Date(now.getFullYear(), now.getMonth() + off, 1);
        const y = v.getFullYear(), m = v.getMonth();
        qs(el, '.ct').textContent = v.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
        const out = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="dow">${d}</div>`);
        for (let i = 0; i < first; i++) out.push('<div></div>');
        for (let d = 1; d <= days; d++) {
            const dow = (first + d - 1) % 7;
            out.push(`<div class="d${off === 0 && d === now.getDate() ? ' today' : ''}${dow > 4 ? ' wknd' : ''}">${d}</div>`);
        }
        qs(el, '.cal-grid').innerHTML = out.join('');
    }
    return {
        id: 'calendar', name: 'Calendar', icon: '📅', color: '#5b8cff', w: 250,
        body: () => `<div class="cal-head"><button class="btn prev" aria-label="Previous month">&#9664;</button><span class="ct" title="Back to today" style="cursor:pointer"></span><button class="btn next" aria-label="Next month">&#9654;</button></div><div class="cal-grid"></div>`,
        init(b) {
            el = b;
            qs(b, '.prev').onclick = () => { off--; render(); };
            qs(b, '.next').onclick = () => { off++; render(); };
            qs(b, '.ct').onclick = () => { off = 0; render(); };
            render();
        },
        tick(now) { if (now.getDate() !== lastDay) { lastDay = now.getDate(); render(); } },
    };
})());

// -----------------------------------------------------------------------
// 3. Today + year progress
// -----------------------------------------------------------------------
def((() => {
    let el;
    return {
        id: 'date', name: 'Today', icon: '📆', color: '#ffb347', w: 240,
        body: () => `<div class="date-row"><div class="big-num dn"></div><div><div class="mn"></div><div class="muted wd"></div></div></div><div class="bar"><i class="yb"></i></div><div class="muted yt"></div>`,
        init(b) { el = b; },
        tick(now) {
            const start = new Date(now.getFullYear(), 0, 1), end = new Date(now.getFullYear() + 1, 0, 1);
            const total = Math.round((end - start) / 864e5), day = Math.floor((now - start) / 864e5) + 1;
            const pct = (now - start) / (end - start) * 100;
            qs(el, '.dn').textContent = now.getDate();
            qs(el, '.mn').textContent = now.toLocaleString(undefined, { month: 'long' });
            qs(el, '.wd').textContent = now.toLocaleString(undefined, { weekday: 'long' });
            qs(el, '.yb').style.width = pct.toFixed(2) + '%';
            qs(el, '.yt').textContent = `Day ${day} of ${total} · ${pct.toFixed(1)}% · ${total - day} left`;
        },
    };
})());

// -----------------------------------------------------------------------
// 4. Moon phase + share of the day gone
// -----------------------------------------------------------------------
function moonPhase(now) {
    const synodic = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
    const age = (((now - ref) / 864e5) % synodic + synodic) % synodic;
    const phase = age / synodic;
    return { age, phase, illum: (1 - Math.cos(2 * Math.PI * phase)) / 2 };
}
function drawMoon(c, phase) {
    const g = c.getContext('2d'), s = c.width, R = s / 2 - 2, C = s / 2;
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#1d2333'; g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2ecd0';
    const waxing = phase < 0.5, k = Math.cos(2 * Math.PI * phase) * R;
    g.beginPath();
    g.arc(C, C, R, -Math.PI / 2, Math.PI / 2, !waxing);
    g.ellipse(C, C, Math.abs(k), R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === waxing);
    g.fill();
}
def((() => {
    let el;
    const NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    return {
        id: 'sky', name: 'Moon', icon: '🌙', color: '#6c5ce7', w: 240,
        body: () => `<div class="sky"><canvas width="56" height="56" aria-hidden="true"></canvas><div><div class="mn"></div><div class="muted mi"></div><div class="bar" style="width:120px"><i class="db"></i></div><div class="muted dt"></div></div></div>`,
        init(b) { el = b; },
        tick(now) {
            const m = moonPhase(now);
            qs(el, '.mn').textContent = NAMES[Math.round(m.phase * 8) % 8];
            qs(el, '.mi').textContent = `${Math.round(m.illum * 100)}% lit · day ${m.age.toFixed(0)}`;
            drawMoon(qs(el, 'canvas'), m.phase);
            const mins = now.getHours() * 60 + now.getMinutes();
            qs(el, '.db').style.width = (mins / 14.4).toFixed(1) + '%';
            qs(el, '.dt').textContent = `${Math.round(mins / 14.4)}% of today gone`;
        },
    };
})());

// -----------------------------------------------------------------------
// 5. Weather (Open-Meteo, no key; last result cached for offline)
// -----------------------------------------------------------------------
const WX = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Fog'], 51: ['🌦️', 'Drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌦️', 'Drizzle'],
    61: ['🌧️', 'Rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'], 71: ['🌨️', 'Snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'],
    80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Heavy showers'], 95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Storm, hail'], 99: ['⛈️', 'Storm, hail'],
};
const wxOf = c => WX[c] || WX[Math.floor(c / 10) * 10] || ['🌡️', 'Weather'];
const Weather = {
    data: store.get('wx', null),
    async refresh(force) {
        const g = Geo.get();
        if (!g) return null;
        if (!force && this.data && this.data.at > Date.now() - 30 * 6e4 && this.data.lat === g.lat) return this.data;
        if (!navigator.onLine) return this.data;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
        const j = await (await fetch(url)).json();
        this.data = { at: Date.now(), lat: g.lat, name: g.name, cur: j.current, daily: j.daily };
        store.set('wx', this.data);
        document.dispatchEvent(new CustomEvent('wx'));
        return this.data;
    },
};
def((() => {
    let el;
    function render() {
        const g = Geo.get(), d = Weather.data;
        const box = qs(el, '.wx');
        if (!g) {
            box.innerHTML = `<p class="muted">Show the weather where you are.</p><div class="row2" style="margin-top:8px"><button class="btn loc">📍 Use my location</button></div>`;
        } else if (!d || d.lat !== g.lat) {
            box.innerHTML = `<p class="muted">Loading weather for ${esc(g.name)}…</p>`;
        } else {
            const [ico, txt] = wxOf(d.cur.weather_code);
            const days = d.daily.time.map((t, i) => {
                const day = new Date(t + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' });
                return `<div>${day}<b>${wxOf(d.daily.weather_code[i])[0]}</b>${Math.round(d.daily.temperature_2m_max[i])}°/${Math.round(d.daily.temperature_2m_min[i])}°</div>`;
            }).join('');
            const age = Math.round((Date.now() - d.at) / 6e4);
            box.innerHTML = `<div class="wx-now"><span class="wx-icon">${ico}</span><div><div class="wx-temp">${Math.round(d.cur.temperature_2m)}°</div><div>${txt}</div></div></div>
                <div class="muted" style="margin-top:6px">${esc(d.name)} · feels ${Math.round(d.cur.apparent_temperature)}° · wind ${Math.round(d.cur.wind_speed_10m)} km/h · ${d.cur.relative_humidity_2m}% humid</div>
                <div class="wx-days">${days}</div>
                <div class="muted" style="margin-top:6px">${navigator.onLine ? `Updated ${age ? age + ' min ago' : 'just now'}` : 'Offline — showing the last forecast'}</div>`;
        }
        box.insertAdjacentHTML('beforeend', `<form class="wx-search"><input type="text" placeholder="Search a city" aria-label="City"><button class="btn">Go</button><button type="button" class="btn loc" aria-label="Use my location">📍</button></form>`);
        box.querySelectorAll('.loc').forEach(b => b.onclick = () => Geo.locate().then(() => Weather.refresh(true)).catch(() => toast('Location not available — search a city instead')));
        qs(box, 'form').onsubmit = e => {
            e.preventDefault();
            const q = qs(box, 'input').value.trim();
            if (q) Geo.search(q).then(() => Weather.refresh(true)).catch(() => toast('City not found'));
        };
    }
    return {
        id: 'weather', name: 'Weather', icon: '⛅', color: '#4fc3f7', w: 300, big: true,
        body: () => `<div class="wx"></div>`,
        init(b) {
            el = b;
            document.addEventListener('wx', render);
            document.addEventListener('geo', render);
            render();
        },
        start() { Weather.refresh().then(render).catch(render); },
        tick(now) { if (now.getMinutes() % 30 === 0 && now.getSeconds() === 0) Weather.refresh().then(render).catch(() => { }); },
    };
})());

// -----------------------------------------------------------------------
// 6. Sun: sunrise / sunset / golden hour, computed offline
// -----------------------------------------------------------------------
def((() => {
    let el;
    const t = d => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';
    function render(now = new Date()) {
        const g = Geo.get(), box = qs(el, '.sun');
        if (!g) {
            box.innerHTML = `<p class="muted">Needs your location (or a city in the Weather widget).</p><button class="btn loc" style="margin-top:8px">📍 Use my location</button>`;
            qs(box, '.loc').onclick = () => Geo.locate().catch(() => toast('Location not available'));
            return;
        }
        const s = sunTimes(now, g.lat, g.lon);
        const len = s.rise && s.set ? (s.set - s.rise) / 36e5 : null;
        box.innerHTML = `<canvas class="sun-arc" width="260" height="80" aria-hidden="true"></canvas>
            <dl class="kv"><dt>Sunrise</dt><dd>${t(s.rise)}</dd><dt>Sunset</dt><dd>${t(s.set)}</dd><dt>Solar noon</dt><dd>${t(s.noon)}</dd>
            <dt>Golden hour</dt><dd>${t(s.goldenEvening)} → ${t(s.set)}</dd><dt>Daylight</dt><dd>${len ? `${Math.floor(len)}h ${Math.round(len % 1 * 60)}m` : 'polar day/night'}</dd></dl>
            <div class="muted" style="margin-top:4px">${esc(g.name)}</div>`;
        const c = qs(box, 'canvas'), x = c.getContext('2d'), W = c.width, H = c.height;
        x.strokeStyle = 'rgba(255,255,255,.35)'; x.setLineDash([4, 4]);
        x.beginPath(); x.moveTo(0, H - 8); x.lineTo(W, H - 8); x.stroke(); x.setLineDash([]);
        x.strokeStyle = accent(); x.lineWidth = 2;
        x.beginPath(); x.ellipse(W / 2, H - 8, W / 2 - 10, H - 18, 0, Math.PI, 0); x.stroke();
        if (s.rise && s.set) {
            const p = Math.max(0, Math.min(1, (now - s.rise) / (s.set - s.rise)));
            const a = Math.PI + p * Math.PI, sx = W / 2 + Math.cos(a) * (W / 2 - 10), sy = H - 8 + Math.sin(a) * (H - 18);
            x.fillStyle = now > s.set || now < s.rise ? '#8892a8' : '#ffd23f';
            x.beginPath(); x.arc(sx, sy, 7, 0, Math.PI * 2); x.fill();
        }
    }
    return {
        id: 'sun', name: 'Sun', icon: '☀️', color: '#f6b93b', w: 280,
        body: () => `<div class="sun"></div>`,
        init(b) { el = b; document.addEventListener('geo', () => render()); render(); },
        tick(now) { if (now.getSeconds() === 0) render(now); },
        start() { render(); },
    };
})());

// -----------------------------------------------------------------------
// 7. System: real FPS graph, memory, battery, network
// -----------------------------------------------------------------------
def((() => {
    let el, raf = 0, frames = 0, lastT = 0;
    const data = [];
    function loop(t) {
        frames++;
        if (t - lastT >= 1000) {
            const fps = Math.round(frames * 1000 / (t - lastT));
            frames = 0; lastT = t;
            data.push(fps); if (data.length > 46) data.shift();
            qs(el, '.fps').textContent = fps;
            qs(el, '.mem').textContent = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB JS heap` : (navigator.deviceMemory ? `~${navigator.deviceMemory} GB device` : 'n/a');
            const c = qs(el, 'canvas'), g = c.getContext('2d');
            g.clearRect(0, 0, c.width, c.height);
            g.fillStyle = accent();
            data.forEach((v, i) => { const h = Math.min(1, v / 120) * (c.height - 4); g.fillRect(i * 5, c.height - h, 4, h); });
            g.fillStyle = 'rgba(255,255,255,.25)';
            g.fillRect(0, c.height - 0.5 * (c.height - 4), c.width, 1);
        }
        raf = requestAnimationFrame(loop);
    }
    function net() {
        const c = navigator.connection;
        qs(el, '.net').textContent = (navigator.onLine ? 'online' : 'offline') + (c && c.effectiveType ? ' · ' + c.effectiveType : '');
    }
    return {
        id: 'system', name: 'System', icon: '💻', color: '#00b894', w: 260, big: true,
        body: () => `<div class="sys"><div class="sys-device"><img alt=""><div><div class="dn"></div><div class="muted sc"></div></div></div>
            <canvas width="230" height="70" aria-label="Frame rate graph"></canvas>
            <dl class="kv"><dt>FPS</dt><dd class="fps">-</dd><dt>Memory</dt><dd class="mem">-</dd><dt>Battery</dt><dd class="bat">-</dd><dt>Network</dt><dd class="net">-</dd><dt>Cores</dt><dd>${navigator.hardwareConcurrency || '?'} logical</dd></dl></div>`,
        init(b) {
            el = b;
            const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || matchMedia('(hover: none)').matches;
            qs(b, 'img').src = mobile ? 'page_images/w_mobile.webp' : 'page_images/w_desktop.webp';
            qs(b, '.dn').textContent = mobile ? 'Mobile device' : 'Desktop';
            qs(b, '.sc').textContent = `${screen.width}×${screen.height} @${devicePixelRatio}x`;
            net(); addEventListener('online', net); addEventListener('offline', net);
            if (navigator.getBattery) navigator.getBattery().then(bt => {
                const r = () => { qs(el, '.bat').textContent = `${Math.round(bt.level * 100)}%${bt.charging ? ' charging' : ''}`; };
                r(); bt.addEventListener('levelchange', r); bt.addEventListener('chargingchange', r);
            }).catch(() => { qs(el, '.bat').textContent = 'n/a'; });
            else qs(b, '.bat').textContent = 'n/a';
        },
        start() { frames = 0; lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); },
        stop() { cancelAnimationFrame(raf); },
    };
})());

// -----------------------------------------------------------------------
// 8. Music (songs from the PS Music Player) + visualizer
// -----------------------------------------------------------------------
const Music = (() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const tracks = (typeof hardcodedMusicData !== 'undefined' ? hardcodedMusicData : []).map(t => {
        const file = t.filename.replace(/^\.\//, '');
        const base = file.substring(file.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
        return { title: t.title, artist: t.artist, src: '../04/' + file, cover: `../04/music/cover/${base}.webp` };
    });
    let analyser = null;
    return {
        audio, tracks, i: store.get('track', 0) % Math.max(1, tracks.length), shuffle: false, loop: false,
        analyser: () => {
            if (!analyser) {
                try {
                    const c = audioCtx();
                    analyser = c.createAnalyser(); analyser.fftSize = 64;
                    c.createMediaElementSource(audio).connect(analyser).connect(c.destination);
                } catch { analyser = false; }
            }
            return analyser;
        },
    };
})();
def((() => {
    let el, vizRaf = 0;
    const a = Music.audio, fmt = s => isFinite(s) ? `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}` : '0:00';
    function set(i, play) {
        if (!Music.tracks.length) return;
        Music.i = (i + Music.tracks.length) % Music.tracks.length;
        const t = Music.tracks[Music.i];
        a.src = encodeURI(t.src).replace(/#/g, '%23');
        qs(el, '.m-title').textContent = t.title;
        qs(el, '.m-artist').textContent = t.artist;
        qs(el, '.m-cover').src = t.cover;
        store.set('track', Music.i);
        if (play) go();
    }
    function go() { Music.analyser(); a.play().catch(() => toast('Could not play this track')); }
    function viz() {
        vizRaf = requestAnimationFrame(viz);
        const c = qs(el, '.m-viz'), g = c.getContext('2d'), an = Music.analyser();
        g.clearRect(0, 0, c.width, c.height);
        if (!an) return;
        const buf = new Uint8Array(32);
        an.getByteFrequencyData(buf);
        g.fillStyle = accent();
        for (let i = 0; i < 25; i++) { const h = Math.max(1, buf[i] / 255 * c.height); g.fillRect(i * 10, c.height - h, 7, h); }
    }
    const next = () => set(Music.shuffle ? Math.floor(Math.random() * Music.tracks.length) : Music.i + 1, true);
    return {
        id: 'music', name: 'Music', icon: '🎵', color: '#e84393', w: 290,
        body: () => `<div class="m-top"><img class="m-cover" alt=""><div class="m-info"><div class="m-title">-</div><div class="muted m-artist"></div></div></div>
            <canvas class="m-viz" width="250" height="28" aria-hidden="true"></canvas>
            <input type="range" class="seek" min="0" max="1000" value="0" aria-label="Seek"><div class="m-time"><span class="cur">0:00</span><span class="dur">0:00</span></div>
            <div class="m-ctrl"><button class="btn prev" aria-label="Previous">&#9198;</button><button class="btn play" aria-label="Play">&#9654;</button><button class="btn next" aria-label="Next">&#9197;</button><button class="btn shuf" aria-label="Shuffle" aria-pressed="false">&#8644;</button><button class="btn loop" aria-label="Repeat one" aria-pressed="false">&#8635;</button></div>
            <div class="m-vol"><span>VOL</span><input type="range" class="vol" min="0" max="1" step="0.01" aria-label="Volume"></div>`,
        init(b) {
            el = b;
            a.addEventListener('play', () => { b.closest('.widget').classList.add('playing'); qs(b, '.play').innerHTML = '&#9208;'; qs(b, '.play').setAttribute('aria-label', 'Pause'); cancelAnimationFrame(vizRaf); viz(); });
            a.addEventListener('pause', () => { b.closest('.widget').classList.remove('playing'); qs(b, '.play').innerHTML = '&#9654;'; qs(b, '.play').setAttribute('aria-label', 'Play'); cancelAnimationFrame(vizRaf); });
            a.addEventListener('ended', () => Music.loop ? (a.currentTime = 0, go()) : next());
            a.addEventListener('timeupdate', () => { if (a.duration) qs(b, '.seek').value = a.currentTime / a.duration * 1000; qs(b, '.cur').textContent = fmt(a.currentTime); });
            a.addEventListener('loadedmetadata', () => { qs(b, '.dur').textContent = fmt(a.duration); });
            qs(b, '.play').onclick = () => a.paused ? go() : a.pause();
            qs(b, '.next').onclick = next;
            qs(b, '.prev').onclick = () => a.currentTime > 3 ? (a.currentTime = 0) : set(Music.i - 1, !a.paused);
            qs(b, '.shuf').onclick = e => { Music.shuffle = !Music.shuffle; e.currentTarget.classList.toggle('on', Music.shuffle); e.currentTarget.setAttribute('aria-pressed', Music.shuffle); };
            qs(b, '.loop').onclick = e => { Music.loop = !Music.loop; e.currentTarget.classList.toggle('on', Music.loop); e.currentTarget.setAttribute('aria-pressed', Music.loop); };
            qs(b, '.seek').oninput = e => { if (a.duration) a.currentTime = e.target.value / 1000 * a.duration; };
            a.volume = store.get('vol', 0.7);
            qs(b, '.vol').value = a.volume;
            qs(b, '.vol').oninput = e => { a.volume = +e.target.value; store.set('vol', a.volume); };
            set(Music.i, false);
        },
        toggle() { a.paused ? go() : a.pause(); },
    };
})());

// -----------------------------------------------------------------------
// 9. Notes with tabs
// -----------------------------------------------------------------------
def((() => {
    let el, notes = store.get('notes2', null) || [{ text: store.get('notes', 'Ideas:\n- ') }], cur = 0, saveT = 0;
    const label = n => (n.text.split('\n')[0].trim() || 'Untitled').slice(0, 18);
    function renderTabs() {
        qs(el, '.tabs').innerHTML = notes.map((n, i) => `<button class="${i === cur ? 'on' : ''}" data-i="${i}">${esc(label(n))}</button>`).join('') +
            '<button data-add aria-label="New note">+</button>' + (notes.length > 1 ? '<button data-del aria-label="Delete this note">&times;</button>' : '');
    }
    function show() { qs(el, 'textarea').value = notes[cur].text; renderTabs(); }
    return {
        id: 'notes', name: 'Notes', icon: '📝', color: '#fdcb6e', w: 260, big: true,
        body: () => `<div class="tabs"></div><textarea class="notes" aria-label="Note text" placeholder="Write something..."></textarea>`,
        init(b) {
            el = b;
            qs(b, '.tabs').onclick = e => {
                const t = e.target.closest('button'); if (!t) return;
                if (t.hasAttribute('data-add')) { notes.push({ text: '' }); cur = notes.length - 1; }
                else if (t.hasAttribute('data-del')) { if (confirm('Delete this note?')) { notes.splice(cur, 1); cur = Math.max(0, cur - 1); } }
                else cur = +t.dataset.i;
                store.set('notes2', notes); show();
                if (t.hasAttribute('data-add')) qs(el, 'textarea').focus();
            };
            qs(b, 'textarea').oninput = e => {
                notes[cur].text = e.target.value;
                clearTimeout(saveT); saveT = setTimeout(() => { store.set('notes2', notes); renderTabs(); }, 300);
            };
            show();
        },
    };
})());

// -----------------------------------------------------------------------
// 10. To-do
// -----------------------------------------------------------------------
def((() => {
    let el, todos = store.get('todos', [{ t: 'Drag widgets around', d: false }, { t: 'Try the focus timer', d: false }]);
    function render() {
        qs(el, '.list').innerHTML = todos.map((td, i) => `<li class="${td.d ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${td.d ? 'checked' : ''} aria-label="Done"><span class="grow">${esc(td.t)}</span><button class="x" data-del="${i}" aria-label="Delete">&times;</button></li>`).join('');
        const left = todos.filter(t => !t.d).length;
        qs(el, '.cnt').textContent = todos.length ? `${left} of ${todos.length} left` : 'Nothing to do. Nice.';
        store.set('todos', todos);
    }
    return {
        id: 'todo', name: 'To-do', icon: '✅', color: '#00cec9', w: 260, big: true,
        body: () => `<form class="add-form"><input type="text" placeholder="Add a task" maxlength="80" aria-label="New task"><button class="btn">+</button></form><ul class="list" style="flex:1"></ul><div class="muted cnt" style="margin-top:6px"></div>`,
        init(b) {
            el = b;
            qs(b, 'form').onsubmit = e => { e.preventDefault(); const i = qs(b, 'input'); if (i.value.trim()) { todos.push({ t: i.value.trim(), d: false }); i.value = ''; render(); } };
            qs(b, '.list').onclick = e => {
                if (e.target.dataset.del != null) { todos.splice(+e.target.dataset.del, 1); render(); }
                else if (e.target.dataset.i != null) { todos[+e.target.dataset.i].d = e.target.checked; render(); }
            };
            render();
        },
    };
})());

// -----------------------------------------------------------------------
// 11. Focus timer (pomodoro)
// -----------------------------------------------------------------------
def((() => {
    let el, mins = 25, left = 25 * 60, end = 0, running = false, int = 0, sessions = store.get('sessions', { day: '', n: 0 });
    function render() {
        const s = Math.max(0, Math.ceil(running ? (end - Date.now()) / 1000 : left));
        qs(el, '.big-face').textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
        qs(el, '.bar i').style.width = (100 - s / (mins * 60) * 100) + '%';
        qs(el, '.go').textContent = running ? 'Pause' : (s < mins * 60 ? 'Resume' : 'Start');
        if (sessions.day !== new Date().toDateString()) sessions = { day: new Date().toDateString(), n: 0 };
        qs(el, '.cnt').textContent = `${sessions.n} focus session${sessions.n === 1 ? '' : 's'} today`;
        document.title = running ? `${qs(el, '.big-face').textContent} · Widget Desktop` : 'Widget Desktop';
        if (running && s <= 0) done();
    }
    function done() {
        running = false; clearInterval(int); left = mins * 60;
        if (mins === 25) { sessions.n++; store.set('sessions', sessions); }
        chime(); toast(mins === 25 ? 'Focus session done — take a break' : 'Break over', 3000);
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Widget Desktop', { body: 'Timer finished' });
        render();
    }
    return {
        id: 'timer', name: 'Focus', icon: '⏳', color: '#e17055', w: 240,
        body: () => `<div class="center-row modes"><button class="btn on" data-m="25">Focus</button><button class="btn" data-m="5">Short</button><button class="btn" data-m="15">Long</button></div>
            <div class="big-face" aria-live="polite">25:00</div><div class="bar"><i></i></div>
            <div class="center-row"><button class="btn go">Start</button><button class="btn rst">Reset</button></div><div class="muted cnt" style="text-align:center;margin-top:6px"></div>`,
        init(b) {
            el = b;
            b.querySelectorAll('.modes .btn').forEach(x => x.onclick = () => {
                b.querySelectorAll('.modes .btn').forEach(y => y.classList.toggle('on', y === x));
                mins = +x.dataset.m; running = false; clearInterval(int); left = mins * 60; render();
            });
            qs(b, '.go').onclick = () => {
                if (running) { left = Math.ceil((end - Date.now()) / 1000); running = false; clearInterval(int); }
                else {
                    end = Date.now() + left * 1000; running = true; int = setInterval(render, 250);
                    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => { });
                }
                render();
            };
            qs(b, '.rst').onclick = () => { running = false; clearInterval(int); left = mins * 60; render(); };
            render();
        },
    };
})());

// -----------------------------------------------------------------------
// 12. Stopwatch with laps
// -----------------------------------------------------------------------
def((() => {
    let el, raf = 0, startAt = 0, acc = 0, running = false, laps = [];
    const now = () => acc + (running ? performance.now() - startAt : 0);
    const fmt = ms => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor(ms / 10) % 100)}`;
    function draw() { qs(el, '.big-face').textContent = fmt(now()); if (running) raf = requestAnimationFrame(draw); }
    function renderLaps() {
        qs(el, '.list').innerHTML = laps.map((l, i) => `<li><span class="grow">Lap ${laps.length - i}</span><span style="font-family:var(--mono)">${fmt(l.split)}</span><span class="muted" style="font-family:var(--mono)">${fmt(l.total)}</span></li>`).join('');
    }
    function ui() { qs(el, '.go').textContent = running ? 'Stop' : (acc ? 'Resume' : 'Start'); qs(el, '.lap').disabled = !running; }
    return {
        id: 'stopwatch', name: 'Stopwatch', icon: '⏱️', color: '#d63031', w: 250,
        body: () => `<div class="big-face">00:00.00</div><div class="center-row"><button class="btn go">Start</button><button class="btn lap" disabled>Lap</button><button class="btn rst">Reset</button></div><ul class="list" style="max-height:150px;margin-top:8px"></ul>`,
        init(b) {
            el = b;
            qs(b, '.go').onclick = () => {
                if (running) { acc = now(); running = false; cancelAnimationFrame(raf); }
                else { startAt = performance.now(); running = true; draw(); }
                ui();
            };
            qs(b, '.lap').onclick = () => { const t = now(); laps.unshift({ total: t, split: t - (laps[0] ? laps[0].total : 0) }); renderLaps(); };
            qs(b, '.rst').onclick = () => { running = false; acc = 0; laps = []; cancelAnimationFrame(raf); draw(); renderLaps(); ui(); };
        },
        start() { if (running) draw(); },
        stop() { cancelAnimationFrame(raf); },
    };
})());

// -----------------------------------------------------------------------
// 13. Countdown to a date
// -----------------------------------------------------------------------
def((() => {
    let el, cd = store.get('countdown', null);
    if (!cd) { const d = new Date(new Date().getFullYear() + 1, 0, 1); cd = { title: 'New Year', at: d.getTime() }; }
    function render() {
        qs(el, '.ttl').textContent = cd.title || 'Countdown';
        let ms = cd.at - Date.now();
        if (ms <= 0) { qs(el, '.cd-grid').innerHTML = '<div style="grid-column:span 4;font-size:20px">🎉 It’s here!</div>'; return; }
        const d = Math.floor(ms / 864e5); ms %= 864e5;
        const h = Math.floor(ms / 36e5); ms %= 36e5;
        const m = Math.floor(ms / 6e4), s = Math.floor(ms % 6e4 / 1000);
        qs(el, '.cd-grid').innerHTML = [[d, 'days'], [h, 'hrs'], [m, 'min'], [s, 'sec']].map(([v, l]) => `<div><b>${v}</b><span class="muted">${l}</span></div>`).join('');
    }
    const toLocal = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    return {
        id: 'countdown', name: 'Countdown', icon: '🎯', color: '#e84393', w: 270,
        body: () => `<div style="font-weight:700;font-size:15px" class="ttl"></div><div class="cd-grid"></div>
            <details><summary class="muted" style="cursor:pointer">Edit</summary><div style="display:grid;gap:6px;margin-top:6px">
            <input type="text" class="in-t" maxlength="40" aria-label="Title"><input type="datetime-local" class="in-d" aria-label="Date and time"><button class="btn sv">Save</button></div></details>`,
        init(b) {
            el = b;
            qs(b, '.in-t').value = cd.title; qs(b, '.in-d').value = toLocal(cd.at);
            qs(b, '.sv').onclick = () => {
                const at = new Date(qs(b, '.in-d').value).getTime();
                if (!at) return toast('Pick a date');
                cd = { title: qs(b, '.in-t').value.trim() || 'Countdown', at };
                store.set('countdown', cd); render(); qs(b, 'details').open = false;
            };
            render();
        },
        tick: render,
    };
})());

// -----------------------------------------------------------------------
// 14. Habit tracker (last 7 days + streak)
// -----------------------------------------------------------------------
def((() => {
    let el, habits = store.get('habits', [{ name: 'Drink water', days: {} }, { name: 'Code', days: {} }, { name: 'Walk', days: {} }]);
    const days = () => [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
    function streak(h) {
        let n = 0; const d = new Date();
        if (!h.days[ymd(d)]) d.setDate(d.getDate() - 1);   // today not done yet doesn't break it
        while (h.days[ymd(d)]) { n++; d.setDate(d.getDate() - 1); }
        return n;
    }
    function render() {
        const ds = days();
        let html = '<span></span>' + ds.map(d => `<span class="h-day">${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('') + '<span class="h-day">🔥</span>';
        habits.forEach((h, i) => {
            html += `<span class="h-name" title="${esc(h.name)}">${esc(h.name)}</span>` +
                ds.map(d => `<button class="hab-cell ${h.days[ymd(d)] ? 'on' : ''}" data-h="${i}" data-d="${ymd(d)}" aria-label="${esc(h.name)} on ${d.toDateString()}"></button>`).join('') +
                `<span class="hab-streak">${streak(h)}</span>`;
        });
        qs(el, '.hab-grid').innerHTML = html;
        qs(el, 'select').innerHTML = habits.map((h, i) => `<option value="${i}">${esc(h.name)}</option>`).join('');
        store.set('habits', habits);
    }
    return {
        id: 'habits', name: 'Habits', icon: '🔥', color: '#f39c12', w: 330,
        body: () => `<div class="hab-grid"></div>
            <form class="add-form" style="margin-top:8px"><input type="text" placeholder="New habit" maxlength="30" aria-label="New habit"><button class="btn">+</button></form>
            <div class="add-form"><select aria-label="Habit to remove"></select><button class="btn rm">Remove</button></div>`,
        init(b) {
            el = b;
            qs(b, '.hab-grid').onclick = e => {
                const c = e.target.closest('.hab-cell'); if (!c) return;
                const h = habits[+c.dataset.h];
                if (h.days[c.dataset.d]) delete h.days[c.dataset.d]; else h.days[c.dataset.d] = 1;
                render();
            };
            qs(b, 'form').onsubmit = e => { e.preventDefault(); const i = qs(b, 'form input'); if (i.value.trim()) { habits.push({ name: i.value.trim(), days: {} }); i.value = ''; render(); } };
            qs(b, '.rm').onclick = () => { const i = +qs(b, 'select').value; if (habits[i]) { habits.splice(i, 1); render(); } };
            render();
        },
        tick(now) { if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) render(); },
    };
})());

// -----------------------------------------------------------------------
// 15. World clocks
// -----------------------------------------------------------------------
def((() => {
    let el, zones = store.get('zones', ['Europe/London', 'America/New_York', 'Asia/Tokyo']);
    const ALL = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];
    const city = z => z.split('/').pop().replace(/_/g, ' ');
    function render(now = new Date()) {
        const localOff = -now.getTimezoneOffset();
        qs(el, '.list').innerHTML = zones.map((z, i) => {
            const parts = new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
            const hr = +parts.slice(0, 2);
            const zOff = (new Date(now.toLocaleString('en-US', { timeZone: z })) - new Date(now.toLocaleString('en-US'))) / 6e4 + localOff;
            const diff = Math.round((zOff - localOff) / 30) / 2;
            return `<li><span>${hr >= 6 && hr < 19 ? '☀️' : '🌙'}</span><span class="grow">${esc(city(z))}<br><span class="muted">${diff === 0 ? 'same time' : (diff > 0 ? '+' : '') + diff + 'h'}</span></span><b style="font:700 20px var(--mono)">${parts}</b><button class="x" data-del="${i}" aria-label="Remove ${esc(city(z))}">&times;</button></li>`;
        }).join('');
        qs(el, 'select').innerHTML = '<option value="">Add a city…</option>' + ALL.filter(z => !zones.includes(z)).map(z => `<option value="${z}">${esc(city(z))}</option>`).join('');
    }
    return {
        id: 'worldclock', name: 'World Clock', icon: '🌍', color: '#0984e3', w: 260,
        body: () => `<ul class="list"></ul><div class="add-form" style="margin-top:8px"><select aria-label="Add a city"></select></div>`,
        init(b) {
            el = b;
            qs(b, '.list').onclick = e => { if (e.target.dataset.del != null) { zones.splice(+e.target.dataset.del, 1); store.set('zones', zones); render(); } };
            qs(b, 'select').onchange = e => { if (e.target.value && zones.length < 6) { zones.push(e.target.value); store.set('zones', zones); render(); } else if (zones.length >= 6) toast('Up to 6 cities'); };
            render();
        },
        tick(now) { if (now.getSeconds() === 0) render(now); },
        start() { render(); },
    };
})());

// -----------------------------------------------------------------------
// 16. Calculator (own parser - no eval)
// -----------------------------------------------------------------------
function calcEval(src) {
    const t = src.replace(/×/g, '*').replace(/÷/g, '/').match(/\d*\.?\d+(?:e[+-]?\d+)?|[-+*/%()]/g) || [];
    let i = 0;
    const peek = () => t[i], take = () => t[i++];
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') v = take() === '+' ? v + term() : v - term(); return v; }
    function term() {
        let v = factor();
        while (['*', '/', '%'].includes(peek())) { const o = take(), r = factor(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; }
        return v;
    }
    function factor() {
        const x = take();
        if (x === '-') return -factor();
        if (x === '+') return factor();
        if (x === '(') { const v = expr(); if (take() !== ')') throw 0; return v; }
        const n = parseFloat(x); if (isNaN(n)) throw 0; return n;
    }
    const v = expr();
    if (i < t.length) throw 0;
    return v;
}
def((() => {
    let el, expr = '', last = '';
    const KEYS = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '⌫', '='];
    function show(val) { qs(el, '.calc-expr').textContent = last; qs(el, '.calc-val').textContent = val ?? (expr || '0'); }
    function press(k) {
        if (k === 'C') { expr = ''; last = ''; }
        else if (k === '⌫' || k === 'Backspace') expr = expr.slice(0, -1);
        else if (k === '=' || k === 'Enter') {
            if (!expr) return;
            try { const v = calcEval(expr); const r = Number.isFinite(v) ? +v.toPrecision(12) + '' : 'Error'; last = expr + ' ='; expr = r === 'Error' ? '' : r; return show(r); }
            catch { return show('Error'); }
        } else expr += k;
        show();
    }
    return {
        id: 'calc', name: 'Calculator', icon: '🧮', color: '#636e72', w: 230,
        body: () => `<div class="calc-screen" tabindex="0" aria-label="Calculator display"><div class="calc-expr"></div><div class="calc-val">0</div></div><div class="calc-keys">${KEYS.map(k => `<button class="btn ${'÷×-+'.includes(k) ? 'op' : ''} ${k === '=' ? 'eq' : ''}" data-k="${k}">${k}</button>`).join('')}</div>`,
        init(b) {
            el = b;
            qs(b, '.calc-keys').onclick = e => { const k = e.target.dataset.k; if (k) press(k); };
            b.closest('.widget')?.addEventListener('keydown', e => {
                if (e.target.closest('input, textarea')) return;
                const map = { '*': '×', '/': '÷', Escape: 'C' };
                const k = map[e.key] || e.key;
                if (/^[\d.+\-()%]$/.test(k) || ['×', '÷', 'C', 'Enter', '=', 'Backspace'].includes(k)) { e.preventDefault(); e.stopPropagation(); press(k); }
            });
            show();
        },
    };
})());

// -----------------------------------------------------------------------
// 17. Unit converter
// -----------------------------------------------------------------------
def((() => {
    let el;
    const UNITS = {
        Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254 },
        Weight: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523, t: 1000 },
        Temperature: { '°C': 'c', '°F': 'f', K: 'k' },
        Speed: { 'km/h': 1, 'm/s': 3.6, mph: 1.609344, knot: 1.852 },
        Data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 },
        Time: { s: 1, min: 60, h: 3600, day: 86400, week: 604800 },
    };
    const toC = (v, u) => u === 'c' ? v : u === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
    const fromC = (v, u) => u === 'c' ? v : u === 'f' ? v * 9 / 5 + 32 : v + 273.15;
    function opts(cat) { return Object.keys(UNITS[cat]).map(u => `<option>${u}</option>`).join(''); }
    function calc() {
        const cat = qs(el, '.cat').value, U = UNITS[cat];
        const v = parseFloat(qs(el, '.from').value), a = qs(el, '.ua').value, b = qs(el, '.ub').value;
        if (isNaN(v)) { qs(el, '.to').value = ''; return; }
        const r = cat === 'Temperature' ? fromC(toC(v, U[a]), U[b]) : v * U[a] / U[b];
        qs(el, '.to').value = +r.toPrecision(8);
    }
    return {
        id: 'convert', name: 'Converter', icon: '🔁', color: '#00a383', w: 270,
        body: () => `<select class="cat" aria-label="Category" style="width:100%;margin-bottom:8px">${Object.keys(UNITS).map(c => `<option>${c}</option>`).join('')}</select>
            <div class="conv"><input type="number" class="from" value="1" aria-label="Value"><button class="btn swap" aria-label="Swap units">⇄</button><input type="text" class="to" readonly aria-label="Result">
            <select class="ua" aria-label="From unit"></select><select class="ub" aria-label="To unit"></select></div>`,
        init(b) {
            el = b;
            const setCat = () => { const c = qs(b, '.cat').value; qs(b, '.ua').innerHTML = opts(c); qs(b, '.ub').innerHTML = opts(c); qs(b, '.ub').selectedIndex = 1; calc(); };
            qs(b, '.cat').onchange = setCat;
            ['.from', '.ua', '.ub'].forEach(s => qs(b, s).addEventListener('input', calc));
            qs(b, '.swap').onclick = () => { const a = qs(b, '.ua').value; qs(b, '.ua').value = qs(b, '.ub').value; qs(b, '.ub').value = a; calc(); };
            setCat();
        },
    };
})());

// -----------------------------------------------------------------------
// 18. Pixel sketch pad (16x16)
// -----------------------------------------------------------------------
def((() => {
    let el, cv, g, color = '#222222', px = store.get('sketch', null) || Array(256).fill(null), drawing = false;
    const PAL = ['#222222', '#ffffff', '#ff4d6d', '#ffd23f', '#3ddc84', '#4fa3ff', '#b48cff', '#ff9f43', '#8d6e63', null];
    function draw() {
        g.clearRect(0, 0, 16, 16);
        px.forEach((c, i) => { if (c) { g.fillStyle = c; g.fillRect(i % 16, (i / 16) | 0, 1, 1); } });
    }
    function at(e) {
        const r = cv.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * 16), y = Math.floor((e.clientY - r.top) / r.height * 16);
        if (x < 0 || y < 0 || x > 15 || y > 15) return;
        px[y * 16 + x] = color; draw();
    }
    return {
        id: 'sketch', name: 'Pixel Pad', icon: '🎨', color: '#fd79a8', w: 240, big: true,
        body: () => `<canvas class="pix" width="16" height="16" aria-label="16 by 16 pixel drawing"></canvas>
            <div class="swatches">${PAL.map((c, i) => `<button data-c="${c}" style="background:${c || 'repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/8px 8px'}" class="${i ? '' : 'on'}" aria-label="${c ? 'Colour ' + c : 'Eraser'}"></button>`).join('')}</div>
            <div class="row2"><button class="btn clr">Clear</button><button class="btn sv">Save PNG</button></div>`,
        init(b) {
            el = b; cv = qs(b, 'canvas'); g = cv.getContext('2d');
            cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); at(e); };
            cv.onpointermove = e => { if (drawing) at(e); };
            cv.onpointerup = cv.onpointercancel = () => { drawing = false; store.set('sketch', px); };
            qs(b, '.swatches').onclick = e => {
                const s = e.target.closest('button'); if (!s) return;
                color = s.dataset.c === 'null' ? null : s.dataset.c;
                b.querySelectorAll('.swatches button').forEach(x => x.classList.toggle('on', x === s));
            };
            qs(b, '.clr').onclick = () => { px = Array(256).fill(null); draw(); store.set('sketch', px); };
            qs(b, '.sv').onclick = () => {
                const o = document.createElement('canvas'); o.width = o.height = 320;
                const og = o.getContext('2d'); og.imageSmoothingEnabled = false; og.drawImage(cv, 0, 0, 320, 320);
                const a = document.createElement('a'); a.href = o.toDataURL(); a.download = 'pixel-art.png'; a.click();
            };
            draw();
        },
    };
})());

// -----------------------------------------------------------------------
// 19. Ambient sounds (generated - no files)
// -----------------------------------------------------------------------
def((() => {
    const SOUNDS = [
        { id: 'rain', icon: '🌧️', name: 'Rain' },
        { id: 'wind', icon: '🌬️', name: 'Wind' },
        { id: 'waves', icon: '🌊', name: 'Waves' },
        { id: 'fire', icon: '🔥', name: 'Fire' },
        { id: 'cafe', icon: '☕', name: 'Café' },
    ];
    const vols = store.get('ambient', {}), nodes = {};
    function noise(c, type) {
        const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
        let last = 0, b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
            else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
            else if (type === 'crackle') d[i] = Math.random() < 0.0012 ? w : 0;
            else d[i] = w * 0.5;
        }
        const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return s;
    }
    function build(id) {
        const c = audioCtx(), out = c.createGain(); out.gain.value = 0; out.connect(c.destination);
        const f = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain();
        const src = [];
        if (id === 'rain') { const n = noise(c, 'pink'); f.type = 'highpass'; f.frequency.value = 900; n.connect(f).connect(out); src.push(n); }
        if (id === 'wind') { const n = noise(c, 'brown'); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.8; lfo.frequency.value = 0.15; lg.gain.value = 250; lfo.connect(lg).connect(f.frequency); n.connect(f).connect(out); src.push(n, lfo); }
        if (id === 'waves') { const n = noise(c, 'brown'), am = c.createGain(); f.type = 'lowpass'; f.frequency.value = 900; lfo.frequency.value = 0.12; lg.gain.value = 0.45; am.gain.value = 0.55; lfo.connect(lg).connect(am.gain); n.connect(f).connect(am).connect(out); src.push(n, lfo); }
        if (id === 'fire') { const n = noise(c, 'brown'), cr = noise(c, 'crackle'), cf = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350; cf.type = 'highpass'; cf.frequency.value = 1500; n.connect(f).connect(out); cr.connect(cf).connect(out); src.push(n, cr); }
        if (id === 'cafe') { const n = noise(c, 'pink'); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6; lfo.frequency.value = 0.3; lg.gain.value = 200; lfo.connect(lg).connect(f.frequency); n.connect(f).connect(out); src.push(n, lfo); }
        src.forEach(s => s.start());
        return { out, src };
    }
    function setVol(id, v) {
        vols[id] = v; store.set('ambient', vols);
        if (v > 0 && !nodes[id]) nodes[id] = build(id);
        if (nodes[id]) nodes[id].out.gain.setTargetAtTime(v * 0.5, audioCtx().currentTime, 0.3);
    }
    return {
        id: 'ambient', name: 'Ambience', icon: '🌧️', color: '#74b9ff', w: 260,
        body: () => SOUNDS.map(s => `<label class="amb-row"><span>${s.icon}</span><span>${s.name}</span><input type="range" min="0" max="1" step="0.01" value="0" data-s="${s.id}" aria-label="${s.name} volume"></label>`).join('') + `<div class="row2" style="margin-top:6px"><button class="btn stop">Stop all</button><span class="muted">Generated live — works offline</span></div>`,
        init(b) {
            b.querySelectorAll('input').forEach(i => { i.value = 0; i.oninput = () => setVol(i.dataset.s, +i.value); });
            qs(b, '.stop').onclick = () => b.querySelectorAll('input').forEach(i => { i.value = 0; setVol(i.dataset.s, 0); });
            // remember the mix but only start sounds after the user touches a slider
            b.querySelectorAll('input').forEach(i => { if (vols[i.dataset.s]) i.dataset.saved = vols[i.dataset.s]; });
            b.addEventListener('pointerdown', () => b.querySelectorAll('input[data-saved]').forEach(i => { i.value = i.dataset.saved; setVol(i.dataset.s, +i.value); delete i.dataset.saved; }), { once: true });
        },
    };
})());

// -----------------------------------------------------------------------
// 20. Breathing guide
// -----------------------------------------------------------------------
def((() => {
    let el, raf = 0, running = false, t0 = 0, pat = 0;
    const PATTERNS = [
        { name: 'Box 4-4-4-4', steps: [['Breathe in', 4, 1], ['Hold', 4, 1], ['Breathe out', 4, 0], ['Hold', 4, 0]] },
        { name: 'Relax 4-7-8', steps: [['Breathe in', 4, 1], ['Hold', 7, 1], ['Breathe out', 8, 0]] },
        { name: 'Calm 5-5', steps: [['Breathe in', 5, 1], ['Breathe out', 5, 0]] },
    ];
    function frame(now) {
        const steps = PATTERNS[pat].steps, total = steps.reduce((a, s) => a + s[1], 0);
        let t = ((now - t0) / 1000) % total, i = 0;
        while (t >= steps[i][1]) { t -= steps[i][1]; i++; }
        const [label, len, to] = steps[i], prev = steps[(i + steps.length - 1) % steps.length][2];
        const k = t / len, ease = 0.5 - Math.cos(Math.PI * k) / 2;
        const scale = 0.55 + 0.45 * (prev + (to - prev) * ease);
        const ball = qs(el, '.breathe-ball');
        ball.style.transform = `scale(${scale})`;
        ball.textContent = `${label}\n${Math.ceil(len - t)}`;
        if (running) raf = requestAnimationFrame(frame);
    }
    return {
        id: 'breathe', name: 'Breathe', icon: '🫧', color: '#55c2c2', w: 240,
        body: () => `<select aria-label="Pattern">${PATTERNS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select><div class="breathe-wrap"><div class="breathe-ball" style="white-space:pre-line">Ready</div></div><div class="center-row"><button class="btn go">Start</button></div>`,
        init(b) {
            el = b;
            qs(b, 'select').onchange = e => { pat = +e.target.value; t0 = performance.now(); };
            qs(b, '.go').onclick = () => {
                running = !running;
                qs(b, '.go').textContent = running ? 'Stop' : 'Start';
                if (running) { t0 = performance.now(); raf = requestAnimationFrame(frame); }
                else { cancelAnimationFrame(raf); qs(el, '.breathe-ball').style.transform = ''; qs(el, '.breathe-ball').textContent = 'Ready'; }
            };
        },
        start() { if (running) raf = requestAnimationFrame(frame); },
        stop() { cancelAnimationFrame(raf); },
    };
})());

// -----------------------------------------------------------------------
// 21. Photo frame (project thumbnails)
// -----------------------------------------------------------------------
def((() => {
    let el, i = 0, int = 0;
    const PICS = [
        ['../01/images/0.webp', 'BMW M3 GTR', '../01/index.html'], ['../02/images/0.webp', 'Just Jump It', '../02/index.html'],
        ['../03/images/0.webp', 'Retro Image FX', '../03/index.html'], ['../04/images/0.webp', 'PS Music Player', '../04/index.html'],
        ['../05/images/0.webp', 'Windows 98', '../05/index.html'], ['../../images_to_use/puzzle_thumb.webp', 'Parking Puzzle', '../../page2.html'],
        ['images/lab_cursor.webp', 'Glass Cursor', 'lots_of_square_cursor.html'],
    ];
    function show(n) {
        i = (n + PICS.length) % PICS.length;
        const imgs = el.querySelectorAll('.photo-box img'), next = imgs[0].style.opacity === '0' ? imgs[0] : imgs[1], cur = next === imgs[0] ? imgs[1] : imgs[0];
        next.src = PICS[i][0]; next.style.opacity = '1'; cur.style.opacity = '0';
        qs(el, '.photo-cap').textContent = PICS[i][1];
    }
    return {
        id: 'photos', name: 'Photos', icon: '🖼️', color: '#e17055', w: 300, big: true,
        body: () => `<div class="photo-box"><img alt="" style="opacity:1"><img alt="" style="opacity:0"><div class="photo-cap"></div></div><div class="row2" style="margin-top:6px"><button class="btn prev" aria-label="Previous">&#9664;</button><button class="btn next" aria-label="Next">&#9654;</button><button class="btn open">Open project</button></div>`,
        init(b) {
            el = b;
            qs(b, '.prev').onclick = () => show(i - 1);
            qs(b, '.next').onclick = () => show(i + 1);
            qs(b, '.open').onclick = () => window.PixelTransition ? PixelTransition.go(PICS[i][2]) : (location.href = PICS[i][2]);
            el.querySelectorAll('img')[0].src = PICS[0][0];
            qs(b, '.photo-cap').textContent = PICS[0][1];
        },
        start() { clearInterval(int); int = setInterval(() => show(i + 1), 5000); },
        stop() { clearInterval(int); },
    };
})());

// -----------------------------------------------------------------------
// 22. Dice / coin / random picker
// -----------------------------------------------------------------------
def((() => {
    let el, n = 2;
    const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    function out(html) { const o = qs(el, '.dice-out'); o.classList.remove('roll'); void o.offsetWidth; o.classList.add('roll'); o.innerHTML = html; }
    return {
        id: 'dice', name: 'Dice', icon: '🎲', color: '#2ecc9a', w: 250,
        body: () => `<div class="dice-out" aria-live="polite">⚀⚅</div><div class="muted sum" style="text-align:center"></div>
            <div class="center-row" style="margin:6px 0"><button class="btn n" data-n="1">1</button><button class="btn n on" data-n="2">2</button><button class="btn n" data-n="3">3</button><button class="btn roll">Roll</button><button class="btn coin">Coin</button></div>
            <form class="add-form"><input type="text" placeholder="pizza, tacos, sushi" aria-label="Options, comma separated"><button class="btn">Pick</button></form><div class="pick-out" aria-live="polite"></div>`,
        init(b) {
            el = b;
            b.querySelectorAll('.n').forEach(x => x.onclick = () => { n = +x.dataset.n; b.querySelectorAll('.n').forEach(y => y.classList.toggle('on', y === x)); });
            qs(b, '.roll').onclick = () => {
                const r = [...Array(n)].map(() => 1 + Math.floor(Math.random() * 6));
                out(r.map(v => FACES[v - 1]).join(''));
                qs(b, '.sum').textContent = n > 1 ? `Total ${r.reduce((a, c) => a + c, 0)}` : `You rolled ${r[0]}`;
            };
            qs(b, '.coin').onclick = () => { const h = Math.random() < 0.5; out(h ? '🪙' : '◎'); qs(b, '.sum').textContent = h ? 'Heads' : 'Tails'; };
            qs(b, 'form').onsubmit = e => {
                e.preventDefault();
                const opts = qs(b, 'input').value.split(',').map(s => s.trim()).filter(Boolean);
                qs(b, '.pick-out').textContent = opts.length ? '→ ' + opts[Math.floor(Math.random() * opts.length)] : 'Add some options first';
            };
        },
    };
})());

// -----------------------------------------------------------------------
// 23. Typing speed test (30 s)
// -----------------------------------------------------------------------
def((() => {
    let el, words = [], typed = '', started = 0, int = 0, done = false, best = store.get('wpmBest', 0);
    const POOL = 'the quick brown fox jumps over lazy dog pixel game code music light night city street coffee window paint puzzle widget clock timer focus build ship test play retro neon glass cursor jump star moon sun rain cloud river stone paper art sketch sound wave dream bright simple smooth quick happy green blue red yellow orange'.split(' ');
    function newText() { words = [...Array(60)].map(() => POOL[Math.floor(Math.random() * POOL.length)]); typed = ''; started = 0; done = false; clearInterval(int); render(); stats(); }
    function render() {
        const target = words.join(' ');
        let html = '';
        for (let i = 0; i < Math.min(target.length, typed.length + 120); i++) {
            const c = target[i], t = typed[i];
            const cls = t == null ? (i === typed.length ? 'cur' : '') : (t === c ? 'ok' : 'bad');
            html += cls ? `<span class="${cls}">${c === ' ' ? '&nbsp;' : esc(c)}</span>` : esc(c);
        }
        qs(el, '.type-text').innerHTML = html;
        const cur = qs(el, '.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    }
    function stats() {
        const secs = started ? Math.min(30, (Date.now() - started) / 1000) : 0;
        const target = words.join(' ');
        let ok = 0; for (let i = 0; i < typed.length; i++) if (typed[i] === target[i]) ok++;
        const wpm = secs ? Math.round(ok / 5 / (secs / 60)) : 0, acc = typed.length ? Math.round(ok / typed.length * 100) : 100;
        qs(el, '.type-stats').innerHTML = `<span>⏱ ${Math.ceil(30 - secs)}s</span><span>${wpm} WPM</span><span>${acc}% acc</span><span>best ${best}</span>`;
        if (secs >= 30 && !done) {
            done = true; clearInterval(int); qs(el, 'input').disabled = true;
            if (wpm > best) { best = wpm; store.set('wpmBest', best); toast(`New best: ${wpm} WPM!`, 2500); } else toast(`${wpm} WPM, ${acc}% accuracy`, 2500);
            stats();
        }
    }
    return {
        id: 'typing', name: 'Typing Test', icon: '⌨️', color: '#8395a7', w: 320, big: true,
        body: () => `<div class="type-text" aria-hidden="true"></div><div class="type-stats"></div><div class="row2"><input type="text" placeholder="Start typing…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type the text here" style="flex:1;min-width:0"><button class="btn again">Restart</button></div>`,
        init(b) {
            el = b;
            const inp = qs(b, 'input');
            inp.oninput = () => {
                if (done) return;
                if (!started) { started = Date.now(); int = setInterval(stats, 250); }
                typed = inp.value;
                render(); stats();
            };
            qs(b, '.again').onclick = () => { inp.disabled = false; inp.value = ''; newText(); inp.focus(); };
            newText();
        },
        stop() { if (started && !done) { clearInterval(int); done = true; started = 0; qs(el, 'input').disabled = false; } },
    };
})());

// -----------------------------------------------------------------------
// 24. Snake
// -----------------------------------------------------------------------
def((() => {
    let el, cv, g, snake, dir, nextDir, food, score, int = 0, running = false, over = false, hi = store.get('snakeHi', 0);
    const N = 16;
    function reset() { snake = [[8, 8], [7, 8], [6, 8]]; dir = nextDir = [1, 0]; score = 0; over = false; placeFood(); draw(); hud(); }
    function placeFood() { do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (snake.some(s => s[0] === food[0] && s[1] === food[1])); }
    function hud() { qs(el, '.sc').textContent = `Score ${score} · best ${hi}`; qs(el, '.go').textContent = running ? 'Pause' : (over ? 'Play again' : 'Play'); }
    function step() {
        dir = nextDir;
        const h = [(snake[0][0] + dir[0] + N) % N, (snake[0][1] + dir[1] + N) % N];
        if (snake.some(s => s[0] === h[0] && s[1] === h[1])) { over = true; running = false; clearInterval(int); if (score > hi) { hi = score; store.set('snakeHi', hi); toast('New high score!'); } hud(); draw(); return; }
        snake.unshift(h);
        if (h[0] === food[0] && h[1] === food[1]) { score++; placeFood(); hud(); } else snake.pop();
        draw();
    }
    function draw() {
        g.fillStyle = '#0e1a10'; g.fillRect(0, 0, N, N);
        g.fillStyle = '#ff4d6d'; g.fillRect(food[0], food[1], 1, 1);
        snake.forEach((s, i) => { g.fillStyle = i ? '#3ddc84' : '#b6ffcf'; g.fillRect(s[0], s[1], 1, 1); });
        if (over) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, N, N); }
    }
    function turn(d) {
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
        if (v && (v[0] !== -dir[0] || v[1] !== -dir[1])) nextDir = v;
        if (!running && !over) toggle();
    }
    function toggle() {
        if (over) reset();
        running = !running;
        clearInterval(int);
        if (running) int = setInterval(step, Math.max(70, 140 - score * 3));
        hud();
    }
    return {
        id: 'snake', name: 'Snake', icon: '🐍', color: '#6ab04c', w: 240, big: true,
        body: () => `<canvas class="pix snake-board" width="16" height="16" tabindex="0" aria-label="Snake game. Arrow keys or swipe to steer."></canvas>
            <div class="row2" style="justify-content:space-between;margin-top:6px"><span class="muted sc"></span><button class="btn go">Play</button></div>
            <div class="dpad"><button class="btn" data-d="up" aria-label="Up">▲</button><button class="btn" data-d="left" aria-label="Left">◀</button><button class="btn" data-d="down" aria-label="Down">▼</button><button class="btn" data-d="right" aria-label="Right">▶</button></div>`,
        init(b) {
            el = b; cv = qs(b, 'canvas'); g = cv.getContext('2d');
            qs(b, '.go').onclick = toggle;
            qs(b, '.dpad').onclick = e => { const d = e.target.closest('[data-d]'); if (d) turn(d.dataset.d); };
            b.closest('.widget')?.addEventListener('keydown', e => {
                const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[e.key];
                if (d && !e.target.closest('input, textarea')) { e.preventDefault(); e.stopPropagation(); turn(d); }
            });
            let sx = 0, sy = 0;
            cv.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; cv.focus(); });
            cv.addEventListener('pointerup', e => {
                const dx = e.clientX - sx, dy = e.clientY - sy;
                if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return toggle();
                turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
            });
            cv.style.touchAction = 'none';
            reset();
        },
        stop() { if (running) toggle(); },
    };
})());

// -----------------------------------------------------------------------
// 25. Quote of the day
// -----------------------------------------------------------------------
def((() => {
    let el, qi = Math.floor(Date.now() / 864e5);
    const Q = [
        ['Simplicity is the soul of efficiency.', 'Austin Freeman'], ['Make it work, make it right, make it fast.', 'Kent Beck'],
        ['The details are not the details. They make the design.', 'Charles Eames'], ['Creativity is intelligence having fun.', 'Albert Einstein'],
        ['Done is better than perfect.', 'Sheryl Sandberg'], ['Play is the highest form of research.', 'Albert Einstein'],
        ['First, solve the problem. Then, write the code.', 'John Johnson'], ['Good design is as little design as possible.', 'Dieter Rams'],
        ['Every artist was first an amateur.', 'Ralph Waldo Emerson'], ['The best way to predict the future is to invent it.', 'Alan Kay'],
        ['You can’t use up creativity. The more you use, the more you have.', 'Maya Angelou'], ['Small steps every day.', 'Unknown'],
    ];
    function render() { const q = Q[qi % Q.length]; qs(el, 'blockquote').textContent = '“' + q[0] + '”'; qs(el, 'cite').textContent = '— ' + q[1]; }
    return {
        id: 'quote', name: 'Quote', icon: '💬', color: '#a29bfe', w: 260, big: true,
        body: () => `<div class="quote"><blockquote></blockquote><cite></cite></div><div class="row2" style="margin-top:8px"><button class="btn nx">Another</button><button class="btn cp">Copy</button></div>`,
        init(b) {
            el = b; render();
            qs(b, '.nx').onclick = () => { qi++; render(); };
            qs(b, '.cp').onclick = () => navigator.clipboard?.writeText(qs(el, 'blockquote').textContent + ' ' + qs(el, 'cite').textContent).then(() => toast('Copied'), () => toast('Could not copy'));
        },
    };
})());
