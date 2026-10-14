// Low-Poly Strike: renderer, input (keyboard/mouse + touch), HUD and main loop.
// Game rules live in sim.js so the network host can run the same code later.
import * as THREE from './three.module.min.js';
import {
    TICK, PLAYER, BOMB, createWorld, addPlayer, removePlayer, stepWorld, stepPlayer, playerHeight, spreadOf,
    startRound, buyItem, effectiveInput, actKind, isBomb,
} from './sim.js';
import { buildGraph, createBrain, botInput, BOT_NAMES } from './bots.js';
import { createPlayerModel, updatePlayerModel, createViewModel, createEffects } from './models.js';
import {
    hostRoom, joinRoom, cleanCode, quantiseInput, packInputs, InputQueue, Interp, FLAG, r2, r3, netStats, SIM_NET,
    manualOffer, manualAnswer, drawQr, canScan, scanQr,
} from './net.js';

const $ = (id) => document.getElementById(id);

// ---------- settings (saved per browser) ----------
const SETTINGS_KEY = 'lp-strike-settings';
const settings = {
    mouseSens: 1, touchSens: 1, touchSize: 1, low: false, fps: false,
    enemies: 4, allies: 3, diff: 'normal',
    name: '', hostKills: 20, hostTime: 600, fillBots: true, hostDiff: 'normal', hostMode: 'tdm', hostRounds: 6,
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
if (!settings.name) { settings.name = 'Player' + (100 + Math.floor(Math.random() * 900)); saveSettings(); }
const WEAPON_IDS = Object.keys(weapons);
const PHASES = ['buy', 'live', 'end'];
const BSTATES = ['carried', 'dropped', 'planted', 'defused', 'exploded'];
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

// The bomb on the floor (dropped) or armed (planted): a dark case with a blinking light.
const bombMesh = new THREE.Group();
const bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
bombLight.position.y = 0.14;
bombMesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.32), new THREE.MeshLambertMaterial({ color: pal.dark })), bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

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
    beginPlay();
}

function beginPlay() {
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
    if (role === 'client') return clientTick();
    inputs.set(me.id, input);
    if (role === 'host') pollRemotes();
    for (const [id, brain] of brains) {
        const p = byId(id);
        if (p) inputs.set(id, botInput(world, p, brain, graph));
    }
    stepWorld(world, inputs);
    jumpQueued = reloadQueued = false;
    drainEvents();
    if (role === 'host') hostAfterTick();
}

// ---------- events -> effects and HUD ----------
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
let hitT = 0, dmgT = 0;

function drainEvents(send = true) {
    for (const e of world.events) onEvent(e);
    if (send && role === 'host' && world.events.length) broadcast({ t: 'ev', e: world.events });
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
        else if (e.hit === 'm') fx.impact(tmpB, 0xe8dcc0, 2);     // teammate: no damage, no blood
    } else if (e.t === 'hit') {
        if (e.by === me.id) {
            hitT = 0.18;
            hitmarkEl.classList.toggle('hs', !!e.hs);
        }
        if (e.tgt === me.id) dmgT = 0.5;
    } else if (e.t === 'round') {
        onRound(e);
    } else if (e.t === 'plant') {
        showBanner(`Bomb planted at ${e.site}`, 2.5);
    } else if (e.t === 'defuse') {
        showBanner('Bomb defused', 2.5);
    } else if (e.t === 'explode') {
        tmpB.set(e.x, e.y + 0.4, e.z);
        for (let i = 0; i < 3; i++) fx.impact(tmpB, [0xffa030, 0xff6050, 0x323834][i], 40);
    } else if (e.t === 'over') {
        world.over = { winner: e.winner };
    } else if (e.t === 'kill') {
        addFeed(e);
        if (e.tgt === me.id) killer = byId(e.by) || null;
    } else if (e.t === 'spawn') {
        const p = byId(e.id);
        if (!p) return;
        prevPos.set(p.id, { x: p.x, y: p.y, z: p.z });
        if (p === me) {
            lookYaw = e.yaw !== undefined ? e.yaw : p.yaw;
            lookPitch = 0;
            pending.length = 0;
            wantSlot = 0;
            killer = null;
        }
    }
}

let bannerT = 0;

function showBanner(text, secs) {
    const el = $('banner');
    el.textContent = text;
    el.hidden = false;
    bannerT = secs;
}

const REASONS = { elim: 'enemies eliminated', bomb: 'bomb exploded', defused: 'bomb defused', time: 'time ran out' };

function onRound(e) {
    const name = (t) => (t === 't' ? 'Red' : 'Blue');
    if (e.phase === 'buy') {
        closeBuy();
        showBanner(e.half ? 'Halftime: sides swapped' : `Round ${e.n} · B to buy`, 3);
    } else if (e.phase === 'live') {
        showBanner('Go!', 1);
    } else if (e.phase === 'end') {
        showBanner(`${name(e.winner)} win the round · ${REASONS[e.reason] || ''}`, 4);
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
const input = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0, fire: false, reload: false, use: false, slot: 0 };
let jumpQueued = false, reloadQueued = false, mouseFire = false;
const touch = { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false, use: false };
let touchMode = matchMedia('(pointer: coarse)').matches;

const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'Tab', 'KeyR', 'KeyQ', 'KeyE', 'KeyB', 'Digit1', 'Digit2', 'Digit3'];

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
    else if (e.code === 'KeyB') toggleBuy();
    else if (e.code.startsWith('Digit')) {
        if (buyOpen) buyKey(Number(e.code.slice(5)));
        else selectSlot(Number(e.code.slice(5)) - 1);
    }
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
    input.use = keys.has('KeyE') || touch.use;
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
holdButton($('tUse'), () => { touch.use = true; }, () => { touch.use = false; });
tapButton($('tBuy'), () => toggleBuy());

