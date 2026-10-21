// Test loop: a closed road on a grass field, with kerbs, a start gantry and trees.
// Textures are canvases drawn here at a few centimetres per texel, so with smooth filtering
// they read as surfaces rather than pixel art.
import * as THREE from './lib/three.module.min.js';

const ROAD_W = 14, KERB_W = 1.4, FIELD = 1400;

// Deterministic noise so the field looks the same on every load.
function rng(seed) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;   // filtering and anisotropy come from textures.js
}

// Base colour plus scattered single-texel flecks; `dots` gives a density per 1000 texels.
function speckle(ctx, w, h, base, dots, seed) {
    const r = rng(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (const [color, perK] of dots) {
        ctx.fillStyle = color;
        for (let i = 0, n = (w * h * perK) / 1000; i < n; i++) ctx.fillRect((r() * w) | 0, (r() * h) | 0, 1, 1);
    }
}

// 4 m tiles at 128 px: about 3 cm per texel
const grassTex = () => canvasTexture(128, 128, (c, w, h) => speckle(c, w, h, '#4f9a3a', [['#5fae44', 90], ['#3f8430', 70], ['#6cbd4e', 20]], 7));
// 256 px across the 14 m road: about 5.5 cm per texel
const roadTex = () => canvasTexture(256, 256, (c, w, h) => {
    speckle(c, w, h, '#55585e', [['#4a4d52', 100], ['#62656b', 90], ['#6d7076', 15]], 3);
    c.fillStyle = '#e8e4d8';
    c.fillRect(124, 0, 8, 128);        // centre dash (0.45 m wide) on the first half of each tile
    c.fillRect(0, 0, 4, h);            // edge lines
    c.fillRect(w - 4, 0, 4, h);
});
const kerbTex = () => canvasTexture(32, 64, (c) => {
    c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, 32, 32);
    c.fillStyle = '#d8402f'; c.fillRect(0, 32, 32, 32);
});
const checkerTex = () => canvasTexture(128, 32, (c) => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) {
        c.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        c.fillRect(x * 16, y * 16, 16, 16);
    }
});

// A flat strip following the curve, between two signed offsets from the centre line.
// UV: u goes across, v counts metres / vScale along the curve so the texture tiles evenly.
function ribbon(points, from, to, y, vScale) {
    const pos = [], uv = [], idx = [];
    let dist = 0;
    const n = points.length;
    for (let i = 0; i <= n; i++) {
        const p = points[i % n], q = points[(i + 1) % n], o = points[(i - 1 + n) % n];
        const tx = q.x - o.x, tz = q.z - o.z, l = Math.hypot(tx, tz);
        const nx = -tz / l, nz = tx / l;                     // sideways (right of travel)
        if (i > 0) dist += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
        pos.push(p.x + nx * from, y, p.z + nz * from, p.x + nx * to, y, p.z + nz * to);
        uv.push(0, dist / vScale, 1, dist / vScale);
        if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

// Builds the test loop. Returns the same map shape as maps.js: a group to add to the scene,
// a spawn point and the queries the game asks of any map.
export function buildTestTrack() {
    const group = new THREE.Group();
    group.name = 'map:loop';

    // ground
    const grass = grassTex();
    grass.repeat.set(FIELD / 4, FIELD / 4);   // 4 m per tile
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD), new THREE.MeshLambertMaterial({ map: grass }));
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);

    // track: a lumpy loop, about 1.4 km
    const curve = new THREE.CatmullRomCurve3([
        [0, 0], [110, -20], [190, 40], [200, 150], [120, 200], [60, 140], [-10, 170], [-120, 210],
        [-200, 130], [-170, 20], [-90, -30],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const pts = curve.getSpacedPoints(600).slice(0, -1);

    const road = new THREE.Mesh(ribbon(pts, -ROAD_W / 2, ROAD_W / 2, 0.02, ROAD_W), new THREE.MeshLambertMaterial({
        map: roadTex(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    group.add(road);
    const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex(), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // kerbs lie at the road's height and tuck under its edge a little: a step between the two,
    // however small, shows a hairline of grass at grazing angles
    const tuck = 0.15;
    group.add(new THREE.Mesh(ribbon(pts, ROAD_W / 2 - tuck, ROAD_W / 2 + KERB_W, 0.02, 2), kerbMat));
    group.add(new THREE.Mesh(ribbon(pts, -ROAD_W / 2 - KERB_W, -ROAD_W / 2 + tuck, 0.02, 2), kerbMat));

    // start line + gantry at t = 0
    const p0 = curve.getPointAt(0), t0 = curve.getTangentAt(0);
    const startYaw = Math.atan2(t0.x, t0.z);
    const start = new THREE.Group();
    start.position.copy(p0);
    start.rotation.y = startYaw;
    const checker = checkerTex();
    checker.repeat.set(ROAD_W / 1.75, 1);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 1.75), new THREE.MeshLambertMaterial({
        map: checker, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }));
    line.rotation.x = -Math.PI / 2;
    line.position.y = 0.04;
    start.add(line);
    const post = new THREE.MeshLambertMaterial({ color: '#2b2f36' }), banner = new THREE.MeshLambertMaterial({ color: '#ffdf00' });
    for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), post);
        p.position.set(s * (ROAD_W / 2 + 2), 3, 0);
        start.add(p);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 4.6, 1.4, 0.5), banner);
    top.position.y = 6.2;
    start.add(top);
    group.add(start);

    scatterTrees(group, pts);

    const nearest = (x, z) => {
        let bd = Infinity;
        for (const p of pts) bd = Math.min(bd, (p.x - x) ** 2 + (p.z - z) ** 2);
        return Math.sqrt(bd);
    };
    const edge = FIELD / 2 - 20;
    // the grid slot sits a few metres behind the line
    const grid = pts[pts.length - 5];
    return {
        group,
        start: { x: grid.x, z: grid.z, yaw: startYaw },
        sky: '#9fd3ff',
        fog: [120, 420],
        groundAt: (x, z) => (Math.abs(x) < edge && Math.abs(z) < edge ? 0 : null),
        offRoad: (x, z) => nearest(x, z) > ROAD_W / 2 + KERB_W + 0.2,
        walls: null,
        textureRoots: [group],
        // the centre line from the start line round, for lap counting (race.js)
        line: { points: pts.flatMap((p) => [p.x, 0, p.z]), closed: true },
    };
}

// Low-poly trees as two instanced meshes, kept off the tarmac.
function scatterTrees(group, pts) {
    const r = rng(42), spots = [];
    const clear = (x, z, d) => pts.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > d * d);
    for (let tries = 0; spots.length < 260 && tries < 4000; tries++) {
        const x = (r() - 0.5) * 640, z = (r() - 0.5) * 560 + 90;
        if (clear(x, z, 16)) spots.push([x, z, 0.7 + r() * 0.8]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 2.4, 5);
    const leafGeo = new THREE.ConeGeometry(2.6, 6, 6);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b4a2f', flatShading: true }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: '#2f7a3a', flatShading: true }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach(([x, z, k], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
        s.setScalar(k);
        trunks.setMatrixAt(i, m.compose(p.set(x, 1.2 * k, z), q, s));
        leaves.setMatrixAt(i, m.compose(p.set(x, 5.2 * k, z), q, s));
    });
    group.add(trunks, leaves);
}
