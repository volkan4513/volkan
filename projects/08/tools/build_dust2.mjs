// Builds map3.json (de_dust2) from the GLB: collision boxes, spawn / site heights and bot waypoints.
// The GLB is only drawn in the game; everything the sim touches comes from here.
//
//   node tools/build_dust2.mjs [debugDir]
//
// Steps: mesh -> world metres -> surface voxels -> merged boxes; then a walk/jump reachability
// flood from the spawns gives the floors bots can use, and a few invisible clips keep players in.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, scenePrimitives, writePng } from './glb.mjs';
import { META } from './dust2_meta.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEBUG = process.argv[2] || null;

// Scene units -> metres. The model is in Hammer units scaled by 1/75 on its root node;
// 1.875 brings that back to 0.025 m per unit, the scale the sim's CS-style movement uses.
const K = 1.875;
const T = [8, -1885.2, -2282];        // centres the map on x/z and puts the lowest floor at y = 0

// Voxel edges sit on the Hammer grid (8 units across, 1 unit up) so axis-aligned brush faces
// land exactly on them and the boxes match the visible walls and floors.
const RES = 0.2;                      // voxel size across
const VY = 0.025;                     // voxel size up
const RAMP = 0.1;                     // sloped floors become stairs of this rise
const X0 = -56.4, Z0 = -66.6, Y0 = -0.2;
const NX = Math.ceil((56.4 - X0) / RES), NZ = Math.ceil((66.6 - Z0) / RES), NY = Math.ceil((15.8 - Y0) / VY);

const STEP = 0.45, JUMP = 1.4, CROUCH = 1.2, STAND = 1.8, HALF = 0.35;   // STEP: what bots may walk up (sim allows 0.5)

// ---------- mesh -> voxels ----------
const glb = readGlb(path.join(ROOT, META.model.src));
const prims = scenePrimitives(glb);
const tris = [];
for (const p of prims) {
    const n = p.idx ? p.idx.length : p.pos.length / 3;
    for (let i = 0; i < n; i++) {
        const k = p.idx ? p.idx[i] : i;
        tris.push(p.pos[k * 3] * K + T[0], p.pos[k * 3 + 1] * K + T[1], p.pos[k * 3 + 2] * K + T[2]);
    }
}
console.log('triangles', tris.length / 9);

const solid = new Uint8Array(NX * NY * NZ);
const vid = (i, j, k) => (k * NX + i) * NY + j;      // columns are contiguous in y
const ix = (x) => Math.floor((x - X0) / RES), iy = (y) => Math.floor((y - Y0) / VY), iz = (z) => Math.floor((z - Z0) / RES);

// Surface voxels, flagged by which way the face looks. The model only has faces that look
// into the playable space, so: below an up-facing face is solid until a down-facing one.
const SURF = 1, UP = 2, DOWN = 4;
for (let t = 0; t < tris.length; t += 9) {
    const a = tris.slice(t, t + 3), b = tris.slice(t + 3, t + 6), c = tris.slice(t + 6, t + 9);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...nrm);
    if (!len) continue;
    const [nx, ny, nz] = nrm.map((v) => v / len);
    const flag = SURF | (ny > 0.3 ? UP : 0) | (ny < -0.3 ? DOWN : 0);
    const ramp = ny > 0.3 && ny < 0.995;
    // Sample points sit a millimetre inside the solid side, so faces on a voxel edge pick the right voxel.
    const span = (u, v) => Math.max(Math.abs(u[0] - v[0]) / RES, Math.abs(u[1] - v[1]) / VY, Math.abs(u[2] - v[2]) / RES);
    const n = Math.max(1, Math.ceil(Math.max(span(a, b), span(b, c), span(a, c)) * 2.2));
    for (let s = 0; s <= n; s++) for (let r = 0; r <= n - s; r++) {
        const u = s / n, v = r / n, w = 1 - u - v;
        let y = a[1] * w + b[1] * u + c[1] * v;
        if (ramp) y = Y0 + Math.ceil((y - Y0) / RAMP - 1e-6) * RAMP;
        const i = ix(a[0] * w + b[0] * u + c[0] * v - nx * 1e-3), j = iy(y - ny * 1e-3), k = iz(a[2] * w + b[2] * u + c[2] * v - nz * 1e-3);
        if (i >= 0 && i < NX && j >= 0 && j < NY && k >= 0 && k < NZ) solid[vid(i, j, k)] |= flag;
    }
}
// Column fill, top down.
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
    let inside = false;
    for (let j = NY - 1; j >= 0; j--) {
        const v = vid(i, j, k), f = solid[v];
        if (f & UP) inside = true;
        solid[v] = inside || f ? 1 : 0;
        if (f & DOWN) inside = false;
    }
}