// Switch to touch controls the first time a finger touches the screen.
addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchMode) {
        touchMode = true;
        updateLayers();
    }
}, true);

function resetTouch() {
    stickId = lookId = null;
    Object.assign(touch, { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false, use: false });
    mouseFire = false;
    knob.style.transform = '';
    stick.classList.remove('on');
    for (const b of touchLayer.querySelectorAll('.tbtn')) b.classList.remove('on');
    placeStickHome();
}

// ---------- online: lobby, host and client ----------
// The host tab runs the same stepWorld as Free Area, bots included, and streams snapshots.
// A client predicts only its own movement and draws everyone else ~100 ms in the past.
let role = 'solo';                 // 'solo' | 'host' | 'client'
let phase = 'none';                // 'lobby' | 'play'
let room = null;                   // host: room code registration
let link = null;                   // client: connection to the host
const peers = new Map();           // host: key -> { key, name, team, link, q, pid }; key 0 is the host
let nextKey = 1, myKey = 0;
let lobby = { r: [], s: {}, code: '' };
const interp = new Interp(100);
const pending = [];                // client: inputs the host has not acknowledged yet
let seq = 0, lastK = 0, overAt = 0, wake = null;
const tmpS = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

const cleanName = (s) => String(s || '').replace(/[^\w .-]/g, '').trim().slice(0, 14);
const playerName = () => cleanName(settings.name) || 'Player';
const broadcast = (msg, fast = false) => { for (const e of peers.values()) if (e.link) e.link.send(msg, fast); };
const humansOn = (team) => [...peers.values()].filter((e) => e.team === team).length;

function notice(title, text) {
    $('nTitle').textContent = title;
    $('nText').textContent = text;
    show('notice');
}

function lobbySettings() {
    return { k: settings.hostKills, tm: settings.hostTime, bots: settings.fillBots, d: settings.hostDiff, mode: settings.hostMode, rounds: settings.hostRounds };
}

function renderLobby() {
    $('lCode').textContent = lobby.code || '·····';
    const fill = (el, team) => {
        el.textContent = '';
        for (const [key, name, t, ping] of lobby.r) {
            if (t !== team) continue;
            const row = document.createElement('div');
            row.className = 'p' + (key === myKey ? ' me' : '');
            const n = document.createElement('span'), g = document.createElement('small');
            n.textContent = name;
            g.textContent = key === 0 ? 'host' : ping ? `${ping} ms` : '';
            row.append(n, g);
            el.append(row);
        }
    };
    fill($('lRed'), 't');
    fill($('lBlue'), 'ct');
    const host = role === 'host', s = lobby.s;
    $('lHost').hidden = !host;
    const bombPick = settings.hostMode === 'bomb';
    $('lRoundsRow').hidden = !bombPick;
    $('lKillsRow').hidden = bombPick;
    $('lTimeRow').hidden = bombPick;
    $('lStart').hidden = !host;
    $('lAdd').hidden = !host;
    $('lInfo').textContent = host
        ? 'Share the room code. Friends use Join game.'
        : !s.k ? 'Connected. Waiting for the host...'
        : s.mode === 'bomb' ? `Bomb mode, first to ${s.rounds} rounds · bots ${s.bots ? s.d : 'off'}. Waiting for the host to start...`
        : `First to ${s.k} kills or ${Math.round(s.tm / 60)} min · bots ${s.bots ? s.d : 'off'}. Waiting for the host to start...`;
}

function pushLobby() {
    if (role !== 'host' || phase !== 'lobby') return;
    lobby.r = [...peers.values()].map((e) => [e.key, e.name, e.team, e.link ? Math.round(e.link.rtt) : 0]);
    lobby.s = lobbySettings();
    renderLobby();
    broadcast({ t: 'lobby', r: lobby.r, s: lobby.s, code: lobby.code });
}

const playRoster = () => world.players.map((p) => {
    const e = [...peers.values()].find((x) => x.pid === p.id);
    return [p.id, p.name, p.team, p.bot ? 1 : 0, e && e.link ? Math.round(e.link.rtt) : 0];
});

function pushRoster() {
    if (role !== 'host' || !world) return;
    const r = playRoster();
    for (const p of world.players) {
        const row = r.find((x) => x[0] === p.id);
        p.ping = row ? row[4] : 0;
    }
    broadcast({ t: 'roster', r });
}

setInterval(() => {
    if (role !== 'host') return;
    if (phase === 'lobby') pushLobby();
    else pushRoster();
}, 2000);

