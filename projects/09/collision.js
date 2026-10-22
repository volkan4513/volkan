// Collision for imported maps, built from the render meshes themselves (no separate collision
// mesh needed). Triangles go into a uniform XZ grid as one of two kinds:
//   ground  anything gentler than about 45°, at any height: "what's under this point, near this height?"
//   walls   near-vertical triangles (trees, poles, fences, building fronts), flattened to 2D segments
//           with their height range, so they only block a car whose body overlaps them
// Slopes between the two (embankments, canyon sides) are neither: a car can't stand on them, so the
// game treats them like the edge of the map and stops the car there.
//
// Cut-out textures (trees, fences, signs drawn on flat cards) only block where they're solid: a
// steep triangle of an alpha-tested material is sampled across its surface, and its wall is cut down
// to the stretch (and heights) where the texture is opaque. A card that's see-through all over is no
// wall at all. Without this a tree's card reaches metres into the road as an invisible wall.
import * as THREE from './lib/three.module.min.js';

const CELL = 16;
const GROUND_NY = 0.7;   // |normal.y| above this is ground (about 45°)
const WALL_NY = 0.3;     // below this is a wall (steeper than about 73°)
const ALPHA_GRID = 10;   // samples per triangle edge when looking for the solid part of a cut-out

// Texture alpha as a lookup (u, v) -> 0..255, read once per texture. Null if it can't be read.
const alphaCache = new WeakMap();
function alphaReader(tex) {
    if (!tex || !tex.image) return null;
    if (alphaCache.has(tex)) return alphaCache.get(tex);
    let read = null;
    try {
        const img = tex.image, w = Math.min(512, img.width), h = Math.min(512, img.height);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        const data = g.getImageData(0, 0, w, h).data;
        // glTF textures aren't flipped: v = 0 is the top row
        read = (u, v) => {
            u -= Math.floor(u);
            v -= Math.floor(v);
            if (tex.flipY) v = 1 - v;
            return data[(Math.min(h - 1, (v * h) | 0) * w + Math.min(w - 1, (u * w) | 0)) * 4 + 3];
        };
    } catch { /* tainted or not decodable: treat as solid */ }
    alphaCache.set(tex, read);
    return read;
}

