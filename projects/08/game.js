// Low-Poly Strike: renderer, input (keyboard/mouse + touch), HUD and main loop.
// Game rules live in sim.js so the network host can run the same code later.
import * as THREE from './three.module.min.js';
import { TICK, PLAYER, createWorld, addPlayer, stepWorld, playerHeight, spreadOf } from './sim.js';
import { buildGraph, createBrain, botInput, BOT_NAMES } from './bots.js';
import { createPlayerModel, updatePlayerModel, createViewModel, createEffects } from './models.js';

const $ = (id) => document.getElementById(id);

// ---------- settings (saved per browser) ----------
const SETTINGS_KEY = 'lp-strike-settings';
const settings = {
    mouseSens: 1, touchSens: 1, touchSize: 1, low: false, fps: false,
    enemies: 4, allies: 3, diff: 'normal',
    ...loadSettings(),
};

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

const fetchJson = async (url) => (await fetch(url)).json();
const [map, weapons] = await Promise.all([fetchJson('map.json'), fetchJson('weapons.json')]);
const graph = buildGraph(map);
const pal = Object.fromEntries(Object.entries(map.palette).map(([k, v]) => [k, new THREE.Color(v)]));

// ---------- renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = pal.sky;
scene.fog = new THREE.Fog(pal.sky, 45, 150);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
camera.rotation.order = 'YXZ';

const LIGHT_DIR = new THREE.Vector3(0.5, 1, 0.3).normalize();
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a968c, 2.3));
const sun = new THREE.DirectionalLight(0xfff4dc, 2.2);
sun.position.copy(LIGHT_DIR);
scene.add(sun);

function applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(settings.low ? Math.min(dpr, 1) * 0.7 : Math.min(dpr, 1.5));
    resize();
}

// The held weapon is drawn on top in its own pass (see models.js).
const vm = createViewModel();
const vmCamera = new THREE.PerspectiveCamera(65, 1, 0.01, 10);
renderer.autoClear = false;

function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = vmCamera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    vmCamera.updateProjectionMatrix();
}

addEventListener('resize', resize);
applyQuality();

// ---------- map ----------
// Deterministic per-box jitter so walls and crates don't look copy-pasted.
const jitter = (i) => {
    const s = Math.sin(i * 12.9898) * 43758.5453;
    return s - Math.floor(s) - 0.5;
};

function geometryFrom(pos, nor, col) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
}

// All boxes in one draw call, plus a slightly bigger back-face copy for the ink outline.
function mergeBoxes(boxes, grow, withColor) {
    const pos = [], nor = [], col = [];
    boxes.forEach((b, i) => {
        const g = new THREE.BoxGeometry(b[3] - b[0] + grow * 2, b[4] - b[1] + grow * 2, b[5] - b[2] + grow * 2)
            .translate((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)
            .toNonIndexed();
        pos.push(...g.attributes.position.array);
        nor.push(...g.attributes.normal.array);
        if (withColor) {
            const c = (pal[b[6]] || pal.wall).clone().offsetHSL(0, 0, jitter(i) * 0.05);
            for (let v = 0; v < g.attributes.position.count; v++) col.push(c.r, c.g, c.b);
        }
        g.dispose();
    });
    return geometryFrom(pos, nor, withColor ? col : null);
}

// Checkered floor: one quad per 4 m tile on the floor box's top face.
function floorGeometry(b) {
    const TILE = 4;
    const w = b[3] - b[0], d = b[5] - b[2];
    const g = new THREE.PlaneGeometry(w, d, Math.round(w / TILE), Math.round(d / TILE))
        .rotateX(-Math.PI / 2)
        .translate((b[0] + b[3]) / 2, b[4], (b[2] + b[5]) / 2)
        .toNonIndexed();
    const p = g.attributes.position;
    const col = [];
    for (let t = 0; t < p.count; t += 3) {
        const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
        const cz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3;
        const c = (Math.floor(cx / TILE) + Math.floor(cz / TILE)) & 1 ? pal.floor : pal.floor2;
        for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
}

// Hard "painted" shadows: each grounded box's footprint swept along the sun direction.
function shadowGeometry(boxes) {
    const pos = [];
    const sx = -LIGHT_DIR.x / LIGHT_DIR.y, sz = -LIGHT_DIR.z / LIGHT_DIR.y;
    for (const b of boxes) {
        if (b[1] > 0.01) continue;
        const h = b[4], ox = sx * h, oz = sz * h;
        const pts = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]];
        const hull = convexHull([...pts, ...pts.map(([x, z]) => [x + ox, z + oz])]);
        for (let i = 1; i < hull.length - 1; i++) {
            for (const [x, z] of [hull[0], hull[i], hull[i + 1]]) pos.push(x, 0.012, z);
        }
    }
    return geometryFrom(pos);
}