// ----- host -----
async function startHosting(useRoom = true) {
    role = 'host';
    phase = 'lobby';
    myKey = 0;
    nextKey = 1;
    peers.clear();
    peers.set(0, { key: 0, name: playerName(), team: 't', link: null, q: null, pid: 0 });
    lobby = { r: [], s: lobbySettings(), code: '' };
    $('lStatus').textContent = useRoom ? 'Opening room...' : 'No server: use "Add player by code" for each friend.';
    $('lStatus').classList.remove('err');
    show('lobby');
    renderLobby();
    if (!useRoom) return;
    try {
        const r = await hostRoom(onHostLink);
        if (role !== 'host') return r.close();
        room = r;
        lobby.code = r.code;
        $('lStatus').textContent = '';
        pushLobby();
    } catch (err) {
        if (role !== 'host') return;
        leaveOnline();
        notice('Could not open a room', err.message || String(err));
    }
}

function onHostLink(l) {
    const timer = setTimeout(() => l.close('no hello'), 5000);
    l.onmsg = (m) => { if (m.t === 'hello') { clearTimeout(timer); admit(l, m.name); } };
    l.onclose = () => clearTimeout(timer);
}

function admit(l, rawName) {
    const team = humansOn('t') <= humansOn('ct') ? 't' : 'ct';
    if (humansOn(team) >= 4) {
        l.onclose = null;
        l.send({ t: 'reject', why: 'The room is full.' });
        setTimeout(() => l.close(), 300);
        return;
    }
    const e = { key: nextKey++, name: cleanName(rawName) || 'Player', team, link: l, q: new InputQueue(), pid: 0 };
    peers.set(e.key, e);
    l.onmsg = (m) => onPeerMsg(e, m);
    l.onclose = () => peerGone(e);
    l.send({ t: 'welcome', key: e.key });
    if (phase === 'play') joinMatch(e);
    else pushLobby();
}

function onPeerMsg(e, m) {
    if (m.t === 'in') {
        if (e.pid && Array.isArray(m.c)) e.q.push(m.c);
    } else if (m.t === 'team') {
        switchTeam(e);
    } else if (m.t === 'buy') {
        const p = e.pid && world && byId(e.pid);
        if (p && typeof m.item === 'string') buyItem(world, p, m.item);
    } else if (m.t === 'bye') {
        e.link.close('left');
    }
}

function switchTeam(e) {
    if (phase !== 'lobby') return;
    const other = e.team === 't' ? 'ct' : 't';
    if (humansOn(other) >= 4) return;
    e.team = other;
    pushLobby();
}

function dropPlayer(id) {
    removePlayer(world, id);
    brains.delete(id);
    prevPos.delete(id);
    const m = models.get(id);
    if (m) { scene.remove(m.root); models.delete(id); }
}

function addBot(team, names) {
    const p = addPlayer(world, { name: names.pop() || 'Bot', team, bot: true });
    brains.set(p.id, createBrain(settings.hostDiff));
}

// A player joining a running match takes a bot's seat when their team is full.
function joinMatch(e) {
    const mates = world.players.filter((p) => p.team === e.team);
    const bot = mates.length >= 4 && mates.find((p) => p.bot);
    if (bot) dropPlayer(bot.id);
    const p = addPlayer(world, { name: e.name, team: e.team });
    e.pid = p.id;
    e.q = new InputQueue();
    e.link.send({ t: 'start', you: p.id, rules: world.rules, r: playRoster() });
    pushRoster();
}

function peerGone(e) {
    peers.delete(e.key);
    if (phase === 'play' && world && e.pid) {
        const p = byId(e.pid);
        if (p && settings.fillBots) {
            p.bot = true;
            brains.set(p.id, createBrain(settings.hostDiff));
        } else if (p) {
            dropPlayer(p.id);
        }
        pushRoster();
    } else {
        pushLobby();
    }
}

function startMatch() {
    if (role !== 'host' || phase !== 'lobby') return;
    clearMatch();
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    world = createWorld(map, weapons, settings.hostMode === 'bomb'
        ? { mode: 'bomb', rounds: settings.hostRounds, respawn: -1, infiniteAmmo: false }
        : { respawn: 3, killLimit: settings.hostKills, timeLimit: settings.hostTime, infiniteAmmo: true });
    for (const e of peers.values()) {
        const p = addPlayer(world, { name: e.name, team: e.team });
        e.pid = p.id;
        e.q = new InputQueue();
        if (!e.link) me = p;
    }
    if (settings.fillBots) {
        for (const team of ['t', 'ct']) {
            while (world.players.filter((p) => p.team === team).length < 4) addBot(team, names);
        }
    }
    if (isBomb(world)) startRound(world, true);
    drainEvents(false);
    phase = 'play';
    overAt = 0;
    const r = playRoster();
    for (const p of world.players) p.ping = 0;
    for (const e of peers.values()) if (e.link) e.link.send({ t: 'start', you: e.pid, rules: world.rules, r });
    beginPlay();
    requestWake();
}

function backToLobby() {
    overAt = 0;
    clearMatch();
    phase = 'lobby';
    state = 'menu';
    for (const e of peers.values()) { e.pid = 0; e.q = null; }
    broadcast({ t: 'lobbyBack' });
    if (isLocked()) document.exitPointerLock();
    updateLayers();
    show('lobby');
    pushLobby();
}

function pollRemotes() {
    for (const e of peers.values()) {
        if (!e.link || !e.pid) continue;
        const c = e.q.next();
        if (c) inputs.set(e.pid, c);
    }
}