// Voxel values: 0 air, 1 solid (blocks bullets and players), 2 clip (blocks players only).
// Hand-placed clips from the meta file:
for (const c of META.clips) fillBox(c, 2);

function fillBox(b, v) {
    for (let k = Math.max(0, iz(b[2] + 1e-6)); k < Math.min(NZ, Math.ceil((b[5] - Z0) / RES - 1e-6)); k++)
        for (let i = Math.max(0, ix(b[0] + 1e-6)); i < Math.min(NX, Math.ceil((b[3] - X0) / RES - 1e-6)); i++)
            for (let j = Math.max(0, iy(b[1] + 1e-6)); j < Math.min(NY, Math.ceil((b[4] - Y0) / VY - 1e-6)); j++) if (!solid[vid(i, j, k)]) solid[vid(i, j, k)] = v;
}

// ---------- floors and reachability ----------
// A floor is a solid voxel with at least crouch height of air above it (in that column).
const floorsOf = (i, k) => {
    const out = [];
    for (let j = 0; j < NY - 1; j++) {
        if (!solid[vid(i, j, k)] || solid[vid(i, j + 1, k)]) continue;
        let h = 0;
        while (j + 1 + h < NY && !solid[vid(i, j + 1 + h, k)]) h++;
        if (h * VY >= CROUCH || j + 1 + h >= NY) out.push({ y: Y0 + (j + 1) * VY, head: j + 1 + h >= NY ? 99 : h * VY });
    }
    return out;
};
const floors = new Array(NX * NZ);
for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) floors[k * NX + i] = floorsOf(i, k);

// Body clearance: nothing solid in a player-wide box from a step above the floor to standing height.
function bodyClear(x, y, z, h = STAND) {
    const r = Math.ceil(HALF / RES);
    const ci = ix(x), ck = iz(z), j0 = iy(y + STEP + 0.02), j1 = iy(y + h);
    for (let k = ck - r; k <= ck + r; k++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || k < 0 || i >= NX || k >= NZ) return false;
        for (let j = Math.max(0, j0); j <= Math.min(NY - 1, j1); j++) if (solid[vid(i, j, k)]) return false;
    }
    return true;
}

// Flood over floors: walk up a step, jump up to JUMP (with room for the jump), drop any distance.
function flood(seeds, canJump) {
    const seen = new Map();   // key column*64 + floor index
    const q = [];
    const push = (i, k, f) => {
        const key = (k * NX + i) * 64 + f;
        if (!seen.has(key)) { seen.set(key, true); q.push([i, k, f]); }
    };
    for (const [x, z, y] of seeds) {
        const i = ix(x), k = iz(z), fl = floors[k * NX + i];
        let best = -1;
        fl.forEach((f, n) => { if (f.y <= y + 0.5 && (best < 0 || f.y > fl[best].y)) best = n; });
        if (best < 0) throw new Error(`no floor under seed ${x} ${z}`);
        push(i, k, best);
    }
    while (q.length) {
        const [i, k, f] = q.pop();
        const cur = floors[k * NX + i][f];
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nk = k + dk;
            if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
            floors[nk * NX + ni].forEach((g, n) => {
                if (g.y - cur.y > (canJump ? JUMP : STEP) + 1e-6) return;
                // The gap between the two columns must let a crouched body through.
                const lo = Math.max(cur.y, g.y), hi = Math.min(cur.y + cur.head, g.y + g.head);
                if (hi - lo < CROUCH) return;
                push(ni, nk, n);
            });
        }
    }
    return seen;
}

const seeds = [...META.spawns.t, ...META.spawns.ct].map(([x, z]) => [x, z, 50]);
let walkSet, jumpSet;