function convexHull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function siteDecal(letter, r, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = color + '40';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = color;
    g.lineWidth = 10;
    g.setLineDash([26, 16]);
    g.strokeRect(8, 8, 240, 240);
    g.font = '700 150px Oswald, Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(letter, 128, 136);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(r[2] - r[0], r[3] - r[1]).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, ...decalOffset }),
    );
    mesh.position.set((r[0] + r[2]) / 2, 0.02, (r[1] + r[3]) / 2);
    return mesh;
}

const decalOffset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

function buildMap() {
    const solid = map.boxes.filter((b) => b[6] !== 'floor');
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });

    scene.add(new THREE.Mesh(mergeBoxes(solid, 0, true), lit));
    scene.add(new THREE.Mesh(mergeBoxes(solid, 0.05, false),
        new THREE.MeshBasicMaterial({ color: pal.ink, side: THREE.BackSide })));

    for (const b of map.boxes.filter((b) => b[6] === 'floor')) scene.add(new THREE.Mesh(floorGeometry(b), lit));

    scene.add(new THREE.Mesh(shadowGeometry(solid), new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, ...decalOffset,
    })));

    scene.add(siteDecal('A', map.sites.A, map.palette.red));
    scene.add(siteDecal('B', map.sites.B, map.palette.blue));
}

// Low-poly backdrop: mountains peeking over the outer walls and a few clouds. One draw call each.
function buildBackdrop() {
    const rnd = (i) => jitter(i + 100) + 0.5;
    const hills = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 5, 1), new THREE.MeshLambertMaterial({ flatShading: true }), 28);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const hillColors = ['#7fa37a', '#6b8f6a', '#94ab86', '#8a9a8f'].map((c) => new THREE.Color(c));
    for (let i = 0; i < hills.count; i++) {
        const a = (i / hills.count) * Math.PI * 2 + rnd(i) * 0.2;
        const r = 95 + rnd(i + 1) * 40;
        const h = 18 + rnd(i + 2) * 26;
        p.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd(i + 3) * 6);
        s.set(16 + rnd(i + 4) * 14, h, 16 + rnd(i + 4) * 14);
        hills.setMatrixAt(i, m.compose(p, q, s));
        hills.setColorAt(i, hillColors[i % hillColors.length]);
    }
    scene.add(hills);

    const clouds = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false }), 24);
    for (let i = 0; i < clouds.count; i++) {
        const group = Math.floor(i / 3);
        const a = group * 0.79 + rnd(group);
        p.set(Math.cos(a) * 120 + (i % 3) * 7, 55 + rnd(group + 9) * 15 + (i % 3 === 1 ? 2 : 0), Math.sin(a) * 120 + rnd(i) * 4);
        q.identity();
        const k = 5 + rnd(i + 7) * 4;
        s.set(k * 1.4, k * 0.8, k);
        clouds.setMatrixAt(i, m.compose(p, q, s));
    }
    scene.add(clouds);
}

buildMap();
buildBackdrop();

const fx = createEffects(scene);

// ---------- match ----------
let world = null, me = null;
const brains = new Map();     // bot id -> brain
const models = new Map();     // player id -> mesh
const prevPos = new Map();    // player id -> position at the previous tick, for smooth rendering
const inputs = new Map();
let lookYaw = 0, lookPitch = 0, wantSlot = 0, lastSlot = 1;
let killer = null;

