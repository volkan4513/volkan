// Car models: loading, normalising (size, facing +Z, sitting on y = 0) and rigging the wheels.
//
// Every car comes out with the same shape so the rest of the game never cares which GLB it was:
//   root ─┬─ body (leans with acceleration / cornering) ─ fit ─ gltf scene
//         └─ wheel.steer (turns about Y, front only) ─ wheel.spin (rolls about X) ─ wheel meshes
//
// Wheels are found three ways, depending on how the model was built:
//   'named'    the GLB has a node per wheel (GT2PSX cars, Subaru, the pixelated sport car)
//   'extracted' wheels are baked into one mesh; we cut them out by finding the separate
//              triangle islands that sit low at the four corners and look round from the side
//   'none'     neither worked: the car still drives, the wheels just don't turn
import * as THREE from './lib/three.module.min.js';
import { GLTFLoader } from './lib/GLTFLoader.js';

const GT2_WHEELS = { fl: 'WHEEL_FL', fr: 'WHEEL_FR', rl: 'WHEEL_BL', rr: 'WHEEL_BR' };

// length: metres bumper to bumper after scaling. forward: which raw axis is the nose, for models
// whose front wheels can't be told apart by name ('+x' | '-x' | '+z' | '-z').
export const CARS = [
    { id: 'r32', name: 'Nissan Skyline R32', file: 'nissan_skyline_r32_pixel_art.glb', length: 4.55, wheels: 'extract', forward: '+z' },
    { id: 'm5', name: 'BMW M5 E39', file: 'bmw_m5_e39_gt2psx_style.glb', length: 4.78, wheels: GT2_WHEELS },
    { id: 'diablo', name: 'Lamborghini Diablo', file: 'lamborghini_diablo_gt2psx_style.glb', length: 4.46, wheels: GT2_WHEELS },
    { id: '993', name: 'Porsche 911 (993)', file: 'porsche_911_carrera_993_gt2psx_style.glb', length: 4.25, wheels: GT2_WHEELS },
    { id: 'charger', name: "Dodge Charger '69", file: '1969_dodge_charger_rt_gt2psx_style.glb', length: 5.28, wheels: GT2_WHEELS },
    {
        id: 'sti', name: 'Subaru Impreza STI', file: 'subaru_impreza_sti.glb', length: 4.35,
        wheels: { fl: 'frontLeftWheel', fr: 'frontRightWheel', rear: 'rearWheels' },
        // discs roll with their wheel, calipers only steer with it
        spinWith: { frontLeftDisc: 'fl', frontRightDisc: 'fr', rearDiscs: 'rear' },
        steerWith: { frontLeftCaliper: 'fl', frontRIghtCaliper: 'fr' },
        hide: ['floor'],
    },
    {
        id: 'sport', name: 'Pixel Sport', file: 'low-poly_pixelated_sport_car.glb', length: 4.2,
        wheels: { list: ['Cylinder', 'Cylinder.001', 'Cylinder.002', 'Cylinder.003'] }, forward: '+z',
        hide: ['Plane.001'],   // a flat "speed lines" decal that floats around the car
    },
    { id: 'compact', name: 'Compact', file: 'low_poly_compact_car_with_pixel_art_texture.glb', length: 3.8, wheels: 'extract', forward: '+z' },
    { id: 'pixel', name: 'Pixel Car', file: 'low_poly_car_-_3d_pixel_art.glb', length: 4.3, wheels: 'extract', forward: '+z' },
];

