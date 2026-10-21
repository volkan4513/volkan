// Low-Poly Strike: renderer, input (keyboard/mouse + touch), HUD and main loop.
// Game rules live in sim.js so the network host can run the same code later.
import * as THREE from './three.module.min.js';
import {
    TICK, PLAYER, BOMB, createWorld, addPlayer, removePlayer, stepWorld, stepPlayer, playerHeight, spreadOf,
    startRound, buyItem, effectiveInput, actKind, isBomb, isBR, startBR, canAim, outsideZone, LOOT_KINDS, ZONE, BR,
    solidsOf, clearLine, castRay, MOVE,
} from './sim.js';
import { buildGraph, createBrain, botInput, BOT_NAMES } from './bots.js';
import { createPlayerModel, updatePlayerModel, createViewModel, createEffects, createLootModel } from './models.js';
import { createAudio } from './audio.js';
import { createRadar } from './radar.js';
import {
    hostRoom, joinRoom, cleanCode, quantiseInput, packInputs, InputQueue, Interp, FLAG, r2, r3, netStats, SIM_NET,
} from './net.js';

const $ = (id) => document.getElementById(id);

// ---------- settings (saved per browser) ----------
const SETTINGS_KEY = 'lp-strike-settings';
const settings = {
    mouseSens: 1, touchSens: 1, touchSize: 1, low: false, fps: false,
    enemies: 4, allies: 3, diff: 'normal', freeMode: 'tdm', brBots: 9,
    touchLayout: null, touchAlpha: 1, volume: 0.7,       // touch editor: { id: { x, y, s } } as screen fractions, and button opacity
    map: 'yard', hostMap: 'yard', name: '', hostKills: 20, hostTime: 600, fillBots: true, hostDiff: 'normal', hostMode: 'tdm', hostRounds: 6,
    brZone: true, hostZone: true,
    ...loadSettings(),
};

function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}

function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

const fetchJson = async (url) => (await fetch(url)).json();
const MAP_FILES = { yard: 'map.json', dust: 'map2.json', dust2: 'map3.json' };
const [weapons, ...mapList] = await Promise.all([fetchJson('weapons.json'), ...Object.values(MAP_FILES).map(fetchJson)]);
const MAPS = Object.fromEntries(Object.keys(MAP_FILES).map((id, i) => [id, mapList[i]]));
for (const id in MAPS) {
    MAPS[id].graph = buildGraph(MAPS[id]);
    for (const list of [MAPS[id].boxes, solidsOf(MAPS[id])]) clearLine(list, [0, 1, 0], [1, 1, 1]);   // builds the box grids now, not on the first tick
}
let map = MAPS.yard, graph = map.graph;
if (!settings.name) { settings.name = 'Player' + (100 + Math.floor(Math.random() * 900)); saveSettings(); }
const WEAPON_IDS = Object.keys(weapons);
const PHASES = ['buy', 'live', 'end'];
const BSTATES = ['carried', 'dropped', 'planted', 'defused', 'exploded'];
let pal;

// ---------- renderer ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 45, 150);

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
// withUv keeps each face's own 0..1 UVs (one whole texture per face, for crates).
function mergeBoxes(boxes, grow, withColor, withUv = false) {
    const pos = [], nor = [], col = [], uv = [];
    boxes.forEach((b, i) => {
        const g = new THREE.BoxGeometry(b[3] - b[0] + grow * 2, b[4] - b[1] + grow * 2, b[5] - b[2] + grow * 2)
            .translate((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2)
            .toNonIndexed();
        pos.push(...g.attributes.position.array);
        nor.push(...g.attributes.normal.array);
        if (withUv) uv.push(...g.attributes.uv.array);
        if (withColor) {
            const c = (pal[b[6]] || pal.wall).clone().offsetHSL(0, 0, jitter(i) * 0.05);
            for (let v = 0; v < g.attributes.position.count; v++) col.push(c.r, c.g, c.b);
        }
        g.dispose();
    });
    const geo = geometryFrom(pos, nor, withColor ? col : null);
    if (withUv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return geo;
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
function shadowGeometry(boxes, y = 0.012) {
    const pos = [];
    const sx = -LIGHT_DIR.x / LIGHT_DIR.y, sz = -LIGHT_DIR.z / LIGHT_DIR.y;
    for (const b of boxes) {
        if (b[1] > 0.01) continue;
        const h = b[4], ox = sx * h, oz = sz * h;
        const pts = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]];
        const hull = convexHull([...pts, ...pts.map(([x, z]) => [x + ox, z + oz])]);
        for (let i = 1; i < hull.length - 1; i++) {
            for (const [x, z] of [hull[0], hull[i], hull[i + 1]]) pos.push(x, y, z);
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
    // CS maps: above the cobblestone. Model maps give the site's floor height as r[4].
    mesh.position.set((r[0] + r[2]) / 2, r[4] !== undefined ? r[4] + 0.03 : map.style === 'cs' ? 0.05 : 0.02, (r[1] + r[3]) / 2);
    return mesh;
}

// Big site letter floating over a model map's bombsite, seen from across the map.
function siteSign(letter, r, color) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.font = '700 110px Oswald, Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = '#111';
    g.strokeText(letter, 64, 70);
    g.fillStyle = color;
    g.fillText(letter, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
    sprite.scale.setScalar(2.2);
    sprite.position.set((r[0] + r[2]) / 2, (r[4] || 0) + 4.5, (r[1] + r[3]) / 2);
    return sprite;
}

const decalOffset = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

// CS 1.6 look: 128 px, 256-colour textures made from CC0 photos (see textures/CREDITS.txt),
// bilinear filtered like the GL renderer. m = metres per tile; fit = one whole texture per face.
const CS_TEX = {
    wall: { m: 2.4 }, stone: { m: 2 }, sand: { m: 3 }, cobble: { m: 2.2 }, plaster: { m: 2.5 }, metal: { m: 1.6 },
    crate: { fit: true }, gcrate: { fit: true }, door: { fit: true },
};
const CS_ALIAS = { brick: 'wall' };
const texLoader = new THREE.TextureLoader();
await Promise.all(Object.entries(CS_TEX).map(async ([kind, t]) => {
    try {
        t.tex = await texLoader.loadAsync(`textures/${kind}.png`);
    } catch {
        t.tex = null;       // missing file: plain colour instead
        return;
    }
    t.tex.colorSpace = THREE.SRGBColorSpace;
    t.tex.wrapS = t.tex.wrapT = THREE.RepeatWrapping;
    t.tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.tex.userData.shared = true;     // kept across map switches
}));

// One merged mesh per texture; UVs follow world position so tiles line up across boxes.
// Vertex colours fake CS lightmaps: walls get darker toward the floor, undersides are dark.
function texturedMesh(kind, g) {
    const t = CS_TEX[kind];
    const P = g.attributes.position, N = g.attributes.normal, uv = [], col = [];
    for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        const ax = Math.abs(N.getX(i)), ny = N.getY(i), ay = Math.abs(ny);
        if (!t.fit) {
            const [u, v] = ax > 0.5 ? [z, y] : ay > 0.5 ? [x, z] : [x, y];
            uv.push(u / t.m, v / t.m);
        }
        const k = ny < -0.5 ? 0.5 : ay > 0.5 ? 1 : 0.62 + 0.38 * Math.min(1, Math.max(0, y / 2.6));
        col.push(k, k, k);
    }
    if (!t.fit) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial(t.tex
        ? { map: t.tex, vertexColors: true }
        : { color: map.palette[kind] || '#c9a76a', vertexColors: true }));
}

function buildTexturedMap(boxes, extras) {
    const kindOf = (b) => {
        const k = CS_ALIAS[b[6]] || b[6];
        return CS_TEX[k] ? k : 'wall';
    };
    for (const [kind, t] of Object.entries(CS_TEX)) {
        const list = boxes.filter((b) => kindOf(b) === kind);
        if (list.length) mapGroup.add(texturedMesh(kind, mergeBoxes(list, 0, false, !!t.fit)));
        if (extras[kind]) mapGroup.add(texturedMesh(kind, concatGeometry(extras[kind])));
    }
    if (extras.dark) mapGroup.add(new THREE.Mesh(concatGeometry(extras.dark), new THREE.MeshLambertMaterial({ color: 0x2a1f14 })));
}

// Joins non-indexed geometries with the same attributes into one.
function concatGeometry(list) {
    const out = {};
    for (const g of list) {
        for (const name of ['position', 'normal', 'uv']) {
            if (!g.attributes[name]) continue;
            (out[name] || (out[name] = [])).push(...g.attributes[name].array);
        }
        g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    for (const [name, arr] of Object.entries(out)) geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, name === 'uv' ? 2 : 3));
    return geo;
}