const byId = (id) => world && world.players.find((p) => p.id === id);

function startFreeArea() {
    clearMatch();
    world = createWorld(map, weapons, { infiniteAmmo: true });
    me = addPlayer(world, { name: 'You', team: 't' });
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const addBot = (team) => {
        const p = addPlayer(world, { name: names.pop(), team, bot: true });
        brains.set(p.id, createBrain(settings.diff));
    };
    for (let i = 0; i < settings.allies; i++) addBot('t');
    for (let i = 0; i < settings.enemies; i++) addBot('ct');
    drainEvents();

    resetTouch();
    state = 'play';
    show(null);
    updateLayers();
    if (touchMode) enterFullscreenLandscape();
    else lockPointer();
}

function clearMatch() {
    for (const m of models.values()) scene.remove(m.root);
    models.clear();
    brains.clear();
    prevPos.clear();
    feedEl.textContent = '';
    world = me = killer = null;
}

function modelFor(p) {
    let m = models.get(p.id);
    if (!m) {
        m = createPlayerModel(p.team);
        models.set(p.id, m);
        scene.add(m.root);
    }
    return m;
}

function tick() {
    for (const p of world.players) {
        const q = prevPos.get(p.id);
        if (q) { q.x = p.x; q.y = p.y; q.z = p.z; } else prevPos.set(p.id, { x: p.x, y: p.y, z: p.z });
    }
    readInput();
    inputs.set(me.id, input);
    for (const [id, brain] of brains) {
        const p = byId(id);
        if (p) inputs.set(id, botInput(world, p, brain, graph));
    }
    stepWorld(world, inputs);
    jumpQueued = reloadQueued = false;
    drainEvents();
}

// ---------- events -> effects and HUD ----------
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
let hitT = 0, dmgT = 0;

function drainEvents() {
    for (const e of world.events) onEvent(e);
    world.events.length = 0;
}

function onEvent(e) {
    if (e.t === 'shot') {
        const p = byId(e.by);
        if (!p) return;
        tmpB.set(e.to[0], e.to[1], e.to[2]);
        if (p === me) {
            vm.muzzleWorld(camera, tmpA);
            vm.fire();
        } else {
            const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
            tmpA.set(p.x + c * 0.18 - s * 0.55, p.y + playerHeight(p) * 0.72, p.z - s * 0.18 - c * 0.55);
        }
        fx.tracer(tmpA, tmpB);
        if (e.hit === 'w') fx.impact(tmpB, 0xe8dcc0, 4);
        else if (e.hit === 'p') fx.impact(tmpB, 0xff3030, 6);
    } else if (e.t === 'hit') {
        if (e.by === me.id) {
            hitT = 0.18;
            hitmarkEl.classList.toggle('hs', !!e.hs);
        }
        if (e.tgt === me.id) dmgT = 0.5;
    } else if (e.t === 'kill') {
        addFeed(e);
        if (e.tgt === me.id) killer = byId(e.by) || null;
    } else if (e.t === 'spawn') {
        const p = byId(e.id);
        if (!p) return;
        prevPos.set(p.id, { x: p.x, y: p.y, z: p.z });
        if (p === me) {
            lookYaw = p.yaw;
            lookPitch = 0;
            wantSlot = 0;
            killer = null;
        }
    }
}

const feedEl = $('feed');

function addFeed(e) {
    const by = byId(e.by), tgt = byId(e.tgt);
    if (!tgt) return;
    const row = document.createElement('div');
    if (by === me || tgt === me) row.className = 'me';
    const name = (p) => {
        const s = document.createElement('span');
        s.className = p.team;
        s.textContent = p.name;
        return s;
    };
    if (by && by !== tgt) row.append(name(by), ` [${weapons[e.w] ? weapons[e.w].name : e.w}${e.hs ? ' HS' : ''}] `, name(tgt));
    else row.append(name(tgt), ' fell');
    feedEl.prepend(row);
    while (feedEl.children.length > 5) feedEl.lastChild.remove();
    setTimeout(() => row.remove(), 5000);
}

