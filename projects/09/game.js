// Pixel Racer: renderer, menus, settings, maps, the player's car, bots, races, multiplayer and the
// main loop. Handling lives in drive.js, car physics against the world in vehicle.js, bot driving in
// bots.js, models and wheel rigs in cars.js, maps in maps.js, lap counting in race.js, the network
// session in multiplayer.js and controls in input.js.
import * as THREE from './lib/three.module.min.js';
import { CARS, createCar } from './cars.js';
import { TUNING } from './drive.js';
import { MAPS, loadMap } from './maps.js';
import { createInput } from './input.js';
import { TEXTURE_STEPS, resolveCap, applyTextures, textureMemoryMB } from './textures.js';
import { createVehicle, setVehicleCar, placeVehicle, stepVehicle, poseVehicle, poseCar, addShadow } from './vehicle.js';
import { createBrain, botInput, obstacle, BOT_NAMES } from './bots.js';
import { createSession, MAX_CHOICES } from './multiplayer.js';
import { cleanCode } from './net.js';
import { createRunner, stepRunner, rank, gridPose, formatTime } from './race.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

// ---------- settings (saved per browser) ----------
const SETTINGS_KEY = 'pixel-racer-settings';
const settings = {
    car: 0, map: 0, pixel: 1, camera: 0, wheelStyle: 'smooth', textures: 'auto', filter: 'smooth', anisotropy: 0, draw: 1,
    bots: 3, name: '', maxPlayers: 4, laps: 1,   // laps 1 is a sprint: one run from the grid to the line
    ...loadSettings(),
};
function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}
const pick = (list, id) => Math.max(0, list.findIndex((x) => x.id === id));
if (settings.lapsV !== 2) { settings.laps = 1; settings.lapsV = 2; }   // sprint is the default now
if (params.has('car')) settings.car = pick(CARS, params.get('car'));
if (params.has('map')) settings.map = pick(MAPS, params.get('map'));
if (params.has('laps')) settings.laps = clamp(Number(params.get('laps')) | 0, 0, 9);
if (params.has('bots')) settings.bots = clamp(Number(params.get('bots')) | 0, 0, BOT_NAMES.length);
if (!TEXTURE_STEPS.includes(settings.textures)) settings.textures = 'auto';
if (!settings.pixel) settings.pixel = 1;   // older saves used 0 for "auto pixels"
if (!settings.name) settings.name = `Driver${Math.floor(Math.random() * 900 + 100)}`;
const playerName = () => settings.name.trim().slice(0, 12) || 'Driver';

// ---------- renderer ----------
const canvas = $('view');
// Renders at CSS-pixel resolution (1x) by default; bigger pixel sizes draw smaller and let the
// browser scale up without smoothing, for a retro look.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const PIXEL_STEPS = [1, 2, 3, 4, 6];
const pixelSize = () => settings.pixel || 1;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
const ANISO_STEPS = [1, 2, 4, 8, 16].filter((a) => a <= MAX_ANISO);
const anisotropy = () => settings.anisotropy || Math.min(8, MAX_ANISO);   // 0 = default
const DRAW = [{ name: 'Near', k: 0.6 }, { name: 'Normal', k: 1 }, { name: 'Far', k: 1.6 }];

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
scene.add(new THREE.HemisphereLight('#dff1ff', '#4c7a3a', 1.6));
const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
sun.position.set(60, 120, 40);
scene.add(sun);
scene.fog = new THREE.Fog('#9fd3ff', 120, 420);
scene.background = new THREE.Color('#9fd3ff');