// How each car drives, as overrides of drive.js's TUNING: the Diablo is quick and grippy, the Charger
// heavy and tail-happy, the STI sticks to the road, the compact is slow but nimble.
const HANDLING = {
    r32:     {},
    m5:      { accel: 7.6, maxSpeed: 44, brake: 17, maxLat: 13.5, grip: 9, maxSteer: 0.56 },
    diablo:  { accel: 9.6, maxSpeed: 48, brake: 20, maxLat: 15.6, grip: 10, maxSteer: 0.58 },
    '993':   { accel: 8.6, maxSpeed: 43, brake: 19, maxLat: 14.6, grip: 9.5, driftGrip: 1.3 },
    charger: { accel: 8.8, maxSpeed: 43, brake: 15, maxLat: 12.4, grip: 7.4, driftGrip: 1.4, maxSteer: 0.6 },
    sti:     { accel: 8.6, maxSpeed: 41, brake: 19, maxLat: 15.2, grip: 11.5 },
    sport:   { accel: 8.2, maxSpeed: 42, maxLat: 14.2 },
    compact: { accel: 6.8, maxSpeed: 38, brake: 17, maxLat: 13.6, grip: 9.5, maxSteer: 0.66 },
    pixel:   { accel: 7.4, maxSpeed: 40, maxLat: 14 },
};
// Engine voice per car for audio.js: pitch scale, how much of each oscillator, filter scale, loudness.
const SOUND = {
    r32:     { pitch: 1.0,  saw: 0.6,  sq: 0.25, tri: 0.3,  cut: 1.1,  gain: 1 },      // inline six: raspy
    m5:      { pitch: 0.78, saw: 0.5,  sq: 0.45, tri: 0.3,  cut: 0.85, gain: 1.05 },   // V8: low and burbly
    diablo:  { pitch: 1.3,  saw: 0.35, sq: 0.1,  tri: 0.55, cut: 1.3,  gain: 0.95 },   // V12: high and smooth
    '993':   { pitch: 1.0,  saw: 0.55, sq: 0.2,  tri: 0.4,  cut: 1.0,  gain: 1 },      // flat six
    charger: { pitch: 0.68, saw: 0.55, sq: 0.5,  tri: 0.2,  cut: 0.75, gain: 1.1 },    // big V8
    sti:     { pitch: 0.92, saw: 0.5,  sq: 0.4,  tri: 0.25, cut: 0.95, gain: 1 },      // boxer
    sport:   { pitch: 1.12, saw: 0.55, sq: 0.2,  tri: 0.35, cut: 1.05, gain: 0.95 },
    compact: { pitch: 1.25, saw: 0.5,  sq: 0.15, tri: 0.35, cut: 1.1,  gain: 0.9 },    // small four
    pixel:   { pitch: 1.15, saw: 0.5,  sq: 0.2,  tri: 0.35, cut: 1.05, gain: 0.95 },
};
for (const car of CARS) {
    car.handling = HANDLING[car.id] || {};
    car.sound = SOUND[car.id] || SOUND.r32;
}

const loader = new GLTFLoader();
const cache = new Map();   // file -> Promise<gltf>

function loadGltf(file) {
    if (!cache.has(file)) cache.set(file, loader.loadAsync(`models/${file}`));
    return cache.get(file);
}

const clean = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
const byName = (root, name) => root.getObjectByName(clean(name));

// Simple lit or unlit materials instead of PBR: these were made for PS1-style shading, not for an
// environment map. Texture filtering is set by textures.js from the player's settings.
function pixelMaterial(m) {
    if (m.isMeshBasicMaterial) return m;
    const out = new THREE.MeshLambertMaterial({
        name: m.name, map: m.map, color: m.color, side: m.side,
        transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest || (m.transparent ? 0.5 : 0),
        emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, vertexColors: m.vertexColors,
    });
    m.dispose();
    return out;
}

