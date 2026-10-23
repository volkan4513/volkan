// Widget Desktop - the desktop shell, in the style of Windows 11: taskbar,
// start menu, windows, desktop icons, quick settings, notification centre,
// dialogs, and the alarm / timer service. Each app's code lives in
// wd/win/apps/<id>.js and is only fetched the first time the app opens.
'use strict';
const WinApps = {};
const Shell = (() => {
    const BG_WANT = store.get('bg', 0);   // custom wallpapers load later, so remember the choice now
    const TB_H = 48;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'Just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : new Date(t).toLocaleDateString(); };

    const APPS = [
        { id: 'explorer', name: 'File Explorer', icon: wico('explorer'), cat: 'System', w: 880, h: 560, kw: 'files folders documents' },
        { id: 'browser', name: 'Browser', icon: wico('browser'), cat: 'Productivity', w: 1040, h: 660, reuse: true, kw: 'internet web edge chrome' },
        { id: 'notepad', name: 'Notepad', icon: wico('notepad'), cat: 'Productivity', w: 740, h: 500, kw: 'text editor' },
        { id: 'paint', name: 'Paint', icon: wico('paint'), cat: 'Creativity', w: 1000, h: 660, minW: 560, kw: 'draw drawing image' },
        { id: 'photos', name: 'Photos', icon: wico('photos'), cat: 'Creativity', w: 860, h: 580, reuse: true, kw: 'pictures images viewer gallery' },
        { id: 'calculator', name: 'Calculator', icon: wico('calculator'), cat: 'Productivity', w: 340, h: 560, minW: 300, minH: 440, single: true, kw: 'maths calc' },
        { id: 'clock', name: 'Clock', icon: wico('clock'), cat: 'Productivity', w: 700, h: 520, single: true, kw: 'alarm timer stopwatch world' },
        { id: 'settings', name: 'Settings', icon: wico('settings'), cat: 'System', w: 940, h: 640, minW: 560, single: true, kw: 'control panel preferences' },
        { id: 'solitaire', name: 'Solitaire', icon: '🃏', cat: 'Games', w: 940, h: 680, minW: 520, minH: 420, single: true, kw: 'cards klondike game' },
    ];
    const appById = id => APPS.find(a => a.id === id);
    const WIDGET_CAT = { snake: 'Games', g2048: 'Games', tictactoe: 'Games', typing: 'Games', dice: 'Games', sketch: 'Creativity', palette: 'Creativity', piano: 'Creativity' };
    // everything the start menu can launch
    function launchables() {
        return [
            ...APPS,
            { id: 'widgets', name: 'Widgets', icon: wico('widgets'), cat: 'System', kw: 'board weather news' },
            { id: 'wallpaper', name: 'Change wallpaper', icon: wico('photos'), cat: 'System', kw: 'background desktop picture photo theme' },
            { id: 'tips', name: 'Tips', icon: wico('help'), cat: 'System', kw: 'help keyboard shortcuts' },
            ...PROJECTS.map(p => ({ id: 'p:' + slug(p[1]), name: p[1], img: p[0], url: p[2], cat: 'Portfolio', kw: 'project portfolio' })),
            ...WIDGETS.map(w => ({ id: 'w:' + w.id, name: w.name, icon: w.icon, color: w.color, cat: WIDGET_CAT[w.id] || 'Widgets', widget: true, kw: 'widget' })),
        ];
    }
    const findL = id => launchables().find(l => l.id === id);
    function iconHtml(l) {
        if (!l) return '<span class="ai">❔</span>';
        if (l.img) return `<span class="ai ai-img"><img src="${esc(l.img)}" alt="" loading="lazy"></span>`;
        return `<span class="ai${l.color ? ' ai-tile' : ''}"${l.color ? ` style="background:${l.color}"` : ''}>${l.icon}</span>`;
    }

    // ---- recent items (apps and files) for "Recommended"
    function addRecent(k) {
        const r = store.get('recent', []).filter(x => x.k !== k);
        r.unshift({ k, t: Date.now() });
        store.set('recent', r.slice(0, 16));
    }

    // =================================================================
    // Launching
    // =================================================================
    function launch(id, args) {
        closeFlyouts();
        if (id === 'widgets') { setBoard(true); return; }
        if (id === 'wallpaper') { wallpaperPicker(); return; }
        if (id === 'tips') { togglePanel('help'); return; }
        if (id === 'portfolio') { leave('../../index.html'); return; }
        if (id.startsWith('w:')) {
            const wid = id.slice(2);
            if (!byId(wid)) return;
            addRecent(id);
            setWidget(wid, true);
            setBoard(true);
            setTimeout(() => { byId(wid).scrollIntoView({ block: 'nearest', behavior: 'smooth' }); byId(wid).classList.add('flash'); setTimeout(() => byId(wid).classList.remove('flash'), 900); }, 80);
            return;
        }
        if (id.startsWith('p:')) {
            const l = findL(id);
            if (!l) return;
            addRecent(id);
            return launch('browser', { url: new URL(l.url, location.href).href });
        }
        const a = appById(id);
        if (!a) return;
        if (!args || !args.path) addRecent(id);
        const mine = WM.wins.filter(w => w.app === id);
        if (mine.length && (a.single || (a.reuse && args))) {
            const w = mine[mine.length - 1];
            restoreWin(w);
            if (args) w.api.onArgs?.(args);
            return Promise.resolve(w);
        }
        return loadApp(id).then(mod => createWin(a, mod, args || {})).catch(err => { console.error(err); toast(`Couldn’t open ${a.name}`); });
    }
    const loading = {};
    function loadApp(id) {
        if (WinApps[id]) return Promise.resolve(WinApps[id]);
        return loading[id] || (loading[id] = new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = `wd/win/apps/${id}.js`;
            s.onload = () => WinApps[id] ? res(WinApps[id]) : rej(new Error('app did not register: ' + id));
            s.onerror = () => { delete loading[id]; rej(new Error('could not load ' + s.src)); };
            document.body.appendChild(s);
        }));
    }
    function openPath(path) {
        const f = FS.get(path);
        if (!f) { toast('That file no longer exists'); return; }
        if (f.type === 'dir') return launch('explorer', { path: f.path });
        addRecent('file:' + f.path);
        const k = FS.kind(f);
        if (k === 'text') return launch('notepad', { path: f.path });
        if (k === 'image') return launch('photos', { path: f.path });
        if (f.track != null) { defOf('music').play(f.track); toast('Playing ' + f.name.replace(/\.mp3$/, '')); return; }
        return launch('browser', { url: FS.urlOf(f.path), title: f.name });
    }
    // what a notification does when you click it on the desktop
    function runAct(act) {
        if (!act) toast('Marked as read');
        else if (act.startsWith('app:')) launch('w:' + act.slice(4));
        else if (act.startsWith('win:')) launch(act.slice(4));
        else if (act.startsWith('go:')) launch('browser', { url: new URL(act.slice(3), location.href).href });
    }

    // =================================================================
    // Windows
    // =================================================================
    const WM = { wins: [], z: 10, seq: 0, focused: null };
    const winBounds = () => store.get('winBounds', {});
    function createWin(a, mod, args) {
        const el = document.createElement('section');
        el.className = 'win opening';
        el.tabIndex = -1;
        el.dataset.app = a.id;
        el.setAttribute('role', 'dialog');
        el.innerHTML = `<header class="win-bar"><span class="win-ic">${a.icon}</span><span class="win-title"></span><span class="win-ctl"><button data-c="min" aria-label="Minimise" title="Minimise">&#8212;</button><button data-c="max" aria-label="Maximise" title="Maximise">&#9744;</button><button data-c="close" aria-label="Close" title="Close">&#10005;</button></span></header><div class="win-body"></div>`
            + ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<i class="rz rz-${d}" data-d="${d}"></i>`).join('');
        const first = !WM.wins.some(w => w.app === a.id), saved = first && winBounds()[a.id], n = WM.wins.length;
        const ww = Math.min(saved ? saved.w : a.w, innerWidth - 16), hh = Math.min(saved ? saved.h : a.h, innerHeight - TB_H - 16);
        const x = saved ? saved.x : (innerWidth - ww) / 2 + (n % 6) * 26 - 60, y = saved ? saved.y : (innerHeight - TB_H - hh) / 2 + (n % 6) * 26 - 50;
        Object.assign(el.style, { left: clamp(x, 0, innerWidth - ww) + 'px', top: clamp(y, 0, innerHeight - TB_H - hh) + 'px', width: ww + 'px', height: hh + 'px' });
        $('wins').appendChild(el);
        const w = { id: ++WM.seq, app: a.id, a, el, body: el.querySelector('.win-body'), title: a.name, min: false, max: false, snap: null, api: {} };
        w.setTitle = t => { w.title = t; el.querySelector('.win-title').textContent = t; el.setAttribute('aria-label', t); renderTaskbar(); };
        w.close = () => closeWin(w);
        w.focus = () => focusWin(w);
        w.setTitle(a.name);
        WM.wins.push(w);
        bindWin(w);
        focusWin(w);
        try { w.api = mod.mount(w, args) || {}; }
        catch (err) { console.error(err); w.body.innerHTML = `<p class="win-err">${esc(a.name)} hit a problem and couldn’t start.</p>`; }
        if (saved && saved.max) toggleMax(w, true);
        setTimeout(() => el.classList.remove('opening'), 220);
        renderTaskbar();
        return w;
    }
    function bindWin(w) {
        const el = w.el;
        el.addEventListener('pointerdown', () => { if (WM.focused !== w) focusWin(w); }, true);
        const bar = el.querySelector('.win-bar');
        bar.addEventListener('pointerdown', e => { if (e.button === 0 && !e.target.closest('button')) dragWin(w, e, 'move'); });
        bar.addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleMax(w); });
        bar.addEventListener('contextmenu', e => {
            e.preventDefault();
            menu(e.clientX, e.clientY, [
                { label: 'Restore', disabled: !w.max && !w.snap, fn: () => w.max ? toggleMax(w, false) : unsnap(w) },
                { label: 'Minimise', fn: () => minimizeWin(w) },
                { label: 'Maximise', disabled: w.max, fn: () => toggleMax(w, true) },
                '-', { label: 'Close', key: 'Alt+F4', fn: () => closeWin(w) },
            ]);
        });
        el.querySelector('.win-ctl').addEventListener('click', e => {
            const c = e.target.closest('[data-c]')?.dataset.c;
            if (c === 'min') minimizeWin(w); else if (c === 'max') toggleMax(w); else if (c === 'close') closeWin(w);
        });
        el.querySelectorAll('.rz').forEach(h => h.addEventListener('pointerdown', e => { if (e.button === 0 && !w.max) dragWin(w, e, h.dataset.d); }));
        el.addEventListener('keydown', e => { if (e.altKey && e.key === 'F4') { e.preventDefault(); closeWin(w); } });
    }
    function bounds(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
    function setBounds(el, b) { Object.assign(el.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' }); }
    function dragWin(w, e, mode) {
        e.preventDefault();
        const el = w.el, sx = e.clientX, sy = e.clientY, tgt = e.target;
        if (mode === 'move' && (w.max || w.snap)) {
            // pulling a maximised / snapped window away restores it under the cursor
            const k = (sx - el.getBoundingClientRect().left) / el.getBoundingClientRect().width;
            if (w.max) toggleMax(w, false); else unsnap(w);
            const b = bounds(el);
            setBounds(el, { ...b, x: sx - b.w * k, y: Math.max(0, sy - 16) });
        }
        const r = el.getBoundingClientRect();
        try { tgt.setPointerCapture(e.pointerId); } catch { }
        document.body.classList.add('win-moving');
        let snap = null;
        const minW = w.a.minW || 320, minH = w.a.minH || 220;
        const move = ev => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (mode === 'move') {
                el.style.left = Math.round(clamp(r.left + dx, 80 - r.width, innerWidth - 80)) + 'px';
                el.style.top = Math.round(clamp(r.top + dy, 0, innerHeight - TB_H - 34)) + 'px';
                snap = ev.clientY <= 3 ? 'max' : ev.clientX <= 3 ? 'left' : ev.clientX >= innerWidth - 4 ? 'right' : null;
                showSnap(snap);
            } else {
                let left = r.left, top = r.top, width = r.width, height = r.height;
                if (mode.includes('e')) width = clamp(r.width + dx, minW, innerWidth - r.left);
                if (mode.includes('s')) height = clamp(r.height + dy, minH, innerHeight - TB_H - r.top);
                if (mode.includes('w')) { width = clamp(r.width - dx, minW, r.right); left = r.right - width; }
                if (mode.includes('n')) { height = clamp(r.height - dy, minH, r.bottom); top = r.bottom - height; }
                setBounds(el, { x: left, y: top, w: width, h: height });
                w.api.onResize?.();
            }
        };
        const up = () => {
            tgt.removeEventListener('pointermove', move);
            tgt.removeEventListener('pointerup', up);
            tgt.removeEventListener('pointercancel', up);
            document.body.classList.remove('win-moving');
            showSnap(null);
            if (snap === 'max') toggleMax(w, true);
            else if (snap) snapHalf(w, snap);
            saveBounds(w);
            w.api.onResize?.();
        };
        tgt.addEventListener('pointermove', move);
        tgt.addEventListener('pointerup', up);
        tgt.addEventListener('pointercancel', up);
    }
    function showSnap(s) {
        const p = $('snapPrev');
        if (!s) { p.hidden = true; return; }
        const half = innerWidth / 2, h = innerHeight - TB_H;
        setBounds(p, s === 'max' ? { x: 0, y: 0, w: innerWidth, h } : { x: s === 'left' ? 0 : half, y: 0, w: half, h });
        p.hidden = false;
    }
    function snapHalf(w, side) {
        if (!w.snap) w.prev = bounds(w.el);
        w.snap = side;
        setBounds(w.el, { x: side === 'left' ? 0 : innerWidth / 2, y: 0, w: innerWidth / 2, h: innerHeight - TB_H });
        w.el.classList.add('snapped');
        w.api.onResize?.();
    }
    function unsnap(w) {
        if (!w.snap) return;
        w.snap = null;
        w.el.classList.remove('snapped');
        if (w.prev) setBounds(w.el, w.prev);
        w.api.onResize?.();
    }
    function toggleMax(w, on = !w.max) {
        w.max = on;
        w.el.classList.toggle('max', on);
        w.el.querySelector('[data-c="max"]').innerHTML = on ? '&#10697;' : '&#9744;';
        w.el.querySelector('[data-c="max"]').title = on ? 'Restore' : 'Maximise';
        saveBounds(w);
        setTimeout(() => w.api.onResize?.(), 200);
    }
    function saveBounds(w) {
        const all = winBounds(), b = w.snap ? w.prev : bounds(w.el);
        if (!b) return;
        all[w.app] = w.max ? { ...(all[w.app] || b), max: true } : { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
        store.set('winBounds', all);
    }
    function focusWin(w) {
        if (!w) return;
        if (++WM.z > 900) { WM.wins.slice().sort((a, b) => a.el.style.zIndex - b.el.style.zIndex).forEach((x, i) => { x.el.style.zIndex = 10 + i; }); WM.z = 10 + WM.wins.length; }
        w.el.style.zIndex = WM.z;
        WM.focused = w;
        WM.wins.forEach(x => x.el.classList.toggle('focused', x === w));
        if (!w.el.contains(document.activeElement)) w.el.focus({ preventScroll: true });
        w.api.onFocus?.();
        renderTaskbar();
    }
    function topWin() { return WM.wins.filter(w => !w.min).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0] || null; }
    function minimizeWin(w) {
        w.min = true;
        w.el.classList.add('minimized');
        if (WM.focused === w) { WM.focused = null; const t = topWin(); if (t) focusWin(t); }
        renderTaskbar();
    }
    function restoreWin(w) {
        w.min = false;
        w.el.classList.remove('minimized');
        focusWin(w);
    }
    async function closeWin(w) {
        if (w.closing) return;
        if (w.api.onClose) {
            w.closing = true;
            const ok = await w.api.onClose();
            w.closing = false;
            if (ok === false) return;
        }
        w.closing = true;
        saveBounds(w);
        try { w.api.onDestroy?.(); } catch (err) { console.error(err); }
        w.el.classList.add('closing');
        setTimeout(() => w.el.remove(), 160);
        WM.wins = WM.wins.filter(x => x !== w);
        if (WM.focused === w) { WM.focused = null; const t = topWin(); if (t) focusWin(t); }
        renderTaskbar();
    }
    let desktopShown = null;
    function showDesktop() {
        if (desktopShown) { desktopShown.forEach(restoreWin); desktopShown = null; return; }
        desktopShown = WM.wins.filter(w => !w.min);
        desktopShown.forEach(minimizeWin);
    }

    // =================================================================
    // Taskbar
    // =================================================================
    const tbPins = () => store.get('tbPins', ['explorer', 'browser', 'notepad', 'paint', 'calculator', 'solitaire', 'settings']).filter(appById);
    function renderTaskbar() {
        if (!$('tbApps')) return;
        const pins = tbPins(), running = [...new Set(WM.wins.map(w => w.app))];
        $('tbApps').innerHTML = [...pins, ...running.filter(id => !pins.includes(id))].map(id => {
            const a = appById(id), ws = WM.wins.filter(w => w.app === id);
            const act = WM.focused && WM.focused.app === id && !WM.focused.min;
            return `<button class="tb-btn tb-app${ws.length ? ' run' : ''}${act ? ' act' : ''}" data-id="${id}" title="${esc(a.name)}${ws.length > 1 ? ` · ${ws.length} windows` : ''}" aria-label="${esc(a.name)}">${a.icon}<i></i></button>`;
        }).join('');
    }
    function taskbarClick(id) {
        const ws = WM.wins.filter(w => w.app === id);
        if (!ws.length) { launch(id); return; }
        const top = ws.slice().sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
        if (WM.focused === top && !top.min) {
            if (ws.length > 1) { const low = ws.slice().sort((a, b) => a.el.style.zIndex - b.el.style.zIndex)[0]; restoreWin(low); }
            else minimizeWin(top);
        } else restoreWin(top.min ? top : top);
    }
    function togglePin(list, key, id) {
        const cur = store.get(key, null) || list();
        store.set(key, cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
    }
    const SVG = {
        start: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent)"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="#0b0e16" stroke-width="2.2"/><circle cx="12" cy="12" r="1.8" fill="#0b0e16"/></svg>',
        search: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        wifi: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.6" fill="currentColor"/></svg>',
        off: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M2 9a15 15 0 0 1 6-3.4M14 8a10 10 0 0 1 5 4.5M17 6a15 15 0 0 1 5 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        vol: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        bat: l => `<svg viewBox="0 0 28 16" width="24" height="14" aria-hidden="true"><rect x="1" y="2" width="23" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="25" y="5.5" width="2" height="5" rx="1" fill="currentColor"/><rect x="3" y="4" width="${(19 * l).toFixed(1)}" height="8" rx="1.5" fill="currentColor"/></svg>`,
        power: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 6.5a7.5 7.5 0 1 0 10 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    };
    let battery = null;

    // =================================================================
    // Start menu
    // =================================================================
    const CATS = ['Productivity', 'Creativity', 'Games', 'Portfolio', 'System', 'Widgets'];
    const DEFAULT_PINS = ['browser', 'explorer', 'notepad', 'paint', 'photos', 'calculator', 'clock', 'settings', 'solitaire', 'widgets', 'wallpaper',
        'p:pixel-racer', 'p:low-poly-strike', 'p:windows-98', 'p:ps-music-player', 'p:parking-puzzle', 'w:music', 'w:weather', 'tips'];
    const startPins = () => (store.get('startPins', null) || DEFAULT_PINS).filter(findL);
    let pinsAll = false, startView = store.get('startView', 'category');
    function tileHtml(l, extra = '') { return `<button class="st-app" data-id="${l.id}" title="${esc(l.name)}">${iconHtml(l)}<span>${esc(l.name)}</span>${extra}</button>`; }
    function renderStart() {
        const pins = startPins();
        $('stPins').innerHTML = (pinsAll ? pins : pins.slice(0, 12)).map(id => tileHtml(findL(id))).join('');
        $('stPinAll').textContent = pinsAll ? 'Show less ‹' : 'Show all ›';
        $('stPinAll').hidden = pins.length <= 12;
        // recommended: recent files first, then apps
        const rec = store.get('recent', []).filter(r => r.k.startsWith('file:') ? FS.exists(r.k.slice(5)) : findL(r.k))
            .sort((a, b) => (b.k.startsWith('file:') - a.k.startsWith('file:')) || b.t - a.t).slice(0, 6);
        $('stRec').innerHTML = rec.length ? rec.map(r => {
            if (r.k.startsWith('file:')) { const f = FS.get(r.k.slice(5)); return `<button class="st-rec-it" data-file="${esc(f.path)}"><span class="ai">${FS.iconOf(f)}</span><span><b>${esc(f.name)}</b><small>${ago(r.t)}</small></span></button>`; }
            const l = findL(r.k);
            return `<button class="st-rec-it" data-id="${l.id}">${iconHtml(l)}<span><b>${esc(l.name)}</b><small>${ago(r.t)}</small></span></button>`;
        }).join('') : `<button class="st-rec-it" data-file="/Documents/Welcome.txt"><span class="ai">${wico('text')}</span><span><b>Welcome.txt</b><small>Start here</small></span></button><button class="st-rec-it" data-id="tips"><span class="ai">${wico('help')}</span><span><b>Tips &amp; shortcuts</b><small>How this desktop works</small></span></button>`;
        renderAll();
    }
    function renderAll() {
        const all = launchables();
        $('stView').textContent = `View: ${{ category: 'Category', grid: 'Grid', list: 'List' }[startView]} ⌄`;
        if (startView === 'category') {
            $('stAll').className = 'st-cats';
            $('stAll').innerHTML = CATS.map(c => {
                const items = all.filter(l => l.cat === c);
                return `<button class="st-cat" data-cat="${c}"><span class="st-cat-box">${items.slice(0, 4).map(iconHtml).join('')}</span><span>${c}</span></button>`;
            }).join('');
        } else if (startView === 'grid') {
            $('stAll').className = 'st-pins';
            $('stAll').innerHTML = all.filter(l => !l.widget).sort((a, b) => a.name.localeCompare(b.name)).map(l => tileHtml(l)).join('');
        } else {
            $('stAll').className = 'st-list';
            let letter = '';
            $('stAll').innerHTML = all.slice().sort((a, b) => a.name.localeCompare(b.name)).map(l => {
                const L = /[a-z]/i.test(l.name[0]) ? l.name[0].toUpperCase() : '#';
                const head = L !== letter ? `<div class="st-letter">${(letter = L)}</div>` : '';
                return head + `<button class="st-row" data-id="${l.id}">${iconHtml(l)}<span>${esc(l.name)}</span>${l.widget ? '<small>Widget</small>' : ''}</button>`;
            }).join('');
        }
    }
    function openFolder(cat) {
        const items = launchables().filter(l => l.cat === cat);
        $('stFolder').innerHTML = `<div class="st-h"><button class="st-back" data-back>‹ Back</button><b>${cat}</b><span></span></div><div class="st-pins">${items.map(l => tileHtml(l)).join('')}</div>`;
        $('stFolder').hidden = false;
        $('stMain').hidden = true;
    }
    const SETTINGS_INDEX = [
        ['Background', 'personal', '🖼️', 'wallpaper photo picture desktop'], ['Colours', 'personal', '🎨', 'accent theme color'],
        ['Lens', 'personal', '🔍', 'reveal shape size pin'], ['Taskbar', 'personal', '▭', 'alignment centre left'],
        ['Notifications', 'system', '🔔', 'do not disturb dnd pop-ups messages'], ['Sound', 'system', '🔊', 'volume music'],
        ['Display', 'system', '🔆', 'brightness dim'], ['Storage', 'system', '💾', 'files space clear'],
        ['Date & time', 'time', '🕒', '24 hour clock format'], ['Weather location', 'time', '📍', 'city weather'],
        ['Apps', 'apps', '🧩', 'reset pinned default'], ['Privacy & security', 'privacy', '🔒', 'clear data reset'],
        ['About', 'about', 'ℹ️', 'device specs version credits'],
    ];
    function search(q) {
        q = q.trim().toLowerCase();
        if (!q) { $('stResults').hidden = true; $('stMain').hidden = false; $('stFolder').hidden = true; return; }
        const score = (name, kw = '') => { name = name.toLowerCase(); return name.startsWith(q) ? 3 : name.split(/\s+/).some(w => w.startsWith(q)) ? 2 : name.includes(q) ? 1 : kw.includes(q) ? 0.5 : 0; };
        const apps = launchables().map(l => ({ l, s: score(l.name, l.kw) })).filter(x => x.s).sort((a, b) => b.s - a.s || a.l.widget - b.l.widget).map(x => x.l);
        const sets = SETTINGS_INDEX.map(s => ({ s, v: score(s[0], s[3]) })).filter(x => x.v).sort((a, b) => b.v - a.v).map(x => x.s);
        const files = FS.search(q).filter(f => f.type === 'file').slice(0, 8);
        const best = apps[0] ? `<button class="st-best" data-id="${apps[0].id}">${iconHtml(apps[0])}<b>${esc(apps[0].name)}</b><small>${apps[0].widget ? 'Widget' : apps[0].cat === 'Portfolio' ? 'Portfolio project' : 'App'}</small></button>`
            : files[0] ? `<button class="st-best" data-file="${esc(files[0].path)}"><span class="ai">${FS.iconOf(files[0])}</span><b>${esc(files[0].name)}</b><small>${esc(FS.dirOf(files[0].path))}</small></button>` : '';
        const sec = (title, html) => html ? `<div class="st-sec"><h4>${title}</h4>${html}</div>` : '';
        $('stResults').innerHTML = (best || sets.length || files.length) ? `<div class="st-res">${best ? `<div class="st-sec"><h4>Best match</h4>${best}</div>` : ''}<div>
            ${sec('Apps', apps.slice(1, 7).map(l => `<button class="st-row" data-id="${l.id}">${iconHtml(l)}<span>${esc(l.name)}</span>${l.widget ? '<small>Widget</small>' : ''}</button>`).join(''))}
            ${sec('Settings', sets.slice(0, 4).map(s => `<button class="st-row" data-set="${s[1]}"><span class="ai">${s[2]}</span><span>${esc(s[0])}</span><small>Settings</small></button>`).join(''))}
            ${sec('Documents', files.slice(apps[0] ? 0 : 1).map(f => `<button class="st-row" data-file="${esc(f.path)}"><span class="ai">${FS.iconOf(f)}</span><span>${esc(f.name)}</span><small>${esc(FS.dirOf(f.path))}</small></button>`).join(''))}</div></div>`
            : `<p class="st-none">No results for “${esc(q)}”</p>`;
        $('stResults').hidden = false;
        $('stMain').hidden = true;
        $('stFolder').hidden = true;
    }
    function openStart(focusSearch) {
        closeFlyouts('start');
        renderStart();
        $('start').hidden = false;
        $('tbStart').classList.add('on');
        requestAnimationFrame(() => $('start').classList.add('show'));
        if (focusSearch) setTimeout(() => $('stQ').focus(), 30);
    }
    function closeStart() {
        if ($('start').hidden) return;
        $('start').classList.remove('show');
        $('tbStart').classList.remove('on');
        $('start').hidden = true;
        $('stQ').value = '';
        search('');
    }
    function startItemMenu(e, id) {
        const l = findL(id);
        if (!l) return;
        const sp = startPins().includes(id), tb = tbPins().includes(id);
        menu(e.clientX, e.clientY, [
            { label: 'Open', fn: () => launch(id) },
            { label: sp ? 'Unpin from Start' : 'Pin to Start', icon: '📌', fn: () => { togglePin(() => DEFAULT_PINS, 'startPins', id); renderStart(); } },
            ...(appById(id) ? [{ label: tb ? 'Unpin from taskbar' : 'Pin to taskbar', fn: () => { togglePin(tbPins, 'tbPins', id); renderTaskbar(); } }] : []),
        ]);
    }

    // =================================================================
    // Quick settings + notification centre + toasts
    // =================================================================
    function closeFlyouts(except) {
        if (except !== 'start') closeStart();
        ['qsFly', 'ncFly'].forEach(id => { if (id !== except && $(id)) $(id).hidden = true; });
        $('tbQs')?.classList.toggle('on', except === 'qsFly');
        $('tbClock')?.classList.toggle('on', except === 'ncFly');
        closeMenu();
    }
    function toggleFly(id) {
        const open = $(id).hidden;
        closeFlyouts(open ? id : null);
        $(id).hidden = !open;
        if (!open) return;
        $('wtoasts').innerHTML = '';   // pop-ups would cover the flyout
        if (id === 'qsFly') { renderQS($('qsTiles')); $('qsDim').value = store.get('dim', 1); $('qsVol').value = Music.audio.volume; renderBattery(); }
        else { renderNC(); renderCal(); }
    }
    function renderNC() {
        $('ncList').innerHTML = notifs.length ? notifs.map(n => `<div class="nc-card" data-nid="${n.id}" role="button" tabindex="0"><span class="nc-ic" style="background:${n.color}">${n.icon}</span><div class="nc-b"><div class="nc-meta"><b>${esc(n.app)}</b> · ${ago(n.t)}</div><div class="nc-t">${esc(n.title)}</div><div class="nc-x">${esc(n.text)}</div></div><button class="nc-close" data-x aria-label="Dismiss">✕</button></div>`).join('') : '<p class="nc-none">No new notifications</p>';
        $('ncClear').hidden = !notifs.length;
        $('ncDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    }
    let calOff = 0;
    function renderCal() {
        const now = new Date(), v = new Date(now.getFullYear(), now.getMonth() + calOff, 1), y = v.getFullYear(), m = v.getMonth();
        const first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
        $('ncMonth').textContent = v.toLocaleString(undefined, { month: 'long', year: 'numeric' });
        let h = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => `<b>${d}</b>`).join('') + '<i></i>'.repeat(first);
        for (let d = 1; d <= days; d++) h += `<i class="${calOff === 0 && d === now.getDate() ? 'today' : ''}">${d}</i>`;
        $('ncGrid').innerHTML = h;
    }
    function notify(n) {
        if (!inited) return;
        updateBell();
        if (!$('ncFly').hidden) renderNC();
        if (dnd || document.hidden) return;
        const t = document.createElement('div');
        t.className = 'wtoast';
        t.dataset.nid = n.id;
        t.innerHTML = `<div class="wt-head"><span class="wt-ic" style="background:${n.color}">${n.icon}</span><b>${esc(n.app)}</b><button data-x aria-label="Dismiss">✕</button></div><div class="wt-t">${esc(n.title)}</div><div class="wt-x">${esc(n.text)}</div>`;
        $('wtoasts').appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        const hide = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
        let tm = setTimeout(hide, 6500);
        t.onmouseenter = () => clearTimeout(tm);
        t.onmouseleave = () => { tm = setTimeout(hide, 2500); };
        t.onclick = e => { hide(); if (e.target.closest('[data-x]')) return; runNotif(n.id); };
        while ($('wtoasts').children.length > 3) $('wtoasts').firstChild.remove();
    }
    function updateBell() { $('tbBell')?.classList.toggle('on', notifs.length > 0); if ($('tbBell')) $('tbBell').textContent = notifs.length > 9 ? '9+' : notifs.length || ''; }
    function renderBattery() {
        if (!battery) { $('tbBat').innerHTML = ''; $('qsBat').textContent = ''; return; }
        const pct = Math.round(battery.level * 100);
        $('tbBat').innerHTML = SVG.bat(battery.level);
        $('tbBat').title = `Battery ${pct}%${battery.charging ? ', charging' : ''}`;
        $('qsBat').textContent = `🔋 ${pct}%${battery.charging ? ' · charging' : ''}`;
    }
    function renderWx() {
        const d = Weather.data;
        if (d && d.cur) {
            const [ic, txt] = wxOf(d.cur.weather_code);
            $('tbWidgets').innerHTML = `<span class="tb-wx-ic">${ic}</span><span class="tb-wx-t"><b>${Math.round(d.cur.temperature_2m)}°C</b><small>${esc(txt)}</small></span>`;
        } else $('tbWidgets').innerHTML = '<span class="tb-wx-ic">🧩</span><span class="tb-wx-t"><b>Widgets</b><small>Weather, music…</small></span>';
    }

    // =================================================================
    // Context menu + dialogs
    // =================================================================
    let menuEl = null;
    function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
    function menu(x, y, items) {
        closeMenu();
        const m = document.createElement('div');
        m.className = 'ctx';
        m.setAttribute('role', 'menu');
        m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button role="menuitem" data-i="${i}" ${it.disabled ? 'disabled' : ''}><span class="ci">${it.check != null ? (it.check ? '✓' : '') : it.icon || ''}</span><span class="cl">${esc(it.label)}</span>${it.key ? `<kbd>${esc(it.key)}</kbd>` : ''}</button>`).join('');
        document.body.appendChild(m);
        const r = m.getBoundingClientRect();
        m.style.left = clamp(x, 4, innerWidth - r.width - 4) + 'px';
        m.style.top = (y + r.height > innerHeight - 4 ? Math.max(4, y - r.height) : y) + 'px';
        m.addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; closeMenu(); items[+b.dataset.i].fn?.(); });
        m.addEventListener('contextmenu', e => e.preventDefault());
        menuEl = m;
        m.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
        m.addEventListener('keydown', e => {
            const bs = [...m.querySelectorAll('button:not([disabled])')], i = bs.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
            if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); }
        });
    }
    function modal(html, cls = '') {
        const back = document.createElement('div');
        back.className = 'dlg-back';
        back.innerHTML = `<div class="dlg ${cls}" role="dialog" aria-modal="true">${html}</div>`;
        document.body.appendChild(back);
        return { el: back.querySelector('.dlg'), close: () => back.remove() };
    }
    function ask({ title, label = '', value = '', ok = 'OK', select = true }) {
        return new Promise(res => {
            const d = modal(`<h3>${esc(title)}</h3>${label ? `<p>${esc(label)}</p>` : ''}<input type="text" class="dlg-in" value="${esc(value)}"><footer><button class="wbtn pri" data-ok>${esc(ok)}</button><button class="wbtn" data-no>Cancel</button></footer>`);
            const inp = d.el.querySelector('input');
            const done = v => { d.close(); res(v); };
            d.el.querySelector('[data-ok]').onclick = () => done(inp.value.trim() || null);
            d.el.querySelector('[data-no]').onclick = () => done(null);
            inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
            inp.focus();
            if (select) { const dot = value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : value.length); }
        });
    }
    function confirmDlg(text, ok = 'OK', title = 'Are you sure?') {
        return new Promise(res => {
            const d = modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><footer><button class="wbtn pri" data-ok>${esc(ok)}</button><button class="wbtn" data-no>Cancel</button></footer>`);
            const done = v => { d.close(); res(v); };
            d.el.querySelector('[data-ok]').onclick = () => done(true);
            d.el.querySelector('[data-no]').onclick = () => done(false);
            d.el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
            d.el.querySelector('[data-ok]').focus();
        });
    }
    // Open / Save dialog over the virtual file system.
    // Resolves { path } for a file here, { file } for one picked from the device, or null.
    function filePicker({ mode = 'open', title, dir = '/Documents', name = '', exts = null }) {
        return new Promise(res => {
            let cur = FS.exists(dir) ? dir : '/Documents', chosen = null;
            const d = modal(`<h3>${esc(title || (mode === 'save' ? 'Save as' : 'Open'))}</h3>
                <div class="fp"><nav class="fp-side">${['/Desktop', '/Documents', '/Downloads', '/Pictures', '/Music'].map(p => `<button data-go="${p}">${FS.dirIcon(p)} ${p.slice(1)}</button>`).join('')}</nav>
                <div class="fp-main"><div class="fp-path"><button data-up aria-label="Up">↑</button><span class="fp-crumb"></span>${mode === 'save' ? '<button data-new>New folder</button>' : ''}</div><div class="fp-list"></div></div></div>
                <footer>${mode === 'save' ? '<input type="text" class="dlg-in fp-name" aria-label="File name">' : '<button class="wbtn" data-dev>From this device…</button><span class="grow"></span>'}<button class="wbtn pri" data-ok>${mode === 'save' ? 'Save' : 'Open'}</button><button class="wbtn" data-no>Cancel</button></footer>
                <input type="file" hidden ${exts ? `accept="${exts.map(e => '.' + e).join(',')}"` : ''}>`, 'dlg-wide');
            const list = d.el.querySelector('.fp-list'), nameIn = d.el.querySelector('.fp-name');
            if (nameIn) nameIn.value = name;
            const ok = f => !exts || f.type === 'dir' || exts.includes(FS.extOf(f.path));
            const done = v => { d.close(); res(v); };
            function render() {
                d.el.querySelector('.fp-crumb').textContent = cur === '/' ? 'This PC' : cur.slice(1).replace(/\//g, ' › ');
                const items = FS.list(cur).filter(ok);
                list.innerHTML = items.length ? items.map(f => `<button class="fp-it ${chosen === f.path ? 'sel' : ''}" data-p="${esc(f.path)}"><span class="fp-ic">${FS.iconOf(f)}</span><span>${esc(f.name)}</span><small>${f.type === 'dir' ? 'Folder' : FS.sizeTxt(f.size)}</small></button>`).join('') : '<p class="fp-empty">Nothing here</p>';
                d.el.querySelectorAll('[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === cur));
            }
            async function finish() {
                if (mode === 'open') { if (chosen && FS.get(chosen)?.type === 'file') done({ path: chosen }); return; }
                let n = FS.clean(nameIn.value);
                if (!n) return nameIn.focus();
                if (exts && !exts.includes(FS.extOf(n))) n += '.' + exts[0];
                if (!FS.canWrite(cur)) { toast('You can’t save in this folder'); return; }
                const p = FS.norm(cur + '/' + n);
                if (FS.exists(p) && !(await confirmDlg(`“${n}” already exists. Replace it?`, 'Replace'))) return;
                done({ path: p });
            }
            list.addEventListener('click', e => {
                const it = e.target.closest('.fp-it'); if (!it) return;
                const f = FS.get(it.dataset.p);
                chosen = f.path;
                if (f.type === 'file' && nameIn) nameIn.value = f.name;
                render();
            });
            list.addEventListener('dblclick', e => {
                const it = e.target.closest('.fp-it'); if (!it) return;
                const f = FS.get(it.dataset.p);
                if (f.type === 'dir') { cur = f.path; chosen = null; render(); } else { chosen = f.path; finish(); }
            });
            d.el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { cur = b.dataset.go; chosen = null; render(); });
            d.el.querySelector('[data-up]').onclick = () => { if (cur !== '/') { cur = FS.dirOf(cur); chosen = null; render(); } };
            d.el.querySelector('[data-new]')?.addEventListener('click', async () => {
                if (!FS.canWrite(cur)) return toast('You can’t make a folder here');
                const n = await ask({ title: 'New folder', value: 'New folder' });
                if (n) { await FS.mkdir(FS.unique(cur, FS.clean(n))); render(); }
            });
            d.el.querySelector('[data-ok]').onclick = finish;
            d.el.querySelector('[data-no]').onclick = () => done(null);
            const fileIn = d.el.querySelector('input[type=file]');
            d.el.querySelector('[data-dev]')?.addEventListener('click', () => fileIn.click());
            fileIn.onchange = () => { if (fileIn.files[0]) done({ file: fileIn.files[0] }); };
            d.el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } if (e.key === 'Enter' && e.target === nameIn) finish(); });
            nameIn?.addEventListener('focus', () => { const i = nameIn.value.lastIndexOf('.'); nameIn.setSelectionRange(0, i > 0 ? i : nameIn.value.length); }, { once: true });
            render();
            (nameIn || d.el.querySelector('[data-ok]')).focus();
        });
    }

    // =================================================================
    // Desktop icons
    // =================================================================
    const SYS_ICONS = [
        { k: 'pc', name: 'This PC', icon: wico('pc'), open: () => launch('explorer', { path: '/' }) },
        { k: 'bin', name: 'Recycle Bin', icon: wico('recycle'), open: () => launch('explorer', { path: '/Recycle Bin' }) },
        { k: 'browser', name: 'Browser', icon: wico('browser'), open: () => launch('browser') },
        { k: 'solitaire', name: 'Solitaire', icon: '🃏', open: () => launch('solitaire') },
        { k: 'notepad', name: 'Notepad', icon: wico('notepad'), open: () => launch('notepad') },
        { k: 'paint', name: 'Paint', icon: wico('paint'), open: () => launch('paint') },
        { k: 'portfolio', name: 'Portfolio', icon: wico('home'), open: () => leave('../../index.html') },
    ];
    function renderDesk() {
        const files = FS.list('/Desktop');
        $('deskIcons').innerHTML = SYS_ICONS.map(s => `<button class="dicon" data-k="${s.k}"><span class="di-ic">${s.icon}</span><span class="di-nm">${esc(s.name)}</span></button>`).join('')
            + files.map(f => `<button class="dicon" data-p="${esc(f.path)}"><span class="di-ic">${FS.iconOf(f)}</span><span class="di-nm">${esc(f.name)}</span></button>`).join('');
    }
    function openIcon(b) {
        if (b.dataset.k) SYS_ICONS.find(s => s.k === b.dataset.k).open();
        else openPath(b.dataset.p);
    }
    async function newOnDesktop(kind) {
        if (kind === 'folder') await FS.mkdir(FS.unique('/Desktop', 'New folder'));
        else await FS.write(FS.unique('/Desktop', 'New text document.txt'), '');
    }

    // =================================================================
    // Alarms + timers (keep working while the Clock app is closed)
    // =================================================================
    const clock = {
        alarms: () => store.get('alarms', [{ id: 1, h: 7, m: 30, label: 'Wake up', on: false, days: [1, 2, 3, 4, 5] }]),
        saveAlarms: a => { store.set('alarms', a); document.dispatchEvent(new CustomEvent('clocksvc')); },
        timers: () => store.get('timers', [{ id: 1, label: '1 min', total: 6e4 }, { id: 2, label: '3 min', total: 18e4 }, { id: 3, label: '5 min', total: 3e5 }, { id: 4, label: 'Tea', total: 24e4 }]),
        saveTimers: t => { store.set('timers', t); document.dispatchEvent(new CustomEvent('clocksvc')); },
        ring(title, text) {
            chime([880, 660, 880, 660, 990]);
            addNotif({ app: 'Clock', icon: '⏰', color: '#ff8a5b', title, text, act: isPhone() ? 'app:clock' : 'win:clock' });
            toast('⏰ ' + title, 4000);
        },
        check(now) {
            if (now.getSeconds() === 0) {
                let changed = false;
                const al = clock.alarms();
                al.forEach(a => {
                    if (!a.on || a.h !== now.getHours() || a.m !== now.getMinutes()) return;
                    if (a.days && a.days.length && !a.days.includes(now.getDay())) return;
                    clock.ring(a.label || 'Alarm', `${pad(a.h)}:${pad(a.m)}`);
                    if (!a.days || !a.days.length) { a.on = false; changed = true; }
                });
                if (changed) clock.saveAlarms(al);
            }
            const ts = clock.timers();
            if (ts.some(t => t.end && t.end <= Date.now())) {
                ts.forEach(t => { if (t.end && t.end <= Date.now()) { t.end = null; t.left = null; clock.ring('Timer done', t.label); } });
                clock.saveTimers(ts);
            }
        },
    };

    // =================================================================
    // Wallpapers from your own photos
    // =================================================================
    async function loadCustomBgs() {
        store.get('customBgs', []).forEach(c => {
            if (FS.exists(c.path) && FS.exists(c.blur) && !BGS.some(b => b.custom === c.path)) BGS.push({ name: c.name, clear: FS.urlOf(c.path), blur: FS.urlOf(c.blur), custom: c.path });
        });
        if (BG_WANT < BGS.length && BG_WANT !== bgIndex) setBg(BG_WANT);
        renderBgChoices();
    }
    function canvasBlob(cv, q) { return new Promise(r => cv.toBlob(r, 'image/webp', q)); }
    async function addWallpaper(blob, name) {
        const img = await createImageBitmap(blob);
        const k = Math.min(1, 2400 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        // the blurred copy: shrink a lot, then scale back up smoothly (works in every browser)
        const tiny = document.createElement('canvas');
        tiny.width = 48; tiny.height = Math.max(1, Math.round(48 * c.height / c.width));
        tiny.getContext('2d').drawImage(c, 0, 0, tiny.width, tiny.height);
        const bl = document.createElement('canvas');
        bl.width = 720; bl.height = Math.round(720 * c.height / c.width);
        const g = bl.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(tiny, 0, 0, bl.width, bl.height);
        const base = FS.clean(name.replace(/\.[^.]+$/, '')) || 'Wallpaper';
        const path = await FS.write(FS.unique('/Pictures/My wallpapers', base + '.webp'), await canvasBlob(c, 0.86), 'image/webp');
        const blur = await FS.write(FS.unique('/.wallpapers', base + '-blur.webp'), await canvasBlob(bl, 0.7), 'image/webp');
        const list = store.get('customBgs', []);
        list.push({ name: base, path, blur });
        store.set('customBgs', list);
        BGS.push({ name: base, clear: FS.urlOf(path), blur: FS.urlOf(blur), custom: path });
        setBg(BGS.length - 1);
        renderBgChoices();
        toast('Wallpaper set');
    }
    async function removeWallpaper(path) {
        const list = store.get('customBgs', []), c = list.find(x => x.path === path);
        if (!c) return;
        store.set('customBgs', list.filter(x => x !== c));
        const i = BGS.findIndex(b => b.custom === path);
        if (i >= 0) BGS.splice(i, 1);
        setBg(0);
        renderBgChoices();
        await FS.purge(c.blur).catch(() => { });
    }
    // a quick picker: built-in wallpapers, your own photos, brightness
    function wallpaperPicker() {
        closeFlyouts();
        if (document.querySelector('.dlg-wp')) return;
        const d = modal(`<h3>Change wallpaper</h3><p>Pick a background, or use one of your own photos. The lens shows it sharp.</p>
            <div class="wp-grid"></div>
            <label class="wp-dim"><span>Brightness</span><input type="range" min="0.35" max="1" step="0.01" aria-label="Wallpaper brightness"></label>
            <footer><button class="wbtn" data-up>${wico('upload')}Use my photo…</button><span class="grow"></span><button class="wbtn pri" data-ok>Done</button></footer>
            <input type="file" accept="image/*" hidden>`, 'dlg-wide dlg-wp');
        const grid = d.el.querySelector('.wp-grid'), file = d.el.querySelector('input[type=file]'), dim = d.el.querySelector('.wp-dim input');
        const render = () => {
            grid.innerHTML = BGS.map((g, i) => `<button class="wp-it ${i === bgIndex ? 'on' : ''}" data-i="${i}" aria-pressed="${i === bgIndex}"><img src="${esc(g.clear)}" alt="" loading="lazy"><span>${esc(g.name)}</span>${g.custom ? `<i data-rm="${esc(g.custom)}" title="Remove" role="button" aria-label="Remove ${esc(g.name)}">✕</i>` : ''}</button>`).join('');
        };
        grid.addEventListener('click', async e => {
            const rm = e.target.closest('[data-rm]');
            if (rm) { e.stopPropagation(); await removeWallpaper(rm.dataset.rm); render(); return; }
            const it = e.target.closest('[data-i]');
            if (it) { setBg(+it.dataset.i); render(); }
        });
        dim.value = store.get('dim', 1);
        dim.oninput = () => setDim(+dim.value);
        d.el.querySelector('[data-up]').onclick = () => file.click();
        file.onchange = () => { const f = file.files[0]; file.value = ''; if (f) addWallpaper(f, f.name).then(render).catch(() => toast('Couldn’t use that picture')); };
        d.el.querySelector('[data-ok]').onclick = d.close;
        d.el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); d.close(); } });
        d.el.parentElement.addEventListener('pointerdown', e => { if (e.target === d.el.parentElement) d.close(); });
        render();
        d.el.querySelector('[data-ok]').focus();
    }
    // any picture in the file system can become the wallpaper
    async function useAsWallpaper(path) {
        const f = FS.get(path);
        if (!f) return;
        const i = BGS.findIndex(b => b.clear === f.url || b.custom === f.path);
        if (i >= 0) { setBg(i); toast('Wallpaper set'); return; }
        addWallpaper(await FS.readBlob(path), f.name).catch(() => toast('Couldn’t use that picture'));
    }

    // =================================================================
    // Build the shell (desktop only; called again harmlessly)
    // =================================================================
    let inited = false;   // dnd (do not disturb) is shared with the phone, in wd/phone.js
    function power(e) {
        const r = e.currentTarget.getBoundingClientRect();
        menu(r.left, r.top - 130, [
            { label: 'Sleep', icon: '🌙', fn: sleep },
            { label: 'Restart', icon: wico('refresh'), fn: () => location.reload() },
            { label: 'Shut down', icon: '⏻', fn: () => leave('../../index.html') },
        ]);
    }
    function sleep() {
        closeFlyouts();
        const s = $('sleep');
        s.hidden = false;
        requestAnimationFrame(() => s.classList.add('on'));
        const wake = () => { s.classList.remove('on'); setTimeout(() => { s.hidden = true; }, 400); removeEventListener('keydown', wake, true); };
        s.onpointerdown = wake;
        setTimeout(() => addEventListener('keydown', wake, true), 300);
    }
    function init() {
        if (inited) return;
        inited = true;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="desk-icons" id="deskIcons" aria-label="Desktop"></div>
            <div id="wins"></div>
            <div class="snap-prev" id="snapPrev" hidden></div>
            <nav class="taskbar" id="taskbar" aria-label="Taskbar">
                <button class="tb-wx" id="tbWidgets" title="Widgets (W)"></button>
                <div class="tb-mid"><button class="tb-btn tb-start" id="tbStart" title="Start" aria-label="Start">${SVG.start}</button><button class="tb-btn" id="tbSearch" title="Search" aria-label="Search">${SVG.search}</button><span class="tb-apps" id="tbApps"></span></div>
                <div class="tb-tray"><button class="tb-qs" id="tbQs" title="Quick settings"><span id="tbNet">${SVG.wifi}</span><span>${SVG.vol}</span><span id="tbBat"></span></button>
                    <button class="tb-clock" id="tbClock" title="Notifications and calendar"><span id="tbTime"></span><span id="tbDate"></span></button><span class="tb-bell" id="tbBell"></span><button class="tb-show" id="tbShow" title="Show desktop" aria-label="Show desktop"></button></div>
            </nav>
            <div class="start" id="start" hidden role="dialog" aria-label="Start">
                <div class="st-search">${SVG.search}<input id="stQ" type="text" placeholder="Search for apps, settings, and documents" autocomplete="off" spellcheck="false"></div>
                <div class="st-scroll">
                    <section id="stMain">
                        <div class="st-h"><b>Pinned</b><button class="st-link" id="stPinAll">Show all ›</button></div>
                        <div class="st-pins" id="stPins"></div>
                        <div class="st-h"><b>Recommended</b></div>
                        <div class="st-rec" id="stRec"></div>
                        <div class="st-h"><b>All</b><button class="st-link" id="stView"></button></div>
                        <div id="stAll"></div>
                    </section>
                    <section id="stFolder" hidden></section>
                    <section id="stResults" hidden></section>
                </div>
                <div class="st-foot"><button class="st-user" id="stUser"><span class="st-av">V</span><span>Volkan</span></button><button class="st-power" id="stPower" title="Power" aria-label="Power">${SVG.power}</button></div>
            </div>
            <div class="flyout qsf" id="qsFly" hidden role="dialog" aria-label="Quick settings">
                <div class="qsf-tiles" id="qsTiles"></div>
                <label class="qsf-sl"><span aria-hidden="true">🔆</span><input type="range" id="qsDim" min="0.35" max="1" step="0.01" aria-label="Wallpaper brightness"></label>
                <label class="qsf-sl"><span aria-hidden="true">🔊</span><input type="range" id="qsVol" min="0" max="1" step="0.01" aria-label="Music volume"></label>
                <div class="qsf-foot"><span id="qsBat"></span><button class="tb-btn" id="qsGear" title="All settings" aria-label="All settings">⚙️</button></div>
            </div>
            <div class="flyout ncf" id="ncFly" hidden role="dialog" aria-label="Notifications">
                <div class="ncf-box"><div class="ncf-head"><b>Notifications</b><button class="st-link" id="ncClear">Clear all</button></div><div class="ncf-list" id="ncList"></div></div>
                <div class="ncf-box"><div class="ncf-head"><b id="ncDate"></b></div><div class="ncf-ch"><b id="ncMonth"></b><span><button class="tb-btn" id="ncPrev" aria-label="Previous month">˄</button><button class="tb-btn" id="ncNext" aria-label="Next month">˅</button></span></div><div class="ncf-grid" id="ncGrid"></div></div>
            </div>
            <div class="wtoasts" id="wtoasts" aria-live="polite"></div>
            <div class="sleep" id="sleep" hidden><span>Click or press a key to wake</span></div>`);

        // taskbar
        $('tbStart').onclick = () => $('start').hidden ? openStart() : closeStart();
        $('tbSearch').onclick = () => $('start').hidden ? openStart(true) : closeStart();
        $('tbWidgets').onclick = () => setBoard(!boardOpen);
        $('tbWidgets').title = 'Show or hide widgets (W)';
        $('tbQs').onclick = () => toggleFly('qsFly');
        $('tbClock').onclick = () => toggleFly('ncFly');
        $('tbShow').onclick = showDesktop;
        $('tbApps').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) taskbarClick(b.dataset.id); });
        $('tbApps').addEventListener('contextmenu', e => {
            const b = e.target.closest('[data-id]'); if (!b) return;
            e.preventDefault();
            const id = b.dataset.id, a = appById(id), ws = WM.wins.filter(w => w.app === id), r = b.getBoundingClientRect();
            menu(r.left, r.top - 8, [
                ...(!a.single || !ws.length ? [{ label: a.name, icon: a.icon, fn: () => a.single ? launch(id) : loadApp(id).then(m => createWin(a, m, {})) }] : []),
                { label: tbPins().includes(id) ? 'Unpin from taskbar' : 'Pin to taskbar', icon: '📌', fn: () => { togglePin(tbPins, 'tbPins', id); renderTaskbar(); } },
                ...(ws.length ? ['-', { label: ws.length > 1 ? 'Close all windows' : 'Close window', icon: '✕', fn: () => ws.forEach(closeWin) }] : []),
            ]);
        });
        $('taskbar').addEventListener('contextmenu', e => {
            if (e.target.closest('[data-id]')) return;
            e.preventDefault();
            menu(e.clientX, e.clientY - 80, [{ label: 'Taskbar settings', icon: wico('settings'), fn: () => launch('settings', { page: 'personal' }) }, { label: 'Show desktop', fn: showDesktop }]);
        });

        // start menu
        $('stQ').addEventListener('input', () => search($('stQ').value));
        $('stQ').addEventListener('keydown', e => {
            if (e.key === 'Enter') { const b = $('stResults').querySelector('.st-best, .st-row'); if (b) b.click(); }
            if (e.key === 'Escape') { e.stopPropagation(); closeStart(); }
        });
        $('stPinAll').onclick = () => { pinsAll = !pinsAll; renderStart(); };
        $('stView').onclick = e => {
            const r = e.currentTarget.getBoundingClientRect();
            menu(r.left, r.bottom + 4, ['category', 'grid', 'list'].map(v => ({ label: { category: 'Category', grid: 'Grid', list: 'List' }[v], check: startView === v, fn: () => { startView = v; store.set('startView', v); renderAll(); } })));
        };
        $('start').addEventListener('click', e => {
            const t = e.target;
            if (t.closest('[data-back]')) { $('stFolder').hidden = true; $('stMain').hidden = false; return; }
            const cat = t.closest('[data-cat]');
            if (cat) { openFolder(cat.dataset.cat); return; }
            const f = t.closest('[data-file]');
            if (f) { closeStart(); openPath(f.dataset.file); return; }
            const s = t.closest('[data-set]');
            if (s) { closeStart(); launch('settings', { page: s.dataset.set }); return; }
            const a = t.closest('[data-id]');
            if (a) { closeStart(); launch(a.dataset.id); }
        });
        $('start').addEventListener('contextmenu', e => { const a = e.target.closest('[data-id]'); if (a) { e.preventDefault(); startItemMenu(e, a.dataset.id); } });
        $('stPower').onclick = power;
        $('stUser').onclick = e => {
            const r = e.currentTarget.getBoundingClientRect();
            menu(r.left, r.top - 130, [
                { label: 'Account & about', icon: wico('info'), fn: () => { closeStart(); launch('settings', { page: 'about' }); } },
                { label: 'Tips & shortcuts', icon: wico('help'), fn: () => { closeStart(); togglePanel('help'); } },
                { label: 'Back to the portfolio', icon: wico('home'), fn: () => leave('../../index.html') },
            ]);
        };

        // quick settings + notification centre
        $('qsTiles').addEventListener('click', e => {
            const b = e.target.closest('.qt'); if (!b) return;
            QS.find(q => q.id === b.dataset.q).tap();
            setTimeout(() => renderQS($('qsTiles')), 60);
        });
        $('qsDim').oninput = e => setDim(+e.target.value);
        $('qsVol').oninput = e => { Music.audio.volume = +e.target.value; store.set('vol', Music.audio.volume); const v = byId('music')?.querySelector('.vol'); if (v) v.value = Music.audio.volume; };
        $('qsGear').onclick = () => launch('settings');
        $('ncClear').onclick = () => { notifs = []; saveNotifs(); updateStatus(); renderNC(); };
        $('ncList').addEventListener('click', e => {
            const c = e.target.closest('.nc-card'); if (!c) return;
            if (e.target.closest('[data-x]')) { dismiss(c.dataset.nid); renderNC(); return; }
            closeFlyouts();
            runNotif(c.dataset.nid);
        });
        $('ncPrev').onclick = () => { calOff--; renderCal(); };
        $('ncNext').onclick = () => { calOff++; renderCal(); };
        document.addEventListener('notifs', () => { updateBell(); if (!$('ncFly').hidden) renderNC(); });

        // desktop icons
        $('deskIcons').addEventListener('click', e => {
            const b = e.target.closest('.dicon');
            $('deskIcons').querySelectorAll('.sel').forEach(x => x.classList.toggle('sel', x === b));
            if (b) { b.classList.add('sel'); if (e.pointerType === 'touch' || e.detail === 0) openIcon(b); }
        });
        $('deskIcons').addEventListener('dblclick', e => { const b = e.target.closest('.dicon'); if (b) openIcon(b); });
        $('deskIcons').addEventListener('keydown', e => { const b = e.target.closest('.dicon'); if (b && e.key === 'Enter') { e.preventDefault(); openIcon(b); } });
        document.addEventListener('contextmenu', e => {
            if (isPhone() || e.target.closest('.win, .taskbar, .start, .flyout, #desk, .panel, .ctx, .dlg-back, .wtoast, input, textarea')) return;
            e.preventDefault();
            const icon = e.target.closest('.dicon');
            if (icon && icon.dataset.p) {
                const p = icon.dataset.p;
                return menu(e.clientX, e.clientY, [
                    { label: 'Open', fn: () => openPath(p) },
                    { label: 'Rename', fn: async () => { const n = await ask({ title: 'Rename', value: FS.baseOf(p) }); if (n) FS.move(p, FS.dirOf(p) + '/' + FS.clean(n)).catch(err => toast(err.message)); } },
                    { label: 'Download', disabled: FS.get(p).type === 'dir', fn: () => FS.download(p) },
                    '-', { label: 'Delete', icon: wico('delete'), fn: () => FS.remove(p).catch(err => toast(err.message)) },
                ]);
            }
            if (icon) return menu(e.clientX, e.clientY, [{ label: 'Open', fn: () => openIcon(icon) }]);
            menu(e.clientX, e.clientY, [
                { label: 'New folder', icon: wico('newfolder'), fn: () => newOnDesktop('folder') },
                { label: 'New text document', icon: wico('newfile'), fn: () => newOnDesktop('text') },
                '-',
                { label: 'Change wallpaper…', icon: wico('photos'), fn: wallpaperPicker },
                { label: 'Next wallpaper', icon: wico('forward'), key: 'B', fn: () => setBg(bgIndex + 1) },
                { label: boardOpen ? 'Hide widgets' : 'Show widgets', icon: wico('widgets'), key: 'W', fn: () => setBoard(!boardOpen) },
                '-',
                { label: 'Personalise', icon: wico('paint'), fn: () => launch('settings', { page: 'personal' }) },
                { label: 'Display settings', icon: wico('pc'), fn: () => launch('settings', { page: 'system' }) },
            ]);
        });
        // drop files from your computer onto the desktop
        document.addEventListener('dragover', e => { if (!isPhone() && e.dataTransfer?.types.includes('Files') && !e.target.closest('.win')) e.preventDefault(); });
        document.addEventListener('drop', e => {
            if (isPhone() || e.target.closest('.win') || !e.dataTransfer?.files.length) return;
            e.preventDefault();
            FS.importFiles(e.dataTransfer.files, '/Desktop').then(ps => toast(`${ps.length} file${ps.length > 1 ? 's' : ''} added to the desktop`)).catch(err => toast(err.message));
        });
        document.addEventListener('fs', e => { if (e.detail.dir === '/Desktop') renderDesk(); });

        // clicking elsewhere closes menus, flyouts and the widgets board
        document.addEventListener('pointerdown', e => {
            if (isPhone()) return;
            const t = e.target;
            if (!t.closest('.ctx')) closeMenu();
            if (!t.closest('#start, #tbStart, #tbSearch, .ctx')) closeStart();
            if (!t.closest('#qsFly, #tbQs')) { $('qsFly').hidden = true; $('tbQs').classList.remove('on'); }
            if (!t.closest('#ncFly, #tbClock')) { $('ncFly').hidden = true; $('tbClock').classList.remove('on'); }
            if (!t.closest('.dicon')) $('deskIcons').querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
        }, true);
        addEventListener('resize', () => {
            WM.wins.forEach(w => {
                if (w.snap) snapHalf(w, w.snap);
                else if (!w.max) { const b = bounds(w.el); setBounds(w.el, { ...b, x: clamp(b.x, 80 - b.w, innerWidth - 80), y: clamp(b.y, 0, Math.max(0, innerHeight - TB_H - 34)) }); }
                w.api.onResize?.();
            });
        });

        if (navigator.getBattery) navigator.getBattery().then(b => { battery = b; renderBattery(); b.addEventListener('levelchange', renderBattery); b.addEventListener('chargingchange', renderBattery); }).catch(() => { });
        const net = () => { $('tbNet').innerHTML = navigator.onLine ? SVG.wifi : SVG.off; $('tbNet').title = navigator.onLine ? 'Online' : 'Offline'; };
        net(); addEventListener('online', net); addEventListener('offline', net);
        document.addEventListener('wx', renderWx);
        renderWx();
        setTaskbarAlign(store.get('tbAlign', 'left'));
        renderTaskbar();
        updateBell();
        tick(new Date());
        FS.ready.then(() => { renderDesk(); loadCustomBgs(); });
        if (!store.get('shellHint', false)) { store.set('shellHint', true); setTimeout(() => toast('Click Start for apps · W for widgets', 4000), 1200); }
    }
    function setTaskbarAlign(a) { store.set('tbAlign', a); document.body.classList.toggle('tb-left', a === 'left'); }
    function tick(now) {
        if (!inited) return;
        const h24 = store.get('h24', true);
        $('tbTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !h24 });
        $('tbDate').textContent = now.toLocaleDateString();
    }
    function escape() {
        if (menuEl) return closeMenu();
        if (!$('start')?.hidden) return closeStart();
        if ($('qsFly') && (!$('qsFly').hidden || !$('ncFly').hidden)) return closeFlyouts();
        if (!$('launcher').hidden) $('launcher').hidden = true;
    }

    return {
        init, tick, escape, launch, openPath, runAct, notify, menu, ask, confirm: confirmDlg, filePicker, clock,
        addWallpaper, removeWallpaper, useAsWallpaper, wallpaperPicker, setTaskbarAlign, iconHtml, findL, addRecent, apps: APPS,
        refreshTaskbar: renderTaskbar,
        get wins() { return WM.wins; },
    };
})();