function resize() {
    const s = pixelSize();
    renderer.setSize(Math.ceil(innerWidth / s), Math.ceil(innerHeight / s), false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Fog and the far plane follow the map and the draw-distance setting.
function applyDraw() {
    if (!map) return;
    const k = DRAW[settings.draw].k;
    scene.background.set(map.sky);
    scene.fog.color.set(map.sky);
    scene.fog.near = map.fog[0] * k;
    scene.fog.far = map.fog[1] * k;
    camera.far = scene.fog.far * 1.15;
    camera.updateProjectionMatrix();
}

// The filter setting is for cars only: maps are always smooth (linear, mipmaps, anisotropy).
function applyTextureSettings() {
    const opts = { max: resolveCap(settings.textures), smooth: settings.filter === 'smooth', anisotropy: anisotropy() };
    const cars = [me.car, ...bots.map((b) => b.v.car), ...[...puppets.values()].map((p) => p.car)];
    for (const c of cars) if (c) applyTextures(c.root, opts);
    if (map) for (const r of map.textureRoots) applyTextures(r, { ...opts, smooth: true });
    updateSettingsLabels();
}

// ---------- map ----------
let map = null, mapIndex = settings.map % MAPS.length, mapToken = 0;

// fromHost: a client only changes map when the host says so.
async function selectMap(i, fromHost = false) {
    if (session.role === 'client' && !fromHost) return;
    mapIndex = (i + MAPS.length) % MAPS.length;
    if (session.role !== 'client') { settings.map = mapIndex; saveSettings(); }
    const token = ++mapToken, def = MAPS[mapIndex];
    $('mapName').textContent = def.name;
    $('mapInfo').textContent = 'loading…';
    $('play').disabled = true;
    let next;
    try {
        next = await loadMap(def, (f) => {
            if (token === mapToken) $('mapInfo').textContent = `loading ${Math.round(clamp(f, 0, 1) * 100)}%`;
        });
    } catch (err) {
        console.error(err);
        if (token === mapToken) $('mapInfo').textContent = 'failed to load';
        return;
    }
    if (token !== mapToken) return;
    if (map) scene.remove(map.group);
    map = next;
    scene.add(map.group);
    beginRace(0, 0, performance.now());   // a new map starts in free roam, everyone on the grid
    applyDraw();
    applyTextureSettings();
    showCredit(map.credit);
    $('mapInfo').textContent = def.info || 'circuit · hills and walls';
    $('play').disabled = false;
    updateMpUI();
    session.sendMap(mapIndex);
}

// CC BY needs the title, author, source and licence wherever the map is shown.
function showCredit(c) {
    const el = $('credit'), hud = $('hudCredit');
    el.hidden = hud.hidden = !c;
    if (!c) return;
    el.innerHTML = '';
    const a = (href, text) => Object.assign(document.createElement('a'), { href, textContent: text, target: '_blank', rel: 'noopener' });
    el.append('Map: ', a(c.url, `“${c.title}”`), ` by ${c.author} · `, a(c.licenseUrl, c.license));
    hud.textContent = `Map: “${c.title}” by ${c.author} · ${c.license}`;
}

// Grid slots behind the start: two abreast, 8 m apart. Players take the front slots
// (host 0, each client its id - 1), bots line up behind the last player slot. Maps with a track
// line the grid up along the road (race.js); the others in a straight line from their spawn.
function slotPose(i) {
    if (map.track) return gridPose(map.track, map, i);
    const s = map.start, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), lx = fz, lz = -fx;
    const row = Math.floor(i / 2), side = i % 2 ? -1 : 1;
    const x = s.x - fx * row * 8 + lx * side * 2.8, z = s.z - fz * row * 8 + lz * side * 2.8;
    const y0 = map.groundAt(s.x, s.z) ?? 0;
    const y = map.groundAt(x, z, y0 + 3, 0);
    return y === null ? s : { x, y, z, yaw: s.yaw };
}
const mySlot = () => (session.role === 'client' ? session.myId - 1 : 0);
const botSlot = (k) => (session.role === 'solo' ? 1 : session.max) + k;

// ---------- the player's car ----------
const me = createVehicle(), drive = me.drive;
let carIndex = settings.car % CARS.length, loadToken = 0;

async function selectCar(i) {
    carIndex = (i + CARS.length) % CARS.length;
    settings.car = carIndex;
    saveSettings();
    const token = ++loadToken, def = CARS[carIndex];
    $('carName').textContent = def.name;
    $('carInfo').textContent = 'loading…';
    $('hudCar').textContent = def.name;
    let next;
    try {
        next = await createCar(def);
    } catch (err) {
        console.error(err);
        if (token === loadToken) $('carInfo').textContent = 'failed to load';
        return;
    }
    if (token !== loadToken) return;   // the player already flicked past this one
    setVehicleCar(me, next);
    scene.add(next.root);
    const modes = { named: 'wheels rigged from the model', extracted: 'wheels cut out of the mesh', none: 'wheels baked in (no spin yet)' };
    $('carInfo').textContent = next.mode === 'none' ? modes.none : `${modes[next.mode]} · ${next.wheels.length} pivots`;
    if (DEBUG) for (const w of next.wheels) w.spin.add(new THREE.AxesHelper(w.radius * 1.6));
    applyTextureSettings();
    poseVehicle(me, map, 0, settings.wheelStyle);
}

const poseOf = (v) => ({ x: v.drive.x, y: v.y, z: v.drive.z, yaw: v.drive.yaw, pitch: v.tilt.pitch, roll: v.tilt.roll, speed: v.drive.speed, steer: v.drive.steer });

// R puts the car back where it was last driving cleanly, a couple of seconds ago.
const crumbs = [];
let crumbTimer = 0;
function dropCrumbs(dt, now) {
    crumbTimer += dt;
    if (crumbTimer < 0.5) return;
    crumbTimer = 0;
    if (Math.abs(drive.speed) < 3 || me.bump > 0 || map.offRoad(drive.x, drive.z)) return;
    crumbs.push({ x: drive.x, y: me.y, z: drive.z, yaw: drive.yaw, t: now });
    if (crumbs.length > 30) crumbs.shift();
}

function resetCar() {
    if (!map) return;
    const now = performance.now();
    while (crumbs.length && now - crumbs[crumbs.length - 1].t < 1500) crumbs.pop();
    placeVehicle(me, map, crumbs.pop() || slotPose(mySlot()));
    cam.snap = true;
}

// ---------- bots (solo and host; a client sees the host's bots) ----------
let bots = [], botsToken = 0;

async function spawnBots() {
    removeBots();
    if (session.role === 'client' || !map) return;
    const token = ++botsToken, list = [];
    for (let k = 0; k < settings.bots; k++) {
        const carI = (k * 4 + 2) % CARS.length;
        const model = await createCar(CARS[carI]);
        if (token !== botsToken) return;
        const v = createVehicle();
        setVehicleCar(v, model);
        scene.add(model.root);
        placeVehicle(v, map, slotPose(botSlot(k)));
        list.push({ id: 100 + k, name: BOT_NAMES[k % BOT_NAMES.length], car: carI, v, brain: createBrain(k), runner: map.track && createRunner(map.track) });
    }
    bots = list;
    applyTextureSettings();
    session.rebuildRoster();
}

function removeBots() {
    botsToken++;
    for (const b of bots) b.v.car.root.removeFromParent();
    bots = [];
    session.rebuildRoster();
}

// ---------- remote cars (other players; on a client, the host's bots too) ----------
const puppets = new Map();   // id -> { car, carIndex, loading, pose, name, bot }

function syncRemotes(now, dt) {
    const seen = new Set();
    for (const r of session.remotes(now)) {
        seen.add(r.id);
        let p = puppets.get(r.id);
        if (!p) puppets.set(r.id, (p = { car: null, carIndex: -1, loading: false }));
        if (p.carIndex !== r.car && !p.loading) loadPuppet(p, r.car);
        Object.assign(p, { pose: r.pose, name: r.name, bot: r.bot });
        if (p.car) poseCar(p.car, r.pose, dt, settings.wheelStyle);
    }
    for (const [id, p] of puppets) {
        if (seen.has(id)) continue;
        if (p.car) p.car.root.removeFromParent();
        puppets.delete(id);
    }
}

async function loadPuppet(p, carI) {
    p.loading = true;
    try {
        const model = await createCar(CARS[carI] || CARS[0]);
        addShadow(model);
        if (p.car) p.car.root.removeFromParent();
        if (![...puppets.values()].includes(p)) return;   // left while loading
        p.car = model;
        p.carIndex = carI;
        scene.add(model.root);
        applyTextureSettings();
    } finally {
        p.loading = false;
    }
}

function clearPuppets() {
    for (const p of puppets.values()) if (p.car) p.car.root.removeFromParent();
    puppets.clear();
}

// Every car as an obstacle, tagged with who it is so a car can skip itself.
function obstacles() {
    const list = [];
    if (me.car) list.push({ who: 'me', ...obstacle(me) });
    for (const b of bots) list.push({ who: b.id, ...obstacle(b.v) });
    for (const [id, p] of puppets) {
        if (p.car && p.pose) list.push({ who: id, x: p.pose.x, y: p.pose.y, z: p.pose.z, yaw: p.pose.yaw, size: p.car.size });
    }
    return list;
}

// ---------- races ----------
// race.id 0 is free roam: laps are still timed, from the first time over the line. Solo and the host
// start races (DRIVE, Restart, Race again); a client follows the host's. Race time runs from the
// green light; in solo it stops while paused. Every car that is simulated here (mine, and the bots
// on solo or the host) counts its own laps; on the host, clients' laps come in over the network.
const LAP_CHOICES = [1, 2, 3, 5, 0];   // 1 = sprint, 0 = free roam
// A sprint-only map (an open road) is always one run; a circuit takes the setting.
const raceLaps = () => (map && map.track && !map.track.closed ? 1 : settings.laps);
const COUNTDOWN_MS = 3600;
const HOLD = { throttle: 0, brake: 0, steer: 0, handbrake: true, analog: true };   // on the grid
const race = { id: 0, laps: 0, goAt: 0, pausedAt: 0, standings: [] };
let myRunner = null, raceCount = 0, resultsT = 0;
const autopilot = createBrain(4);   // drives my car on after the finish
const racing = () => race.id > 0;
const onGrid = (now) => racing() && now < race.goAt;
const raceTime = (now) => ((race.pausedAt || now) - race.goAt) / 1000;

// Reset lap counting for a race (or free roam, id 0) and, unless told not to, line everyone up.
function beginRace(id, laps, goAt, place = true) {
    const track = map && map.track;
    Object.assign(race, { id: track ? id : 0, laps: track ? laps : 0, goAt, pausedAt: 0, standings: [] });
    myRunner = track ? createRunner(track) : null;
    if (!map) return;
    bots.forEach((b, k) => {
        b.runner = track && createRunner(track);
        Object.assign(b.brain, { seg: -1, stuck: 0, backing: 0, commit: 0 });
        if (place) placeVehicle(b.v, map, slotPose(botSlot(k)));
    });
    if (place) {
        placeVehicle(me, map, slotPose(mySlot()));
        crumbs.length = 0;
        cam.snap = true;
    }
}

// Solo and host: a new race with the laps setting, or free roam when it's off.
function startRace() {
    if (session.role === 'client') return;
    const laps = map && map.track ? raceLaps() : 0;
    const was = racing();
    if (laps) beginRace(++raceCount, laps, performance.now() + COUNTDOWN_MS);
    else beginRace(0, 0, performance.now());
    if (laps || was) session.sendRace(race.id, laps, COUNTDOWN_MS);
}

// Client: the host started a race (or called it off, id 0: carry on driving where you are).
function onRace(m) {
    if (m.id) beginRace(m.id, m.laps, performance.now() + Math.max(0, m.in));
    else if (racing()) beginRace(0, 0, performance.now(), false);
}

// Solo pauses stop the race clock, and the bots with it.
function frozen(now) {
    const stop = session.role === 'solo' && state !== 'play';
    if (stop && !race.pausedAt) race.pausedAt = now;
    if (!stop && race.pausedAt) { race.goAt += now - race.pausedAt; race.pausedAt = 0; }
    return stop;
}

function myLap(ev) {
    if (!ev) return;
    const r = myRunner, last = r.lapTimes[r.lapTimes.length - 1], best = last === r.best && r.lapTimes.length > 1 ? ' · BEST' : '';
    if (ev === 'finish') resultsT = 0;   // the results card says how it went
    else if (!race.laps) toast(`LAP ${formatTime(last)}${best}`, 2200);
    else toast(`${r.lap === race.laps ? 'FINAL LAP' : `LAP ${r.lap}/${race.laps}`} · ${formatTime(last)}${best}`, 2200);
}

const finishMs = (f) => Math.round((f || 0) * 1000);
const progM = (p) => (Number.isFinite(p) ? Math.round(p) : 0);

// Everyone in the current race, unordered. A client has the host's list; the host and solo make it.
function standingsNow() {
    if (!racing()) return [];
    if (session.role === 'client') {
        return (session.standings || []).map(([id, lap, f, prog]) => {
            const r = session.roster.find((p) => p.id === id);
            return { id, lap, finish: f / 1000, prog, name: id === session.myId ? playerName() : r ? r.name : '?', bot: !!(r && r.bot) };
        });
    }
    const list = [];
    if (myRunner) list.push({ id: session.myId, name: playerName(), lap: myRunner.lap, finish: myRunner.finish, prog: myRunner.prog });
    for (const b of bots) if (b.runner) list.push({ id: b.id, name: b.name, bot: true, lap: b.runner.lap, finish: b.runner.finish, prog: b.runner.prog });
    for (const p of session.roster) {
        const rep = !p.bot && p.id !== session.myId && session.raceOf(p.id);
        if (rep && rep[0] === race.id) list.push({ id: p.id, name: p.name, lap: rep[1] | 0, prog: rep[2] | 0, finish: (rep[3] | 0) / 1000 });
    }
    return list;
}

function stepRace(now, dt) {
    const track = map.track;
    if (!track) return;
    const t = raceTime(now);
    if (myRunner && me.car && state === 'play') myLap(stepRunner(myRunner, track, poseOf(me), t, dt, race.laps));
    for (const b of bots) if (b.runner) stepRunner(b.runner, track, poseOf(b.v), t, dt, race.laps);
    race.standings = rank(standingsNow());
}

// HUD: position, lap, time, best lap; the start lights; wrong way; results once I'm over the line.
let hudText = '';
function updateRaceHud(now, dt) {
    const show = state === 'play' && !!myRunner;
    $('raceHud').hidden = !show;
    const r = myRunner, finished = !!(r && r.finish && racing());
    let count = '';
    if (state === 'play' && racing()) {
        if (onGrid(now)) { const n = Math.ceil((race.goAt - now) / 1000); count = n <= 3 ? String(n) : ''; }
        else if (now - race.goAt < 900) count = 'GO!';
    }
    $('countdown').hidden = !count;
    if (count && $('countdown').textContent !== count) $('countdown').textContent = count;
    $('wrongWay').hidden = !(show && r.wrong && !finished && !onGrid(now));
    $('results').hidden = !(state === 'play' && finished);
    document.body.classList.toggle('finished', finished);   // the autopilot drives: no pedals
    if (!show) return;

    const t = raceTime(now), pos = race.standings.findIndex((e) => e.id === session.myId);
    const lap = racing() ? `${clamp(r.lap, 1, race.laps)}/${race.laps}` : r.lap ? String(r.lap) : '-';
    const time = racing() ? (r.finish || Math.max(0, t)) : r.lap ? t - r.lapStart : 0;
    const text = [racing() && pos >= 0 ? `${pos + 1}/${race.standings.length}` : '', lap, formatTime(time), formatTime(r.best)].join('|');
    if (text !== hudText) {
        hudText = text;
        const [p, l, tm, b] = text.split('|');
        $('rPosRow').hidden = !p;
        $('rPos').textContent = p;
        $('rLap').textContent = l;
        $('rTime').textContent = tm;
        $('rBest').textContent = b;
    }
    if (finished && (resultsT -= dt) <= 0) {
        resultsT = 0.25;
        renderResults();
    }
}

function renderResults() {
    const list = $('resList');
    list.innerHTML = '';
    race.standings.forEach((e, i) => {
        const li = document.createElement('li');
        li.className = e.id === session.myId ? 'me' : '';
        const name = Object.assign(document.createElement('span'), { textContent: `${i + 1}. ${e.name}${e.bot ? ' (bot)' : ''}` });
        const how = Object.assign(document.createElement('span'), {
            textContent: e.finish ? formatTime(e.finish) : `lap ${clamp(e.lap, 1, race.laps)}/${race.laps}`,
        });
        li.append(name, how);
        list.append(li);
    });
    const client = session.role === 'client';
    $('resAgain').hidden = client;
    $('resNote').textContent = client ? 'The host starts the next race.' : '';
}

// ---------- name tags over other cars ----------
const tags = new Map(), tagPos = new THREE.Vector3();
function updateTags(entries) {
    const box = $('tags'), live = new Set();
    for (const e of entries) {
        live.add(e.id);
        let el = tags.get(e.id);
        if (!el) {
            el = document.createElement('div');
            el.className = 'tag';
            box.append(el);
            tags.set(e.id, el);
        }
        if (el.textContent !== e.label) el.textContent = e.label;
        el.classList.toggle('bot', !!e.bot);
        tagPos.set(e.x, e.y + 2.1, e.z);
        const dist = tagPos.distanceTo(camera.position);
        tagPos.project(camera);
        const visible = state === 'play' && dist < 140 && tagPos.z < 1 && Math.abs(tagPos.x) < 1.1 && Math.abs(tagPos.y) < 1.1;
        el.hidden = !visible;
        if (visible) el.style.transform = `translate(${((tagPos.x + 1) / 2) * innerWidth}px, ${((1 - tagPos.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of tags) if (!live.has(id)) { el.remove(); tags.delete(id); }
}

// ---------- multiplayer ----------
const session = createSession({
    me: () => ({ name: playerName(), car: carIndex, pose: poseOf(me) }),
    bots: () => bots.map((b) => ({ id: b.id, name: b.name, car: b.car, pose: poseOf(b.v) })),
    mapIndex: () => mapIndex,
    myRace: () => (racing() && myRunner ? [race.id, myRunner.lap, progM(myRunner.prog), finishMs(myRunner.finish)] : null),
    standings: () => (racing() ? race.standings.map((e) => [e.id, e.lap, finishMs(e.finish), progM(e.prog)]) : null),
    onMap: (i) => selectMap(i, true),
    onRace,
    onRoster: updateMpUI,
    onEnd: (reason) => {
        toast(reason, 3000);
        clearPuppets();
        if (racing()) beginRace(0, 0, performance.now(), false);
        updateMpUI();
        if (state === 'play' || state === 'pause') spawnBots();
    },
    onStatus: (t) => { $('mpStatus').textContent = t; },
});

async function hostGame() {
    $('mpStatus').textContent = 'Opening a room…';
    try {
        await session.host(settings.maxPlayers);
        clearPuppets();
        if (state !== 'menu' && state !== 'mp') spawnBots();
    } catch (err) {
        $('mpStatus').textContent = err.message || String(err);
    }
    updateMpUI();
}

async function joinGame(code) {
    try {
        removeBots();
        await session.join(code, playerName(), carIndex);
        beginRace(0, 0, performance.now());   // free roam on my grid slot until the host starts a race
        toast(`Joined room ${session.code}`);
    } catch (err) {
        $('mpStatus').textContent = err.message || String(err);
    }
    updateMpUI();
}

async function leaveGame() {
    await session.leave();
    clearPuppets();
    if (racing()) beginRace(0, 0, performance.now(), false);
    $('mpStatus').textContent = 'Not in a room';
    updateMpUI();
    if (state === 'play' || state === 'pause') spawnBots();
}

function inviteLink() {
    const u = new URL(location.href);
    u.search = `?join=${session.code}`;
    return u.href;
}

function updateMpUI() {
    const role = session.role, inRoom = role !== 'solo';
    $('mpHost').hidden = $('joinRow').hidden = inRoom;
    $('mpLeave').hidden = $('mpCopy').hidden = !inRoom;
    $('mpCode').textContent = inRoom ? session.code : '';
    $('mpCodeBox').hidden = !inRoom;
    $('mpMax').disabled = inRoom;
    $('mpMax').textContent = `${inRoom ? session.max : settings.maxPlayers} players`;
    const list = $('mpRoster');
    list.innerHTML = '';
    for (const r of session.roster) {
        const li = document.createElement('li');
        li.textContent = `${r.name}${r.bot ? ' (bot)' : ''}${r.id === session.myId ? ' (you)' : ''}${r.id === 1 ? ' · host' : ''}`;
        list.append(li);
    }
    const line = inRoom ? `Room ${session.code} · ${session.players}/${session.max} players${role === 'client' ? ' · host picks the map' : ''}` : '';
    $('mpLine').textContent = line;
    $('mpLine').hidden = !inRoom;
    $('hudRoom').hidden = !inRoom;
    $('prevMap').disabled = $('nextMap').disabled = role === 'client';
    $('botsBtn').disabled = role === 'client';
    $('botsBtn').textContent = role === 'client' ? 'Bots: host' : `Bots: ${settings.bots}`;
    const track = !!(map && map.track);
    const sprintOnly = track && !map.track.closed, laps = raceLaps();
    $('lapsBtn').disabled = role === 'client' || !track || sprintOnly;
    $('lapsBtn').textContent = !track ? 'No race' : role === 'client' ? 'Race: host' : laps === 1 ? 'Sprint' : laps ? `Laps: ${laps}` : 'Free roam';
}

// ---------- camera ----------
const CAMERAS = [
    { name: 'Chase', dist: 6.2, height: 2.0, look: 1.0, ahead: 2.5 },
    { name: 'Far', dist: 10, height: 3.8, look: 1.0, ahead: 3.5 },
    { name: 'Bumper', bumper: true },
    { name: 'Top', dist: 9, height: 22, look: 0, ahead: 0 },
];
const cam = { yaw: 0, pos: new THREE.Vector3(), snap: true, open: 1, orbit: 0, orbitSpeed: 0.35 };
const lookAt = new THREE.Vector3();
const inMenu = () => state === 'menu' || state === 'settings' || state === 'mp';

function updateCamera(dt) {
    const car = me.car;
    if (!car) return;
    const scale = car.def.length / 4.5, carY = me.y;
    const fx = Math.sin(drive.yaw), fz = Math.cos(drive.yaw);
    const fast = clamp(Math.abs(drive.speed) / TUNING.maxSpeed, 0, 1);
    camera.fov = 60 + fast * 5;
    camera.updateProjectionMatrix();

    if (inMenu()) {
        // showroom: slow orbit, aimed low so the car sits above the menu card
        cam.orbit += dt * cam.orbitSpeed;
        const a = drive.yaw + cam.orbit, r = 7 * scale;
        camera.position.set(drive.x + Math.sin(a) * r, carY + 1.9 * scale, drive.z + Math.cos(a) * r);
        camera.lookAt(drive.x, carY - 0.9 * scale, drive.z);
        cam.snap = true;
        return;
    }

    const c = CAMERAS[settings.camera % CAMERAS.length];
    if (c.bumper) {
        camera.position.set(drive.x + fx * car.size.z * 0.52, carY + car.size.y * 0.45, drive.z + fz * car.size.z * 0.52);
        camera.lookAt(drive.x + fx * 30, carY + car.size.y * 0.4, drive.z + fz * 30);
        cam.snap = true;
        return;
    }
    // Only the heading is smoothed, so a slide still swings the car out to the side of the frame.
    // The distance is fixed: the camera is placed exactly that far back every frame, so speed
    // never stretches the gap.
    let diff = drive.yaw - cam.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    cam.yaw = cam.snap ? drive.yaw : cam.yaw + diff * damp(5, dt);
    cam.snap = false;
    const dist = c.dist * scale;
    cam.pos.set(drive.x - Math.sin(cam.yaw) * dist, carY + c.height * scale, drive.z - Math.cos(cam.yaw) * dist);
    // on a downhill the road behind is higher than the car: stay above it
    const behind = map.groundAt(cam.pos.x, cam.pos.z, cam.pos.y + 6, 0);
    if (behind !== null) cam.pos.y = Math.max(cam.pos.y, behind + 1.2);
    // tunnels, bridge decks, walls: if anything sits between the car and the camera, move the camera
    // up to it. It moves in at once and eases back out once the way is clear.
    if (map.walls && map.walls.castRay) {
        const hx = drive.x, hy = carY + 1.3 * scale, hz = drive.z;
        const len = Math.hypot(cam.pos.x - hx, cam.pos.y - hy, cam.pos.z - hz);
        const hit = map.walls.castRay(hx, hy, hz, cam.pos.x, cam.pos.y, cam.pos.z);
        const open = hit === null ? 1 : clamp((hit * len - 0.5) / len, 0.2, 1);
        cam.open = cam.snap || open < cam.open ? open : cam.open + (open - cam.open) * damp(4, dt);
        cam.pos.set(hx + (cam.pos.x - hx) * cam.open, hy + (cam.pos.y - hy) * cam.open, hz + (cam.pos.z - hz) * cam.open);
    }
    camera.position.copy(cam.pos);
    lookAt.set(drive.x + fx * c.ahead * scale, carY + c.look * scale, drive.z + fz * c.ahead * scale);
    camera.lookAt(lookAt);
}

// ---------- states: menu / settings / mp / play / pause ----------
let state = 'menu', settingsFrom = 'menu';
const input = createInput({
    pause: () => (state === 'play' ? pause() : state === 'pause' && resume()),
    camera: () => {
        settings.camera = (settings.camera + 1) % CAMERAS.length;
        saveSettings();
        cam.snap = true;
        toast(`Camera: ${CAMERAS[settings.camera].name}`);
    },
    nextCar: () => selectCar(carIndex + 1),
    prevCar: () => selectCar(carIndex - 1),
    reset: resetCar,
    pixel: () => { cycle('pixel'); toast(`Pixel size: ${labels.pixel()}`); },
    wheelStyle: () => { cycle('wheelStyle'); toast(`Wheels: ${labels.wheelStyle()}`); },
    touchMode: updateLayers,
});

// Settings rows: what each one cycles through and how it reads.
const OPTIONS = {
    pixel: PIXEL_STEPS,
    textures: TEXTURE_STEPS,
    filter: ['smooth', 'pixel'],
    anisotropy: [0, ...ANISO_STEPS],
    draw: [0, 1, 2],
    wheelStyle: ['smooth', 'stepped'],
};
const labels = {
    pixel: () => (settings.pixel === 1 ? 'Off (sharp)' : `${settings.pixel}x`),
    filter: () => (settings.filter === 'smooth' ? 'Smooth' : 'Pixel'),
    anisotropy: () => (settings.anisotropy ? `${settings.anisotropy}x` : `Auto (${anisotropy()}x)`),
    textures: () => {
        const t = settings.textures;
        return t === 'auto' ? `Auto (${resolveCap(t) || 'Full'})` : t === 'full' ? 'Full' : `${t} px`;
    },
    draw: () => DRAW[settings.draw].name,
    wheelStyle: () => (settings.wheelStyle === 'smooth' ? 'Smooth' : 'Stepped'),
};
const APPLY = {
    pixel: resize, textures: applyTextureSettings, filter: applyTextureSettings, anisotropy: applyTextureSettings,
    draw: applyDraw, wheelStyle: () => {},
};

function cycle(key) {
    const list = OPTIONS[key], i = list.indexOf(settings[key]);
    settings[key] = list[(i + 1) % list.length];
    saveSettings();
    APPLY[key]();
    updateSettingsLabels();
}

function updateSettingsLabels() {
    for (const key of Object.keys(OPTIONS)) $(`set_${key}`).textContent = labels[key]();
    $('texMem').textContent = `≈ ${textureMemoryMB().toFixed(1)} MB of textures loaded`;
}

function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
}

function updateLayers() {
    const playing = state === 'play';
    $('hud').hidden = !playing;
    $('tags').hidden = !playing;
    $('touch').hidden = !(playing && input.touchMode);
    document.body.classList.toggle('playing', playing);
    document.body.classList.toggle('touch', input.touchMode);
    $('hint').textContent = input.touchMode
        ? 'Left thumb: drag to steer · Right: GAS, BRAKE, DRIFT'
        : 'W/S or ↑/↓ drive · A/D steer · Space drift · C camera · Q/E car · R reset · P pixels · T wheel style';
}

function start() {
    if (!map || !me.car) return;
    state = 'play';
    show(null);
    input.setEnabled(true);
    cam.snap = true;
    if (input.touchMode) enterFullscreenLandscape();
    if (session.role !== 'client') {
        if (!bots.length) spawnBots();
        startRace();
    } else if (!racing()) beginRace(0, 0, performance.now());
    updateLayers();
}

function pause() {
    if (state !== 'play') return;
    state = 'pause';
    input.setEnabled(false);
    $('pauseRoom').textContent = session.role === 'solo' ? '' : `Room ${session.code} · the race goes on while you're paused`;
    $('restart').hidden = session.role === 'client' || !(map && map.track && raceLaps());
    show('pause');
    updateLayers();
}

function resume() {
    state = 'play';
    show(null);
    input.setEnabled(true);
    updateLayers();
}

function toMenu() {
    state = 'menu';
    input.setEnabled(false);
    removeBots();
    // the host leaving for the garage calls the race off for everyone
    if (session.role === 'host' && racing()) session.sendRace(0, 0, 0);
    beginRace(0, 0, performance.now());
    show('menu');
    updateLayers();
}

function openScreen(id) {
    settingsFrom = state;
    state = id;
    if (id === 'settings') updateSettingsLabels();
    if (id === 'mp') updateMpUI();
    show(id);
    updateLayers();
}

function closeScreen() {
    state = settingsFrom;
    show(state === 'play' ? null : state);
    updateLayers();
}

function enterFullscreenLandscape() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
        .catch(() => { /* iOS Safari: the rotate hint covers it */ });
}

$('play').addEventListener('click', start);
$('prevCar').addEventListener('click', () => selectCar(carIndex - 1));
$('nextCar').addEventListener('click', () => selectCar(carIndex + 1));
$('prevMap').addEventListener('click', () => selectMap(mapIndex - 1));
$('nextMap').addEventListener('click', () => selectMap(mapIndex + 1));
$('resume').addEventListener('click', resume);
$('restart').addEventListener('click', () => { resume(); startRace(); });
$('resAgain').addEventListener('click', startRace);
$('resGarage').addEventListener('click', toMenu);
$('lapsBtn').addEventListener('click', () => {
    settings.laps = LAP_CHOICES[(LAP_CHOICES.indexOf(settings.laps) + 1) % LAP_CHOICES.length];
    saveSettings();
    updateMpUI();
});
$('garage').addEventListener('click', toMenu);
$('menuSettings').addEventListener('click', () => openScreen('settings'));
$('pauseSettings').addEventListener('click', () => openScreen('settings'));
$('settingsBack').addEventListener('click', closeScreen);
$('menuMp').addEventListener('click', () => openScreen('mp'));
$('mpBack').addEventListener('click', closeScreen);
$('botsBtn').addEventListener('click', () => {
    settings.bots = (settings.bots + 1) % (BOT_NAMES.length + 1);
    saveSettings();
    updateMpUI();
});
$('mpMax').addEventListener('click', () => {
    settings.maxPlayers = MAX_CHOICES[(MAX_CHOICES.indexOf(settings.maxPlayers) + 1) % MAX_CHOICES.length];
    saveSettings();
    updateMpUI();
});
$('mpName').value = settings.name;
$('mpName').addEventListener('input', () => { settings.name = $('mpName').value; saveSettings(); });
$('mpHost').addEventListener('click', hostGame);
$('mpJoin').addEventListener('click', () => joinGame($('mpJoinCode').value));
$('mpJoinCode').addEventListener('input', () => { $('mpJoinCode').value = cleanCode($('mpJoinCode').value); });
$('mpLeave').addEventListener('click', leaveGame);
$('mpCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(inviteLink()); toast('Invite link copied'); } catch { prompt('Invite link:', inviteLink()); }
});
for (const key of Object.keys(OPTIONS)) $(`set_${key}`).addEventListener('click', () => cycle(key));
addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;   // typing a name or a room code
    if ((state === 'settings' || state === 'mp') && e.code === 'Escape') closeScreen();
    if (state !== 'menu') return;
    if (e.code === 'Enter') { e.preventDefault(); start(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') selectCar(carIndex - 1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') selectCar(carIndex + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') selectMap(mapIndex - 1);
    else if (e.code === 'ArrowDown' || e.code === 'KeyS') selectMap(mapIndex + 1);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
// Hidden tabs get no animation frames. Keep the network going on a timer instead (browsers slow
// it to about once a second), so a host who switches tabs doesn't freeze everyone else's view.
setInterval(() => { if (document.hidden && map) session.tick(performance.now()); }, 250);

let toastTimer = 0;
function toast(text, ms = 1400) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- main loop ----------
const speedEl = $('speed'), gearEl = $('gear');
let last = performance.now(), fpsT = 0, fpsN = 0, roomT = 0;

// Debug: __game.topView(x, z, size) looks straight down with an orthographic camera
// (null switches back). Used to find roads and spawn points on imported maps.
let topCam = null;
function topView(x, z, size = 400) {
    if (x === null) { topCam = null; applyDraw(); return; }
    topCam = new THREE.OrthographicCamera(-size / 2 * camera.aspect, size / 2 * camera.aspect, size / 2, -size / 2, 1, 5000);
    topCam.position.set(x, 2000, z);
    topCam.up.set(0, 0, -1);   // north (-z) at the top of the screen
    topCam.lookAt(x, 0, z);
    scene.fog.far = 1e6;
}

function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (map) {
        syncRemotes(now, dt);
        const all = obstacles(), others = (who) => all.filter((o) => o.who !== who);
        const stop = frozen(now), grid = onGrid(now);
        if (me.car) {
            if (state === 'play') {
                const keys = input.read();   // read every frame so one-shot pad buttons stay live
                const ctl = grid ? HOLD : myRunner && myRunner.finish && racing() ? botInput(me, autopilot, map, others('me'), dt) : keys;
                stepVehicle(me, map, ctl, dt, others('me'));
                dropCrumbs(dt, now);
                poseVehicle(me, map, dt, settings.wheelStyle);
            } else if (inMenu()) {
                // let the showroom wheels roll slowly so you can see the rig working
                drive.steer = Math.sin(now / 900) * 0.35;
                poseVehicle(me, map, dt, settings.wheelStyle, 3);
            } else {
                poseVehicle(me, map, dt, settings.wheelStyle);
            }
        }
        for (const b of bots) {
            const near = others(b.id);
            if (!stop) stepVehicle(b.v, map, grid ? HOLD : botInput(b.v, b.brain, map, near, dt), dt, near);
            poseVehicle(b.v, map, dt, settings.wheelStyle);
        }
        if (!stop) stepRace(now, dt);
        updateRaceHud(now, dt);
        session.tick(now);
        updateCamera(dt);
        updateTags([
            ...bots.map((b) => ({ id: b.id, label: b.name, bot: true, x: b.v.drive.x, y: b.v.y, z: b.v.drive.z })),
            ...[...puppets].filter(([, p]) => p.pose).map(([id, p]) => ({ id, label: p.name, bot: p.bot, ...p.pose })),
        ]);
    }

    const kmh = Math.round(Math.abs(drive.speed) * 3.6);
    speedEl.textContent = kmh;
    gearEl.textContent = drive.speed < -0.5 ? 'R' : kmh < 1 ? 'N' : 'D';
    if (session.role !== 'solo' && now - roomT > 500) {
        roomT = now;
        const ping = session.role === 'client' ? ` · ${session.rtt()} ms` : '';
        $('hudRoom').textContent = `ROOM ${session.code} · ${session.players}/${session.max}${ping}`;
    }

    renderer.render(scene, topCam || camera);

    if (DEBUG) {
        fpsN++;
        fpsT += dt;
        if (fpsT > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsT)} fps · ${renderer.info.render.calls} draws`; fpsT = fpsN = 0; }
    }
}

// ---------- boot ----------
$('fps').hidden = !DEBUG;
updateLayers();
updateSettingsLabels();
updateMpUI();
selectMap(mapIndex).then(() => { if (params.get('state') === 'play') start(); });
selectCar(carIndex).then(() => { if (params.get('state') === 'play') start(); });
if (params.has('join')) {
    $('mpJoinCode').value = cleanCode(params.get('join'));
    openScreen('mp');
}
requestAnimationFrame(frame);
window.__game = {
    drive, me, get car() { return me.car; }, get map() { return map; }, get bots() { return bots; }, puppets, session,
    race, get runner() { return myRunner; }, startRace,
    camera, cam, selectCar, selectMap, settings, renderer, topView, hostGame, joinGame, leaveGame,
    placeCar: (p) => { placeVehicle(me, map, p); cam.snap = true; },
};
