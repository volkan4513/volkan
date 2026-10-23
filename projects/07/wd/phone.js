// Widget Desktop - phones: a Samsung-style home screen. Live home widgets and
// shortcuts on swipeable pages, every app in a drawer (swipe up), a
// notification shade (pull down) and one gesture layer that also drags the
// reveal lens. Loaded before app.js, which calls initPhone() at boot.
'use strict';
let openApp = null;
const appDef = id => WIDGETS.find(w => w.id === id);
const isEdit = () => document.body.classList.contains('edit-mode');
const clamp01 = v => Math.max(0, Math.min(1, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
const leave = url => window.PixelTransition ? PixelTransition.go(url) : (location.href = url);
const setTxt = (root, sel, v) => { const n = root.querySelector(sel); if (n && n.textContent !== v) n.textContent = v; };

// =================================================================
// Gestures. The home screen, drawer and shade use touch-action: none,
// so every swipe arrives here: the axis locks after 9px, with velocity.
// =================================================================
let swallowUntil = 0;
const swallowClick = () => { swallowUntil = performance.now() + 120; };
document.addEventListener('click', e => { if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); } }, true);

// start(e) returns { lock(T), move(T), end(T, cancelled) } or null to ignore
function onDrag(el, start) {
    el.addEventListener('pointerdown', e => {
        if (e.button > 0 || !isPhone()) return;
        const h = start(e);
        if (!h) return;
        const T = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, dy: 0, vx: 0, vy: 0, axis: null };
        const move = ev => {
            if (ev.pointerId !== T.id) return;
            const dt = Math.max(1, ev.timeStamp - T.t);
            T.vx = 0.6 * (ev.clientX - T.x) / dt + 0.4 * T.vx;
            T.vy = 0.6 * (ev.clientY - T.y) / dt + 0.4 * T.vy;
            T.x = ev.clientX; T.y = ev.clientY; T.t = ev.timeStamp;
            T.dx = T.x - T.x0; T.dy = T.y - T.y0;
            if (!T.axis && Math.hypot(T.dx, T.dy) > 9) { T.axis = Math.abs(T.dx) > Math.abs(T.dy) ? 'x' : 'y'; h.lock?.(T); }
            if (T.axis) h.move?.(T);
        };
        const end = ev => {
            if (ev.pointerId !== T.id) return;
            removeEventListener('pointermove', move);
            removeEventListener('pointerup', end);
            removeEventListener('pointercancel', end);
            if (ev.timeStamp - T.t > 90) T.vx = T.vy = 0;   // the finger stopped before lifting
            if (T.axis) swallowClick();
            document.body.classList.remove('g-drag');
            h.end?.(T, ev.type === 'pointercancel');
        };
        addEventListener('pointermove', move, { passive: true });
        addEventListener('pointerup', end);
        addEventListener('pointercancel', end);
    });
}

// touch scrolling for lists inside gesture areas, with a little momentum
function fling(el, v) {
    cancelAnimationFrame(el._fling);
    let last = performance.now();
    const step = t => {
        const dt = t - last; last = t;
        el.scrollTop -= v * dt;
        v *= Math.pow(0.996, dt);
        if (Math.abs(v) > 0.03) el._fling = requestAnimationFrame(step);
    };
    el._fling = requestAnimationFrame(step);
}

// =================================================================
// Layers (app, drawer, shade): each one is a history entry, so the
// phone's back gesture closes the top one
// =================================================================
const layers = [];
function pushLayer(name) { layers.push(name); history.pushState({ wd: name }, ''); }
function swapTop(name) { layers[layers.length - 1] = name; history.replaceState({ wd: name }, ''); }
function back() { if (layers.length) history.back(); }
function closeLayer(name) {
    if (name === 'app') closeAppNow();
    else if (name === 'drawer') setDrawer(0);
    else if (name === 'shade') setShade(0);
}
addEventListener('popstate', () => { const top = layers.pop(); if (top) closeLayer(top); });
function phoneBack() { if (isEdit()) setEdit(false); else back(); }
// leaving the phone layout (window got wider): drop every layer at once
function phoneReset() {
    const n = layers.length;
    while (layers.length) closeLayer(layers.pop());
    if (n) history.go(-n);
    setEdit(false);
}
function syncLayerClass() { document.body.classList.toggle('layer-open', drawerP > 0 || shadeP > 0); }

// =================================================================
// Apps
// =================================================================
const EXTRA_APPS = {
    settings: { name: 'Settings', icon: '⚙️', color: '#57606f' },
    portfolio: { name: 'Portfolio', icon: '🏠', color: '#c9a400' },
    wallpaper: { name: 'Wallpaper', icon: '🖼️', color: '#3d7bd9' },
    apps: { name: 'Apps', icon: '⠿', color: '#3d4457' },
};
const appInfo = id => appDef(id) || EXTRA_APPS[id];
function iconHtml(id, style = '') {
    const a = appInfo(id);
    return `<button class="icon" data-id="${id}" style="${style}" aria-label="Open ${esc(a.name)}"><span class="ic" style="background:${a.color}">${a.icon}</span><span class="lbl">${esc(a.name)}</span><span class="rm" aria-hidden="true">−</span></button>`;
}

function openAppFrom(id, fromEl) {
    if (id === 'settings' || id === 'wallpaper') { if (layers[layers.length - 1] === 'shade') back(); togglePanel('settings'); return; }
    if (id === 'portfolio') { leave('../../index.html'); return; }
    if (id === 'apps') { openDrawer(); return; }
    const el = byId(id);
    if (!el) return;
    if (fromEl) {
        const r = fromEl.getBoundingClientRect();
        el.style.setProperty('--ox', r.left + r.width / 2 + 'px');
        el.style.setProperty('--oy', r.top + r.height / 2 + 'px');
    }
    const top = layers[layers.length - 1];
    if (top === 'shade') { setShade(0); swapTop('app'); }
    else if (top === 'app') { if (openApp === id) return; closeAppNow(); swapTop('app'); }
    else pushLayer('app');
    openApp = id;
    el.classList.remove('closing');
    el.classList.add('app');
    document.body.classList.add('app-open');
    hideHeadsup();
    closePanels();
    refreshActive();
}
function closeAppNow() {
    if (!openApp) return;
    const el = byId(openApp);
    openApp = null;
    document.body.classList.remove('app-open');
    el.classList.add('closing');
    setTimeout(() => el.classList.remove('app', 'closing'), 180);
    refreshActive();
    queueLens();
    renderHomeWidgets(true);   // to-dos, countdown etc. may have changed
}