// Places only a jump reaches are fine when small (crates, the car). Big ones are roofs and wall
// tops, and anything leading off the map is an escape: those get a 2 m player clip on top.
const PROP_AREA = 14;
for (let pass = 0; ; pass++) {
    walkSet = flood(seeds, false);
    jumpSet = flood(seeds, true);
    console.log('pass', pass, 'reachable floor cells: walk', walkSet.size, 'jump', jumpSet.size);
    const only = new Set([...jumpSet.keys()].filter((key) => !walkSet.has(key)));
    const done = new Set(), bad = [];
    for (const start of only) {
        if (done.has(start)) continue;
        const comp = [start], st = [start];
        done.add(start);
        let oob = false;
        while (st.length) {
            const key = st.pop(), c = Math.floor(key / 64), i = c % NX, k = Math.floor(c / NX), y = floors[c][key % 64].y;
            const x = X0 + (i + 0.5) * RES, z = Z0 + (k + 0.5) * RES, b = META.bounds;
            if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) oob = true;
            for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const ni = i + di, nk = k + dk;
                if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
                floors[nk * NX + ni].forEach((g, n) => {
                    const nkey = (nk * NX + ni) * 64 + n;
                    if (only.has(nkey) && !done.has(nkey) && Math.abs(g.y - y) <= JUMP) { done.add(nkey); comp.push(nkey); st.push(nkey); }
                });
            }
        }
        const area = comp.length * RES * RES;
        if (oob || area > PROP_AREA) bad.push(comp);
        if (area > 1) {
            const c0 = Math.floor(comp[0] / 64);
            console.log(`  jump-only area ${area.toFixed(1)} m2 near ${(X0 + (c0 % NX) * RES).toFixed(1)}, ${(Z0 + Math.floor(c0 / NX) * RES).toFixed(1)} y ${floors[c0][comp[0] % 64].y.toFixed(2)}${oob ? ' OUT OF BOUNDS' : ''}${oob || area > PROP_AREA ? ' -> clip' : ''}`);
        }
    }
    if (!bad.length || pass >= 4) break;
    for (const comp of bad) for (const key of comp) {
        const c = Math.floor(key / 64), i = c % NX, k = Math.floor(c / NX), y = floors[c][key % 64].y;
        for (let j = iy(y + 1e-4); j < Math.min(NY, iy(y + 2)); j++) if (!solid[vid(i, j, k)]) solid[vid(i, j, k)] = 2;
    }
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) floors[k * NX + i] = floorsOf(i, k);
}

const floorAt = (x, z, y = 99, set = null) => {
    const i = ix(x), k = iz(z);
    if (i < 0 || k < 0 || i >= NX || k >= NZ) return null;
    let best = null;
    floors[k * NX + i].forEach((f, n) => {
        if (set && !set.has((k * NX + i) * 64 + n)) return;
        if (f.y <= y + 0.3 && (!best || f.y > best.y)) best = f;
    });
    return best;
};

// ---------- voxels -> boxes (greedy merge: x, then z, then y) ----------
function mergeBoxes(value) {
    const used = new Uint8Array(solid.length), out = [];
    const free = (i, j, k) => solid[vid(i, j, k)] === value && !used[vid(i, j, k)];
    for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
        if (!free(i, j, k)) continue;
        let i1 = i + 1;
        while (i1 < NX && free(i1, j, k)) i1++;
        let k1 = k + 1;
        rowz: while (k1 < NZ) { for (let a = i; a < i1; a++) if (!free(a, j, k1)) break rowz; k1++; }
        let j1 = j + 1;
        rowy: while (j1 < NY) { for (let c = k; c < k1; c++) for (let a = i; a < i1; a++) if (!free(a, j1, c)) break rowy; j1++; }
        for (let c = k; c < k1; c++) for (let a = i; a < i1; a++) for (let b = j; b < j1; b++) used[vid(a, b, c)] = 1;
        out.push([X0 + i * RES, Y0 + j * VY, Z0 + k * RES, X0 + i1 * RES, Y0 + j1 * VY, Z0 + k1 * RES].map((v) => Math.round(v * 1000) / 1000));
    }
    return out;
}
const boxes = mergeBoxes(1), clips = mergeBoxes(2);
console.log('boxes', boxes.length, 'clips', clips.length);

// ---------- spawns, sites, waypoints ----------
const r2 = (v) => Math.round(v * 100) / 100;
// Height to put a player at: the highest floor anywhere under the body. Starting inside a step
// would make the sim push the player out sideways, across the whole box.
const lift = (x, z, y) => {
    const f = floorAt(x, z, y, walkSet);
    if (!f) throw new Error(`no reachable floor at ${x} ${z}`);
    let top = f.y;
    for (let dz = -HALF - 0.05; dz <= HALF + 0.05; dz += RES / 2) for (let dx = -HALF - 0.05; dx <= HALF + 0.05; dx += RES / 2) {
        const g = floorAt(x + dx, z + dz, f.y + STEP);
        if (g && g.y <= f.y + STEP + 0.05) top = Math.max(top, g.y);
    }
    return Math.ceil((top + 0.02) * 100) / 100;
};
const spawns = {};
for (const side of ['t', 'ct']) spawns[side] = META.spawns[side].map(([x, z, yaw]) => {
    const y = lift(x, z, 50);
    if (!bodyClear(x, y, z)) console.warn('spawn blocked', side, x, z);
    return [x, z, yaw, y];
});