// ---------- input ----------
const keys = new Set();
const input = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0, fire: false, reload: false, slot: 0 };
let jumpQueued = false, reloadQueued = false, mouseFire = false;
const touch = { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false };
let touchMode = matchMedia('(pointer: coarse)').matches;

const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'Tab', 'KeyR', 'KeyQ', 'Digit1', 'Digit2', 'Digit3'];

function selectSlot(i) {
    if (!me || !me.inv[i] || i === wantSlot) return;
    lastSlot = wantSlot;
    wantSlot = i;
}

function cycleSlot(dir) {
    if (me) selectSlot((wantSlot + dir + me.inv.length) % me.inv.length);
}

addEventListener('keydown', (e) => {
    if (state !== 'play') return;
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') jumpQueued = true;
    else if (e.code === 'KeyR') reloadQueued = true;
    else if (e.code === 'KeyQ') selectSlot(lastSlot);
    else if (e.code.startsWith('Digit')) selectSlot(Number(e.code.slice(5)) - 1);
    keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseFire = false; });

function readInput() {
    const k = (c) => (keys.has(c) ? 1 : 0);
    input.mx = clamp(k('KeyD') - k('KeyA') + touch.mx, -1, 1);
    input.mz = clamp(k('KeyW') - k('KeyS') + touch.mz, -1, 1);
    input.jump = keys.has('Space') || touch.jump || jumpQueued;
    input.crouch = keys.has('KeyC') || touch.crouch;
    input.walk = keys.has('ShiftLeft') || keys.has('ShiftRight');
    input.fire = mouseFire || touch.fire;
    input.reload = reloadQueued;
    input.yaw = lookYaw;
    input.pitch = lookPitch;
    input.slot = wantSlot;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PITCH_LIMIT = Math.PI / 2 - 0.02;

function look(dx, dy) {
    if (!me || !me.alive) return;
    lookYaw -= dx;
    lookPitch = clamp(lookPitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
}

// Mouse look with pointer lock.
const isLocked = () => document.pointerLockElement === canvas;

function lockPointer() {
    try {
        const r = canvas.requestPointerLock();
        if (r && r.catch) r.catch(() => { /* Esc cooldown; the click-to-resume path retries */ });
    } catch { /* not supported */ }
}

document.addEventListener('mousemove', (e) => {
    if (state !== 'play' || !isLocked()) return;
    // Some browsers report a huge jump on the first event after locking.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    const k = 0.0022 * settings.mouseSens;
    look(e.movementX * k, e.movementY * k);
});

document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && state === 'play' && isLocked()) mouseFire = true;
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseFire = false; });
document.addEventListener('wheel', (e) => {
    if (state === 'play' && isLocked() && e.deltaY) cycleSlot(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

document.addEventListener('pointerlockchange', () => {
    if (!isLocked() && state === 'play' && !touchMode) pause();
});

canvas.addEventListener('click', () => {
    if (state === 'play' && !touchMode && !isLocked()) lockPointer();
});

// Touch: left half is a floating joystick, right half drags the view.
const touchLayer = $('touch'), stick = $('stick'), knob = $('knob');
const STICK_R = 56;
const TOUCH_LOOK = 0.0055;
let stickId = null, stickX = 0, stickY = 0, lookId = null, lookX = 0, lookY = 0;

function placeStickHome() {
    stick.style.left = `${Math.max(90, innerWidth * 0.14)}px`;
    stick.style.top = `${innerHeight - Math.max(90, innerHeight * 0.26)}px`;
}

touchLayer.addEventListener('pointerdown', (e) => {
    if (e.target !== touchLayer) return;
    touchLayer.setPointerCapture(e.pointerId);
    if (e.clientX < innerWidth * 0.45 && stickId === null) {
        stickId = e.pointerId;
        stickX = e.clientX;
        stickY = e.clientY;
        stick.style.left = `${stickX}px`;
        stick.style.top = `${stickY}px`;
        stick.classList.add('on');
    } else if (lookId === null) {
        lookId = e.pointerId;
        lookX = e.clientX;
        lookY = e.clientY;
    }
});

touchLayer.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
        let dx = e.clientX - stickX, dy = e.clientY - stickY;
        const d = Math.hypot(dx, dy);
        if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touch.mx = dx / STICK_R;
        touch.mz = -dy / STICK_R;
    } else if (e.pointerId === lookId) {
        const k = TOUCH_LOOK * settings.touchSens;
        look((e.clientX - lookX) * k, (e.clientY - lookY) * k);
        lookX = e.clientX;
        lookY = e.clientY;
    }
});