export function buildCollision(root) {
    const ground = [], walls = [];          // flat arrays: ground 9 floats per tri, walls 6 per segment
    const groundCells = new Map(), wallCells = new Map();
    const key = (ix, iz) => ix * 100003 + iz;
    const insert = (cells, id, x0, z0, x1, z1) => {
        for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
            for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
                const k = key(ix, iz);
                if (!cells.has(k)) cells.set(k, []);
                cells.get(k).push(id);
            }
        }
    };

    root.updateMatrixWorld(true);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3();
    let trimmed = 0, dropped = 0;
    root.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const pos = o.geometry.attributes.position, idx = o.geometry.index, uv = o.geometry.attributes.uv;
        const alpha = o.material && o.material.alphaTest > 0 && uv ? alphaReader(o.material.map) : null;
        const count = idx ? idx.count : pos.count;
        for (let t = 0; t < count; t += 3) {
            const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
            a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
            b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
            c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
            n.subVectors(b, a).cross(e.subVectors(c, a));
            const len = n.length();
            if (len < 1e-8) continue;
            const ny = Math.abs(n.y) / len;
            if (ny > GROUND_NY) {
                const id = ground.length / 9;
                ground.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
                insert(groundCells, id, Math.min(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.x, b.x, c.x), Math.max(a.z, b.z, c.z));
            } else if (ny < WALL_NY) {
                // a steep triangle seen from above is (nearly) a line: keep its two furthest-apart corners
                const p = [a, b, c];
                let best = 0, bi = 0, bj = 1;
                for (const [i, j] of [[0, 1], [1, 2], [0, 2]]) {
                    const d = (p[i].x - p[j].x) ** 2 + (p[i].z - p[j].z) ** 2;
                    if (d > best) { best = d; bi = i; bj = j; }
                }
                if (best < 0.04) continue;          // under 20 cm: a sliver, not a wall
                let ax = p[bi].x, az = p[bi].z, bx = p[bj].x, bz = p[bj].z, y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
                if (alpha) {
                    // keep the part of the segment, and the heights, where the texture is solid
                    const dx = bx - ax, dz = bz - az, dd = dx * dx + dz * dz;
                    let t0 = Infinity, t1 = -Infinity, ylo = Infinity, yhi = -Infinity;
                    const ui = [uv.getX(i0), uv.getX(i1), uv.getX(i2)], vi = [uv.getY(i0), uv.getY(i1), uv.getY(i2)];
                    for (let i = 0; i <= ALPHA_GRID; i++) {
                        for (let j = 0; i + j <= ALPHA_GRID; j++) {
                            const w0 = i / ALPHA_GRID, w1 = j / ALPHA_GRID, w2 = 1 - w0 - w1;
                            if (alpha(ui[0] * w0 + ui[1] * w1 + ui[2] * w2, vi[0] * w0 + vi[1] * w1 + vi[2] * w2) < 128) continue;
                            const x = a.x * w0 + b.x * w1 + c.x * w2, y = a.y * w0 + b.y * w1 + c.y * w2, z = a.z * w0 + b.z * w1 + c.z * w2;
                            const t = ((x - ax) * dx + (z - az) * dz) / dd;
                            t0 = Math.min(t0, t); t1 = Math.max(t1, t); ylo = Math.min(ylo, y); yhi = Math.max(yhi, y);
                        }
                    }
                    if (t0 > t1) { dropped++; continue; }
                    if (t0 > 0.02 || t1 < 0.98) trimmed++;
                    [ax, az, bx, bz] = [ax + dx * t0, az + dz * t0, ax + dx * t1, az + dz * t1];
                    [y0, y1] = [ylo, yhi];
                    if ((bx - ax) ** 2 + (bz - az) ** 2 < 0.04 && yhi - ylo < 0.2) continue;
                }
                const id = walls.length / 6;
                walls.push(ax, az, bx, bz, y0, y1);
                insert(wallCells, id, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
            }
        }
    });

    // Height of the highest ground under (x, z) that is no more than `up` metres above yRef
    // (so a bridge overhead doesn't count), or null if there is none.
    function groundRaw(x, z, yRef, up) {
        const list = groundCells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!list) return null;
        let top = null;
        const limit = yRef + up;
        for (const id of list) {
            const g = id * 9;
            const x0 = ground[g], z0 = ground[g + 2], x1 = ground[g + 3], z1 = ground[g + 5], x2 = ground[g + 6], z2 = ground[g + 8];
            const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
            if (Math.abs(d) < 1e-9) continue;
            const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
            const v = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
            if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) continue;
            const y = u * ground[g + 1] + v * ground[g + 4] + (1 - u - v) * ground[g + 7];
            if (y <= limit && (top === null || y > top)) top = y;
        }
        return top;
    }

    // The imported maps have hairline cracks where road tiles meet (no triangle covers them), and a
    // car whose nose or tail circle lands exactly on one is treated as being off the edge of the map
    // and bounced back. A point with ground close by on both sides of it is on a crack, not an edge,
    // so it takes their height; at a real edge only one side has ground and it stays empty.
    const CRACK = 0.15;
    function groundAt(x, z, yRef = Infinity, up = 1) {
        const g = groundRaw(x, z, yRef, up);
        if (g !== null) return g;
        for (const [dx, dz] of [[CRACK, 0], [0, CRACK]]) {
            const a = groundRaw(x + dx, z + dz, yRef, up);
            if (a === null) continue;
            const b = groundRaw(x - dx, z - dz, yRef, up);
            if (b !== null && Math.abs(a - b) < 0.5) return Math.max(a, b);
        }
        return null;
    }

    // Push a circle out of every wall that overlaps the car's body height (y + 0.4 .. y + 1.6).
    // Returns the total push and its direction, or null when the circle is clear.
    const seen = new Uint32Array(walls.length / 6);
    let stamp = 0;
    function pushCircle(x, z, r, y = 0) {
        stamp++;
        let px = 0, pz = 0;
        const lo = y + 0.4, hi = y + 1.6;
        for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
            for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
                const list = wallCells.get(key(ix, iz));
                if (!list) continue;
                for (const id of list) {
                    if (seen[id] === stamp) continue;
                    seen[id] = stamp;
                    const w = id * 6;
                    if (walls[w + 5] < lo || walls[w + 4] > hi) continue;
                    const ax = walls[w], az = walls[w + 1], bx = walls[w + 2], bz = walls[w + 3];
                    const dx = bx - ax, dz = bz - az;
                    const cx = x + px, cz = z + pz;
                    const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / (dx * dx + dz * dz)));
                    const qx = cx - (ax + dx * t), qz = cz - (az + dz * t), d = Math.hypot(qx, qz);
                    if (d >= r || d < 1e-6) continue;
                    px += (qx / d) * (r - d);
                    pz += (qz / d) * (r - d);
                }
            }
        }
        if (!px && !pz) return null;
        const d = Math.hypot(px, pz);
        return { x: px, z: pz, nx: px / d, nz: pz / d };
    }

    // First thing a ray hits, as a fraction (0..1) of the way from (ox, oy, oz) to (tx, ty, tz), or
    // null. Hits ground triangles from either side (so a tunnel roof or a bridge deck blocks it) and
    // walls. Used to keep the camera out of the scenery.
    const gseen = new Uint32Array(ground.length / 9);
    let gstamp = 0;
    function castRay(ox, oy, oz, tx, ty, tz) {
        gstamp++;
        stamp++;
        const dx = tx - ox, dy = ty - oy, dz = tz - oz;
        const len2 = Math.hypot(dx, dz), steps = Math.max(1, Math.ceil(len2 / (CELL / 2)));
        let best = Infinity;
        let lastKey = -1;
        for (let k = 0; k <= steps; k++) {
            const f = k / steps, ix = Math.floor((ox + dx * f) / CELL), iz = Math.floor((oz + dz * f) / CELL), ck = key(ix, iz);
            if (ck === lastKey) continue;
            lastKey = ck;
            const gl = groundCells.get(ck);
            if (gl) for (const id of gl) {
                if (gseen[id] === gstamp) continue;
                gseen[id] = gstamp;
                const g = id * 9;
                const e1x = ground[g + 3] - ground[g], e1y = ground[g + 4] - ground[g + 1], e1z = ground[g + 5] - ground[g + 2];
                const e2x = ground[g + 6] - ground[g], e2y = ground[g + 7] - ground[g + 1], e2z = ground[g + 8] - ground[g + 2];
                const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;   // d x e2
                const det = e1x * px + e1y * py + e1z * pz;
                if (Math.abs(det) < 1e-9) continue;
                const sx = ox - ground[g], sy = oy - ground[g + 1], sz = oz - ground[g + 2];
                const u = (sx * px + sy * py + sz * pz) / det;
                if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;   // s x e1
                const v = (dx * qx + dy * qy + dz * qz) / det;
                if (v < 0 || u + v > 1) continue;
                const t = (e2x * qx + e2y * qy + e2z * qz) / det;
                if (t > 0.01 && t < best) best = t;
            }
            const wl = wallCells.get(ck);
            if (wl && len2 > 1e-6) for (const id of wl) {
                if (seen[id] === stamp) continue;
                seen[id] = stamp;
                const w = id * 6, ax = walls[w], az = walls[w + 1], ex = walls[w + 2] - ax, ez = walls[w + 3] - az;
                const den = dx * ez - dz * ex;
                if (Math.abs(den) < 1e-9) continue;
                const t = ((ax - ox) * ez - (az - oz) * ex) / den, s = ((ax - ox) * dz - (az - oz) * dx) / den;
                if (t <= 0.01 || t >= best || s < 0 || s > 1) continue;
                const y = oy + dy * t;
                if (y >= walls[w + 4] && y <= walls[w + 5]) best = t;
            }
        }
        return best <= 1 ? best : null;
    }

    return { groundAt, pushCircle, castRay, stats: { ground: ground.length / 9, walls: walls.length / 6, trimmed, dropped } };
}