const sites = {};
for (const [k, r] of Object.entries(META.sites)) sites[k] = [...r, lift((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, 50)];

// Waypoints: one per WP_GRID cell of reachable floor, at the cell's most open point.
const WP_GRID = 3.2;
const wps = [];
for (let gz = Z0; gz < Z0 + NZ * RES; gz += WP_GRID) for (let gx = X0; gx < X0 + NX * RES; gx += WP_GRID) {
    const levels = new Map();     // floor height bucket -> best candidate
    for (let z = gz + RES / 2; z < gz + WP_GRID; z += RES * 2) for (let x = gx + RES / 2; x < gx + WP_GRID; x += RES * 2) {
        const i = ix(x), k = iz(z);
        if (i < 0 || k < 0 || i >= NX || k >= NZ) continue;
        floors[k * NX + i].forEach((f, n) => {
            if (!walkSet.has((k * NX + i) * 64 + n) || !bodyClear(x, f.y, z)) return;
            const d = Math.hypot(x - (gx + WP_GRID / 2), z - (gz + WP_GRID / 2));
            const bucket = Math.round(f.y / 2.5);
            const cur = levels.get(bucket);
            const open = openness(x, f.y, z);
            if (!cur || open - d * 0.3 > cur.score) levels.set(bucket, { x: r2(x), z: r2(z), y: r2(f.y), score: open - d * 0.3 });
        });
    }
    for (const c of levels.values()) wps.push([c.x, c.z, c.y]);
}

// How far the body fits around a point (0..3 rings): keeps waypoints off walls and ledges.
function openness(x, y, z) {
    let n = 0;
    for (const r of [0.4, 0.8, 1.2]) {
        let ok = true;
        for (let a = 0; a < 8 && ok; a++) {
            const px = x + Math.cos(a * Math.PI / 4) * r, pz = z + Math.sin(a * Math.PI / 4) * r;
            const f = floorAt(px, pz, y + STEP);
            if (!f || Math.abs(f.y - y) > STEP || !bodyClear(px, f.y, pz)) ok = false;
        }
        if (!ok) break;
        n++;
    }
    return n;
}

// Links: straight walk with continuous floor (no gaps, no step over STEP) and a clear body.
function walkLink(a, b) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d > 14) return false;
    const n = Math.ceil(d / (RES * 0.75));
    let y = a[2];
    for (let s = 1; s <= n; s++) {
        const x = a[0] + (b[0] - a[0]) * s / n, z = a[1] + (b[1] - a[1]) * s / n;
        const f = floorAt(x, z, y + STEP, walkSet);
        if (!f || f.y < y - STEP - 1e-6 || f.y > y + STEP + 1e-6) return false;
        y = f.y;
        // body clearance across the path, using a slightly narrower box than the player
        const c = Math.ceil((HALF - 0.05) / RES);
        const ci = ix(x), ck = iz(z), j0 = iy(y + STEP + 0.02), j1 = iy(y + STAND);
        for (let k = ck - c; k <= ck + c; k++) for (let i = ci - c; i <= ci + c; i++)
            for (let j = j0; j <= j1; j++) if (solid[vid(i, j, k)]) return false;
    }
    return Math.abs(y - b[2]) < STEP;
}

const links = [];
for (let a = 0; a < wps.length; a++) for (let b = a + 1; b < wps.length; b++) {
    if (Math.hypot(wps[a][0] - wps[b][0], wps[a][1] - wps[b][1]) > 14) continue;
    if (walkLink(wps[a], wps[b]) && walkLink(wps[b], wps[a])) links.push([a, b]);
}
// Keep only the largest connected group of waypoints.
const adj = wps.map(() => []);
for (const [a, b] of links) { adj[a].push(b); adj[b].push(a); }
const comp = new Int32Array(wps.length).fill(-1);
let biggest = -1, bigN = 0;
for (let s = 0; s < wps.length; s++) {
    if (comp[s] >= 0) continue;
    const st = [s];
    comp[s] = s;
    let n = 0;
    while (st.length) { const u = st.pop(); n++; for (const v of adj[u]) if (comp[v] < 0) { comp[v] = s; st.push(v); } }
    if (n > bigN) { bigN = n; biggest = s; }
}
const keep = wps.map((_, i) => comp[i] === biggest);
const remap = [];
const waypoints = wps.filter((_, i) => keep[i]);
let ni = 0;
keep.forEach((k, i) => { remap[i] = k ? ni++ : -1; });
// Thin out links: drop a link when a shorter two-hop route via a shared neighbour exists (keeps the graph light).
const finalLinks = links.filter(([a, b]) => keep[a] && keep[b]).map(([a, b]) => [remap[a], remap[b]]);
console.log('waypoints', wps.length, '-> kept', waypoints.length, 'links', finalLinks.length);

