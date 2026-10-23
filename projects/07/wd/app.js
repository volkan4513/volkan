// Widget Desktop - framework: builds widgets from WIDGETS, the Widgets board
// (desktop, opened from the taskbar), panels, keyboard shortcuts and the
// shared tick. The desktop shell is wd/win/shell.js, the phone home screen
// is wd/phone.js.
'use strict';
const byId = id => document.querySelector(`.widget[data-w="${id}"]`);
const defOf = id => WIDGETS.find(w => w.id === id);
const DEFAULT_SET = ['clock', 'weather', 'calendar', 'music', 'date', 'todo', 'sky', 'quote'];
const PRESETS = {
    Default: DEFAULT_SET,
    Focus: ['clock', 'timer', 'todo', 'notes', 'breathe', 'ambient'],
    Music: ['music', 'piano', 'metronome', 'ambient', 'photos'],
    Planner: ['calendar', 'date', 'countdown', 'habits', 'todo', 'worldclock', 'weather'],
    Play: ['snake', 'g2048', 'tictactoe', 'dice', 'typing'],
    Create: ['palette', 'sketch', 'notes', 'quote', 'piano'],
    Tools: ['calc', 'convert', 'password', 'stopwatch', 'worldclock'],
    Outdoors: ['weather', 'sun', 'sky', 'worldclock', 'clock'],
};

// =================================================================
// Build widgets
// =================================================================
let layout = store.get('board', null);   // { id: { on } }
const desk = $('desk');
desk.insertAdjacentHTML('beforeend', '<div class="board-cols" id="boardCols"></div>');

WIDGETS.forEach(w => {
    const el = document.createElement('section');
    el.className = 'widget' + (w.big ? ' big' : ' fixed');
    el.dataset.w = w.id;
    el.tabIndex = -1;
    el.setAttribute('aria-label', w.name);
    el.innerHTML = `<div class="w-head"><button class="w-back" aria-label="Back to home">&#8592;</button><span class="w-ic" aria-hidden="true">${w.icon}</span><span class="w-title">${w.name}</span><button class="w-close" aria-label="Remove ${w.name}" title="Remove from board">&times;</button></div>
        <div class="w-body">${w.body()}</div>`;
    el.hidden = true;
    $('boardCols').appendChild(el);
    try { w.init(el.querySelector('.w-body')); w.tick?.(new Date()); } catch (err) { console.error('widget init failed:', w.id, err); }
});

// =================================================================
// Active state: start/stop hooks so hidden widgets do no work
// =================================================================
let boardOpen = false;
const active = new Set();
function isActive(id) {
    if (document.hidden) return false;
    if (isPhone()) return openApp === id;
    return boardOpen && !!layout[id]?.on && !document.body.classList.contains('zen');
}
function refreshActive() {
    WIDGETS.forEach(w => {
        const on = isActive(w.id);
        if (on && !active.has(w.id)) { active.add(w.id); w.start?.(); w.tick?.(new Date()); }
        else if (!on && active.has(w.id)) { active.delete(w.id); w.stop?.(); }
    });
}

// =================================================================
// Widgets board (desktop): a panel that slides in from the left
// =================================================================
desk.insertAdjacentHTML('afterbegin', `<div class="board-head"><div><div class="bh-time" id="bhTime"></div><div class="bh-date" id="bhDate"></div></div>
    <div class="row2"><button class="btn" id="boardAdd" aria-expanded="false">+ Add widgets</button><button class="btn" id="boardClose" aria-label="Close widgets">✕</button></div></div>`);
$('desk').querySelector('.board-head').after($('launcher'));

const saveLayout = () => store.set('board', layout);
function applyLayout() {
    WIDGETS.forEach(w => { byId(w.id).hidden = !layout[w.id]?.on; });
    renderLauncher();
    refreshActive();
}
function applyPreset(name, silent) {
    const ids = PRESETS[name];
    layout = {};
    ids.forEach(id => { layout[id] = { on: true }; });
    saveLayout(); applyLayout();
    if (!silent) toast(name + ' widgets');
}
function setWidget(id, on) {
    layout[id] = { on };
    byId(id).hidden = !on;
    saveLayout(); renderLauncher(); refreshActive();
}
// on the desktop the widgets sit on the right of the screen; W or the taskbar button hides them
function setBoard(open) {
    if (!isPhone()) store.set('deskWidgets', open);
    if (isPhone()) open = false;
    boardOpen = open;
    document.body.classList.toggle('board-open', open);
    if (!open) $('launcher').hidden = true;
    renderBoardTime();
    refreshActive();
    fitBoard();
}
// the desktop widgets never scroll: if they don't fit their area, the columns
// zoom out (which also makes room for a third column) until they do
let fitRaf = 0;
function fitBoard() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
        const cols = $('boardCols');
        if (isPhone() || !boardOpen) { cols.style.zoom = ''; return; }
        const avail = desk.clientHeight - cols.offsetTop;
        const fits = z => { cols.style.zoom = z; return cols.getBoundingClientRect().height <= avail + 1; };
        if (fits(1)) return;
        // the height jumps whenever a column is added, so search for the largest zoom that fits
        let lo = 0.4, hi = 1;
        for (let i = 0; i < 9; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
        cols.style.zoom = lo;
    });
}
const fitObserver = new ResizeObserver(fitBoard);
[...$('boardCols').children, $('launcher'), desk.querySelector('.board-head')].forEach(el => fitObserver.observe(el));
addEventListener('resize', fitBoard);
function renderBoardTime(now = new Date()) {
    if (!boardOpen) return;
    $('bhTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('bhDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}
desk.addEventListener('click', e => {
    const close = e.target.closest('.w-close'), back = e.target.closest('.w-back');
    if (close) setWidget(close.closest('.widget').dataset.w, false);
    if (back) history.back();
});
desk.addEventListener('pointerdown', e => {
    const el = e.target.closest('.widget');
    if (el && !e.target.closest('input, textarea, select, button, canvas, [tabindex]:not(.widget)')) el.focus({ preventScroll: true });
});
$('boardAdd').onclick = () => {
    const open = $('launcher').hidden;
    $('launcher').hidden = !open;
    $('boardAdd').setAttribute('aria-expanded', open);
};
$('boardClose').onclick = () => setBoard(false);
$('boardClose').title = 'Hide widgets (W)';

// =================================================================
// Panels: widget picker (inside the board), phone settings, help
// =================================================================
const PANELS = ['launcher', 'settings', 'help', 'hwPicker'];
function closePanels(except) { PANELS.forEach(id => { if (id !== except) $(id).hidden = true; }); }
function togglePanel(id) { const open = $(id).hidden; closePanels(); $(id).hidden = !open; }
document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.panel, .taskbar, .favbar, .icon, #boardAdd, .start, .ctx')) closePanels();
});

