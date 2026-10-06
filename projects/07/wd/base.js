// Widget Desktop - shared helpers, wallpaper and the reveal lens.
'use strict';
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
    get(k, d) { try { const v = localStorage.getItem('wd.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('wd.' + k, JSON.stringify(v)); } catch { } },
};
const isPhone = () => matchMedia('(max-width: 700px)').matches;
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let toastT = 0;
function toast(msg, ms = 1800) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms);
}

// one shared AudioContext (created on first use, after a user gesture)
let ACTX = null;
function audioCtx() {
    if (!ACTX) ACTX = new (window.AudioContext || window.webkitAudioContext)();
    ACTX.resume();
    return ACTX;
}
function chime(freqs = [660, 880, 990]) {
    try {
        const c = audioCtx();
        freqs.forEach((f, i) => {
            const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.18;
            o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
            o.connect(g).connect(c.destination);
            o.start(t);
            o.stop(t + 0.55);
        });
    } catch { }
}

window.addEventListener('pointermove', e => document.body.classList.toggle('mouse', e.pointerType === 'mouse'), { passive: true });

// =================================================================
// Wallpapers
// =================================================================
const BGS = [
    { name: 'Portrait', blur: 'page_images/w_bg1_blur.webp', clear: 'page_images/w_bg1.webp' },
    { name: 'Street', blur: 'page_images/w_bg2_blur.webp', clear: 'page_images/w_bg2.webp' },
    { name: 'Night', blur: 'page_images/w_bg3_blur.webp', clear: 'page_images/w_bg3.webp' },
];
let bgIndex = store.get('bg', 0) % BGS.length;
function setBg(i) {
    bgIndex = (i + BGS.length) % BGS.length;
    $('bgBlur').src = BGS[bgIndex].blur;
    $('bgClear').src = BGS[bgIndex].clear;
    store.set('bg', bgIndex);
    const b = $('bgBtn');
    if (b) b.style.backgroundImage = `url("${BGS[(bgIndex + 1) % BGS.length].blur}")`;
    document.querySelectorAll('#bgChoices .btn').forEach((x, j) => x.classList.toggle('on', j === bgIndex));
}

// =================================================================
// Lens: a clip-path window onto the clear photo (GPU friendly)
// =================================================================
const SHAPES = [
    { id: 'bar', label: 'Bar', w: 90, h: 220, r: 0 },
    { id: 'square', label: 'Square', w: 170, h: 170, r: 4 },
    { id: 'circle', label: 'Circle', w: 190, h: 190, r: 999 },
    { id: 'wide', label: 'Wide', w: 320, h: 110, r: 8 },
];
const Lens = {
    shape: SHAPES.find(s => s.id === store.get('shape', 'bar')) || SHAPES[0],
    scale: store.get('lensSize', 1),
    x: innerWidth / 2, y: innerHeight / 2, on: false, pinned: false, raf: 0,
};
// elements over which the lens should not follow the pointer
const UI_SEL = '.widget, .dock, .panel, .icon, .glance, .favbar, .edit-bar, .coach, .site-home-btn';

function lensDims() {
    const k = Lens.scale * (isPhone() ? 0.8 : 1), s = Lens.shape;
    return [s.w * k, s.h * k, Math.min(s.r, s.w * k / 2)];
}
function drawLens() {
    Lens.raf = 0;
    const wrap = $('bgClearWrap'), frame = $('lensFrame');
    if (!Lens.on || document.body.classList.contains('app-open')) {
        wrap.style.clipPath = 'inset(50% 50% 50% 50%)';
        frame.classList.remove('on');
        return;
    }
    const [w, h, r] = lensDims();
    const top = Lens.y - h / 2, left = Lens.x - w / 2;
    wrap.style.clipPath = `inset(${top}px ${innerWidth - left - w}px ${innerHeight - top - h}px ${left}px round ${r}px)`;
    frame.style.width = w + 'px';
    frame.style.height = h + 'px';
    frame.style.borderRadius = r + 'px';
    frame.style.transform = `translate(${left}px, ${top}px)`;
    frame.classList.add('on');
}
const queueLens = () => { if (!Lens.raf) Lens.raf = requestAnimationFrame(drawLens); };