// One car instance, ready to drop into the scene. Each call clones the cached GLTF,
// so the same model can be used twice (ghosts, AI later) without sharing transforms.
export async function createCar(def) {
    const gltf = await loadGltf(def.file);
    const scene = gltf.scene.clone(true);
    const root = new THREE.Group(), body = new THREE.Group(), fit = new THREE.Group();
    root.name = `car:${def.id}`;
    root.add(body);
    body.add(fit);
    fit.add(scene);

    scene.traverse((o) => {
        if (o.isCamera || o.isLight) o.visible = false;
        if (o.isMesh) {
            o.material = Array.isArray(o.material) ? o.material.map(pixelMaterial) : pixelMaterial(o.material);
            o.castShadow = false;
        }
    });
    for (const n of def.hide || []) { const o = byName(scene, n); if (o) o.visible = false; }

    // ---- wheels by name ----
    let named = null;
    if (def.wheels && def.wheels !== 'extract') {
        const w = def.wheels;
        named = w.list
            ? w.list.map((n) => ({ obj: byName(scene, n), key: n, front: null }))
            : Object.entries(w).map(([key, n]) => ({ obj: byName(scene, n), key, front: key.startsWith('f') }));
        named = named.filter((e) => e.obj);
        if (!named.length) named = null;
    }

    // ---- facing: rotate so the nose points +Z ----
    root.updateMatrixWorld(true);
    const raw = visibleBox(scene, fit);
    const rawCenter = raw.getCenter(new THREE.Vector3()), rawSize = raw.getSize(new THREE.Vector3());
    let nose;
    const fronts = named && named.filter((e) => e.front);
    if (fronts && fronts.length) {
        const c = new THREE.Vector3();
        for (const e of fronts) c.add(boxOf(e.obj, fit).getCenter(new THREE.Vector3()));
        c.divideScalar(fronts.length).sub(rawCenter);
        nose = rawSize.x > rawSize.z ? (c.x > 0 ? '+x' : '-x') : (c.z > 0 ? '+z' : '-z');
    } else {
        nose = def.forward || (rawSize.x > rawSize.z ? '+x' : '+z');
    }
    fit.rotation.y = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[nose];
    if (def.flip) fit.rotation.y += Math.PI;

    // ---- size and ground: scale to the real length, centre on x/z, wheels on y = 0 ----
    root.updateMatrixWorld(true);
    let box = visibleBox(scene, root);
    const k = def.length / box.getSize(new THREE.Vector3()).z;
    fit.scale.setScalar(k);
    root.updateMatrixWorld(true);
    box = visibleBox(scene, root);
    const center = box.getCenter(new THREE.Vector3());
    fit.position.set(-center.x, -box.min.y, -center.z);
    root.updateMatrixWorld(true);
    box = visibleBox(scene, root);
    const size = box.getSize(new THREE.Vector3());

    // ---- rig ----
    let wheels = [], mode = 'none';
    if (named) {
        wheels = named.map((e) => rigWheel(root, [e.obj], e.key, e.front));
        mode = 'named';
        for (const [n, key] of Object.entries(def.spinWith || {})) {
            const o = byName(scene, n), w = wheels.find((x) => x.key === key);
            if (o && w) w.spin.attach(o);
        }
        for (const [n, key] of Object.entries(def.steerWith || {})) {
            const o = byName(scene, n), w = wheels.find((x) => x.key === key);
            if (o && w) w.steer.attach(o);
        }
    } else if (def.wheels === 'extract') {
        wheels = extractWheels(root, scene, size);
        if (wheels.length) mode = 'extracted';
    }
    // Unnamed wheels (or extracted ones): the half nearer the nose steers.
    for (const w of wheels) if (w.front === null) w.front = w.steer.position.z > 0;

    // Lean about a point near the centre of mass instead of the ground.
    const pivotY = size.y * 0.35;
    body.position.y = pivotY;
    fit.position.y -= pivotY;

    const fz = wheels.filter((w) => w.front).map((w) => w.steer.position.z);
    const rz = wheels.filter((w) => !w.front).map((w) => w.steer.position.z);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const wheelbase = fz.length && rz.length ? Math.abs(avg(fz) - avg(rz)) : size.z * 0.6;

    return { def, root, body, wheels, mode, size, wheelbase };
}

// Bounding box of the visible meshes, expressed in `space`'s local frame.
function visibleBox(obj, space) {
    const box = new THREE.Box3(), inv = new THREE.Matrix4().copy(space.matrixWorld).invert(), m = new THREE.Matrix4();
    obj.traverseVisible((o) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    });
    return box;
}
const boxOf = visibleBox;

// Wrap wheel meshes in steer → spin pivots placed at the wheel's centre (the axle).
function rigWheel(root, objs, key, front) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const o of objs) box.union(visibleBox(o, root));
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const steer = new THREE.Object3D(), spin = new THREE.Object3D();
    steer.position.copy(c);
    steer.add(spin);
    root.add(steer);
    root.updateMatrixWorld(true);
    for (const o of objs) spin.attach(o);
    return { key, front, steer, spin, radius: Math.max(0.05, Math.max(s.y, s.z) / 2), angle: 0 };
}