function renderLauncher() {
    const on = WIDGETS.filter(w => !byId(w.id).hidden).length;
    $('launchCount').textContent = `· ${on} of ${WIDGETS.length} on`;
    $('tiles').innerHTML = WIDGETS.map(w => `<button class="tile ${byId(w.id).hidden ? '' : 'on'}" data-id="${w.id}" aria-pressed="${!byId(w.id).hidden}"><span class="ti" style="background:${w.color}">${w.icon}</span>${w.name}</button>`).join('');
}
$('tiles').addEventListener('click', e => {
    const t = e.target.closest('.tile'); if (!t) return;
    setWidget(t.dataset.id, byId(t.dataset.id).hidden);
});
$('presets').innerHTML = Object.keys(PRESETS).map(p => `<button class="btn" data-p="${p}">${p}</button>`).join('');
$('presets').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) applyPreset(b.dataset.p); });

// settings panel (phones; the desktop has the Settings app)
SHAPES.forEach(s => {
    const b = document.createElement('button');
    b.className = 'btn'; b.dataset.s = s.id; b.textContent = s.label;
    b.onclick = () => setShape(s.id);
    $('lensShapes').appendChild(b);
});
function renderBgChoices() {
    $('bgChoices').innerHTML = '';
    BGS.forEach((bg, i) => {
        const b = document.createElement('button');
        b.className = 'btn' + (i === bgIndex ? ' on' : ''); b.textContent = bg.name;
        b.onclick = () => setBg(i);
        $('bgChoices').appendChild(b);
    });
    const up = document.createElement('button');
    up.className = 'btn'; up.textContent = '+ Photo'; up.title = 'Use one of your photos';
    up.onclick = () => $('bgFile').click();
    $('bgChoices').appendChild(up);
}
renderBgChoices();
$('bgFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) Shell.addWallpaper(f, f.name).catch(() => toast('Couldn’t use that picture')); };
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
$('grainBtn').onclick = () => setGrain(document.body.classList.contains('no-grain'));
function resetLayout() {
    applyPreset('Default', true);
    resetHome();
    toast('Layout reset');
}
$('resetBtn').onclick = () => { if (confirm('Reset the layout? (Your notes, to-dos and other data are kept.)')) resetLayout(); };

// =================================================================
// Keyboard
// =================================================================
document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
        const hadPanel = PANELS.some(id => !$(id).hidden);
        closePanels();
        document.body.classList.remove('zen');
        refreshActive();
        if (!hadPanel) isPhone() ? phoneBack() : Shell.escape();
        return;
    }
    if (e.target.closest('.widget, .win, .dlg-back') || e.ctrlKey || e.metaKey || e.altKey) return;   // apps get their own keys
    if (k === 'w') setBoard(!boardOpen);
    else if (k === 'b') setBg(bgIndex + 1);
    else if (k === 'l') cycleShape();
    else if (k === 'p') togglePin();
    else if (k === '[') setLensScale(Lens.scale - 0.1);
    else if (k === ']') setLensScale(Lens.scale + 0.1);
    else if (k === 'h') { document.body.classList.toggle('zen'); refreshActive(); toast(document.body.classList.contains('zen') ? 'Zen mode — press H to come back' : 'Desktop back'); }
    else if (k === '?' || (k === '/' && e.shiftKey)) togglePanel('help');
    else if (k === ' ') { e.preventDefault(); defOf('music').toggle(); }
});

// switching between phone and desktop sizes
let wasPhone = isPhone();
addEventListener('resize', () => {
    const p = isPhone();
    if (p === wasPhone) return;
    wasPhone = p;
    if (p) { boardOpen = false; document.body.classList.remove('board-open'); } else { phoneReset(); Shell.init(); setBoard(store.get('deskWidgets', true)); }
    refreshActive();
});

// =================================================================
// Shared 1-second tick; everything sleeps while the tab is hidden
// =================================================================
let tickInt = 0;
function tick() {
    const now = new Date();
    active.forEach(id => { try { defOf(id).tick?.(now); } catch (err) { console.error(err); } });
    Shell.clock.check(now);
    if (isPhone()) phoneTick(now);
    else { Shell.tick(now); renderBoardTime(now); }
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
setShape(Lens.shape.id);
setBg(bgIndex);
$('lensSize').value = Lens.scale;
initPhone();
if (!layout) applyPreset('Default', true); else applyLayout();
if (!isPhone()) { Shell.init(); setBoard(store.get('deskWidgets', true)); }
if (matchMedia('(hover: none)').matches && !isPhone()) { Lens.on = true; queueLens(); }
startTicking();
