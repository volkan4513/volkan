// Widget Desktop - framework: builds widgets from WIDGETS, desktop drag /
// resize / layouts, the dock + panels, and the Android-style phone home.
'use strict';
const byId = id => document.querySelector(`.widget[data-w="${id}"]`);
const defOf = id => WIDGETS.find(w => w.id === id);
const DEFAULT_SET = ['clock', 'calendar', 'date', 'weather', 'music', 'system', 'sky'];
const PRESETS = {
    Default: DEFAULT_SET,
    Focus: ['clock', 'timer', 'todo', 'notes', 'breathe', 'ambient'],
    Music: ['music', 'ambient', 'photos', 'quote', 'sky'],
    Planner: ['calendar', 'date', 'countdown', 'habits', 'todo', 'worldclock', 'weather'],
    Play: ['snake', 'dice', 'typing', 'sketch', 'calc'],
    Outdoors: ['weather', 'sun', 'sky', 'worldclock', 'clock'],
};

// =================================================================
// Build widgets
// =================================================================
let layout = store.get('layout2', null);   // { id: {x, y, w, h, on} }
let zTop = 20;
const desk = $('desk');

WIDGETS.forEach(w => {
    const el = document.createElement('section');
    el.className = 'widget' + (w.big ? ' big' : ' fixed');
    el.dataset.w = w.id;
    el.tabIndex = -1;
    el.setAttribute('aria-label', w.name);
    el.style.width = w.w + 'px';
    el.innerHTML = `<div class="w-head"><button class="w-back" aria-label="Back to home">&#8592;</button><span class="w-grip" aria-hidden="true">&#10303;</span><span class="w-title">${w.name}</span><button class="w-close" aria-label="Hide ${w.name}">&times;</button></div>
        <div class="w-body">${w.body()}</div>${w.big ? '<div class="w-resize" aria-hidden="true" title="Resize"></div>' : ''}`;
    el.hidden = true;
    desk.appendChild(el);
    try { w.init(el.querySelector('.w-body')); w.tick?.(new Date()); } catch (err) { console.error('widget init failed:', w.id, err); }
});

// =================================================================
// Active state: start/stop hooks so off-screen widgets do no work
// =================================================================
let openApp = null;
const active = new Set();
function isActive(id) {
    if (document.hidden) return false;
    if (isPhone()) return openApp === id;
    return !byId(id).hidden && !document.body.classList.contains('zen');
}
function refreshActive() {
    WIDGETS.forEach(w => {
        const on = isActive(w.id);
        if (on && !active.has(w.id)) { active.add(w.id); w.start?.(); w.tick?.(new Date()); }
        else if (!on && active.has(w.id)) { active.delete(w.id); w.stop?.(); }
    });
}

// =================================================================
// Desktop layout
// =================================================================
function saveLayout() { store.set('layout2', layout); }
function place(el, l) {
    if (l.x != null) { el.style.left = l.x * innerWidth + 'px'; el.style.top = l.y * innerHeight + 'px'; }
    if (l.w) el.style.width = l.w + 'px';
    if (l.h) el.style.height = l.h + 'px';
}
function applyLayout() {
    WIDGETS.forEach(w => {
        const el = byId(w.id), l = layout[w.id] || {};
        el.hidden = !l.on;
        place(el, l);
    });
    clampAll();
    renderLauncher();
    refreshActive();
}
function clampAll() {
    if (isPhone()) return;
    document.querySelectorAll('.widget:not([hidden])').forEach(el => {
        const r = el.getBoundingClientRect();
        const x = Math.max(0, Math.min(innerWidth - r.width, r.left));
        const y = Math.max(0, Math.min(innerHeight - 70 - r.height, r.top));
        if (Math.round(x) !== Math.round(r.left) || Math.round(y) !== Math.round(r.top)) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
    });
}
addEventListener('resize', () => { if (!isPhone()) applyLayout(); });