// ---------- render-only details (map.deco) ----------
// Outline of an opening w wide and h tall whose top is an arc rising `rise` (0 = square top).
function openingPath(path, w, h, rise, y0 = 0) {
    const hw = w / 2;
    path.moveTo(-hw, y0);
    path.lineTo(hw, y0);
    if (rise > 0) {
        const R = (hw * hw + rise * rise) / (2 * rise), cy = y0 + h - R, a = Math.atan2(y0 + h - rise - cy, hw);
        path.lineTo(hw, y0 + h - rise);
        path.absarc(0, cy, R, a, Math.PI - a, false);
    } else {
        path.lineTo(hw, y0 + h);
        path.lineTo(-hw, y0 + h);
    }
    path.lineTo(-hw, y0);
    return path;
}

// Puts a shape built facing +z onto a wall face with outward normal (nx, nz).
function onFace(g, x, y, z, nx, nz, out = 0) {
    g.rotateY(Math.atan2(nx, nz));
    return g.translate(x + nx * out, y, z + nz * out);
}

const extrude = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });

// Returns { kind: [geometries] } plus the plain render-only boxes.
function buildDeco(deco = []) {
    const extras = {}, boxes = [];
    const add = (kind, g) => (extras[kind] || (extras[kind] = [])).push(g.index ? g.toNonIndexed() : g);
    for (const d of deco) {
        if (d[0] === 'box') {
            boxes.push(d.slice(1));
        } else if (d[0] === 'arch') {
            // Fills the space between the curve and the lintel above the doorway.
            const [, x, y, z, axis, w, depth, crown, rise, kind] = d;
            const hw = w / 2, top = crown - 0.04, r = rise - 0.04, R = (hw * hw + r * r) / (2 * r), cy = top - R;
            const a = Math.atan2(top - r - cy, hw);
            const s = new THREE.Shape();
            s.moveTo(hw, crown - rise);
            s.lineTo(hw, crown);
            s.lineTo(-hw, crown);
            s.lineTo(-hw, crown - rise);
            s.absarc(0, cy, R, Math.PI - a, a, true);
            const g = extrude(s, depth).translate(0, 0, -depth / 2);
            if (axis === 'z') g.rotateY(Math.PI / 2);
            add(CS_ALIAS[kind] || kind, g.translate(x, y, z));
        } else if (d[0] === 'window') {
            // Dark arched recess in a stone frame with a sill.
            const [, x, y, z, nx, nz, w, h] = d;
            add('dark', onFace(new THREE.ShapeGeometry(openingPath(new THREE.Shape(), w, h, w / 2)), x, y, z, nx, nz, 0.02));
            const frame = openingPath(new THREE.Shape(), w + 0.36, h + 0.3, (w + 0.36) / 2, -0.12);
            frame.holes.push(openingPath(new THREE.Path(), w, h, w / 2));
            add('stone', onFace(extrude(frame, 0.1), x, y, z, nx, nz));
            add('stone', onFace(new THREE.BoxGeometry(w + 0.6, 0.12, 0.24).translate(0, -0.18, 0.12), x, y, z, nx, nz));
        } else if (d[0] === 'door') {
            // Wooden double door in a stone frame.
            const [, x, y, z, nx, nz, w, h] = d;
            add('door', onFace(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), x, y, z, nx, nz, 0.03));
            const W = w + 0.5, f = new THREE.Shape();
            f.moveTo(-W / 2, 0); f.lineTo(-w / 2, 0); f.lineTo(-w / 2, h); f.lineTo(w / 2, h); f.lineTo(w / 2, 0);
            f.lineTo(W / 2, 0); f.lineTo(W / 2, h + 0.3); f.lineTo(-W / 2, h + 0.3); f.lineTo(-W / 2, 0);
            add('stone', onFace(extrude(f, 0.14), x, y, z, nx, nz));
        }
    }
    return { extras, boxes };
}

// ---------- model maps (map.model: a .glb drawn as is; map.boxes stay invisible) ----------
// Small GLB reader: triangle meshes with an optional base colour texture, which is all a map needs.
const mapModels = new Map();     // src -> Promise<THREE.Group>, kept across map switches

function loadMapModel(src) {
    if (!mapModels.has(src)) mapModels.set(src, fetch(src).then((r) => r.arrayBuffer()).then(parseGlb));
    return mapModels.get(src);
}

async function parseGlb(buf) {
    const dv = new DataView(buf), jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    const bin = 20 + jsonLen + 8;
    const TYPES = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
    const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
    const accessor = (i) => {
        const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = TYPES[a.componentType], n = SIZE[a.type];
        const start = bin + (v.byteOffset || 0) + (a.byteOffset || 0), size = T.BYTES_PER_ELEMENT;
        if (!v.byteStride || v.byteStride === n * size) return new THREE.BufferAttribute(new T(buf.slice(start, start + a.count * n * size)), n);
        const out = new T(a.count * n), bytes = new Uint8Array(buf), dst = new Uint8Array(out.buffer);
        for (let k = 0; k < a.count; k++) dst.set(bytes.subarray(start + k * v.byteStride, start + k * v.byteStride + n * size), k * n * size);
        return new THREE.BufferAttribute(out, n);
    };
    const textures = await Promise.all((json.textures || []).map(async (t) => {
        const im = json.images[t.source], v = json.bufferViews[im.bufferView];
        const blob = new Blob([new Uint8Array(buf, bin + (v.byteOffset || 0), v.byteLength)], { type: im.mimeType });
        const tex = new THREE.Texture(await createImageBitmap(blob));
        tex.flipY = false;                   // glTF UVs start at the top
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;
        return tex;
    }));
    const materials = (json.materials || []).map((m) => {
        const ti = m.pbrMetallicRoughness?.baseColorTexture?.index;
        return new THREE.MeshLambertMaterial({ map: ti !== undefined ? textures[ti] : null, side: m.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    });
    const node = (i) => {
        const n = json.nodes[i], o = new THREE.Group();
        if (n.matrix) o.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
        if (n.translation) o.position.fromArray(n.translation);
        if (n.rotation) o.quaternion.fromArray(n.rotation);
        if (n.scale) o.scale.fromArray(n.scale);
        if (n.mesh !== undefined) {
            for (const p of json.meshes[n.mesh].primitives) {
                if ((p.mode ?? 4) !== 4) continue;
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', accessor(p.attributes.POSITION));
                if (p.attributes.NORMAL !== undefined) g.setAttribute('normal', accessor(p.attributes.NORMAL));
                else g.computeVertexNormals();
                if (p.attributes.TEXCOORD_0 !== undefined) g.setAttribute('uv', accessor(p.attributes.TEXCOORD_0));
                if (p.indices !== undefined) g.setIndex(accessor(p.indices));
                o.add(new THREE.Mesh(g, materials[p.material] || new THREE.MeshLambertMaterial({ color: 0xc8a878 })));
            }
        }
        for (const c of n.children || []) o.add(node(c));
        return o;
    };
    const root = new THREE.Group();
    for (const i of json.scenes[json.scene || 0].nodes) root.add(node(i));
    return root;
}

function buildModelMap() {
    const m = map, spec = m.model;
    // The model has its own painted bombsite marks; a floating letter shows where each site is.
    for (const [k, color] of [['A', m.palette.red], ['B', m.palette.blue]]) mapGroup.add(siteSign(k, m.sites[k], color));
    loadMapModel(spec.src).then((model) => {
        if (map !== m) return;          // switched maps while it loaded
        const holder = new THREE.Group();
        holder.userData.keep = true;    // cached model: never disposed
        holder.scale.setScalar(spec.scale);
        holder.position.fromArray(spec.offset);
        holder.add(model);
        holder.updateMatrixWorld(true);
        holder.traverse((o) => { o.matrixAutoUpdate = false; });
        mapGroup.add(holder);
    }).catch((err) => console.error('map model failed to load', spec.src, err));
}

function buildMap() {
    if (map.style === 'model') {
        buildModelMap();
        return;
    }
    if (map.style === 'cs') {
        const deco = buildDeco(map.deco);
        buildTexturedMap(map.boxes.concat(deco.boxes), deco.extras);
        mapGroup.add(new THREE.Mesh(shadowGeometry(map.boxes.filter((b) => b[4] > 0.5), 0.045), new THREE.MeshBasicMaterial({
            color: 0x3a2410, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, ...decalOffset,
        })));
        mapGroup.add(siteDecal('A', map.sites.A, map.palette.red));
        mapGroup.add(siteDecal('B', map.sites.B, map.palette.blue));
        return;
    }
    const solid = map.boxes.filter((b) => b[6] !== 'floor');
    const lit = new THREE.MeshLambertMaterial({ vertexColors: true });

    mapGroup.add(new THREE.Mesh(mergeBoxes(solid, 0, true), lit));
    mapGroup.add(new THREE.Mesh(mergeBoxes(solid, 0.05, false),
        new THREE.MeshBasicMaterial({ color: pal.ink, side: THREE.BackSide })));

    for (const b of map.boxes.filter((b) => b[6] === 'floor')) mapGroup.add(new THREE.Mesh(floorGeometry(b), lit));

    mapGroup.add(new THREE.Mesh(shadowGeometry(solid), new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, ...decalOffset,
    })));

    mapGroup.add(siteDecal('A', map.sites.A, map.palette.red));
    mapGroup.add(siteDecal('B', map.sites.B, map.palette.blue));
}