function hostAfterTick() {
    if (world.tick % 3 === 0) sendSnapshots();
    if (world.over && !overAt) overAt = performance.now() + 8000;
    else if (overAt && performance.now() >= overAt) backToLobby();
}

// Progress of the plant or defuse this player is holding, 0..1.
function actFrac(p) {
    const k = actKind(world, p);
    return k ? Math.min(1, p.act / (k === 'plant' ? BOMB.plant : BOMB.defuse)) : 0;
}

function sendSnapshots() {
    const flags = (p) => (p.alive ? FLAG.alive : 0) | (p.crouch ? FLAG.crouch : 0) | (p.reloadUntil ? FLAG.reload : 0)
        | (world.time < p.invulnUntil ? FLAG.shield : 0) | (p.onGround ? FLAG.ground : 0);
    const all = world.players.map((p) => [
        p.id, r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), Math.max(0, p.hp), p.slot, flags(p), p.kills, p.deaths,
    ]);
    const base = { t: 's', k: world.tick, tm: r3(world.time), sc: [world.score.t, world.score.ct], p: all };
    if (isBomb(world) && world.round) {
        const rd = world.round, b = world.bomb;
        base.rd = [PHASES.indexOf(rd.phase), rd.n, r3(Math.max(0, rd.until - world.time)), world.att === 'ct' ? 1 : 0];
        if (b) {
            const defusing = Math.max(0, ...world.players.map((q) => (actKind(world, q) === 'defuse' ? actFrac(q) : 0)));
            base.bm = [BSTATES.indexOf(b.state), r2(b.x), r2(b.y), r2(b.z), ['', 'A', 'B'].indexOf(b.site),
                r2(Math.max(0, b.fuseAt - world.time)), b.carrier, r2(defusing)];
        }
    }
    for (const e of peers.values()) {
        if (!e.link || !e.pid) continue;
        const p = byId(e.pid);
        if (!p) continue;
        const left = (t) => (t > world.time ? r3(t - world.time) : 0);
        const m = [e.q.ack, r3(p.x), r3(p.y), r3(p.z), r3(p.vx), r3(p.vy), r3(p.vz), p.jumpHeld ? 1 : 0,
            left(p.reloadUntil), left(p.switchUntil), left(p.respawnAt), p.money, r2(actFrac(p))];
        for (const w of p.inv) m.push(WEAPON_IDS.indexOf(w.id), w.mag, w.reserve);
        e.link.send({ ...base, m }, true);
    }
}

// ----- client -----
async function startJoining() {
    const code = cleanCode($('jCode').value);
    const status = $('jStatus');
    status.classList.add('err');
    if (code.length < 5) { status.textContent = 'Enter the 5-character room code.'; return; }
    settings.name = cleanName($('jName').value);
    saveSettings();
    status.classList.remove('err');
    status.textContent = 'Connecting...';
    $('jGo').disabled = true;
    let l;
    try {
        l = await joinRoom(code);
    } catch (err) {
        $('jGo').disabled = false;
        status.classList.add('err');
        status.textContent = err.message || String(err);
        return;
    }
    $('jGo').disabled = false;
    if ($('joinScreen').hidden) return l.close();     // user backed out while connecting
    status.textContent = '';
    enterClientLobby(l, code);
}

function enterClientLobby(l, code) {
    role = 'client';
    phase = 'lobby';
    link = l;
    myKey = -1;
    lobby = { r: [], s: {}, code };
    l.onmsg = onClientMsg;
    l.onclose = () => { if (link === l) hostGone('Lost connection to the host.'); };
    l.send({ t: 'hello', name: playerName() });
    renderLobby();
    show('lobby');
}

// ----- manual handshake (no signaling server) -----
let offer = null, answerSess = null, scanner = null;

function copyText(el) {
    el.select();
    if (navigator.clipboard) navigator.clipboard.writeText(el.value).catch(() => document.execCommand('copy'));
    else document.execCommand('copy');
}

async function showQr(canvas, text) {
    canvas.hidden = true;
    try { canvas.hidden = !(await drawQr(canvas, text)); } catch { /* QR is optional; the text code still works */ }
}

async function openAddPlayer(note = '') {
    if (offer) offer.cancel();
    offer = null;
    show('manualHost');
    $('mOffer').value = '';
    $('mAnswer').value = '';
    $('mQr').hidden = true;
    $('mGo').disabled = true;
    $('mStatus').classList.toggle('err', !!note);
    $('mStatus').textContent = note || 'Making code (a few seconds)...';
    try {
        const o = await manualOffer();
        if ($('manualHost').hidden) return o.cancel();
        offer = o;
        $('mOffer').value = o.code;
        $('mGo').disabled = false;
        if (!note) $('mStatus').textContent = '';
        showQr($('mQr'), o.code);
    } catch (err) {
        $('mStatus').classList.add('err');
        $('mStatus').textContent = err.message || String(err);
    }
}

async function finishAddPlayer() {
    const code = $('mAnswer').value.trim();
    const status = $('mStatus');
    if (!offer || !code) { status.classList.add('err'); status.textContent = 'Paste the answer code first.'; return; }
    status.classList.remove('err');
    status.textContent = 'Connecting...';
    $('mGo').disabled = true;
    const o = offer;
    try {
        const l = await o.finish(code);
        if (offer !== o) return l.close();
        offer = null;
        onHostLink(l);
        show('lobby');
    } catch (err) {
        if (offer === o) openAddPlayer(`${err.message || err} Here is a fresh code.`);
    }
}