// masonry-style auto arrange of the visible widgets, column by column
function autoArrange(ids) {
    const gap = 12, top = 16, maxY = innerHeight - 80;
    let x = 16, y = top, colW = 0;
    ids.forEach(id => {
        const el = byId(id);
        el.hidden = false;
        el.style.height = layout[id]?.h ? layout[id].h + 'px' : '';
        const r = el.getBoundingClientRect();
        if (y + r.height > maxY && y > top) { x += colW + gap; y = top; colW = 0; }
        el.style.left = x + 'px'; el.style.top = y + 'px';
        layout[id] = { ...(layout[id] || {}), on: true, x: x / innerWidth, y: y / innerHeight };
        y += r.height + gap; colW = Math.max(colW, r.width);
    });
    refreshActive();
}
function applyPreset(name, silent) {
    const ids = PRESETS[name];
    WIDGETS.forEach(w => { layout[w.id] = { ...(layout[w.id] || {}), on: ids.includes(w.id) }; byId(w.id).hidden = !ids.includes(w.id); });
    autoArrange(ids);
    saveLayout(); applyLayout();
    if (!silent) toast(name + ' layout');
}
function setWidget(id, on) {
    layout[id] = { ...(layout[id] || {}), on };
    const el = byId(id);
    el.hidden = !on;
    if (on && layout[id].x == null) {
        // drop new widgets near the middle, cascading
        const n = document.querySelectorAll('.widget:not([hidden])').length;
        el.style.left = Math.max(16, innerWidth / 2 - el.offsetWidth / 2 + (n % 5) * 24) + 'px';
        el.style.top = Math.max(16, innerHeight / 3 - 80 + (n % 5) * 24) + 'px';
        const r = el.getBoundingClientRect();
        layout[id].x = r.left / innerWidth; layout[id].y = r.top / innerHeight;
    }
    if (on) { el.style.zIndex = ++zTop; clampAll(); }
    saveLayout(); renderLauncher(); refreshActive();
}

// ---- drag by the title bar, resize from the corner
desk.addEventListener('pointerdown', e => {
    const el = e.target.closest('.widget');
    if (!el || isPhone()) return;
    el.style.zIndex = ++zTop;
    if (!e.target.closest('input, textarea, select, button, canvas, [tabindex]:not(.widget)')) el.focus({ preventScroll: true });
    const head = e.target.closest('.w-head'), grip = e.target.closest('.w-resize');
    if (document.body.classList.contains('locked') || (!head && !grip) || e.target.closest('.w-close, .w-back')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    const tgt = e.target;
    tgt.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    dismissCoach();
    const move = ev => {
        if (grip) {
            el.style.width = Math.max(180, Math.min(innerWidth - r.left, r.width + ev.clientX - sx)) + 'px';
            el.style.height = Math.max(140, Math.min(innerHeight - r.top - 10, r.height + ev.clientY - sy)) + 'px';
        } else {
            const x = Math.max(0, Math.min(innerWidth - r.width, r.left + ev.clientX - sx));
            const y = Math.max(0, Math.min(innerHeight - r.height, r.top + ev.clientY - sy));
            el.style.left = Math.round(x / 8) * 8 + 'px';
            el.style.top = Math.round(y / 8) * 8 + 'px';
        }
    };
    const up = () => {
        el.classList.remove('dragging');
        tgt.removeEventListener('pointermove', move);
        tgt.removeEventListener('pointerup', up);
        tgt.removeEventListener('pointercancel', up);
        const b = el.getBoundingClientRect(), id = el.dataset.w;
        layout[id] = { ...(layout[id] || {}), x: b.left / innerWidth, y: b.top / innerHeight };
        if (grip) { layout[id].w = Math.round(b.width); layout[id].h = Math.round(b.height); }
        saveLayout();
    };
    tgt.addEventListener('pointermove', move);
    tgt.addEventListener('pointerup', up);
    tgt.addEventListener('pointercancel', up);
});
desk.addEventListener('click', e => {
    const close = e.target.closest('.w-close'), back = e.target.closest('.w-back');
    if (close) setWidget(close.closest('.widget').dataset.w, false);
    if (back) history.back();
});

// ---- first-visit hint: widgets are draggable
let coachT = 0;
function showCoach() {
    if (isPhone() || store.get('coached', false)) return;
    const el = [...document.querySelectorAll('.widget:not([hidden])')][0];
    if (!el) return;
    const h = el.querySelector('.w-head').getBoundingClientRect();
    const c = $('coach');
    c.innerHTML = `<b>Psst — these move!</b><br>Drag any widget by its <b>&#10303;</b> title bar.<br>Big ones resize from the <b>&#9698;</b> corner.<br><button class="btn">Got it</button>`;
    c.style.left = Math.min(innerWidth - 280, h.left + 8) + 'px';
    c.style.top = h.bottom + 12 + 'px';
    c.hidden = false;
    document.querySelectorAll('.widget:not([hidden])').forEach(w => w.classList.add('hint-wiggle'));
    c.querySelector('button').onclick = dismissCoach;
    coachT = setTimeout(dismissCoach, 12000);
}
function dismissCoach() {
    if ($('coach').hidden) return;
    $('coach').hidden = true;
    clearTimeout(coachT);
    document.querySelectorAll('.hint-wiggle').forEach(w => w.classList.remove('hint-wiggle'));
    store.set('coached', true);
}

// =================================================================
// Dock + panels (desktop)
// =================================================================
function closePanels() { ['launcher', 'settings', 'help'].forEach(id => { $(id).hidden = true; }); }
function togglePanel(id) { const open = $(id).hidden; closePanels(); $(id).hidden = !open; }
document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.panel, .dock, .favbar, .icon')) closePanels();
});