// Low-poly backdrop: mountains peeking over the outer walls and a few clouds. One draw call each.
function buildBackdrop() {
    const rnd = (i) => jitter(i + 100) + 0.5;
    const hills = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, 5, 1), new THREE.MeshLambertMaterial({ flatShading: true }), 28);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const hillColors = (map.hills || ['#7fa37a', '#6b8f6a', '#94ab86', '#8a9a8f']).map((c) => new THREE.Color(c));
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
    mapGroup.add(hills);

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
    mapGroup.add(clouds);
}

const mapGroup = new THREE.Group();
scene.add(mapGroup);

const radar = createRadar($('radar'));

function useMap(id) {
    map = MAPS[id] || MAPS.yard;
    graph = map.graph;
    pal = Object.fromEntries(Object.entries(map.palette).map(([k, v]) => [k, new THREE.Color(v)]));
    scene.background = map.sky ? skyTexture(map.sky) : pal.sky;
    scene.fog.color.copy(pal.sky);
    [scene.fog.near, scene.fog.far] = map.fog || [45, 150];
    for (const o of mapGroup.children.slice()) {
        mapGroup.remove(o);
        if (o.userData.keep) continue;
        o.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) { if (n.material.map && !n.material.map.userData.shared) n.material.map.dispose(); n.material.dispose(); } });
    }
    buildMap();
    if (!map.sky) buildBackdrop();
    radar.setMap(map);
    const pc = $('pCredit');
    pc.innerHTML = creditHtml(map);
    pc.hidden = !pc.innerHTML;
}

// Credit line for maps made from someone else's model (map.credit), shown where the map is picked.
function creditHtml(m) {
    const c = m && m.credit;
    if (!c) return '';
    return `Map: "${escapeHtml(c.title)}" by <a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.author)}</a>, `
        + `<a href="${c.licenseUrl}" target="_blank" rel="noopener">${escapeHtml(c.license)}</a>. Scaled, with collision and callouts added.`;
}

// Under the map pickers (Free Area and the lobby). Not called before the lobby state exists.
function showMapCredits() {
    const set = (id, m) => {
        const el = $(id);
        el.innerHTML = creditHtml(m);
        el.hidden = !el.innerHTML;
    };
    set('fCredit', MAPS[settings.map]);
    set('lCredit', MAPS[role === 'host' || !lobby.s || !lobby.s.m ? settings.hostMap : lobby.s.m]);
}

// Callout under the player's feet, from map.areas ({ name, r: [x0, z0, x1, z1], y?: [min, max] }). First match wins.
function areaAt(x, y, z) {
    for (const a of map.areas || []) {
        const r = a.r;
        if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3] && (!a.y || (y >= a.y[0] && y <= a.y[1]))) return a.name;
    }
    return '';
}

const skies = new Map();
function skyTexture(url) {
    if (!skies.has(url)) {
        const t = texLoader.load(url);
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        skies.set(url, t);
    }
    return skies.get(url);
}
useMap(settings.map);

const fx = createEffects(scene);

// ---------- sound ----------
const sfx = createAudio();
sfx.setVolume(settings.volume);
// Browsers only allow audio after a gesture: any click, tap or key starts it.
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => sfx.unlock(), true);

// A world sound at a point, muffled when a wall is between it and the camera.
function heard(x, y, z) {
    const c = camera.position;
    return { at: [x, y, z], muffled: !clearLine(world.boxes, [c.x, c.y, c.z], [x, y, z]) };
}
const heardFrom = (p) => heard(p.x, p.y + 1.4, p.z);
const lastShot = new Map();     // player id -> time of their last shot (performance.now), for the radar

function soundFor(e) {
    if (e.t === 'shot') {
        const p = byId(e.by);
        if (!p) return;
        lastShot.set(p.id, performance.now());
        if (e.w) sfx.gun(e.w, p === me ? null : heardFrom(p));
    } else if (e.t === 'hit') {
        if (e.by === me.id && e.tgt !== me.id) sfx.hit(e.hs);
        if (e.tgt === me.id) sfx.hurt();
    } else if (e.t === 'kill') {
        if (e.by === me.id && e.tgt !== me.id) sfx.kill();
    } else if (e.t === 'reload') {
        const p = byId(e.id);
        const W = p && p.inv && p.inv[p.slot] && weapons[p.inv[p.slot].id];
        if (p) sfx.reload(p === me ? null : heardFrom(p), W ? W.reload : 2);
    } else if (e.t === 'plant') {
        const p = byId(e.by);
        if (p) sfx.plant(p === me ? null : heardFrom(p));
    } else if (e.t === 'defuse') {
        sfx.defuse();
    } else if (e.t === 'explode') {
        sfx.explode(heard(e.x, e.y + 0.5, e.z));
    } else if (e.t === 'round') {
        if (e.phase === 'live') sfx.ui('go');
        else if (e.phase === 'end') sfx.ui(e.winner === me.team ? 'win' : 'lose');
    } else if (e.t === 'over') {
        sfx.ui((isBR(world) ? e.winner === me.id : e.winner === me.team) ? 'win' : 'lose');
    } else if ((e.t === 'buy' && e.id === me.id) || (e.t === 'loot' && e.by === me.id)) {
        sfx.ui(e.t === 'buy' ? 'buy' : 'pickup');
    }
}

// Footsteps for anyone running on the ground (walking and crouching are silent, as in CS),
// and a thud when landing from a real drop.
const feet = new Map();     // player id -> { x, z, y, acc, air, peak }
function stepSounds(dt) {
    if (!dt) return;
    const c = camera.position;
    for (const p of world.players) {
        let f = feet.get(p.id);
        if (!f || !p.alive) {
            feet.set(p.id, { x: p.x, z: p.z, y: p.y, acc: 0, air: false, peak: p.y });
            continue;
        }
        const d = Math.hypot(p.x - f.x, p.z - f.z);
        const near = Math.hypot(p.x - c.x, p.z - c.z) < 45;
        if (p.onGround) {
            if (f.air && f.peak - p.y > 0.8 && near) sfx.land(p === me ? null : heardFrom(p));
            f.air = false;
            if (d / dt > MOVE.walk + 0.4 && d < 1) {
                f.acc += d;
                if (f.acc > 2.1) {
                    f.acc = 0;
                    if (near) sfx.step(p === me ? null : heard(p.x, p.y + 0.1, p.z));
                }
            }
        } else {
            if (!f.air) f.peak = p.y;
            f.air = true;
            f.peak = Math.max(f.peak, p.y);
        }
        Object.assign(f, { x: p.x, z: p.z, y: p.y });
    }
}

// ---------- radar ----------
const TEAM_COLOR = { t: '#ff6050', ct: '#00a5ff' };
const spotted = new Map();     // enemy id -> time last seen by your side
let spotAt = 0;