window.addEventListener('pointermove', e => {
    if (Lens.pinned) return;
    if (e.target.closest && e.target.closest(UI_SEL)) {
        if (e.pointerType === 'mouse') { Lens.on = false; queueLens(); }
        return;
    }
    Lens.x = e.clientX; Lens.y = e.clientY; Lens.on = true;
    queueLens();
}, { passive: true });
window.addEventListener('pointerdown', e => {
    if (e.target.closest(UI_SEL + ', button')) return;
    if (e.pointerType !== 'mouse' && !Lens.pinned) { Lens.x = e.clientX; Lens.y = e.clientY; Lens.on = true; queueLens(); }
});
document.addEventListener('mouseleave', () => { if (!Lens.pinned) { Lens.on = false; queueLens(); } });
window.addEventListener('resize', queueLens);

function togglePin() {
    Lens.pinned = !Lens.pinned;
    $('lensFrame').classList.toggle('pinned', Lens.pinned);
    toast(Lens.pinned ? 'Lens pinned' : 'Lens follows the pointer');
}
function setLensScale(v) {
    Lens.scale = Math.max(0.6, Math.min(2.2, Math.round(v * 10) / 10));
    $('lensSize').value = Lens.scale;
    store.set('lensSize', Lens.scale);
    queueLens();
}
function setShape(id) {
    Lens.shape = SHAPES.find(s => s.id === id) || SHAPES[0];
    store.set('shape', Lens.shape.id);
    document.querySelectorAll('#lensShapes .btn').forEach(b => b.classList.toggle('on', b.dataset.s === Lens.shape.id));
    queueLens();
}
function cycleShape() {
    setShape(SHAPES[(SHAPES.indexOf(Lens.shape) + 1) % SHAPES.length].id);
    toast('Lens: ' + Lens.shape.label);
}
window.addEventListener('wheel', e => {
    if (e.target.closest(UI_SEL)) return;
    setLensScale(Lens.scale + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: true });

// =================================================================
// Shared location (weather + sun), cached so it works offline later
// =================================================================
const Geo = {
    get: () => store.get('geo', null),
    set(g) { store.set('geo', g); document.dispatchEvent(new CustomEvent('geo')); },
    locate() {
        return new Promise((res, rej) => {
            if (!navigator.geolocation) return rej(new Error('no geolocation'));
            navigator.geolocation.getCurrentPosition(p => {
                const g = { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), name: 'Your location' };
                Geo.set(g); res(g);
            }, rej, { timeout: 10000, maximumAge: 36e5 });
        });
    },
    async search(q) {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`);
        const j = await r.json();
        const x = j.results && j.results[0];
        if (!x) throw new Error('not found');
        const g = { lat: x.latitude, lon: x.longitude, name: x.name + (x.country_code ? ', ' + x.country_code : '') };
        Geo.set(g);
        return g;
    },
};

// sunrise / sunset (after the SunCalc algorithm)
function sunTimes(date, lat, lng) {
    const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, e = rad * 23.4397;
    const toDays = d => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
    const fromJ = j => new Date((j + 0.5 - J1970) * dayMs);
    const lw = rad * -lng, phi = rad * lat, d = toDays(date);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = rad * (357.5291 + 0.98560028 * ds);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const at = h => {
        const cosw = (Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
        if (cosw < -1 || cosw > 1) return null;   // polar day / night
        const w = Math.acos(cosw);
        const set = J2000 + (J0 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
        return [fromJ(noon - (set - noon)), fromJ(set)];
    };
    const sun = at(-0.833), gold = at(6);
    return { noon: fromJ(noon), rise: sun && sun[0], set: sun && sun[1], goldenMorningEnd: gold && gold[0], goldenEvening: gold && gold[1] };
}