function renderDock() {
    const dock = $('dock');
    dock.innerHTML = '';
    const add = (html, tip, fn, cls = '') => {
        const b = document.createElement('button');
        b.innerHTML = html; b.title = tip; b.setAttribute('aria-label', tip); b.className = cls;
        b.addEventListener('click', fn);
        dock.appendChild(b);
        return b;
    };
    add('&#9638; WIDGETS', 'Widgets and layouts (W)', () => togglePanel('launcher'), 'label');
    add('', 'Next wallpaper (B)', () => setBg(bgIndex + 1), 'bg-thumb').id = 'bgBtn';
    add('&#9635;', 'Lens shape (L)', cycleShape);
    add('&#128204;', 'Pin lens (P)', togglePin);
    add('&#9881;', 'Settings', () => togglePanel('settings'));
    add('?', 'Help (?)', () => togglePanel('help'));
    setBg(bgIndex);
}
function renderLauncher() {
    const on = WIDGETS.filter(w => !byId(w.id).hidden).length;
    $('launchCount').textContent = `· ${on} of ${WIDGETS.length} on`;
    $('tiles').innerHTML = WIDGETS.map(w => `<button class="tile ${byId(w.id).hidden ? '' : 'on'}" data-id="${w.id}" aria-pressed="${!byId(w.id).hidden}"><span class="ti" style="background:${w.color}">${w.icon}</span>${w.name}</button>`).join('');
}
$('tiles').addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    setWidget(t.dataset.id, byId(t.dataset.id).hidden);
});
$('presets').innerHTML = Object.keys(PRESETS).map(p => `<button class="btn" data-p="${p}">${p}</button>`).join('') + '<button class="btn" data-arrange>Tidy up</button>';
$('presets').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.p) applyPreset(b.dataset.p);
    else { autoArrange(WIDGETS.filter(w => !byId(w.id).hidden).map(w => w.id)); saveLayout(); toast('Tidied up'); }
});

// settings
SHAPES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'btn'; b.dataset.s = s.id; b.textContent = s.label;
    b.onclick = () => setShape(s.id);
    $('lensShapes').appendChild(b);
});
BGS.forEach((bg, i) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = bg.name;
    b.onclick = () => setBg(i);
    $('bgChoices').appendChild(b);
});
$('lensSize').oninput = e => setLensScale(+e.target.value);
const ACCENTS = ['#6aa8ff', '#ff6b8b', '#ffd23f', '#3ddc84', '#b48cff', '#ff9f43'];
function setAccent(c) {
    document.documentElement.style.setProperty('--accent', c);
    store.set('accent', c);
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.c === c));
}
ACCENTS.forEach(c => {
    const b = document.createElement('button');
    b.className = 'swatch'; b.dataset.c = c; b.style.background = c; b.setAttribute('aria-label', 'Accent ' + c);
    b.onclick = () => setAccent(c);
    $('swatches').appendChild(b);
});
function setToggle(btn, on) { btn.textContent = on ? 'On' : 'Off'; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on); }
function setGrain(on) { document.body.classList.toggle('no-grain', !on); setToggle($('grainBtn'), on); store.set('grain', on); }
function setLock(on) { document.body.classList.toggle('locked', on); setToggle($('lockBtn'), on); store.set('locked', on); }
$('grainBtn').onclick = () => setGrain(document.body.classList.contains('no-grain'));
$('lockBtn').onclick = () => setLock(!document.body.classList.contains('locked'));
$('arrangeBtn').onclick = () => { autoArrange(WIDGETS.filter(w => !byId(w.id).hidden).map(w => w.id)); saveLayout(); toast('Tidied up'); };
$('resetBtn').onclick = () => {
    if (!confirm('Reset the layout? (Your notes, to-dos and other data are kept.)')) return;
    WIDGETS.forEach(w => { const el = byId(w.id); el.style.width = w.w + 'px'; el.style.height = ''; });
    layout = {};
    applyPreset('Default');
    homeOrder = WIDGETS.map(w => w.id); store.set('homeOrder', homeOrder); renderHome();
    toast('Layout reset');
};