// ---------- baked-in wheels ----------
// Split the body mesh into triangle islands (welding vertices by position, since UV seams
// duplicate them), then pick islands that are low, near a corner, and as tall as they are long
// when seen from the side. Smaller islands inside a picked wheel (rims, hubs) go with it.
function extractWheels(root, scene, carSize) {
    const meshes = [];
    scene.traverseVisible((o) => { if (o.isMesh && !Array.isArray(o.material)) meshes.push(o); });
    root.updateMatrixWorld(true);
    const toRoot = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert();

    const picked = { fl: [], fr: [], rl: [], rr: [] };   // per corner: [{ mesh, tris, box }]
    const islandsByMesh = new Map();
    for (const mesh of meshes) {
        toRoot.multiplyMatrices(inv, mesh.matrixWorld);
        const isl = islands(mesh.geometry, toRoot);
        islandsByMesh.set(mesh, isl);
        for (const it of isl) {
            const s = it.box.getSize(new THREE.Vector3()), c = it.box.getCenter(new THREE.Vector3());
            const low = it.box.min.y < carSize.y * 0.12;
            const tall = s.y > carSize.y * 0.18 && s.y < carSize.y * 0.75;
            const round = Math.abs(s.y - s.z) / Math.max(s.y, s.z) < 0.3;
            const thin = s.x < carSize.x * 0.4;
            const corner = Math.abs(c.x) > carSize.x * 0.2 && Math.abs(c.z) > carSize.z * 0.15;
            if (!(low && tall && round && thin && corner)) continue;
            const key = (c.z > 0 ? 'f' : 'r') + (c.x > 0 ? 'l' : 'r');   // +X is the car's left
            picked[key].push({ mesh, it });
        }
    }

    const wheels = [], cut = new Map();   // cut: mesh -> its original geometry
    for (const [key, list] of Object.entries(picked)) {
        if (!list.length) continue;
        // the biggest island is the tyre; anything that sits inside it belongs to the same wheel
        list.sort((a, b) => b.it.tris.length - a.it.tris.length);
        const tyre = list[0].it.box.clone().expandByScalar(0.02 * carSize.z);
        const objs = [];
        for (const [mesh, isl] of islandsByMesh) {
            const tris = [];
            for (const it of isl) {
                if (it.taken || !tyre.containsBox(it.box)) continue;
                tris.push(...it.tris);
                it.taken = true;
            }
            if (!tris.length) continue;
            if (!cut.has(mesh)) cut.set(mesh, mesh.geometry);
            const part = new THREE.Mesh(subset(cut.get(mesh), tris), mesh.material);
            part.name = `${mesh.name}:wheel_${key}`;
            mesh.add(part);   // same transform as the body; rigWheel() re-parents it to the spin pivot
            objs.push(part);
        }
        wheels.push(rigWheel(root, objs, key, null));
    }
    if (wheels.length < 4) {
        // half a rig looks worse than none: leave the mesh as it was
        for (const w of wheels) w.steer.removeFromParent();
        return [];
    }
    // the body keeps every triangle that didn't go to a wheel
    for (const [mesh, full] of cut) {
        const keep = [];
        for (const it of islandsByMesh.get(mesh)) if (!it.taken) keep.push(...it.tris);
        mesh.geometry = subset(full, keep);
    }
    return wheels;
}

const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function islands(geom, toRoot) {
    const pos = geom.attributes.position, n = triCount(geom);
    const idx = (t, k) => (geom.index ? geom.index.getX(t * 3 + k) : t * 3 + k);
    // weld by rounded position
    const weld = new Map(), vid = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
        const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
        if (!weld.has(key)) weld.set(key, weld.size);
        vid[i] = weld.get(key);
    }
    const parent = new Int32Array(weld.size).map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
    for (let t = 0; t < n; t++) {
        const a = find(vid[idx(t, 0)]);
        parent[find(vid[idx(t, 1)])] = a;
        parent[find(vid[idx(t, 2)])] = a;
    }
    const groups = new Map(), v = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
        const r = find(vid[idx(t, 0)]);
        if (!groups.has(r)) groups.set(r, { tris: [], box: new THREE.Box3() });
        const g = groups.get(r);
        g.tris.push(t);
        for (let k = 0; k < 3; k++) g.box.expandByPoint(v.fromBufferAttribute(pos, idx(t, k)).applyMatrix4(toRoot));
    }
    return [...groups.values()];
}

// New compact geometry holding only the given triangles (and only the vertices they use,
// so bounding boxes come out right).
function subset(geom, tris) {
    const src = geom.index, remap = new Map(), order = [], index = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) {
            const v = src ? src.getX(t * 3 + k) : t * 3 + k;
            if (!remap.has(v)) { remap.set(v, order.length); order.push(v); }
            index[i * 3 + k] = remap.get(v);
        }
    });
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(geom.attributes)) {
        // getX..getW also read interleaved and normalised attributes, so write plain floats
        const n = a.itemSize, out = new Float32Array(order.length * n), get = [a.getX, a.getY, a.getZ, a.getW];
        order.forEach((v, i) => { for (let c = 0; c < n; c++) out[i * n + c] = get[c].call(a, v); });
        g.setAttribute(name, new THREE.BufferAttribute(out, n));
    }
    g.setIndex(new THREE.BufferAttribute(index, 1));
    return g;
}