// Enemies show while you or a teammate can see them, and briefly after they fire nearby.
function updateSpotted(now) {
    if (now < spotAt) return;
    spotAt = now + 200;
    const br = isBR(world);
    const eyes = world.players.filter((p) => p.alive && (p === me || (!br && p.team === me.team)));
    for (const e of world.players) {
        if (!e.alive || e === me || (!br && e.team === me.team)) continue;
        const seen = eyes.some((s) => Math.hypot(s.x - e.x, s.z - e.z) < 70
            && clearLine(world.boxes, [s.x, s.y + 1.6, s.z], [e.x, e.y + 1.2, e.z]));
        const shot = now - (lastShot.get(e.id) || -1e9) < 700 && Math.hypot(e.x - camera.position.x, e.z - camera.position.z) < 30;
        if (seen || shot) spotted.set(e.id, now);
    }
}

function drawRadar(now) {
    updateSpotted(now);
    const br = isBR(world), dc = deathCam;
    const watch = me.alive ? me : dc && dc.mode === 'spec' ? byId(dc.spec) : null;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const view = {
        x: watch ? watch.x : camera.position.x, z: watch ? watch.z : camera.position.z, y: watch ? watch.y : me.y,
        yaw: me.alive ? lookYaw : Math.atan2(-dir.x, -dir.z),
        players: [], sites: [], bomb: null, zone: world.zone,
    };
    for (const p of world.players) {
        if (!p.alive || p === watch) continue;
        const mate = !br && p.team === me.team;
        if (!mate && !(now - (spotted.get(p.id) || -1e9) < 1000)) continue;
        view.players.push({ x: p.x, z: p.z, y: p.y, yaw: p.yaw, color: br ? '#ffd23f' : TEAM_COLOR[p.team] || '#fff' });
    }
    if (!br && map.sites) {
        for (const [k, color] of [['A', map.palette.red], ['B', map.palette.blue]]) {
            const r = map.sites[k];
            if (r) view.sites.push({ name: k, x: (r[0] + r[2]) / 2, z: (r[1] + r[3]) / 2, color });
        }
    }
    const b = world.bomb;
    if (b && (b.state === 'planted' || (b.state === 'dropped' && me.team === world.att))) view.bomb = { x: b.x, z: b.z, planted: b.state === 'planted' };
    radar.draw(view);
}

// Battle royale: the zone wall, a ring where it shrinks to next, and the loot on the floor.
const zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60, 72, 1, true), new THREE.MeshBasicMaterial({
    color: 0x3a8dff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false,
}));
const zoneNext = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, ...decalOffset,
}));
zoneWall.position.y = 25;
zoneNext.position.y = 0.05;
zoneWall.visible = zoneNext.visible = false;
scene.add(zoneWall, zoneNext);

const lootGroup = new THREE.Group();
scene.add(lootGroup);
let lootMeshes = [];

function buildLoot() {
    for (const m of lootMeshes) {
        lootGroup.remove(m.root);
        m.root.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
    }
    lootMeshes = world && world.loot ? world.loot.map((l) => {
        const m = createLootModel(l.kind);
        lootGroup.add(m.root);
        return m;
    }) : [];
}

function updateZoneAndLoot(now) {
    const zn = world && world.zone;
    zoneWall.visible = !!zn && !zn.off && zn.r > 0.05;
    zoneNext.visible = !!zn && zn.stage < ZONE.length && zn.tr > 0.05;
    if (zn) {
        zoneWall.position.x = zn.x;
        zoneWall.position.z = zn.z;
        zoneWall.scale.set(Math.max(zn.r, 0.01), 1, Math.max(zn.r, 0.01));
        zoneNext.position.set(zn.tx, 0.05, zn.tz);
        zoneNext.scale.setScalar(Math.max(zn.tr, 0.01));
    }
    lootMeshes.forEach((m, i) => {
        const l = world.loot[i];
        m.root.visible = !l.taken;
        if (l.taken) return;
        m.root.position.set(l.x, l.y + 0.5 + Math.sin(now / 400 + i) * 0.06, l.z);
        m.item.rotation.y = now / 700 + i;
    });
}

// Everyone gets their own colour in battle royale.
const BR_COLORS = [0xff6050, 0x00a5ff, 0x3cc85a, 0xffb020, 0xb36bff, 0xff7ac8, 0x22d3c5, 0xf2f2f2, 0x8a6a3c, 0x9bd23a, 0x5b6bff, 0xff9a3c];

// The bomb on the floor (dropped) or armed (planted): a dark case with a blinking light.
const bombMesh = new THREE.Group();
const bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
bombLight.position.y = 0.14;
bombMesh.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.32), new THREE.MeshLambertMaterial({ color: 0x323834 })), bombLight);
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
let deathCam = null;     // set while you are dead, see deathCamera()

const byId = (id) => world && world.players.find((p) => p.id === id);

function startFreeArea() {
    clearMatch();
    useMap(settings.map);
    const br = settings.freeMode === 'br';
    world = createWorld(map, weapons, br
        ? { mode: 'br', respawn: -1, infiniteAmmo: false, zone: settings.brZone, map: settings.map }
        : { infiniteAmmo: true, map: settings.map });
    me = addPlayer(world, { name: 'You', team: 't' });
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const addBot = (team) => {
        const p = addPlayer(world, { name: names.pop() || `Bot ${world.nextId}`, team, bot: true });
        brains.set(p.id, createBrain(settings.diff));
    };
    if (br) {
        for (let i = 0; i < settings.brBots; i++) addBot('ct');
        startBR(world);
        buildLoot();
    } else {
        for (let i = 0; i < settings.allies; i++) addBot('t');
        for (let i = 0; i < settings.enemies; i++) addBot('ct');
    }
    drainEvents();
    overAt = 0;
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
    world = me = killer = deathCam = null;
    buildLoot();
    aimK = 0;
    touch.aim = false;
}

function modelFor(p) {
    let m = models.get(p.id);
    if (!m) {
        m = createPlayerModel(isBR(world) ? BR_COLORS[p.id % BR_COLORS.length] : p.team);
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
    else if (world.over && isBR(world)) {
        // Free Area battle royale: show the result for a few seconds, then back to the menu.
        if (!overAt) overAt = performance.now() + 8000;
        else if (performance.now() >= overAt) { overAt = 0; quit(); }
    }
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
    soundFor(e);
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
        if (isBR(world)) {
            const w = byId(e.winner);
            if (w) w.place = 1;
            showBanner(w === me ? 'Winner! #1' : w ? `${w.name} wins` : 'Nobody survived', 6);
        }
    } else if (e.t === 'kill') {
        const tgt = byId(e.tgt);
        if (tgt && e.pl) tgt.place = e.pl;
        addFeed(e);
        if (e.tgt === me.id) {
            killer = byId(e.by) || null;
            startDeathCam(e);
        }
    } else if (e.t === 'loot') {
        const l = world.loot && world.loot[e.id];
        if (l) l.taken = true;
        if (e.by === me.id) {
            showBanner(e.kind === 'med' ? '+50 HP' : `Picked up ${weapons[e.kind].name}`, 1.4);
            // Swap to a new gun straight away when all you hold is the pistol.
            const cur = me.inv[me.slot];
            if (e.kind !== 'med' && e.slot >= 0 && (!cur || cur.id === 'pistol')) {
                lastSlot = wantSlot;
                wantSlot = e.slot;
            }
        }
    } else if (e.t === 'spawn') {
        const p = byId(e.id);
        if (!p) return;
        prevPos.set(p.id, { x: p.x, y: p.y, z: p.z });
        if (p === me) {
            lookYaw = e.yaw !== undefined ? e.yaw : p.yaw;
            lookPitch = 0;
            pending.length = 0;
            wantSlot = 0;
            killer = deathCam = null;
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
        s.className = isBR(world) ? '' : p.team;
        s.textContent = p.name;
        return s;
    };
    if (by && by !== tgt) row.append(name(by), ` [${weapons[e.w] ? weapons[e.w].name : e.w}${e.hs ? ' HS' : ''}] `, name(tgt));
    else row.append(name(tgt), e.w === 'zone' ? ' was caught by the zone' : ' fell');
    feedEl.prepend(row);
    while (feedEl.children.length > 5) feedEl.lastChild.remove();
    setTimeout(() => row.remove(), 5000);
}

// ---------- input ----------
const keys = new Set();
const input = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, yaw: 0, pitch: 0, fire: false, reload: false, use: false, aim: false, slot: 0 };
let jumpQueued = false, reloadQueued = false, mouseFire = false, mouseAim = false;
const touch = { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false, use: false, aim: false };
let aimK = 0, zoomNow = 1;     // scope: 0..1 aim-in progress and the current zoom, for drawing and look speed
let touchMode = matchMedia('(pointer: coarse)').matches;