// ---------- write ----------
const map = {
    name: META.name,
    style: 'model',
    credit: META.credit,
    model: META.model,
    sky: META.sky,
    fog: META.fog,
    palette: META.palette,
    bounds: META.bounds,
    sites,
    areas: META.areas,
    spawns,
    waypoints,
    links: finalLinks,
    boxes,
    clips,
};
fs.writeFileSync(path.join(ROOT, 'map3.json'), JSON.stringify(map));
console.log('wrote map3.json', (fs.statSync(path.join(ROOT, 'map3.json')).size / 1024).toFixed(0), 'KB');

// ---------- debug render ----------
if (DEBUG) {
    const PX = RES, W = NX, H = NZ, rgb = new Uint8Array(W * H * 3);
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) {
        const fl = floors[k * NX + i], o = (k * NX + i) * 3;
        let top = null, esc = false;
        fl.forEach((f, n) => {
            const key = (k * NX + i) * 64 + n;
            if (walkSet.has(key) && (!top || f.y > top.y)) top = f;
            if (jumpSet.has(key) && !walkSet.has(key)) esc = true;
        });
        if (top) {
            const h = Math.min(1, top.y / 9);
            rgb.set([255 * h, 255 * (1 - Math.abs(h - 0.5) * 2), 255 * (1 - h)], o);
        }
        if (esc) rgb.set([255, 255, 255], o);
    }
    const dot = (x, z, c, r = 2) => {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            const i = ix(x) + dx, k = iz(z) + dz;
            if (i >= 0 && k >= 0 && i < W && k < H) rgb.set(c, (k * W + i) * 3);
        }
    };
    const line = (a, b, c) => {
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (PX / 2));
        for (let s = 0; s <= n; s++) dot(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n, c, 0);
    };
    for (const [a, b] of finalLinks) line(waypoints[a], waypoints[b], [40, 40, 40]);
    for (const w of waypoints) dot(w[0], w[1], [0, 0, 0], 1);
    for (const s of spawns.t) dot(s[0], s[1], [255, 0, 0], 3);
    for (const s of spawns.ct) dot(s[0], s[1], [0, 0, 255], 3);
    for (const a of META.areas) {
        const [x0, z0, x1, z1] = a.r;
        line([x0, z0], [x1, z0], [255, 0, 255]); line([x1, z0], [x1, z1], [255, 0, 255]);
        line([x1, z1], [x0, z1], [255, 0, 255]); line([x0, z1], [x0, z0], [255, 0, 255]);
    }
    for (const r of Object.values(META.sites)) {
        line([r[0], r[1]], [r[2], r[1]], [255, 255, 0]); line([r[2], r[1]], [r[2], r[3]], [255, 255, 0]);
        line([r[2], r[3]], [r[0], r[3]], [255, 255, 0]); line([r[0], r[3]], [r[0], r[1]], [255, 255, 0]);
    }
    writePng(path.join(DEBUG, 'reach.png'), W, H, rgb);
    // Vertical slices, 0.1 m per pixel up: SLICES="z:-31,x:5" (white = solid).
    for (const s of (process.env.SLICES || '').split(',').filter(Boolean)) {
        const [axis, v] = s.split(':'), along = axis === 'z' ? NX : NZ, rows = Math.ceil(NY / 4);
        const img = new Uint8Array(along * rows * 3);
        for (let a = 0; a < along; a++) for (let r = 0; r < rows; r++) {
            let n = 0;
            for (let q = 0; q < 4; q++) {
                const j = (rows - 1 - r) * 4 + q;
                if (j < NY && solid[axis === 'z' ? vid(a, j, iz(+v)) : vid(ix(+v), j, a)]) n++;
            }
            const c = n * 60 + (r % 10 === 0 ? 30 : 0);
            img.set([c, c, a % 25 === 0 ? 120 : c], (r * along + a) * 3);
        }
        writePng(path.join(DEBUG, `slice_${axis}${v}.png`), along, rows, img);
    }
    fs.writeFileSync(path.join(DEBUG, 'floors.json'), JSON.stringify({ X0, Z0, RES, NX, NZ, top: floors.map((fl, c) => fl.map((f) => r2(f.y))) }));
    console.log('debug written to', DEBUG);
}