document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea, select') || e.defaultPrevented) return;
    if (e.target.closest('.widget') && e.target !== document.body && /^Arrow/.test(e.key)) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
        closePanels(); dismissCoach(); document.body.classList.remove('zen'); refreshActive();
        if (openApp) history.back();
        if (document.body.classList.contains('edit-mode')) setEdit(false);
        return;
    }
    if (e.target.closest('.widget')) return;   // widget keyboard shortcuts win
    if (k === 'w') togglePanel('launcher');
    else if (k === 'b') setBg(bgIndex + 1);
    else if (k === 'l') cycleShape();
    else if (k === 'p') togglePin();
    else if (k === '[') setLensScale(Lens.scale - 0.1);
    else if (k === ']') setLensScale(Lens.scale + 0.1);
    else if (k === 'h') { document.body.classList.toggle('zen'); refreshActive(); toast(document.body.classList.contains('zen') ? 'Zen mode — press H to come back' : 'Widgets back'); }
    else if (k === '?' || (k === '/' && e.shiftKey)) togglePanel('help');
    else if (k === ' ') { e.preventDefault(); defOf('music').toggle(); }
});

// =================================================================
// Phones: Android-style home screen
// =================================================================
let homeOrder = store.get('homeOrder', null) || WIDGETS.map(w => w.id);
WIDGETS.forEach(w => { if (!homeOrder.includes(w.id)) homeOrder.push(w.id); });
homeOrder = homeOrder.filter(id => defOf(id));
const FAVS = ['music', 'notes', 'timer', 'settings'];
const PER_FIRST = 12, PER_PAGE = 20;

function iconHtml(id) {
    if (id === 'settings') return `<button class="icon" data-id="settings" aria-label="Settings"><span class="ic" style="background:#57606f">⚙️</span><span class="lbl">Settings</span></button>`;
    const w = defOf(id);
    return `<button class="icon" data-id="${id}" aria-label="Open ${w.name}"><span class="ic" style="background:${w.color}">${w.icon}</span><span class="lbl">${w.name}</span></button>`;
}
function renderHome() {
    const ids = homeOrder.filter(id => !FAVS.includes(id));
    const pages = [ids.slice(0, PER_FIRST)];
    for (let i = PER_FIRST; i < ids.length; i += PER_PAGE) pages.push(ids.slice(i, i + PER_PAGE));
    $('pages').innerHTML = pages.map((p, i) => `<div class="page">${i === 0 ? `<button class="glance" data-id="clock" aria-label="Open clock"><div class="glance-time" id="gTime"></div><div class="glance-date" id="gDate"></div><div class="glance-extra" id="gExtra"></div></button>` : ''}${p.map(iconHtml).join('')}</div>`).join('');
    $('dots').innerHTML = pages.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
    $('favbar').innerHTML = FAVS.map(iconHtml).join('');
    renderGlance();
}
$('pages').addEventListener('scroll', () => {
    const i = Math.round($('pages').scrollLeft / innerWidth);
    [...$('dots').children].forEach((d, j) => d.classList.toggle('on', i === j));
}, { passive: true });