function cancelAddPlayer() {
    if (offer) offer.cancel();
    offer = null;
    show('lobby');
}

async function makeAnswer() {
    const status = $('kStatus');
    const code = $('kOffer').value.trim();
    status.classList.add('err');
    if (!code) { status.textContent = "Paste the host's code first."; return; }
    settings.name = cleanName($('kName').value);
    saveSettings();
    status.classList.remove('err');
    status.textContent = 'Making answer (a few seconds)...';
    $('kGo').disabled = true;
    if (answerSess) answerSess.cancel();
    let a;
    try {
        a = answerSess = await manualAnswer(code);
        $('kAnswer').value = a.code;
        showQr($('kQr'), a.code);
        status.textContent = 'Send this answer to the host. Waiting for them to connect...';
        const l = await a.link;
        if (answerSess !== a || $('joinManual').hidden) return l.close();
        answerSess = null;
        enterClientLobby(l, '');
    } catch (err) {
        if (a && answerSess !== a) return;
        $('kGo').disabled = false;
        status.classList.add('err');
        status.textContent = err.message || String(err);
    }
}

function cancelJoinManual() {
    if (answerSess) answerSess.cancel();
    answerSess = null;
    $('kGo').disabled = false;
    $('kStatus').textContent = '';
    show('menu');
}

function scanInto(target, back, then) {
    show('scanScreen');
    scanner = scanQr($('scanView'));
    scanner.result.then((text) => {
        show(back);
        if (text) { target.value = text; then(); }
    }).catch(() => {
        show(back);
        const st = back === 'manualHost' ? $('mStatus') : $('kStatus');
        st.classList.add('err');
        st.textContent = 'Could not use the camera. Paste the code instead.';
    });
}

function hostGone(text) {
    leaveOnline(false);
    notice('Disconnected', text);
}

function onClientMsg(m) {
    switch (m.t) {
        case 'welcome': myKey = m.key; break;
        case 'reject': leaveOnline(false); notice('Cannot join', m.why); break;
        case 'lobby':
            if (phase !== 'lobby') break;
            lobby = { r: m.r, s: m.s, code: m.code || lobby.code };
            renderLobby();
            break;
        case 'start': startClientMatch(m); break;
        case 'roster': if (world) syncRoster(m.r); break;
        case 'ev': if (world) for (const e of m.e) onEvent(e); break;
        case 's': if (world) onSnapshot(m); break;
        case 'lobbyBack':
            clearMatch();
            phase = 'lobby';
            state = 'menu';
            if (isLocked()) document.exitPointerLock();
            updateLayers();
            show('lobby');
            renderLobby();
            break;
        case 'bye': hostGone('The host closed the game.'); break;
    }
}

function stubPlayer(id, name, team, bot) {
    return {
        id, name, team, bot, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
        onGround: true, crouch: false, jumpHeld: false, hp: 0, alive: false, kills: 0, deaths: 0, ping: 0,
        slot: 0, reloadUntil: 0, switchUntil: 0, invulnUntil: 0, respawnAt: 0, money: 0, act: 0, actF: 0,
        inv: ['rifle', 'pistol', 'shotgun'].map((w) => ({ id: w, mag: 0, reserve: 0 })),
    };
}

function syncRoster(r) {
    const ids = new Set(r.map((x) => x[0]));
    for (const [id, name, team, bot, ping] of r) {
        let p = byId(id);
        if (!p) { p = stubPlayer(id, name, team, !!bot); world.players.push(p); }
        Object.assign(p, { name, team, bot: !!bot, ping });
    }
    for (const p of world.players.slice()) {
        if (ids.has(p.id)) continue;
        world.players.splice(world.players.indexOf(p), 1);
        interp.drop(p.id);
        prevPos.delete(p.id);
        const m = models.get(p.id);
        if (m) { scene.remove(m.root); models.delete(p.id); }
    }
}

function startClientMatch(m) {
    clearMatch();
    world = createWorld(map, weapons, m.rules);
    syncRoster(m.r);
    me = byId(m.you);
    pending.length = 0;
    interp.clear();
    seq = 0;
    lastK = 0;
    phase = 'play';
    lookYaw = 0;
    lookPitch = 0;
    wantSlot = 0;
    beginPlay();
    requestWake();
}