function endTouch(e) {
    if (e.pointerId === stickId) {
        stickId = null;
        touch.mx = touch.mz = 0;
        knob.style.transform = '';
        stick.classList.remove('on');
        placeStickHome();
    } else if (e.pointerId === lookId) {
        lookId = null;
    }
}

touchLayer.addEventListener('pointerup', endTouch);
touchLayer.addEventListener('pointercancel', endTouch);

// Buttons. Fire also aims: drag the thumb across it to look while shooting.
const tFire = $('tFire'), tJump = $('tJump'), tCrouch = $('tCrouch'), tBoard = $('tBoard');

function holdButton(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        down(e);
    });
    const release = () => { el.classList.remove('on'); if (up) up(); };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
}

function tapButton(el, fn) {
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); });
}

let fireX = 0, fireY = 0;
holdButton(tFire, (e) => { touch.fire = true; fireX = e.clientX; fireY = e.clientY; }, () => { touch.fire = false; });
tFire.addEventListener('pointermove', (e) => {
    if (!touch.fire) return;
    const k = TOUCH_LOOK * settings.touchSens;
    look((e.clientX - fireX) * k, (e.clientY - fireY) * k);
    fireX = e.clientX;
    fireY = e.clientY;
});
holdButton(tJump, () => { touch.jump = true; jumpQueued = true; }, () => { touch.jump = false; });
tapButton(tCrouch, () => {
    touch.crouch = !touch.crouch;
    tCrouch.classList.toggle('on', touch.crouch);
});
tapButton($('tReload'), () => { reloadQueued = true; });
tapButton($('tSwap'), () => cycleSlot(1));
tapButton(tBoard, () => {
    touch.board = !touch.board;
    tBoard.classList.toggle('on', touch.board);
});
tapButton($('tPause'), pause);

// Switch to touch controls the first time a finger touches the screen.
addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchMode) {
        touchMode = true;
        updateLayers();
    }
}, true);

function resetTouch() {
    stickId = lookId = null;
    Object.assign(touch, { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false });
    mouseFire = false;
    knob.style.transform = '';
    stick.classList.remove('on');
    for (const b of touchLayer.querySelectorAll('.tbtn')) b.classList.remove('on');
    placeStickHome();
}

// ---------- screens and game state ----------
let state = 'menu';            // 'menu' | 'play' | 'pause'
let settingsReturn = 'menu';
const screens = { menu: $('menu'), freeSetup: $('freeSetup'), pause: $('pause'), settings: $('settings') };

function show(name) {
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

function updateLayers() {
    const playing = state === 'play';
    document.body.classList.toggle('playing', state !== 'menu');
    document.body.classList.toggle('touch', touchMode);
    $('hud').hidden = state === 'menu';
    touchLayer.hidden = !(playing && touchMode);
}

function enterFullscreenLandscape() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
        .catch(() => { /* iOS Safari: the rotate overlay covers it */ });
}

function pause() {
    if (state !== 'play') return;
    state = 'pause';
    keys.clear();
    resetTouch();
    show('pause');
    updateLayers();
    if (isLocked()) document.exitPointerLock();
}

function resume() {
    state = 'play';
    show(null);
    updateLayers();
    if (!touchMode) lockPointer();
}

function quit() {
    state = 'menu';
    clearMatch();
    show('menu');
    updateLayers();
    if (isLocked()) document.exitPointerLock();
}