const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'ShiftLeft', 'ShiftRight', 'Tab', 'KeyR', 'KeyQ', 'KeyE', 'KeyB', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];

function selectSlot(i) {
    if (!me || !me.inv[i] || i === wantSlot) return;
    lastSlot = wantSlot;
    wantSlot = i;
    setTouchAim(false);       // switching weapons drops the scope
}

function setTouchAim(on) {
    touch.aim = on;
    $('tAim').classList.toggle('on', on);
}

function cycleSlot(dir) {
    if (me) selectSlot((wantSlot + dir + me.inv.length) % me.inv.length);
}

addEventListener('keydown', (e) => {
    if (state !== 'play') return;
    if (GAME_KEYS.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') {
        if (me && !me.alive) nextSpectate();
        else jumpQueued = true;
    }
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
addEventListener('blur', () => { keys.clear(); mouseFire = mouseAim = false; });

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
    input.aim = mouseAim || touch.aim;
    input.yaw = lookYaw;
    input.pitch = lookPitch;
    input.slot = wantSlot;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const PITCH_LIMIT = Math.PI / 2 - 0.02;

// Looking slows down with the zoom, so a scope stays steady.
function look(dx, dy) {
    if (!me || !me.alive) return;
    lookYaw -= dx / zoomNow;
    lookPitch = clamp(lookPitch - dy / zoomNow, -PITCH_LIMIT, PITCH_LIMIT);
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

// Left button fires, right button holds the scope.
document.addEventListener('mousedown', (e) => {
    if (state !== 'play' || !isLocked()) return;
    if (e.button === 0 && me && !me.alive) nextSpectate();
    if (e.button === 0) mouseFire = true;
    else if (e.button === 2) mouseAim = true;
});
document.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseFire = false;
    else if (e.button === 2) mouseAim = false;
});
document.addEventListener('contextmenu', (e) => { if (state !== 'menu') e.preventDefault(); });
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

const stickLayout = () => (settings.touchLayout && settings.touchLayout.stick) || null;
const stickR = () => STICK_R * ((stickLayout() && stickLayout().s) || 1);

function placeStickHome() {
    const L = stickLayout();
    stick.style.left = L ? `${L.x * innerWidth}px` : `${Math.max(90, innerWidth * 0.14)}px`;
    stick.style.top = L ? `${L.y * innerHeight}px` : `${innerHeight - Math.max(90, innerHeight * 0.26)}px`;
}

// The floating stick lives on whichever half of the screen its home is on.
function inStickZone(x) {
    const L = stickLayout();
    return L && L.x > 0.5 ? x > innerWidth * 0.55 : x < innerWidth * 0.45;
}

touchLayer.addEventListener('pointerdown', (e) => {
    if (e.target !== touchLayer || editing) return;
    touchLayer.setPointerCapture(e.pointerId);
    if (inStickZone(e.clientX) && stickId === null) {
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
        const R = stickR();
        let dx = e.clientX - stickX, dy = e.clientY - stickY;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        knob.style.transform = `translate(${dx * STICK_R / R}px, ${dy * STICK_R / R}px)`;
        touch.mx = dx / R;
        touch.mz = -dy / R;
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
holdButton(tFire, (e) => {
    touch.fire = true;
    fireX = e.clientX;
    fireY = e.clientY;
    if (me && !me.alive) nextSpectate();
}, () => { touch.fire = false; });
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
tapButton($('tAim'), () => setTouchAim(!touch.aim));
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
    Object.assign(touch, { mx: 0, mz: 0, jump: false, crouch: false, fire: false, board: false, use: false, aim: false });
    mouseFire = mouseAim = false;
    knob.style.transform = '';
    stick.classList.remove('on');
    for (const b of touchLayer.querySelectorAll('.tbtn')) b.classList.remove('on');
    placeStickHome();
}

// ---------- touch layout editor ----------
// Drag any control to move it, pick one and set its size. Positions are saved as screen
// fractions of the control's centre, so a layout survives rotation and other phones.
const EDIT_NAMES = {
    stick: 'Move stick', tFire: 'Fire', tAim: 'Scope', tJump: 'Jump', tCrouch: 'Duck', tReload: 'Reload',
    tSwap: 'Swap', tUse: 'Use', tBuy: 'Buy', tPause: 'Pause', tBoard: 'Score',
};
let editing = false, editSel = null, editDrag = null;

function applyTouchLayout() {
    const L = settings.touchLayout || {};
    for (const id of Object.keys(EDIT_NAMES)) {
        const el = $(id), e = L[id];
        el.style.scale = e && e.s !== 1 ? e.s : '';
        if (id === 'stick') continue;       // its home goes through placeStickHome
        Object.assign(el.style, e
            ? { left: `${e.x * 100}%`, top: `${e.y * 100}%`, right: 'auto', bottom: 'auto', translate: '-50% -50%' }
            : { left: '', top: '', right: '', bottom: '', translate: '' });
    }
    touchLayer.style.setProperty('--ta', settings.touchAlpha);
    placeStickHome();
}

// The saved entry for a control, created from where it sits now.
function layoutEntry(id) {
    const L = settings.touchLayout || (settings.touchLayout = {});
    if (!L[id]) {
        const r = $(id).getBoundingClientRect();
        L[id] = { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight, s: 1 };
    }
    return L[id];
}

function selectEdit(id) {
    if (editSel) $(editSel).classList.remove('sel');
    editSel = id;
    if (id) $(id).classList.add('sel');
    $('eName').textContent = id ? EDIT_NAMES[id] : 'Drag a control';
    $('eSize').disabled = !id;
    $('eSize').value = id && settings.touchLayout && settings.touchLayout[id] ? settings.touchLayout[id].s : 1;
}

function openTouchEditor() {
    editing = true;
    resetTouch();
    show(null);
    touchLayer.classList.add('editing');
    $('editBar').hidden = false;
    $('eAlpha').value = settings.touchAlpha;
    updateLayers();
    selectEdit(null);
}

function closeTouchEditor() {
    selectEdit(null);
    editing = false;
    editDrag = null;
    touchLayer.classList.remove('editing');
    $('editBar').hidden = true;
    saveSettings();
    updateLayers();
    show('settings');
}

// Capture phase: while editing, presses move controls instead of reaching their game handlers.
touchLayer.addEventListener('pointerdown', (e) => {
    if (!editing) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.target.closest('.tbtn, #stick');
    selectEdit(el ? el.id : null);
    if (!el) return;
    const entry = layoutEntry(el.id);
    editDrag = { id: e.pointerId, entry, dx: e.clientX - entry.x * innerWidth, dy: e.clientY - entry.y * innerHeight };
    touchLayer.setPointerCapture(e.pointerId);
}, true);

touchLayer.addEventListener('pointermove', (e) => {
    if (!editing || !editDrag || e.pointerId !== editDrag.id) return;
    editDrag.entry.x = clamp((e.clientX - editDrag.dx) / innerWidth, 0.02, 0.98);
    editDrag.entry.y = clamp((e.clientY - editDrag.dy) / innerHeight, 0.02, 0.98);
    applyTouchLayout();
}, true);

const endEditDrag = (e) => { if (editDrag && e.pointerId === editDrag.id) editDrag = null; };
touchLayer.addEventListener('pointerup', endEditDrag, true);
touchLayer.addEventListener('pointercancel', endEditDrag, true);

$('eSize').addEventListener('input', () => {
    if (!editSel) return;
    layoutEntry(editSel).s = Number($('eSize').value);
    applyTouchLayout();
});
$('eAlpha').addEventListener('input', () => {
    settings.touchAlpha = Number($('eAlpha').value);
    applyTouchLayout();
});
$('eReset').addEventListener('click', () => {
    settings.touchLayout = null;
    settings.touchAlpha = 1;
    $('eAlpha').value = 1;
    applyTouchLayout();
    selectEdit(null);
});
$('eDone').addEventListener('click', closeTouchEditor);
$('sTouchEdit').addEventListener('click', openTouchEditor);

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
    return { k: settings.hostKills, tm: settings.hostTime, bots: settings.fillBots, d: settings.hostDiff, mode: settings.hostMode, rounds: settings.hostRounds, m: settings.hostMap, zone: settings.hostZone };
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
    const bombPick = settings.hostMode === 'bomb', tdmPick = settings.hostMode === 'tdm';
    $('lRoundsRow').hidden = !bombPick;
    $('lKillsRow').hidden = !tdmPick;
    $('lTimeRow').hidden = !tdmPick;
    $('lZoneRow').hidden = settings.hostMode !== 'br';
    $('lStart').hidden = !host;
    $('lTeam').hidden = (host ? settings.hostMode : s.mode) === 'br';
    const on = s.m && MAPS[s.m] ? `${MAPS[s.m].name} · ` : '';
    $('lInfo').textContent = host
        ? 'Share the room code. Friends use Join game.'
        : !s.k ? 'Connected. Waiting for the host...'
        : s.mode === 'bomb' ? `${on}Bomb mode, first to ${s.rounds} rounds · bots ${s.bots ? s.d : 'off'}. Waiting for the host to start...`
        : s.mode === 'br' ? `${on}Battle royale, last one standing · zone ${s.zone === false ? 'off' : 'on'} · bots ${s.bots ? s.d : 'off'}. Waiting for the host to start...`
        : `${on}First to ${s.k} kills or ${Math.round(s.tm / 60)} min · bots ${s.bots ? s.d : 'off'}. Waiting for the host to start...`;
    showMapCredits();
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
async function startHosting() {
    role = 'host';
    phase = 'lobby';
    myKey = 0;
    nextKey = 1;
    peers.clear();
    peers.set(0, { key: 0, name: playerName(), team: 't', link: null, q: null, pid: 0 });
    lobby = { r: [], s: lobbySettings(), code: '' };
    $('lStatus').textContent = 'Opening room...';
    $('lStatus').classList.remove('err');
    show('lobby');
    renderLobby();
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
// Battle royale: they watch until the next match.
function joinMatch(e) {
    const mates = world.players.filter((p) => p.team === e.team);
    const bot = !isBR(world) && mates.length >= 4 && mates.find((p) => p.bot);
    if (bot) dropPlayer(bot.id);
    const p = addPlayer(world, { name: e.name, team: e.team });
    e.pid = p.id;
    e.q = new InputQueue();
    e.link.send({ t: 'start', you: p.id, rules: world.rules, r: playRoster(), loot: lootWire() });
    pushRoster();
}

const lootWire = () => world.loot && world.loot.map((l) => [LOOT_KINDS.indexOf(l.kind), r2(l.x), r2(l.y), r2(l.z)]);

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
    useMap(settings.hostMap);
    const mode = settings.hostMode;
    world = createWorld(map, weapons, mode === 'bomb'
        ? { mode: 'bomb', rounds: settings.hostRounds, respawn: -1, infiniteAmmo: false, map: settings.hostMap }
        : mode === 'br' ? { mode: 'br', respawn: -1, infiniteAmmo: false, zone: settings.hostZone, map: settings.hostMap }
        : { respawn: 3, killLimit: settings.hostKills, timeLimit: settings.hostTime, infiniteAmmo: true, map: settings.hostMap });
    for (const e of peers.values()) {
        const p = addPlayer(world, { name: e.name, team: e.team });
        e.pid = p.id;
        e.q = new InputQueue();
        if (!e.link) me = p;
    }
    world.hist = [];
    if (settings.fillBots && isBR(world)) {
        while (world.players.length < BR.fill) addBot('ct', names);
    } else if (settings.fillBots) {
        for (const team of ['t', 'ct']) {
            while (world.players.filter((p) => p.team === team).length < 4) addBot(team, names);
        }
    }
    if (isBomb(world)) startRound(world, true);
    if (isBR(world)) startBR(world);
    buildLoot();
    drainEvents(false);
    phase = 'play';
    overAt = 0;
    const r = playRoster();
    for (const p of world.players) p.ping = 0;
    const loot = lootWire();
    for (const e of peers.values()) if (e.link) e.link.send({ t: 'start', you: e.pid, rules: world.rules, r, loot });
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
    const zn = world.zone;
    if (zn) {
        base.zn = [r2(zn.x), r2(zn.z), r2(zn.r), r2(zn.tx), r2(zn.tz), r2(zn.tr), r2(Math.max(0, zn.until - world.time)), zn.stage, zn.shrinking ? 1 : 0, zn.dps, zn.off ? 1 : 0];
        base.lt = world.loot.map((l) => (l.taken ? 1 : 0)).join('');
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
        aim: false, place: 0, inv: ['rifle', 'pistol', 'shotgun', 'sniper'].map((w) => ({ id: w, mag: 0, reserve: 0 })),
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
    useMap(m.rules.map);
    world = createWorld(map, weapons, m.rules);
    if (m.loot) world.loot = m.loot.map((a, id) => ({ id, kind: LOOT_KINDS[a[0]], x: a[1], y: a[2], z: a[3], taken: false }));
    buildLoot();
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
    interp.mark(now, s.k);
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
    if (s.zn) {
        const z = s.zn;
        world.zone = { x: z[0], z: z[1], r: z[2], tx: z[3], tz: z[4], tr: z[5], until: world.time + z[6], stage: z[7], shrinking: !!z[8], dps: z[9], off: !!z[10] };
    }
    if (s.lt && world.loot) for (const l of world.loot) l.taken = s.lt[l.id] === '1';
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
        stepPlayer(me, effectiveInput(world, me, c), solidsOf(map));
    }
}

function clientTick() {
    const cmd = quantiseInput({ ...input, view: interp.tickAt(performance.now()) }, ++seq);
    pending.push(cmd);
    if (me.alive) {
        me.yaw = cmd.yaw;
        me.pitch = cmd.pitch;
        const eff = effectiveInput(world, me, cmd);
        me.aim = !!eff.aim;
        stepPlayer(me, eff, solidsOf(map));
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

const buyKey = (n) => { const item = ['rifle', 'shotgun', 'sniper'][n - 1]; if (item) doBuy(item); };

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
};

function show(name) {
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
}

function updateLayers() {
    const playing = state === 'play';
    document.body.classList.toggle('playing', state !== 'menu' || editing);
    document.body.classList.toggle('touch', touchMode);
    $('hud').hidden = state === 'menu';
    touchLayer.hidden = !(playing && touchMode) && !editing;
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
    mouseFire = mouseAim = false;
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
$('hostBtn').addEventListener('click', startHosting);
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
bindRadios('lmap', 'hostMap', false);
bindRadios('lrounds', 'hostRounds', true);
bindRadios('lkills', 'hostKills', true);
bindRadios('ltime', 'hostTime', true);
bindRadios('ldiff', 'hostDiff', false);
bindCheck('lBots', 'fillBots', pushLobby);
bindCheck('lZone', 'hostZone', pushLobby);

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
    set look([yaw, pitch]) { lookYaw = yaw; lookPitch = pitch; },
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
bindRange('sVolume', 'volume', () => sfx.setVolume(settings.volume));
bindRange('fEnemies', 'enemies', null, 0);
bindRange('fAllies', 'allies', null, 0);
bindRange('fBrBots', 'brBots', null, 0);
bindCheck('fZone', 'brZone');
function showFreeRows() {
    const br = settings.freeMode === 'br';
    $('fBrRow').hidden = !br;
    $('fZoneRow').hidden = !br;
    $('fEnemiesRow').hidden = $('fAlliesRow').hidden = br;
}
for (const r of document.querySelectorAll('input[name="fmode"]')) {
    r.checked = r.value === settings.freeMode;
    r.addEventListener('change', () => { settings.freeMode = r.value; saveSettings(); showFreeRows(); });
}
showFreeRows();
for (const r of document.querySelectorAll('input[name="diff"]')) {
    r.checked = r.value === settings.diff;
    r.addEventListener('change', () => { settings.diff = r.value; saveSettings(); });
}
for (const r of document.querySelectorAll('input[name="fmap"]')) {
    r.checked = r.value === settings.map;
    r.addEventListener('change', () => { settings.map = r.value; saveSettings(); useMap(r.value); showMapCredits(); });
}
for (const r of document.querySelectorAll('input[name="lmap"]')) r.addEventListener('change', showMapCredits);
showMapCredits();
applyTouchSize();
applyTouchLayout();
$('stats').hidden = !settings.fps;
placeStickHome();
addEventListener('resize', () => { if (stickId === null) placeStickHome(); });

// Phones in portrait: the CSS overlay covers the screen and the sim stops.
const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');

// ---------- HUD ----------
const hud = {
    hp: $('hp'), ammo: $('ammo'), dead: $('dead'), board: $('board'), mode: $('modeTag'),
    cross: $('crosshair'), vignette: $('vignette'),
    money: $('money'), bomb: $('bombTag'), act: $('actbar'), scope: $('scope'), area: $('areaTag'),
};
const mmss = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
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
    const bomb = isBomb(world), br = isBR(world);
    const limit = world.rules.timeLimit, left = limit ? Math.max(0, limit - world.time) : 0;
    const clock = limit ? ` · ${mmss(left)}` : '';
    const champ = br && world.over && byId(world.over.winner);
    const result = !world.over ? ''
        : br ? (champ ? (champ === me ? 'You win' : `${escapeHtml(champ.name)} wins`) : 'Nobody survived')
        : world.over.winner ? `${world.over.winner === 't' ? 'Red' : 'Blue'} wins` : 'Draw';
    if (br) {
        const alive = world.players.filter((p) => p.alive).length;
        setText('mode', hud.mode, `${result ? result + ' · ' : ''}Alive ${alive} · Kills ${me.kills}`);
        updateZoneHud();
        hud.money.hidden = hud.act.hidden = true;
    } else if (bomb && world.round) {
        const rd = world.round, rleft = Math.max(0, rd.until - world.time);
        const ph = rd.phase === 'buy' ? `BUY ${Math.ceil(rleft)}` : rd.phase === 'live' ? mmss(rleft) : 'END';
        setText('mode', hud.mode, `${result ? result + ' · ' : ''}Red ${world.score.t} : ${world.score.ct} Blue · R${rd.n} · ${ph}`);
        updateBombHud(rd);
    } else {
        setText('mode', hud.mode, `${result ? result + ' · ' : ''}T ${world.score.t} : ${world.score.ct} CT${clock}`);
        hud.bomb.hidden = hud.money.hidden = hud.act.hidden = true;
    }
    touchLayer.classList.toggle('bomb', bomb);
    touchLayer.classList.toggle('noscope', !W.scope);
    if (!W.scope && touch.aim) setTouchAim(false);
    if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').hidden = true;
    if (buyOpen) { if (canBuy()) updateBuy(); else closeBuy(); }
    $('lockHint').hidden = touchMode || isLocked() || state !== 'play';

    const watched = me.alive ? me : deathCam && deathCam.mode === 'spec' ? byId(deathCam.spec) : null;
    const place = watched ? areaAt(watched.x, watched.y, watched.z) : '';
    hud.area.hidden = !place;
    if (place) setText('area', hud.area, escapeHtml(place));

    hud.dead.hidden = me.alive;
    if (!me.alive) {
        const wait = br ? `Placed #${me.place || '?'} of ${world.players.length}`
            : bomb ? 'Next round soon' : `Back in ${Math.max(0, Math.ceil(me.respawnAt - world.time))}`;
        const dc = deathCam, spec = dc && dc.mode === 'spec' && byId(dc.spec);
        let text;
        if (spec) {
            text = `Spectating ${escapeHtml(spec.name)}<br><small>${wait} · ${touchMode ? 'tap Fire' : 'click'} to switch</small>`;
        } else {
            const who = killer && killer !== me ? `${escapeHtml(killer.name)} got you` : 'You died';
            const how = [];
            if (dc && dc.w && weapons[dc.w]) how.push(weapons[dc.w].name + (dc.hs ? ' · headshot' : ''));
            else if (dc && dc.w === 'fall') how.push('Fell');
            else if (dc && dc.w === 'zone') how.push('Caught by the zone');
            if (killer && killer !== me && killer.alive) {
                how.push(`${Math.max(0, killer.hp)} HP left`);
                how.push(`${Math.round(Math.hypot(killer.x - dc.x, killer.z - dc.z))} m`);
            }
            text = `${who}<br><small>${how.length ? how.join(' · ') + '<br>' : ''}${wait}</small>`;
        }
        setText('dead', hud.dead, text);
    }

    // Crosshair gap follows the real spread cone.
    const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const gap = clamp(3 + Math.tan(spreadOf(me, W)) * focal, 3, 90);
    hud.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    hud.cross.style.display = me.alive && aimK < 0.5 ? '' : 'none';

    const boardOpen = keys.has('Tab') || touch.board || !!world.over;
    hud.board.hidden = !boardOpen;
    if (boardOpen && performance.now() > boardAt) {
        boardAt = performance.now() + 250;
        renderBoard();
    }
}

// Battle royale: where the zone is going and how long until it moves.
function updateZoneHud() {
    const zn = world.zone;
    hud.bomb.hidden = !zn || !!zn.off;
    if (hud.bomb.hidden) return;
    const out = me.alive && outsideZone(zn, me);
    const left = Math.max(0, zn.until - world.time);
    const text = out ? `Outside the zone · -${zn.dps} HP/s`
        : zn.stage >= ZONE.length ? 'Final zone'
        : zn.shrinking ? `Zone closing · ${mmss(left)}` : `Zone shrinks in ${mmss(left)}`;
    hud.bomb.classList.toggle('hot', out);
    setText('bombTag', hud.bomb, text);
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
    hud.board.classList.toggle('one', isBR(world));
    if (isBR(world)) {
        const alive = world.players.filter((p) => p.alive).length;
        const rows = world.players.slice()
            .sort((a, b) => (b.alive - a.alive) || (a.place || 99) - (b.place || 99) || b.kills - a.kills)
            .map((p) => `<tr class="${p === me ? 'me' : ''}"><td class="${p.alive ? '' : 'out'}">${escapeHtml(p.name)}${p.bot ? ' <small>BOT</small>' : ''}</td><td>${p.kills}</td><td>${p.alive ? '-' : '#' + (p.place || '?')}</td></tr>`)
            .join('');
        setText('board', hud.board, `<table><tr><th>Battle royale · ${alive} left</th><th>K</th><th>#</th></tr>${rows}</table>`);
        return;
    }
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
let fpsFrames = 0, fpsTime = 0, vmHidden = false;

function setZoom(z) {
    zoomNow = z;
    const fov = 75 / z;
    if (Math.abs(camera.fov - fov) < 1e-3) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
}
const statsEl = $('stats');

// Online, the match keeps running while the menu is open (you are just standing still).
function advance(dt) {
    const running = (state === 'play' || (state === 'pause' && role !== 'solo')) && world && !portrait.matches;
    if (!running) { acc = 0; return; }
    acc += dt;
    for (let n = 0; acc >= TICK && n < 80 && world; n++) {
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

// Steps and ramps (ramps are fine stairs in the collision boxes) move a grounded player up or down
// in one tick. Like CS, the view and body absorb that jump and ease to the real height, so walking
// a slope looks smooth. Display only: the sim keeps the exact height.
const steps = new Map();     // player id -> { frame, y (raw), out (shown), off, ground }
function stepSmooth(p, y, dt) {
    let s = steps.get(p.id);
    if (s && s.frame === frameNo) return s.out;
    if (!s || !p.alive) {
        s = { frame: frameNo, y, out: y, off: 0, ground: p.onGround };
        steps.set(p.id, s);
        return y;
    }
    const dy = y - s.y;
    if (p.onGround && s.ground && Math.abs(dy) > 1e-4 && Math.abs(dy) < 0.6) s.off -= dy;
    s.off = Math.max(-0.6, Math.min(0.6, s.off)) * Math.exp(-dt * 12);
    if (Math.abs(s.off) < 1e-3) s.off = 0;
    Object.assign(s, { frame: frameNo, y, out: y + s.off, ground: p.onGround });
    return s.out;
}

// ---------- death camera ----------
// Fall: rise out of the head and pull back to watch your body drop. Kill cam: look at whoever got
// you from where you died, zoomed in. Spectate: once that is over and you are still dead (bomb
// rounds, battle royale), a chase camera behind a living teammate; click / tap Fire to switch.
const DEATH = { fall: 0.7, killcam: 3.6, back: 3.2, up: 1.0 };

function startDeathCam(e) {
    const from = camera.position.clone(), dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    deathCam = {
        t: 0, mode: 'fall', x: me.x, y: me.y, z: me.z, yaw: lookYaw,
        killer: e && e.by !== me.id ? e.by : 0, w: e ? e.w : '', hs: e ? e.hs : 0,
        spec: 0, cam: from, look: from.clone().add(dir.multiplyScalar(4)), zoom: 1,
    };
}

function nextSpectate() {
    const dc = deathCam;
    if (!dc) return;
    if (dc.mode !== 'spec') { dc.t = DEATH.killcam; return; }    // first press skips the kill cam
    const list = spectateTargets();
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === dc.spec);
    dc.spec = list[(i + 1) % list.length].id;
}

// Teammates first, as in CS; in battle royale (or with no teammate left) anyone alive.
function spectateTargets() {
    const alive = world.players.filter((p) => p.alive && p !== me);
    const mates = alive.filter((p) => !isBR(world) && p.team === me.team);
    return mates.length ? mates : alive;
}

// Camera point from `from` toward `to`, stopped short of walls.
function clipCam(from, to, skip) {
    const d = [to.x - from.x, to.y - from.y, to.z - from.z], len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-3) return to.clone();
    const hit = castRay(world, [from.x, from.y, from.z], d.map((v) => v / len), len, skip);
    const t = Math.max(0.2, Math.min(len, hit.t - 0.3));
    return new THREE.Vector3(from.x + d[0] / len * t, from.y + d[1] / len * t, from.z + d[2] / len * t);
}

const camTmp = new THREE.Vector3();
function deathCamera(dt, lerp) {
    const dc = deathCam;
    dc.t += dt;
    const k = byId(dc.killer);
    if (dc.mode !== 'spec') dc.mode = dc.t < DEATH.fall ? 'fall' : dc.t < DEATH.killcam && k && k.alive ? 'kill' : 'spec';
    const body = new THREE.Vector3(dc.x, dc.y, dc.z);
    let cam, look, zoom = 1, rate = 6;

    if (dc.mode === 'fall') {
        // Up and back over the body, looking down at it.
        const pivot = body.clone().add(new THREE.Vector3(0, 1.4, 0));
        const want = pivot.clone().add(new THREE.Vector3(Math.sin(dc.yaw) * 2.6, 0.9, Math.cos(dc.yaw) * 2.6));
        cam = clipCam(pivot, want, me);
        look = body.clone().add(new THREE.Vector3(0, 0.3, 0));
        rate = 5;
    } else if (dc.mode === 'kill') {
        // From just above where you died, framing the killer; zoom so they fill a good part of the screen.
        const [kx, ky, kz] = lerp(k);
        const head = new THREE.Vector3(kx, ky + playerHeight(k) - 0.35, kz);
        const pivot = body.clone().add(new THREE.Vector3(0, 1.7, 0));
        const toK = head.clone().sub(pivot), dist = toK.length();
        cam = clipCam(pivot, pivot.clone().add(toK.multiplyScalar(Math.min(0.25, Math.max(0, dist - 4) / dist))), me);
        if (!clearLine(world.boxes, [cam.x, cam.y, cam.z], [head.x, head.y, head.z])) {
            // They walked out of sight: move in close, on the side you were facing them from.
            const back = pivot.clone().sub(head).setY(0);
            if (back.lengthSq() < 1e-4) back.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
            back.normalize().multiplyScalar(4).add(new THREE.Vector3(0, 1, 0));
            cam = clipCam(head, head.clone().add(back), k);
        }
        look = head.clone().setY(ky + 0.7);     // aim below the head: the killer sits above the death panel
        const fovWant = THREE.MathUtils.radToDeg(2 * Math.atan(2.6 / Math.max(1, cam.distanceTo(head))));
        zoom = clamp(75 / fovWant, 1, 3.5);
        rate = 4;
    } else {
        const list = spectateTargets();
        let p = byId(dc.spec);
        if (!p || !p.alive || !list.includes(p)) {
            p = list.find((q) => q.id === dc.killer) || list[0] || null;
            dc.spec = p ? p.id : 0;
        }
        if (p) {
            // Chase camera behind the player, looking where they look.
            const [px, py, pz] = lerp(p);
            const pivot = new THREE.Vector3(px, py + playerHeight(p) - 0.2, pz);
            const yaw = p === me ? lookYaw : p.yaw;
            cam = clipCam(pivot, pivot.clone().add(new THREE.Vector3(Math.sin(yaw) * DEATH.back, DEATH.up, Math.cos(yaw) * DEATH.back)), p);
            look = pivot.clone().add(new THREE.Vector3(-Math.sin(yaw) * 6, -0.6, -Math.cos(yaw) * 6));
            rate = 10;
        } else {
            // Nobody left to watch: hang over your body.
            const pivot = body.clone().add(new THREE.Vector3(0, 1.4, 0));
            cam = clipCam(pivot, pivot.clone().add(new THREE.Vector3(Math.sin(dc.yaw) * 3, 2, Math.cos(dc.yaw) * 3)), me);
            look = body;
        }
    }
    const a = 1 - Math.exp(-dt * rate);
    dc.cam.lerp(cam, a);
    dc.look.lerp(look, a);
    dc.zoom += (zoom - dc.zoom) * (1 - Math.exp(-dt * 3));
    camera.position.copy(dc.cam);
    camera.lookAt(camTmp.copy(dc.look));
}

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
        return [q.x + (p.x - q.x) * a, stepSmooth(p, q.y + (p.y - q.y) * a, live ? dt : 0), q.z + (p.z - q.z) * a];
    };

    if (me) {
        const [x, y, z] = lerp(me);
        if (me.alive) {
            const target = me.crouch ? PLAYER.crouchEye : PLAYER.eye;
            eyeH += (target - eyeH) * Math.min(1, dt * 14);
            camera.position.set(x, y + eyeH, z);
            camera.rotation.set(lookPitch, lookYaw, 0);
        } else {
            if (!deathCam) startDeathCam(null);
            deathCamera(live ? dt : 0, lerp);
        }

        for (const p of world.players) {
            const m = modelFor(p);
            const [px, py, pz] = lerp(p);
            updatePlayerModel(m, p, px, py, pz, live ? dt : 0);
            if (p === me && me.alive) m.root.visible = false;   // your own body only shows on the death camera
            else if (p.alive && world.time < p.invulnUntil) m.root.visible = (frameNo >> 2) % 2 === 0;
        }

        const cur = me.inv[me.slot], W = weapons[cur.id];
        vm.show(cur.id);
        const reload = me.reloadUntil ? 1 - (me.reloadUntil - world.time) / W.reload : 0;
        const raise = Math.min(1, 1 - (me.switchUntil - world.time) / 0.35);

        // Scope: ease in, zoom the camera, then the overlay replaces the gun (red dot keeps it).
        const sc = W.scope;
        const want = sc && input.aim && canAim(world, me) ? 1 : 0;
        aimK = sc ? aimK + (want - aimK) * Math.min(1, dt * 14) : 0;
        if (aimK < 0.005) aimK = 0;
        setZoom(deathCam ? deathCam.zoom : sc ? 1 + (sc.zoom - 1) * aimK : 1);
        hud.scope.className = sc ? sc.type : '';
        hud.scope.style.opacity = sc && !deathCam ? clamp((aimK - 0.55) / 0.35, 0, 1) : 0;
        vmHidden = !!sc && sc.type !== 'reddot' && aimK > 0.75;

        vm.update(live ? dt : 0, Math.hypot(me.vx, me.vz), me.onGround, reload, raise, aimK);
        updateHud(dt);
        const look = new THREE.Vector3();
        camera.getWorldDirection(look);
        sfx.setListener(camera.position.x, camera.position.y, camera.position.z, Math.atan2(-look.x, -look.z), Math.asin(clamp(look.y, -1, 1)));
        stepSounds(live ? dt : 0);
        drawRadar(now);
    } else {
        setZoom(1);
        // Menu backdrop: slow orbit over the map.
        orbit += dt * 0.06;
        camera.position.set(Math.cos(orbit) * 48, 30, Math.sin(orbit) * 48);
        camera.lookAt(0, 0, 0);
    }

    updateZoneAndLoot(now);

    const bb = world && world.bomb;
    if (bb && (bb.state === 'dropped' || bb.state === 'planted')) {
        bombMesh.visible = true;
        bombMesh.position.set(bb.x, bb.y + 0.1, bb.z);
        const period = bb.state === 'planted' ? Math.max(0.15, (bb.fuseAt - world.time) / 40) : 1;
        const on = (now / 1000) % period < period * 0.5;
        if (on && !bombLight.visible && bb.state === 'planted' && live) sfx.beep(heard(bb.x, bb.y + 0.3, bb.z));
        bombLight.visible = on;
    } else {
        bombMesh.visible = false;
    }

    fx.update(state === 'pause' && role === 'solo' ? 0 : dt);

    renderer.clear();
    renderer.render(scene, camera);
    if (me && me.alive && !vmHidden) {
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