function onSnapshot(s) {
    if (s.k <= lastK) return;
    lastK = s.k;
    const now = performance.now();
    world.time = s.tm;
    world.score.t = s.sc[0];
    world.score.ct = s.sc[1];
    if (s.rd) {
        world.round = { n: s.rd[1], phase: PHASES[s.rd[0]], until: world.time + s.rd[2] };
        world.att = s.rd[3] ? 'ct' : 't';
    }
    if (s.bm) {
        const b = s.bm;
        world.bomb = {
            state: BSTATES[b[0]], x: b[1], y: b[2], z: b[3], site: ['', 'A', 'B'][b[4]],
            fuseAt: world.time + b[5], carrier: b[6], defuse: b[7],
        };
    }
    for (const a of s.p) {
        const p = byId(a[0]);
        if (!p) continue;
        const f = a[8];
        p.hp = a[6];
        p.slot = a[7];
        p.alive = !!(f & FLAG.alive);
        p.crouch = !!(f & FLAG.crouch);
        p.kills = a[9];
        p.deaths = a[10];
        p.invulnUntil = f & FLAG.shield ? world.time + 0.2 : 0;
        p.onGround = !!(f & FLAG.ground);
        if (p !== me) interp.push(p.id, now, a[1], a[2], a[3], a[4], a[5]);
    }
    const m = s.m;
    if (!m || !me) return;
    me.x = m[1]; me.y = m[2]; me.z = m[3];
    me.vx = m[4]; me.vy = m[5]; me.vz = m[6];
    me.jumpHeld = !!m[7];
    me.reloadUntil = m[8] > 0 ? world.time + m[8] : 0;
    me.switchUntil = m[9] > 0 ? world.time + m[9] : 0;
    me.respawnAt = world.time + m[10];
    me.money = m[11];
    me.actF = m[12];
    const n = (m.length - 13) / 3;
    me.inv.length = n;
    for (let i = 0; i < n; i++) {
        const w = me.inv[i] || (me.inv[i] = {});
        w.id = WEAPON_IDS[m[13 + i * 3]];
        w.mag = m[14 + i * 3];
        w.reserve = m[15 + i * 3];
    }

    // Reconcile: drop acknowledged inputs, then replay the rest on top of the host's state.
    while (pending.length && pending[0].seq <= m[0]) pending.shift();
    if (!me.alive) { pending.length = 0; return; }
    for (const c of pending) {
        me.yaw = c.yaw;
        me.pitch = c.pitch;
        stepPlayer(me, effectiveInput(world, me, c), map.boxes);
    }
}

function clientTick() {
    const cmd = quantiseInput(input, ++seq);
    pending.push(cmd);
    if (me.alive) {
        me.yaw = cmd.yaw;
        me.pitch = cmd.pitch;
        stepPlayer(me, effectiveInput(world, me, cmd), map.boxes);
    }
    world.time += TICK;
    jumpQueued = reloadQueued = false;
    if (pending.length > 40) pending.splice(0, pending.length - 40);
    if ((seq & 1) === 0) link.send(packInputs(pending.slice(-12)), true);   // 30 Hz, with redundancy
}

// Remote players come from the snapshot buffer, drawn 100 ms behind.
function interpolateRemotes(dt) {
    const now = performance.now();
    for (const p of world.players) {
        if (p === me || !interp.sample(p.id, now, tmpS)) continue;
        if (dt > 0) {
            const vx = (tmpS.x - p.x) / dt, vz = (tmpS.z - p.z) / dt;
            const ok = Math.hypot(vx, vz) < 12;
            p.vx += ((ok ? vx : 0) - p.vx) * 0.4;
            p.vz += ((ok ? vz : 0) - p.vz) * 0.4;
        }
        Object.assign(p, tmpS);
        prevPos.set(p.id, { x: p.x, y: p.y, z: p.z });
    }
}

function leaveOnline(sendBye = true) {
    const quietClose = (l) => { l.onclose = null; setTimeout(() => l.close(), 250); };
    if (role === 'host') {
        if (sendBye) broadcast({ t: 'bye' });
        for (const e of peers.values()) if (e.link) quietClose(e.link);
        peers.clear();
        if (room) room.close();
        room = null;
    } else if (role === 'client' && link) {
        const l = link;
        link = null;
        if (sendBye) l.send({ t: 'bye' });
        quietClose(l);
    }
    role = 'solo';
    phase = 'none';
    overAt = 0;
    pending.length = 0;
    clearMatch();
    releaseWake();
    if (isLocked()) document.exitPointerLock();
    state = 'menu';
    updateLayers();
}

async function requestWake() {
    try { wake = await navigator.wakeLock.request('screen'); } catch { /* unsupported or denied */ }
}

function releaseWake() {
    try { if (wake) wake.release(); } catch { /* already released */ }
    wake = null;
}

// ---------- buy menu (bomb mode) ----------
let buyOpen = false;
const buyEl = $('buy');
const canBuy = () => !!world && !!me && me.alive && isBomb(world) && !!world.round && world.round.phase === 'buy';

function toggleBuy() {
    if (buyOpen) return closeBuy();
    if (!canBuy()) return;
    buyOpen = true;
    buyEl.hidden = false;
    updateBuy();
}

function closeBuy() {
    buyOpen = false;
    buyEl.hidden = true;
}

function doBuy(item) {
    if (!canBuy()) return;
    if (role === 'client') link.send({ t: 'buy', item });
    else buyItem(world, me, item);
    wantSlot = 0;     // the new primary always sits in slot 0
}

const buyKey = (n) => { const item = ['rifle', 'shotgun'][n - 1]; if (item) doBuy(item); };

for (const b of buyEl.querySelectorAll('button[data-item]')) b.addEventListener('click', () => doBuy(b.dataset.item));

function updateBuy() {
    $('buyMoney').textContent = `$${me.money}`;
    for (const b of buyEl.querySelectorAll('button[data-item]')) {
        const W = weapons[b.dataset.item], own = me.inv.some((w) => w.id === b.dataset.item);
        b.classList.toggle('own', own);
        b.classList.toggle('no', !own && me.money < W.price);
        b.lastElementChild.textContent = own ? 'owned' : `$${W.price}`;
    }
}