$('playFree').addEventListener('click', startFreeArea);
$('resume').addEventListener('click', resume);
$('quit').addEventListener('click', quit);
for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => {
        if (b.dataset.open === 'settings') settingsReturn = state === 'menu' ? 'menu' : 'pause';
        show(b.dataset.open);
    });
}
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => show('menu'));
$('settingsBack').addEventListener('click', () => show(settingsReturn));

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// Settings form, bound to the saved values.
function bindRange(id, key, apply, digits = 2) {
    const el = $(id), out = el.nextElementSibling;
    el.value = settings[key];
    out.textContent = Number(settings[key]).toFixed(digits);
    el.addEventListener('input', () => {
        settings[key] = Number(el.value);
        out.textContent = settings[key].toFixed(digits);
        if (apply) apply();
        saveSettings();
    });
}

function bindCheck(id, key, apply) {
    const el = $(id);
    el.checked = settings[key];
    el.addEventListener('change', () => {
        settings[key] = el.checked;
        if (apply) apply();
        saveSettings();
    });
}

const applyTouchSize = () => touchLayer.style.setProperty('--ts', settings.touchSize);
bindRange('sMouse', 'mouseSens');
bindRange('sTouch', 'touchSens');
bindRange('sSize', 'touchSize', applyTouchSize);
bindCheck('sLow', 'low', applyQuality);
bindCheck('sFps', 'fps', () => { $('stats').hidden = !settings.fps; });
bindRange('fEnemies', 'enemies', null, 0);
bindRange('fAllies', 'allies', null, 0);
for (const r of document.querySelectorAll('input[name="diff"]')) {
    r.checked = r.value === settings.diff;
    r.addEventListener('change', () => { settings.diff = r.value; saveSettings(); });
}
applyTouchSize();
$('stats').hidden = !settings.fps;
placeStickHome();
addEventListener('resize', () => { if (stickId === null) placeStickHome(); });

// Phones in portrait: the CSS overlay covers the screen and the sim stops.
const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');

// ---------- HUD ----------
const hud = {
    hp: $('hp'), ammo: $('ammo'), dead: $('dead'), board: $('board'), mode: $('modeTag'),
    cross: $('crosshair'), vignette: $('vignette'),
};
const hitmarkEl = $('hitmark');
const shown = {};   // last text written, to skip unchanged DOM updates
let boardAt = 0;

function setText(key, el, text) {
    if (shown[key] === text) return;
    shown[key] = text;
    el.innerHTML = text;
}

function updateHud(dt) {
    hitT = Math.max(0, hitT - dt);
    dmgT = Math.max(0, dmgT - dt);
    hitmarkEl.style.opacity = hitT > 0 ? 1 : 0;
    hud.vignette.style.opacity = Math.min(1, dmgT * 2);

    const cur = me.inv[me.slot], W = weapons[cur.id];
    setText('hp', hud.hp, `${Math.max(0, me.hp)} <small>HP</small>`);
    hud.hp.classList.toggle('low', me.alive && me.hp <= 30);
    const reserve = world.rules.infiniteAmmo ? '∞' : cur.reserve;
    const status = me.reloadUntil ? 'Reloading' : W.name;
    setText('ammo', hud.ammo, `${cur.mag} <small>/ ${reserve}<br>${status}</small>`);
    setText('mode', hud.mode, `T ${world.score.t} : ${world.score.ct} CT`);

    hud.dead.hidden = me.alive;
    if (!me.alive) {
        const who = killer && killer !== me ? `${escapeHtml(killer.name)} got you` : 'You died';
        setText('dead', hud.dead, `${who}<br><small>Back in ${Math.max(0, Math.ceil(me.respawnAt - world.time))}</small>`);
    }

    // Crosshair gap follows the real spread cone.
    const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const gap = clamp(3 + Math.tan(spreadOf(me, W)) * focal, 3, 90);
    hud.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    hud.cross.style.display = me.alive ? '' : 'none';

    const boardOpen = keys.has('Tab') || touch.board || !!world.over;
    hud.board.hidden = !boardOpen;
    if (boardOpen && performance.now() > boardAt) {
        boardAt = performance.now() + 250;
        renderBoard();
    }
}