function renderGlance(now = new Date()) {
    if (!$('gTime')) return;
    $('gTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('gDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const m = moonPhase(now), wx = Weather.data;
    const bits = [];
    if (wx && wx.cur) bits.push(`${wxOf(wx.cur.weather_code)[0]} ${Math.round(wx.cur.temperature_2m)}°`);
    bits.push(`🌙 ${Math.round(m.illum * 100)}%`);
    const todos = store.get('todos', []).filter(t => !t.d).length;
    if (todos) bits.push(`✅ ${todos} to do`);
    $('gExtra').textContent = bits.join('   ');
    $('sbTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('sbNet').textContent = navigator.onLine ? '▲▼' : '✕';
}
if (navigator.getBattery) navigator.getBattery().then(b => { const r = () => { $('sbBat').textContent = Math.round(b.level * 100) + '%' + (b.charging ? '⚡' : ''); }; r(); b.onlevelchange = r; b.onchargingchange = r; }).catch(() => { });
document.addEventListener('wx', () => renderGlance());

// ---- open / close "apps"
function openAppFrom(id, fromEl) {
    if (id === 'settings') { togglePanel('settings'); return; }
    const el = byId(id);
    if (fromEl) {
        const r = fromEl.getBoundingClientRect();
        el.style.setProperty('--ox', r.left + r.width / 2 + 'px');
        el.style.setProperty('--oy', r.top + r.height / 2 + 'px');
    }
    openApp = id;
    el.classList.remove('closing');
    el.classList.add('app');
    document.body.classList.add('app-open');
    history.pushState({ app: id }, '');
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
}
addEventListener('popstate', () => closeAppNow());

// ---- tap to open, long-press to rearrange
let pressT = 0, drag = null, suppressClick = false;
function setEdit(on) {
    document.body.classList.toggle('edit-mode', on);
    if (on) toast('Drag icons to rearrange');
}
$('editDone').onclick = () => setEdit(false);
$('home').addEventListener('pointerdown', e => {
    const icon = e.target.closest('.icon, .glance');
    if (!icon) { if (document.body.classList.contains('edit-mode')) setEdit(false); return; }
    clearTimeout(pressT);
    const start = { x: e.clientX, y: e.clientY };
    if (document.body.classList.contains('edit-mode') && icon.classList.contains('icon') && !icon.closest('.favbar')) {
        beginDrag(icon, e);
        return;
    }
    pressT = setTimeout(() => {
        if (!icon.classList.contains('icon') || icon.closest('.favbar')) return;
        navigator.vibrate?.(20);
        setEdit(true);
        suppressClick = true;
        beginDrag(icon, e, start);
    }, 480);
    const cancel = ev => { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 10) clearTimeout(pressT); };
    icon.addEventListener('pointermove', cancel, { passive: true });
    icon.addEventListener('pointerup', () => { clearTimeout(pressT); icon.removeEventListener('pointermove', cancel); }, { once: true });
});
$('home').addEventListener('click', e => {
    const icon = e.target.closest('.icon, .glance');
    if (!icon || suppressClick) { suppressClick = false; return; }
    if (document.body.classList.contains('edit-mode')) return;
    openAppFrom(icon.dataset.id, icon.querySelector('.ic') || icon);
});
$('home').addEventListener('contextmenu', e => { if (e.target.closest('.icon')) e.preventDefault(); });

// while an icon is being dragged, stop the browser scrolling the pages
$('home').addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });

function beginDrag(icon, e) {
    const id = icon.dataset.id, sx = e.clientX, sy = e.clientY;
    icon.classList.add('drag');
    try { icon.setPointerCapture(e.pointerId); } catch { }
    let target = null;
    drag = { id };
    const move = ev => {
        icon.style.transform = `translate(${ev.clientX - sx}px, ${ev.clientY - sy}px)`;
        icon.style.pointerEvents = 'none';
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.page .icon');
        icon.style.pointerEvents = '';
        if (target && target !== under) target.classList.remove('drop-target');
        target = under && under !== icon ? under : null;
        if (target) target.classList.add('drop-target');
    };
    const up = () => {
        icon.removeEventListener('pointermove', move);
        icon.removeEventListener('pointerup', up);
        icon.removeEventListener('pointercancel', up);
        icon.classList.remove('drag');
        icon.style.transform = '';
        if (target) {
            const from = homeOrder.indexOf(id), to = homeOrder.indexOf(target.dataset.id);
            homeOrder.splice(from, 1);
            homeOrder.splice(to, 0, id);
            store.set('homeOrder', homeOrder);
            renderHome();
        }
        drag = null;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 50);
    };
    icon.addEventListener('pointermove', move);
    icon.addEventListener('pointerup', up);
    icon.addEventListener('pointercancel', up);
}

// switching between phone and desktop sizes
let wasPhone = isPhone();
addEventListener('resize', () => {
    const p = isPhone();
    if (p !== wasPhone) { wasPhone = p; if (!p && openApp) closeAppNow(); applyLayout(); }
});

// =================================================================
// Shared 1-second tick; everything sleeps while the tab is hidden
// =================================================================
let tickInt = 0;
function tick() {
    const now = new Date();
    active.forEach(id => { try { defOf(id).tick?.(now); } catch (err) { console.error(err); } });
    if (isPhone()) renderGlance(now);
}
function startTicking() { clearInterval(tickInt); tick(); tickInt = setInterval(tick, 1000); }
document.addEventListener('visibilitychange', () => {
    refreshActive();
    if (document.hidden) clearInterval(tickInt); else startTicking();
});

// =================================================================
// Boot
// =================================================================
setAccent(store.get('accent', ACCENTS[0]));
setGrain(store.get('grain', true));
setLock(store.get('locked', false));
setShape(Lens.shape.id);
$('lensSize').value = Lens.scale;
renderDock();
renderHome();
if (!layout) { layout = {}; applyPreset('Default', true); }
else applyLayout();
if (matchMedia('(hover: none)').matches && !isPhone()) { Lens.on = true; queueLens(); }
startTicking();
setTimeout(showCoach, 900);
if (isPhone() && !store.get('phoneHint', false)) { store.set('phoneHint', true); setTimeout(() => toast('Tap an icon to open it · long-press to rearrange', 3500), 900); }