// ---------- screens and game state ----------
let state = 'menu';            // 'menu' | 'play' | 'pause'
let settingsReturn = 'menu';
const screens = {
    menu: $('menu'), freeSetup: $('freeSetup'), pause: $('pause'), settings: $('settings'),
    joinScreen: $('joinScreen'), lobby: $('lobby'), notice: $('notice'),
    manualHost: $('manualHost'), joinManual: $('joinManual'), scanScreen: $('scanScreen'),
};

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
    mouseFire = false;
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
    if (role !== 'solo') {
        leaveOnline();
    } else {
        state = 'menu';
        clearMatch();
        updateLayers();
        if (isLocked()) document.exitPointerLock();
    }
    show('menu');
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

// Online, the match keeps running in the background, so only Free Area pauses.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (role === 'solo') pause(); }
    else if (role !== 'solo' && state !== 'menu') requestWake();
});

// Online menus.
$('hostBtn').addEventListener('click', () => startHosting(true));
$('hostManualBtn').addEventListener('click', () => startHosting(false));
$('lAdd').addEventListener('click', () => openAddPlayer());
$('mGo').addEventListener('click', finishAddPlayer);
$('mCancel').addEventListener('click', cancelAddPlayer);
$('mCopy').addEventListener('click', () => copyText($('mOffer')));
$('mScan').addEventListener('click', () => scanInto($('mAnswer'), 'manualHost', finishAddPlayer));
$('kGo').addEventListener('click', makeAnswer);
$('kCancel').addEventListener('click', cancelJoinManual);
$('kCopy').addEventListener('click', () => copyText($('kAnswer')));
$('kScan').addEventListener('click', () => scanInto($('kOffer'), 'joinManual', makeAnswer));
$('scanCancel').addEventListener('click', () => { if (scanner) scanner.stop(); });
$('mScan').hidden = $('kScan').hidden = !canScan();
$('kName').value = settings.name;
$('kName').addEventListener('input', () => { settings.name = cleanName($('kName').value); saveSettings(); });
$('jGo').addEventListener('click', startJoining);
$('jCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') startJoining(); });
$('lStart').addEventListener('click', startMatch);
$('lLeave').addEventListener('click', () => { leaveOnline(); show('menu'); });
$('lTeam').addEventListener('click', () => {
    if (role === 'host') switchTeam(peers.get(0));
    else if (link) link.send({ t: 'team' });
});
$('nOk').addEventListener('click', () => show('menu'));
$('jName').value = $('lName').value = settings.name;
$('jName').addEventListener('input', () => { settings.name = cleanName($('jName').value); saveSettings(); });
$('lName').addEventListener('input', () => {
    settings.name = cleanName($('lName').value);
    saveSettings();
    if (peers.has(0)) { peers.get(0).name = playerName(); pushLobby(); }
});

function bindRadios(name, key, numeric) {
    for (const r of document.querySelectorAll(`input[name="${name}"]`)) {
        r.checked = String(settings[key]) === r.value;
        r.addEventListener('change', () => {
            settings[key] = numeric ? Number(r.value) : r.value;
            saveSettings();
            pushLobby();
        });
    }
}
bindRadios('lmode', 'hostMode', false);
bindRadios('lrounds', 'hostRounds', true);
bindRadios('lkills', 'hostKills', true);
bindRadios('ltime', 'hostTime', true);
bindRadios('ldiff', 'hostDiff', false);
bindCheck('lBots', 'fillBots', pushLobby);