function renderBoard() {
    const table = (team, label) => {
        const rows = world.players
            .filter((p) => p.team === team)
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
            .map((p) => `<tr class="${p === me ? 'me' : ''}"><td>${escapeHtml(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
            .join('');
        return `<table><tr><th class="t${team.toUpperCase()}">${label} · ${world.score[team]}</th><th>K</th><th>D</th></tr>${rows}</table>`;
    };
    setText('board', hud.board, table('t', 'Red') + table('ct', 'Blue'));
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- main loop ----------
let last = performance.now(), acc = 0, orbit = 0, eyeH = PLAYER.eye, frameNo = 0;
let fpsFrames = 0, fpsTime = 0;
const statsEl = $('stats');

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    frameNo++;

    if (state === 'play' && world && !portrait.matches) {
        acc += dt;
        while (acc >= TICK) {
            tick();
            acc -= TICK;
        }
    } else {
        acc = 0;
    }

    const a = acc / TICK;
    const lerp = (p) => {
        const q = prevPos.get(p.id) || p;
        return [q.x + (p.x - q.x) * a, q.y + (p.y - q.y) * a, q.z + (p.z - q.z) * a];
    };

    if (me) {
        const [x, y, z] = lerp(me);
        // Dead: float up above the body and turn toward whoever got you.
        const target = me.alive ? (me.crouch ? PLAYER.crouchEye : PLAYER.eye) : 3.2;
        eyeH += (target - eyeH) * Math.min(1, dt * (me.alive ? 14 : 2));
        camera.position.set(x, y + eyeH, z);
        if (!me.alive && killer && killer.alive) {
            const dx = killer.x - me.x, dz = killer.z - me.z;
            const want = Math.atan2(-dx, -dz);
            const wantPitch = Math.atan2(killer.y + 1.2 - (me.y + eyeH), Math.hypot(dx, dz));
            const k = Math.min(1, dt * 3);
            lookYaw += Math.atan2(Math.sin(want - lookYaw), Math.cos(want - lookYaw)) * k;
            lookPitch += (wantPitch - lookPitch) * k;
        }
        camera.rotation.set(lookPitch, lookYaw, 0);

        for (const p of world.players) {
            const m = modelFor(p);
            const [px, py, pz] = lerp(p);
            updatePlayerModel(m, p, px, py, pz, state === 'play' ? dt : 0);
            if (p === me) m.root.visible = !p.alive;   // you only see your own body once dead
            else if (p.alive && world.time < p.invulnUntil) m.root.visible = (frameNo >> 2) % 2 === 0;
        }

        const cur = me.inv[me.slot], W = weapons[cur.id];
        vm.show(cur.id);
        const reload = me.reloadUntil ? 1 - (me.reloadUntil - world.time) / W.reload : 0;
        const raise = Math.min(1, 1 - (me.switchUntil - world.time) / 0.35);
        vm.update(state === 'play' ? dt : 0, Math.hypot(me.vx, me.vz), me.onGround, reload, raise);
        updateHud(dt);
    } else {
        // Menu backdrop: slow orbit over the map.
        orbit += dt * 0.06;
        camera.position.set(Math.cos(orbit) * 48, 30, Math.sin(orbit) * 48);
        camera.lookAt(0, 0, 0);
    }

    fx.update(state === 'pause' ? 0 : dt);

    renderer.clear();
    renderer.render(scene, camera);
    if (me && me.alive) {
        renderer.clearDepth();
        renderer.render(vm.scene, vmCamera);
    }

    if (settings.fps) {
        fpsFrames++;
        fpsTime += dt;
        if (fpsTime >= 0.5) {
            const speed = me ? Math.hypot(me.vx, me.vz).toFixed(1) : '0.0';
            statsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps · ${speed} m/s`;
            fpsFrames = 0;
            fpsTime = 0;
        }
    }
}

show('menu');
updateLayers();
requestAnimationFrame(frame);