// =================================================================
// Home widgets: small live views of the apps, sized in grid cells
// =================================================================
let hwPhoto = 0;
const HW = {
    glance: {
        name: 'Clock', icon: '⏰', w: 4, h: 2, app: 'clock', live: true,
        html: () => '<div class="glance-time"></div><div class="glance-date"></div><div class="glance-extra"></div>',
        render(el, now, force) {
            setTxt(el, '.glance-time', now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            setTxt(el, '.glance-date', now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
            if (!force && now.getSeconds() % 10) return;
            const m = moonPhase(now), wx = Weather.data, bits = [];
            if (wx && wx.cur) bits.push(`${wxOf(wx.cur.weather_code)[0]} ${Math.round(wx.cur.temperature_2m)}°`);
            bits.push(`🌙 ${Math.round(m.illum * 100)}%`);
            const todos = store.get('todos', []).filter(t => !t.d).length;
            if (todos) bits.push(`✅ ${todos} to do`);
            setTxt(el, '.glance-extra', bits.join('   '));
        },
    },
    search: {
        name: 'App search', icon: '🔍', w: 4, h: 1, tap: () => openDrawer(true),
        html: () => '<span class="hs-ic">🔍</span><span class="hs-txt">Search apps</span>',
    },
    music: {
        name: 'Music', icon: '🎵', w: 4, h: 1, app: 'music', live: true,
        html: () => '<img class="hm-cover" alt=""><div class="hm-info"><div class="hm-title"></div><div class="hm-artist"></div><div class="hm-bar"><i></i></div></div><button class="hm-btn" data-act="music-toggle" aria-label="Play or pause"></button><button class="hm-btn" data-act="music-next" aria-label="Next song">⏭</button>',
        render(el) {
            const t = Music.tracks[Music.i], a = Music.audio;
            if (!t) return;
            setTxt(el, '.hm-title', t.title);
            setTxt(el, '.hm-artist', t.artist);
            const img = el.querySelector('.hm-cover');
            if (img.getAttribute('src') !== t.cover) img.setAttribute('src', t.cover);
            setTxt(el, '[data-act="music-toggle"]', a.paused ? '▶' : '⏸');
            el.querySelector('.hm-bar i').style.width = (a.duration ? a.currentTime / a.duration * 100 : 0).toFixed(1) + '%';
            el.classList.toggle('playing', !a.paused);
        },
    },
    weather: {
        name: 'Weather', icon: '⛅', w: 2, h: 2, app: 'weather',
        html: () => '<div class="hwx-top"><span class="hwx-ic"></span><span class="hwx-t"></span></div><div class="hwx-txt"></div><div class="hwx-city"></div><div class="hwx-hl"></div>',
        render(el) {
            const d = Weather.data;
            if (!d || !d.cur) {
                setTxt(el, '.hwx-ic', '⛅'); setTxt(el, '.hwx-t', '--°'); setTxt(el, '.hwx-txt', 'Tap to set');
                setTxt(el, '.hwx-city', 'your city'); setTxt(el, '.hwx-hl', '');
                return;
            }
            const [ic, txt] = wxOf(d.cur.weather_code);
            setTxt(el, '.hwx-ic', ic);
            setTxt(el, '.hwx-t', Math.round(d.cur.temperature_2m) + '°');
            setTxt(el, '.hwx-txt', txt);
            setTxt(el, '.hwx-city', d.name);
            setTxt(el, '.hwx-hl', `H ${Math.round(d.daily.temperature_2m_max[0])}° · L ${Math.round(d.daily.temperature_2m_min[0])}°`);
        },
    },
    calendar: {
        name: 'Calendar', icon: '📅', w: 2, h: 2, app: 'calendar',
        html: () => '<div class="hc-m"></div><div class="hc-grid"></div>',
        render(el, now) {
            const key = ymd(now);
            if (el.dataset.k === key) return;
            el.dataset.k = key;
            const y = now.getFullYear(), m = now.getMonth(), first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
            setTxt(el, '.hc-m', now.toLocaleString(undefined, { month: 'long' }));
            let h = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<b>${d}</b>`).join('') + '<i></i>'.repeat(first);
            for (let d = 1; d <= days; d++) h += `<i class="${d === now.getDate() ? 'today' : ''}">${d}</i>`;
            el.querySelector('.hc-grid').innerHTML = h;
        },
    },
    todo: {
        name: 'To-do', icon: '✅', w: 2, h: 2, app: 'todo',
        html: () => '<div class="ht-h">To-do <span class="ht-n"></span></div><ul class="ht-list"></ul>',
        render(el) {
            const open = store.get('todos', []).filter(t => !t.d);
            setTxt(el, '.ht-n', String(open.length));
            el.querySelector('.ht-list').innerHTML = open.length ? open.slice(0, 4).map(t => `<li>${esc(t.t)}</li>`).join('') : '<li class="done">All done 🎉</li>';
        },
    },
    countdown: {
        name: 'Countdown', icon: '🎯', w: 2, h: 1, app: 'countdown',
        html: () => '<div class="hcd-n"></div><div class="hcd-t"></div>',
        render(el, now) {
            const cd = appDef('countdown').get(), ms = cd.at - now;
            setTxt(el, '.hcd-n', ms > 0 ? Math.ceil(ms / 864e5) + (ms > 864e5 ? ' days' : ' day') : '🎉');
            setTxt(el, '.hcd-t', ms > 0 ? 'to ' + cd.title : cd.title + ' is here');
        },
    },
    moon: {
        name: 'Moon', icon: '🌙', w: 2, h: 1, app: 'sky',
        html: () => '<canvas width="44" height="44" aria-hidden="true"></canvas><div><div class="hmo-n">Moon</div><div class="hmo-p"></div></div>',
        render(el, now) {
            const m = moonPhase(now);
            drawMoon(el.querySelector('canvas'), m.phase);
            setTxt(el, '.hmo-p', `${Math.round(m.illum * 100)}% lit`);
        },
    },
    photos: {
        name: 'Projects', icon: '🖼️', w: 4, h: 2, live: true,
        tap: () => leave(PROJECTS[hwPhoto % PROJECTS.length][2]),
        html: () => '<img alt=""><div class="hp-cap"></div>',
        render(el, now, force) {
            if (!force && now.getSeconds() % 6) return;
            if (!force) hwPhoto++;
            const p = PROJECTS[hwPhoto % PROJECTS.length];
            el.querySelector('img').src = p[0];
            setTxt(el, '.hp-cap', p[1] + '  ›');
        },
    },
    quote: {
        name: 'Quote', icon: '💬', w: 4, h: 1, app: 'quote',
        html: () => '<div class="hq-q"></div><div class="hq-a"></div>',
        render(el, now) {
            const q = QUOTES[Math.floor(now / 864e5) % QUOTES.length];
            setTxt(el, '.hq-q', '“' + q[0] + '”');
            setTxt(el, '.hq-a', '— ' + q[1]);
        },
    },
};
function renderHomeWidgets(force, now = new Date()) {
    $('pages').querySelectorAll('.hw').forEach(el => {
        const s = HW[el.dataset.id.slice(3)];
        if (s.render && (force || s.live || now.getSeconds() === 0)) {
            try { s.render(el, now, force); } catch (err) { console.error('home widget failed:', el.dataset.id, err); }
        }
    });
}

// =================================================================
// Home pages: items are packed into a 4-column grid, page by page
// =================================================================
const FAVS = ['music', 'notes', 'timer', 'apps'];
// '|' starts a new page, so each page keeps some bare wallpaper for the lens
const DEFAULT_HOME = ['hw:glance', 'hw:music', 'weather', 'calendar', 'photos', 'todo', '|',
    'hw:weather', 'hw:calendar', 'hw:todo', 'hw:countdown', 'hw:moon', '|', 'hw:search', 'hw:photos', 'hw:quote'];
const CELL = 88, GAP = 8;
const validItem = id => id === '|' || (id.startsWith('hw:') ? !!HW[id.slice(3)] : !!appInfo(id) && id !== 'apps');
let homeItems = (store.get('homeItems', null) || DEFAULT_HOME).filter(validItem);
let rows = 5, packed = [], page = 0;
const saveHome = () => store.set('homeItems', homeItems);
const sizeOf = id => id.startsWith('hw:') ? [HW[id.slice(3)].w, HW[id.slice(3)].h] : [1, 1];

function calcRows() { return Math.max(3, Math.min(7, Math.floor(($('pages').clientHeight - 12 + GAP) / (CELL + GAP)))); }
function pack(items) {
    const pages = [];
    let used;
    const newPage = () => { used = Array(rows * 4).fill(false); pages.push([]); };
    const fit = (w, h) => {
        for (let i = 0; i < rows * 4; i++) {
            const c = i % 4, r = Math.floor(i / 4);
            if (c + w > 4 || r + h > rows) continue;
            let free = true;
            for (let y = r; y < r + h && free; y++) for (let x = c; x < c + w; x++) if (used[y * 4 + x]) { free = false; break; }
            if (free) return [c, r];
        }
        return null;
    };
    newPage();
    items.forEach(id => {
        if (id === '|') { if (pages[pages.length - 1].length) newPage(); return; }
        const [w, h] = sizeOf(id);
        let spot = fit(w, Math.min(h, rows));
        if (!spot) { newPage(); spot = fit(w, Math.min(h, rows)); }
        const [c, r] = spot, hh = Math.min(h, rows);
        for (let y = r; y < r + hh; y++) for (let x = c; x < c + w; x++) used[y * 4 + x] = true;
        pages[pages.length - 1].push({ id, c, r, w, h: hh });
    });
    return pages;
}
function itemHtml(it) {
    const style = `grid-area:${it.r + 1} / ${it.c + 1} / span ${it.h} / span ${it.w}`;
    if (!it.id.startsWith('hw:')) return iconHtml(it.id, style);
    const k = it.id.slice(3), s = HW[k];
    return `<div class="hw hw-${k}" data-id="${it.id}" role="button" tabindex="0" aria-label="${esc(s.name)} widget" style="${style}">${s.html()}<span class="rm" aria-hidden="true">−</span></div>`;
}
function renderHome() {
    rows = calcRows();
    packed = pack(homeItems);
    $('pages').innerHTML = `<div class="track" id="track">${packed.map(p => `<div class="page" style="grid-template-rows:repeat(${rows}, ${CELL}px)">${p.map(itemHtml).join('')}</div>`).join('')}</div>`;
    $('dots').innerHTML = packed.map((_, i) => `<i data-p="${i}" aria-label="Page ${i + 1}"></i>`).join('');
    $('favbar').innerHTML = FAVS.map(id => iconHtml(id)).join('');
    goPage(Math.min(page, packed.length - 1), true);
    renderHomeWidgets(true);
}
function goPage(p, instant) {
    page = Math.max(0, Math.min(packed.length - 1, p));
    const t = $('track');
    if (instant) t.style.transition = 'none';
    t.style.transform = `translate3d(${-page * innerWidth}px,0,0)`;
    if (instant) { void t.offsetWidth; t.style.transition = ''; }
    [...$('dots').children].forEach((d, i) => d.classList.toggle('on', i === page));
}
function dragPage(dx) {
    const min = -(packed.length - 1) * innerWidth;
    let off = -page * innerWidth + dx;
    if (off > 0) off *= 0.3; else if (off < min) off = min + (off - min) * 0.3;   // rubber band at the ends
    $('track').style.transform = `translate3d(${off}px,0,0)`;
}
const pageOf = id => packed.findIndex(p => p.some(it => it.id === id));

function setEdit(on) {
    document.body.classList.toggle('edit-mode', on);
    if (!on) $('hwPicker').hidden = true;
}
function addToHome(id) {
    if (homeItems.includes(id)) { toast('Already on Home'); return; }
    homeItems.push(id); saveHome(); renderHome();
    toast(`${id.startsWith('hw:') ? HW[id.slice(3)].name + ' widget' : appInfo(id).name} added to Home`);
}
function removeHome(id) { homeItems = homeItems.filter(x => x !== id); saveHome(); renderHome(); }
function resetHome() { homeItems = [...DEFAULT_HOME]; saveHome(); page = 0; renderHome(); }

// widget picker (edit mode)
function renderPicker() {
    $('hwList').innerHTML = Object.entries(HW).map(([k, s]) => {
        const on = homeItems.includes('hw:' + k);
        return `<button class="tile ${on ? 'on' : ''}" data-hw="${k}" ${on ? 'disabled' : ''}><span class="ti" style="background:#3d4457">${s.icon}</span>${s.name}<span class="muted">${s.w}×${s.h}${on ? ' · on Home' : ''}</span></button>`;
    }).join('');
}
$('editAdd').onclick = () => { renderPicker(); togglePanel('hwPicker'); };
$('editDone').onclick = () => setEdit(false);
$('hwList').addEventListener('click', e => {
    const t = e.target.closest('[data-hw]');
    if (!t || t.disabled) return;
    addToHome('hw:' + t.dataset.hw);
    goPage(pageOf('hw:' + t.dataset.hw));
    renderPicker();
});

// ---- the home gesture: pages, shade, drawer, lens, long-press
function lensHit(x, y) {
    if (!Lens.on) return false;
    const [w, h] = lensDims();
    return Math.abs(x - Lens.x) < w / 2 + 16 && Math.abs(y - Lens.y) < h / 2 + 16;
}
onDrag($('home'), e => {
    if (e.target.closest('.edit-bar')) return null;
    const item = e.target.closest('[data-id]'), inPage = !!(item && item.closest('.page'));
    if (isEdit() && inPage) { beginDrag(item, e); return null; }
    const onStatus = !!e.target.closest('.status');
    let mode = null, ox = 0, oy = 0;
    // a touch that starts inside the lens rectangle drags the lens
    if (!onStatus && !isEdit() && e.pointerType !== 'mouse' && !Lens.pinned && lensHit(e.clientX, e.clientY)) { mode = 'lens'; ox = Lens.x - e.clientX; oy = Lens.y - e.clientY; }
    let dead = false;
    const pressT = inPage ? setTimeout(() => { dead = true; navigator.vibrate?.(20); setEdit(true); beginDrag(item, e); }, 480) : 0;
    return {
        lock(T) {
            clearTimeout(pressT);
            if (dead || mode) return;
            if (isEdit()) mode = T.axis === 'x' ? 'page' : null;
            else mode = T.axis === 'x' && !onStatus ? 'page' : T.dy > 0 ? 'shade' : 'drawer';
            if (mode && mode !== 'lens') document.body.classList.add('g-drag');
            if (mode === 'shade') renderShade();
            if (mode === 'drawer') renderDrawer();
        },
        move(T) {
            if (dead) return;
            if (mode === 'lens') { Lens.x = T.x + ox; Lens.y = T.y + oy; Lens.on = true; queueLens(); }
            else if (mode === 'page') dragPage(T.dx);
            else if (mode === 'shade') setShade(clamp01(T.dy / $('shadeSheet').offsetHeight));
            else if (mode === 'drawer') setDrawer(clamp01(-T.dy / (innerHeight * 0.55)));
        },
        end(T, cancelled) {
            clearTimeout(pressT);
            if (dead) return;
            if (mode === 'page') {
                let p = page;
                if (T.dx < -innerWidth * 0.22 || T.vx < -0.35) p++;
                else if (T.dx > innerWidth * 0.22 || T.vx > 0.35) p--;
                goPage(p);
            } else if (mode === 'shade') {
                if (!cancelled && T.vy > -0.3 && (shadeP > 0.35 || T.vy > 0.4)) openShade(); else setShade(0);
            } else if (mode === 'drawer') {
                if (!cancelled && T.vy < 0.3 && (drawerP > 0.3 || T.vy < -0.4)) openDrawer(); else setDrawer(0);
            } else if (!T.axis && !mode) {
                if (onStatus) openShade();
                else if (isEdit() && !item) setEdit(false);
                else if (!item && e.pointerType !== 'mouse' && !Lens.pinned) { Lens.x = T.x0; Lens.y = T.y0; Lens.on = true; queueLens(); }
            }
        },
    };
});
$('home').addEventListener('click', e => {
    const dot = e.target.closest('.dots i');
    if (dot) { goPage(+dot.dataset.p); return; }
    const item = e.target.closest('[data-id]');
    if (!item) return;
    if (isEdit()) { if (e.target.closest('.rm') && item.closest('.page')) removeHome(item.dataset.id); return; }
    const act = e.target.closest('[data-act]');
    if (act) {
        if (act.dataset.act === 'music-toggle') appDef('music').toggle();
        else if (act.dataset.act === 'music-next') appDef('music').next();
        setTimeout(() => renderHomeWidgets(true), 50);
        return;
    }
    const id = item.dataset.id;
    if (id.startsWith('hw:')) { const s = HW[id.slice(3)]; s.tap ? s.tap(item) : openAppFrom(s.app, item); return; }
    openAppFrom(id, item.querySelector('.ic') || item);
});
$('home').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('hw')) { e.preventDefault(); e.target.click(); }
});
$('home').addEventListener('contextmenu', e => { if (e.target.closest('[data-id]')) e.preventDefault(); });

// ---- long-press drag to rearrange (flips pages at the screen edges)
function beginDrag(item, e) {
    const id = item.dataset.id, sx = e.clientX, sy = e.clientY, startPage = page;
    item.classList.add('drag');
    try { item.setPointerCapture(e.pointerId); } catch { }
    let target = null, edgeT = 0, edgeDir = 0, last = e, moved = false;
    const place = ev => {
        last = ev;
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) moved = true;
        item.style.transform = `translate(${ev.clientX - sx + (page - startPage) * innerWidth}px, ${ev.clientY - sy}px)`;
        item.style.visibility = 'hidden';
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.page [data-id]');
        item.style.visibility = '';
        if (target && target !== under) target.classList.remove('drop-target');
        target = under && under !== item ? under : null;
        if (target) target.classList.add('drop-target');
    };
    const move = ev => {
        place(ev);
        const dir = ev.clientX < 28 ? -1 : ev.clientX > innerWidth - 28 ? 1 : 0;
        if (dir === edgeDir) return;
        clearTimeout(edgeT);
        edgeDir = dir;
        if (dir) edgeT = setTimeout(function flip() {
            if (page + dir < 0 || page + dir > packed.length - 1) return;
            goPage(page + dir); place(last);
            edgeT = setTimeout(flip, 700);
        }, 550);
    };
    const up = () => {
        clearTimeout(edgeT);
        item.removeEventListener('pointermove', move);
        item.removeEventListener('pointerup', up);
        item.removeEventListener('pointercancel', up);
        item.classList.remove('drag');
        item.style.transform = '';
        if (target) target.classList.remove('drop-target');
        if (moved) swallowClick();   // a plain tap still reaches the − badge
        const from = homeItems.indexOf(id);
        if (target) {
            homeItems.splice(from, 1);
            homeItems.splice(homeItems.indexOf(target.dataset.id), 0, id);
        } else if (page !== startPage) {
            // dropped on an empty spot of another page: put it at the end of that page
            const onPage = packed[page].map(it => it.id).filter(x => x !== id);
            homeItems.splice(from, 1);
            homeItems.splice(onPage.length ? homeItems.indexOf(onPage[onPage.length - 1]) + 1 : homeItems.length, 0, id);
        } else return;
        saveHome();
        renderHome();
    };
    item.addEventListener('pointermove', move);
    item.addEventListener('pointerup', up);
    item.addEventListener('pointercancel', up);
}

// =================================================================
// App drawer (swipe up): every app A-Z, search, long-press to add to Home
// =================================================================
let drawerP = 0;
function setDrawer(p) {
    drawerP = p;
    document.body.style.setProperty('--dp', p);
    $('drawer').classList.toggle('open', p > 0);
    if (!p && $('appSearch').value) { $('appSearch').value = ''; renderDrawer(); }
    if (!p) $('appSearch').blur();
    syncLayerClass();
}
function openDrawer(focusSearch) {
    renderDrawer();
    setDrawer(1);
    if (!layers.includes('drawer')) pushLayer('drawer');
    if (focusSearch) setTimeout(() => $('appSearch').focus(), 280);
}
function renderDrawer() {
    const q = $('appSearch').value.trim().toLowerCase();
    const list = [...WIDGETS.map(w => w.id), 'settings', 'wallpaper', 'portfolio'].map(id => ({ id, name: appInfo(id).name }))
        .filter(a => !q || a.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    $('drawerGrid').innerHTML = list.length ? list.map(a => iconHtml(a.id)).join('') : '<p class="drawer-none">No apps match</p>';
    $('drawerCount').textContent = `${list.length} app${list.length === 1 ? '' : 's'}`;
}
$('appSearch').addEventListener('input', renderDrawer);
$('appSearch').addEventListener('keydown', e => { if (e.key === 'Enter') $('drawerGrid').querySelector('.icon')?.click(); });
$('drawerGrid').addEventListener('click', e => { const i = e.target.closest('.icon'); if (i) openAppFrom(i.dataset.id, i.querySelector('.ic')); });
$('drawer').addEventListener('contextmenu', e => e.preventDefault());
onDrag($('drawer'), e => {
    if (e.target.closest('input')) return null;
    const grid = $('drawerGrid'), item = e.target.closest('.icon'), s0 = grid.scrollTop;
    cancelAnimationFrame(grid._fling);
    let mode = null;
    const pressT = item ? setTimeout(() => { mode = 'added'; navigator.vibrate?.(20); addToHome(item.dataset.id); }, 520) : 0;
    return {
        lock(T) {
            clearTimeout(pressT);
            if (mode) return;
            mode = T.axis === 'y' ? (T.dy > 0 && grid.scrollTop <= 0 ? 'close' : 'scroll') : 'none';
            if (mode === 'close') document.body.classList.add('g-drag');
        },
        move(T) {
            if (mode === 'scroll') grid.scrollTop = s0 - T.dy;
            else if (mode === 'close') setDrawer(clamp01(1 - T.dy / (innerHeight * 0.55)));
        },
        end(T) {
            clearTimeout(pressT);
            if (mode === 'added') swallowClick();
            else if (mode === 'scroll') fling(grid, T.vy);
            else if (mode === 'close') { if (T.dy > 60 || T.vy > 0.3) back(); else setDrawer(1); }
        },
    };
});

// =================================================================
// Notification shade (pull down): quick tiles, wallpaper brightness,
// notifications you swipe away left or right
// =================================================================
let shadeP = 0, dnd = store.get('dnd', false), mediaOn = false;
let notifs = store.get('notifs', null), nidSeq = Date.now();
const saveNotifs = () => store.set('notifs', notifs);

function setShade(p) {
    shadeP = p;
    $('shade').style.setProperty('--sp', p);
    $('shade').classList.toggle('open', p > 0);
    syncLayerClass();
}
function openShade() {
    if (!shadeP) renderShade();
    setShade(1);
    if (!layers.includes('shade')) pushLayer('shade');
    hideHeadsup();
}
function renderShade() {
    const now = new Date();
    $('shTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('shDate').textContent = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    renderQS();
    renderNotifs();
}

const QS = [
    { id: 'lens', icon: '🔍', label: () => 'Lens', on: () => Lens.on, tap: () => { Lens.on = !Lens.on; queueLens(); } },
    { id: 'pin', icon: '📌', label: () => 'Pin lens', on: () => Lens.pinned, tap: togglePin },
    { id: 'shape', icon: '◳', label: () => Lens.shape.label, tap: cycleShape },
    { id: 'bg', icon: '🖼️', label: () => BGS[bgIndex].name, tap: () => setBg(bgIndex + 1) },
    { id: 'music', icon: '🎵', label: () => Music.audio.paused ? 'Music' : 'Playing', on: () => !Music.audio.paused, tap: () => appDef('music').toggle() },
    { id: 'grain', icon: '🎞️', label: () => 'Film grain', on: () => !document.body.classList.contains('no-grain'), tap: () => setGrain(document.body.classList.contains('no-grain')) },
    { id: 'dnd', icon: '🔕', label: () => 'Do not disturb', on: () => dnd, tap: () => { dnd = !dnd; store.set('dnd', dnd); toast(dnd ? 'Pop-ups off' : 'Pop-ups on'); } },
    {
        id: 'loc', icon: '📍', label: () => Geo.get()?.name || 'Location', on: () => !!Geo.get(),
        tap: () => Geo.locate().then(() => Weather.refresh(true)).then(() => { renderQS(); renderHomeWidgets(true); }).catch(() => toast('Location not available')),
    },
];
function renderQS(box = $('qs')) {
    box.innerHTML = QS.map(q => {
        const on = q.on ? q.on() : null;
        return `<button class="qt ${on ? 'on' : ''}" data-q="${q.id}" ${on === null ? '' : `aria-pressed="${on}"`}><span class="qt-ic">${q.icon}</span><span class="qt-l">${esc(q.label())}</span></button>`;
    }).join('');
}
$('qs').addEventListener('click', e => {
    const b = e.target.closest('.qt');
    if (!b) return;
    QS.find(q => q.id === b.dataset.q).tap();
    setTimeout(renderQS, 60);
});
$('shGear').onclick = () => openAppFrom('settings');
function setDim(v) { $('dim').style.opacity = (1 - v).toFixed(2); store.set('dim', v); }
$('dimRange').oninput = e => setDim(+e.target.value);

const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
function cardHtml(n) {
    return `<div class="notif" data-nid="${n.id}" role="button" tabindex="0"><span class="nf-ic" style="background:${n.color}">${n.icon}</span><div class="nf-body"><div class="nf-meta"><b>${esc(n.app)}</b> · <span class="nf-t" data-t="${n.t}">${ago(n.t)}</span></div><div class="nf-title">${esc(n.title)}</div><div class="nf-text">${esc(n.text)}</div></div></div>`;
}
function mediaHtml() {
    const t = Music.tracks[Music.i], playing = !Music.audio.paused;
    return `<div class="notif media" data-nid="media" role="button" tabindex="0"><img class="nf-cover" src="${esc(t.cover)}" alt=""><div class="nf-body"><div class="nf-meta"><b>Music</b> · ${playing ? 'playing' : 'paused'}</div><div class="nf-title">${esc(t.title)}</div><div class="nf-text">${esc(t.artist)}</div>
        <div class="nf-ctrl"><button data-mact="prev" aria-label="Previous">⏮</button><button data-mact="toggle" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? '⏸' : '▶'}</button><button data-mact="next" aria-label="Next">⏭</button></div></div></div>`;
}
function renderNotifs() {
    $('nfList').innerHTML = (mediaOn && Music.tracks.length ? mediaHtml() : '') + notifs.map(cardHtml).join('') + '<p class="nf-empty">No notifications</p>';
    syncEmpty();
}
function syncEmpty() {
    const empty = $('nfList').querySelector('.nf-empty');
    if (empty) empty.hidden = !!(notifs.length || mediaOn);
    $('nfClear').hidden = !notifs.length;
}
function updateStatus() {
    const ic = [...new Set(notifs.map(n => n.icon))].slice(0, 3);
    if (mediaOn) ic.unshift('🎵');
    $('sbIcons').textContent = ic.join(' ') + (notifs.length > 3 ? ' •' : '');
    document.dispatchEvent(new CustomEvent('notifs'));   // the desktop shell listens
}
function addNotif(n) {
    n.id = 'n' + (++nidSeq);
    n.t = n.t || Date.now();
    notifs.unshift(n);
    notifs = notifs.slice(0, 20);
    saveNotifs();
    updateStatus();
    if (!isPhone()) Shell.notify(n);
    else if (shadeP > 0) renderNotifs(); else showHeadsup(n);
}
function dismiss(id, card) {
    if (card) {
        card.style.height = card.offsetHeight + 'px';
        void card.offsetHeight;
        card.classList.add('gone');
        setTimeout(() => card.remove(), 220);
    }
    if (id === 'media') { mediaOn = false; Music.audio.pause(); }
    else { notifs = notifs.filter(n => n.id !== id); saveNotifs(); }
    updateStatus();
    syncEmpty();
}
function runNotif(id, card) {
    if (id === 'media') { isPhone() ? openAppFrom('music', card) : Shell.launch('w:music'); return; }
    const n = notifs.find(x => x.id === id);
    if (!n) return;
    const act = n.act || '';
    dismiss(id, $('nfList').querySelector(`[data-nid="${id}"]`));
    if (!isPhone()) { Shell.runAct(act); return; }
    if (act.startsWith('win:')) {
        // desktop apps have a phone equivalent among the widgets
        const m = { clock: 'clock', calculator: 'calc', notepad: 'notes', paint: 'sketch', solitaire: 'g2048' }[act.slice(4)];
        if (m) openAppFrom(m, card); else toast('Open this on a computer');
    } else if (act.startsWith('app:')) openAppFrom(act.slice(4), card);
    else if (act.startsWith('go:')) leave(act.slice(3));
    else toast('Marked as read');
}
// a card follows the finger and flies off past 35% of its width (or on a flick)
function settleCard(card, T, gone) {
    card.classList.remove('dragging');
    const flick = Math.abs(T.vx) > 0.5 && Math.sign(T.vx) === Math.sign(T.dx);
    if (Math.abs(T.dx) > card.offsetWidth * 0.35 || flick) {
        card.style.transform = `translateX(${Math.sign(T.dx) * (innerWidth + 40)}px)`;
        card.style.opacity = 0;
        setTimeout(gone, 200);
    } else { card.style.transform = ''; card.style.opacity = ''; }
}
const dragCard = (card, dx) => {
    card.classList.add('dragging');
    card.style.transform = `translateX(${dx}px)`;
    card.style.opacity = 1 - Math.min(1, Math.abs(dx) / innerWidth) * 0.9;
};
$('nfClear').onclick = () => {
    const cards = [...$('nfList').querySelectorAll('.notif:not(.media)')];
    cards.forEach((c, i) => setTimeout(() => { c.style.transform = `translateX(${innerWidth}px)`; c.style.opacity = 0; }, i * 40));
    setTimeout(() => { notifs = []; saveNotifs(); renderNotifs(); updateStatus(); }, cards.length * 40 + 220);
};
$('nfList').addEventListener('click', e => {
    const mb = e.target.closest('[data-mact]');
    if (mb) {
        const m = appDef('music');
        if (mb.dataset.mact === 'toggle') m.toggle(); else m[mb.dataset.mact]();
        return;
    }
    const c = e.target.closest('.notif');
    if (c) runNotif(c.dataset.nid, c);
});
onDrag($('shade'), e => {
    if (e.target.closest('input')) return null;
    const list = $('nfList'), card = e.target.closest('.notif'), inList = !!e.target.closest('.nf-list');
    const onScrim = e.target.classList.contains('shade-scrim'), s0 = list.scrollTop, sheetH = $('shadeSheet').offsetHeight;
    cancelAnimationFrame(list._fling);
    let mode = null;
    return {
        lock(T) {
            const scrolls = list.scrollHeight > list.clientHeight + 2, atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
            if (T.axis === 'x') mode = card ? 'swipe' : null;
            else if (inList && scrolls && !(T.dy < 0 && atEnd)) mode = 'scroll';
            else mode = T.dy < 0 ? 'close' : null;
            if (mode === 'close') document.body.classList.add('g-drag');
        },
        move(T) {
            if (mode === 'swipe') dragCard(card, T.dx);
            else if (mode === 'scroll') list.scrollTop = s0 - T.dy;
            else if (mode === 'close') setShade(clamp01(1 + T.dy / sheetH));
        },
        end(T) {
            if (mode === 'swipe') settleCard(card, T, () => dismiss(card.dataset.nid, card));
            else if (mode === 'scroll') fling(list, T.vy);
            else if (mode === 'close') { if (T.dy < -50 || T.vy < -0.3) back(); else setShade(1); }
            else if (!T.axis && onScrim) back();
        },
    };
});

// ---- heads-up pop-up for new notifications
let huT = 0;
function showHeadsup(n) {
    if (dnd || shadeP > 0 || !isPhone() || document.hidden) return;
    const h = $('headsup');
    clearTimeout(huT);
    h.innerHTML = cardHtml(n);
    h.hidden = false;
    void h.offsetWidth;
    h.classList.add('show');
    navigator.vibrate?.(30);
    huT = setTimeout(hideHeadsup, 5000);
}
function hideHeadsup() {
    const h = $('headsup');
    if (h.hidden) return;
    clearTimeout(huT);
    h.classList.remove('show');
    huT = setTimeout(() => { h.hidden = true; h.style.transform = ''; }, 300);
}
$('headsup').addEventListener('click', e => { const c = e.target.closest('.notif'); if (c) { hideHeadsup(); runNotif(c.dataset.nid, c); } });
onDrag($('headsup'), e => {
    const h = $('headsup'), card = h.querySelector('.notif');
    if (!card) return null;
    clearTimeout(huT);
    return {
        move(T) {
            if (T.axis === 'x') dragCard(card, T.dx);
            else { h.style.transition = 'none'; h.style.transform = `translateY(${Math.min(0, T.dy)}px)`; }
        },
        end(T) {
            h.style.transition = '';
            if (T.axis === 'x') settleCard(card, T, () => { dismiss(card.dataset.nid); h.hidden = true; h.classList.remove('show'); });
            else if (T.axis === 'y' && T.dy < -20) { h.style.transform = ''; hideHeadsup(); }
            else { h.style.transform = ''; huT = setTimeout(hideHeadsup, 3000); }
        },
    };
});

// ---- random notifications: friends, the other projects, the apps here
const PEOPLE = [['Mia', '#ff6b8b'], ['Sam', '#4fa3ff'], ['Dad', '#ff9f43'], ['Priya', '#b48cff'], ['Leo', '#2ecc71'], ['Aiko', '#ff7675']];
const TEXTS = ['are you still up? 👀', 'lunch tomorrow? 🍜', 'sent you a song, tell me what you think', 'game night friday?', 'running 5 min late, sorry!',
    'that pixel racer thing is way too addictive', 'call me when you are free', 'did you water the plants? 🌱', 'look outside, the sky is unreal right now',
    'ok but which wallpaper is your favourite', 'I beat your snake score 🐍', 'happy friday!! 🎉'];
const NOTIF_GEN = [
    () => { const [p, c] = pick(PEOPLE); return { app: 'Messages', icon: '💬', color: c, title: p, text: pick(TEXTS) }; },
    () => { const [p, c] = pick(PEOPLE); return { app: 'Messages', icon: '💬', color: c, title: p, text: pick(TEXTS) }; },
    () => ({ app: 'Pixel Racer', icon: '🏎️', color: '#ff6050', title: 'New lap record on Chicago', text: 'A rival just beat your time. Take it back?', act: 'go:../09/index.html' }),
    () => ({ app: 'Low-Poly Strike', icon: '🎯', color: '#e74c3c', title: 'Match ready', text: 'Three bots are waiting in Free Area.', act: 'go:../08/index.html' }),
    () => ({ app: 'Windows 98', icon: '🖥️', color: '#008080', title: 'You’ve got mail!', text: 'A message is waiting on the 98 desktop.', act: 'go:../05/index.html' }),
    () => ({ app: 'Parking Puzzle', icon: '🚗', color: '#e6b800', title: 'Daily puzzle', text: 'Free the red car in par moves for 3 stars.', act: 'go:../../page2.html' }),
    () => ({ app: 'PS Music Player', icon: '💿', color: '#e84393', title: 'Spin a disc', text: 'Your playlist misses you.', act: 'go:../04/index.html' }),
    () => ({ app: 'Retro FX', icon: '📺', color: '#00a5ff', title: 'Try ASCII mode', text: 'Turn any photo into scanlines or text art.', act: 'go:../03/index.html' }),
    () => { const n = store.get('todos', []).filter(t => !t.d).length; return n ? { app: 'To-do', icon: '✅', color: '#00cec9', title: `${n} task${n > 1 ? 's' : ''} left`, text: 'Tick one off before the day ends.', act: 'app:todo' } : null; },
    () => ({ app: 'Focus', icon: '⏳', color: '#e17055', title: 'Time to focus?', text: 'Start a 25-minute session.', act: 'app:timer' }),
    () => {
        const d = Weather.data;
        if (!d || !d.cur) return { app: 'Weather', icon: '⛅', color: '#4fc3f7', title: 'Set your city', text: 'Get the forecast on your home screen.', act: 'app:weather' };
        const [ic, txt] = wxOf(d.cur.weather_code);
        return { app: 'Weather', icon: ic, color: '#4fc3f7', title: `${Math.round(d.cur.temperature_2m)}° in ${d.name}`, text: `${txt} · feels like ${Math.round(d.cur.apparent_temperature)}°`, act: 'app:weather' };
    },
    () => { const day = new Date().getDay(), n = day === 0 ? 0 : 6 - day; return { app: 'Calendar', icon: '📅', color: '#5b8cff', title: n ? `Weekend in ${n} day${n > 1 ? 's' : ''}` : 'It’s the weekend 🎉', text: 'Plan something fun.', act: 'app:calendar' }; },
    () => ({ app: 'Habits', icon: '🔥', color: '#f39c12', title: 'Keep your streak going', text: 'Tick off today’s habits.', act: 'app:habits' }),
    () => ({ app: 'Breathe', icon: '🫧', color: '#55c2c2', title: 'Take a breath', text: 'One minute of box breathing?', act: 'app:breathe' }),
    () => ({ app: 'Piano', icon: '🎹', color: '#2d3436', title: 'New: Piano', text: 'Slide a finger across the keys to glide.', act: 'app:piano' }),
    () => ({ app: '2048', icon: '🔢', color: '#d4a017', title: 'Can you reach 2048?', text: `Your best is ${store.get('2048best', 0)} points.`, act: 'app:g2048' }),
    () => ({ app: 'Tic-Tac-Toe', icon: '⭕', color: '#16a085', title: 'Rematch?', text: 'The computer is feeling confident.', act: 'app:tictactoe' }),
];
let lastGen = -1, notifT = 0;
function randomNotif() {
    for (let tries = 0; tries < 6; tries++) {
        const i = Math.floor(Math.random() * NOTIF_GEN.length);
        if (i === lastGen) continue;
        const n = NOTIF_GEN[i]();
        if (n) { lastGen = i; return n; }
    }
    return NOTIF_GEN[0]();
}
// a random message every 30-75 s on phones, 60-150 s on the desktop (Settings can turn them off)
function scheduleNotif(ms = isPhone() ? 30000 + Math.random() * 45000 : 60000 + Math.random() * 90000) {
    clearTimeout(notifT);
    notifT = setTimeout(() => { if (!document.hidden && store.get('nfRandom', true)) addNotif(randomNotif()); scheduleNotif(); }, ms);
}
if (!notifs) {
    const now = Date.now();
    notifs = [
        { id: 'n1', app: appTitle(), icon: '👋', color: '#6aa8ff', title: 'Welcome!', text: 'Swipe a notification left or right to clear it. Tap to open.', t: now - 60e3 },
        { id: 'n2', app: 'Pixel Racer', icon: '🏎️', color: '#ff6050', title: 'New project', text: 'A PS1-style racer is out. Tap to play.', act: 'go:../09/index.html', t: now - 18 * 60e3 },
        { id: 'n3', app: 'Messages', icon: '💬', color: '#ff6b8b', title: 'Mia', text: 'ok but which wallpaper is your favourite', t: now - 2 * 36e5 },
    ];
    saveNotifs();
}

// media notification follows the music player
['play', 'pause', 'loadedmetadata'].forEach(ev => Music.audio.addEventListener(ev, () => {
    if (ev === 'play') mediaOn = true;
    if (mediaOn && shadeP > 0) renderNotifs();
    updateStatus();
    renderHomeWidgets(true);
}));

// =================================================================
// Tick + boot (called from app.js)
// =================================================================
function phoneTick(now) {
    const hm = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('sbTime').textContent = hm;
    $('sbNet').textContent = navigator.onLine ? '▲▼' : '✕';
    if (!openApp && drawerP < 1) renderHomeWidgets(false, now);
    if (shadeP > 0) {
        $('shTime').textContent = hm;
        if (now.getSeconds() === 0) $('nfList').querySelectorAll('.nf-t').forEach(t => { t.textContent = ago(+t.dataset.t); });
    }
}
let resizeRaf = 0;
addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { if (isPhone()) { if (calcRows() !== rows) renderHome(); else goPage(page, true); } });
});
document.addEventListener('wx', () => renderHomeWidgets(true));
document.addEventListener('geo', () => renderHomeWidgets(true));
if (navigator.getBattery) navigator.getBattery().then(b => { const r = () => { $('sbBat').textContent = Math.round(b.level * 100) + '%' + (b.charging ? '⚡' : ''); }; r(); b.onlevelchange = r; b.onchargingchange = r; }).catch(() => { });

function initPhone() {
    renderHome();
    updateStatus();
    const dim = store.get('dim', 1);
    $('dimRange').value = dim;
    setDim(dim);
    if (Geo.get()) Weather.refresh().catch(() => { });
    scheduleNotif(12000);
    if (isPhone() && !store.get('phoneHint2', false)) {
        store.set('phoneHint2', true);
        setTimeout(() => toast('Swipe down for notifications · swipe up for all apps', 4000), 900);
    }
}