// Test and debugging hook: read-only views of the running game.
window.__lps = {
    get role() { return role; },
    get state() { return state; },
    get phase() { return phase; },
    get world() { return world; },
    get me() { return me; },
    get lobby() { return lobby; },
    get link() { return link; },
    get seq() { return seq; },
    set fire(v) { touch.fire = !!v; },
    peers, netStats, SIM_NET,
};

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
    money: $('money'), bomb: $('bombTag'), act: $('actbar'),
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
    const bomb = isBomb(world);
    const mmss = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
    const limit = world.rules.timeLimit, left = limit ? Math.max(0, limit - world.time) : 0;
    const clock = limit ? ` · ${mmss(left)}` : '';
    const result = world.over ? (world.over.winner ? `${world.over.winner === 't' ? 'Red' : 'Blue'} wins` : 'Draw') : '';
    if (bomb && world.round) {
        const rd = world.round, rleft = Math.max(0, rd.until - world.time);
        const ph = rd.phase === 'buy' ? `BUY ${Math.ceil(rleft)}` : rd.phase === 'live' ? mmss(rleft) : 'END';
        setText('mode', hud.mode, `${result ? result + ' · ' : ''}Red ${world.score.t} : ${world.score.ct} Blue · R${rd.n} · ${ph}`);
        updateBombHud(rd);
    } else {
        setText('mode', hud.mode, `${result ? result + ' · ' : ''}T ${world.score.t} : ${world.score.ct} CT${clock}`);
        hud.bomb.hidden = hud.money.hidden = hud.act.hidden = true;
    }
    touchLayer.classList.toggle('bomb', bomb);
    if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').hidden = true;
    if (buyOpen) { if (canBuy()) updateBuy(); else closeBuy(); }
    $('lockHint').hidden = touchMode || isLocked() || state !== 'play';

    hud.dead.hidden = me.alive;
    if (!me.alive) {
        const who = killer && killer !== me ? `${escapeHtml(killer.name)} got you` : 'You died';
        const wait = bomb ? 'Next round soon' : `Back in ${Math.max(0, Math.ceil(me.respawnAt - world.time))}`;
        setText('dead', hud.dead, `${who}<br><small>${wait}</small>`);
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

function updateBombHud(rd) {
    const b = world.bomb, attacking = me.team === world.att;
    const side = attacking ? 'Attack' : 'Defend';
    let text = side, hot = false;
    if (b && b.state === 'planted') {
        text = `Bomb planted ${b.site} · ${Math.max(0, Math.ceil(b.fuseAt - world.time))}`;
        hot = true;
        if (b.defuse > 0) text += ` · defusing ${Math.round(b.defuse * 100)}%`;
    } else if (b && b.state === 'dropped') {
        text = `${side} · bomb dropped`;
    } else if (b && b.state === 'carried' && b.carrier === me.id) {
        text = `${side} · you carry the bomb`;
    }
    hud.bomb.hidden = false;
    hud.bomb.classList.toggle('hot', hot);
    setText('bombTag', hud.bomb, text);
    hud.money.hidden = false;
    setText('money', hud.money, `$${me.money}`);

    const kind = me.alive ? actKind(world, me) : null;
    const frac = kind ? (role === 'client' ? me.actF : actFrac(me)) : 0;
    hud.act.hidden = !kind;
    if (kind) {
        setText('actLabel', $('actLabel'), kind === 'plant' ? 'Hold E to plant' : 'Hold E to defuse');
        hud.act.lastElementChild.style.width = `${Math.round(frac * 100)}%`;
    }
}

function renderBoard() {
    const net = role !== 'solo';
    const table = (team, label) => {
        const rows = world.players
            .filter((p) => p.team === team)
            .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
            .map((p) => `<tr class="${p === me ? 'me' : ''}"><td>${escapeHtml(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td>${net ? `<td>${p.bot || p === me && role === 'host' ? '-' : p === me ? Math.round(link.rtt) : p.ping || 0}</td>` : ''}</tr>`)
            .join('');
        return `<table><tr><th class="t${team.toUpperCase()}">${label} · ${world.score[team]}</th><th>K</th><th>D</th>${net ? '<th>Ping</th>' : ''}</tr>${rows}</table>`;
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

// Online, the match keeps running while the menu is open (you are just standing still).
function advance(dt) {
    const running = (state === 'play' || (state === 'pause' && role !== 'solo')) && world && !portrait.matches;
    if (!running) { acc = 0; return; }
    acc += dt;
    for (let n = 0; acc >= TICK && n < 80; n++) {
        tick();
        acc -= TICK;
    }
    if (acc >= TICK) acc = 0;
}

// A hidden tab gets no animation frames, so the host keeps the match going from a timer.
setInterval(() => {
    if (!document.hidden || role !== 'host' || !world) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 1);
    last = now;
    advance(dt);
}, 100);

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, role === 'host' ? 1 : 0.1);
    last = now;
    frameNo++;
    advance(dt);
    const live = state === 'play' || (state === 'pause' && role !== 'solo');
    if (role === 'client' && world) interpolateRemotes(dt);

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
            updatePlayerModel(m, p, px, py, pz, live ? dt : 0);
            if (p === me) m.root.visible = false;   // never draw your own body: the death camera sits right on it
            else if (p.alive && world.time < p.invulnUntil) m.root.visible = (frameNo >> 2) % 2 === 0;
        }

        const cur = me.inv[me.slot], W = weapons[cur.id];
        vm.show(cur.id);
        const reload = me.reloadUntil ? 1 - (me.reloadUntil - world.time) / W.reload : 0;
        const raise = Math.min(1, 1 - (me.switchUntil - world.time) / 0.35);
        vm.update(live ? dt : 0, Math.hypot(me.vx, me.vz), me.onGround, reload, raise);
        updateHud(dt);
    } else {
        // Menu backdrop: slow orbit over the map.
        orbit += dt * 0.06;
        camera.position.set(Math.cos(orbit) * 48, 30, Math.sin(orbit) * 48);
        camera.lookAt(0, 0, 0);
    }

    const bb = world && world.bomb;
    if (bb && (bb.state === 'dropped' || bb.state === 'planted')) {
        bombMesh.visible = true;
        bombMesh.position.set(bb.x, bb.y + 0.1, bb.z);
        const period = bb.state === 'planted' ? Math.max(0.15, (bb.fuseAt - world.time) / 40) : 1;
        bombLight.visible = (now / 1000) % period < period * 0.5;
    } else {
        bombMesh.visible = false;
    }

    fx.update(state === 'pause' && role === 'solo' ? 0 : dt);

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
            const ping = role === 'client' && link ? ` · ${Math.round(link.rtt)} ms` : '';
            statsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps · ${speed} m/s${ping}`;
            fpsFrames = 0;
            fpsTime = 0;
        }
    }
}

show('menu');
updateLayers();
requestAnimationFrame(frame);
