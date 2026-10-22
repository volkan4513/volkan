// Maps: four imported GLB maps, each coming out with the same shape:
//   { group, start: { x, z, yaw }, sky, fog: [near, far], groundAt(x, z, yRef?, up?) -> y | null,
//     offRoad(x, z) -> bool, walls: { pushCircle } | null, textureRoots: [Object3D], credit?,
//     track: race.js track | null }
// A map gets a track (and with it races) when tracks.js has a centre line for it.
import * as THREE from './lib/three.module.min.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import { MeshoptDecoder } from './lib/meshopt_decoder.module.js';
import { buildCollision } from './collision.js';
import { createTrack, buildRacingLine } from './race.js';
import { TRACKS } from './tracks.js';
import { buildGate } from './gates.js';

export const MAPS = [
    {
        id: 'chicago', name: 'Chicago', file: 'maps/nfs_shift_mobile_-_chicago.glb', size: 7836168,
        // The file is built at about 2x real size: its trackside barriers are 1.87 units tall and the
        // crowd cards 3.6, against ~0.9 m and ~1.75 m. Halving it puts the cars at true scale.
        scale: 0.5,
        info: 'city sprint · walls on',
        // west end of the sprint, right-hand lane, heading south (in scaled metres)
        spawn: { x: -780, z: -100, yaw: 0 }, roadWidth: 22, ownGantry: true,
        backdrop: { kind: 'city', top: '#5b93d6', ground: '#6d7075', far: '#8497ab', near: '#6b7d90' },   // a skyline behind the facades   // the map has a finish gantry at the end of the road
        sky: '#b9cfe2', fog: [120, 500],
        credit: {
            title: 'nfs shift mobile - chicago', author: 'amogusstrikesback2', license: 'CC BY 4.0',
            url: 'https://sketchfab.com/3d-models/nfs-shift-mobile-chicago-4e70d67846cb4326b1dad80c23368682',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        },
    },
    // NFS III: Hot Pursuit tracks: closed circuits over real terrain (100-300 m of height), one
    // texture atlas each and no painted-in lighting, so they are drawn lit (lit: true keeps their
    // normals). Their roads are 20-25 m wide against a 1.9 m car, so they're scaled to 0.6.
    // Spawns are in scaled metres.
    nfs3('woods', 'Country Woods', 'country_woods', '059ffef1c06f4f02aeafc529606b8dc9', 5009520,
        { backdrop: { kind: 'mountain', top: '#6f9bcb', ground: '#e3e9ee', far: '#93a5b3', near: '#6f8691' }, roadWidth: 15, spawn: { x: 449.4, z: 180, yaw: Math.PI }, sky: '#b4cbe0', fog: [120, 500] }),   // east straight, heading north
    nfs3('canyons', 'Lost Canyons', 'lost_canyons', '3017b1c97c3e401eb7a744ce172df97d', 7471740,
        { backdrop: { kind: 'mesa', top: '#8fb6da', ground: '#c9a272', far: '#c99d70', near: '#ad7347' }, roadWidth: 22, spawn: { x: -445.2, z: 831.5, yaw: 1.6 }, sky: '#e9d3b0', fog: [120, 550] }),
    nfs3('rocky', 'Rocky Pass', 'rocky_pass', 'c53cc28c9f5d4dbfa40c96d7a41d434b', 5784468,
        { backdrop: { kind: 'mountain', top: '#6f9fd0', ground: '#7a796c', far: '#8d9aa8', near: '#6c7e8c' }, roadWidth: 15, spawn: { x: 269.7, z: 613.8, yaw: 1.63 }, sky: '#c4d6e6', fog: [120, 550] }),   // behind the start line
];

function nfs3(id, name, slug, sketchfabId, size, rest) {
    const title = `nfs iii hot pursuit - ${slug.replace('_', ' ')}`;
    return {
        id, name, file: `maps/nfs_iii_hot_pursuit_-_${slug}.glb`, size, lit: true, scale: 0.6, ...rest,
        credit: {
            title, author: 'amogusstrikesback2', license: 'CC BY 4.0',
            url: `https://sketchfab.com/3d-models/nfs-iii-hot-pursuit-${slug.replace('_', '-')}-${sketchfabId}`,
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        },
    };
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const built = new Map();   // id -> Promise<map>, so switching back is instant

export function loadMap(def, onProgress) {
    if (!built.has(def.id)) {
        const p = loadGlbMap(def, onProgress).then((map) => {
            const line = TRACKS[def.id];
            map.track = line ? createTrack(line) : null;
            let clear = null;
            if (map.track) {
                // the line a driver takes: bots follow it and plan their corner speeds on it
                clear = (x, z, y) => { const g = map.groundAt(x, z, y, 0.9); return g !== null && !(map.walls && map.walls.pushCircle(x, z, 1.0, g)); };
                buildRacingLine(map.track, clear, Math.max(2, (def.roadWidth || 16) / 2 - 2.2));
            }
            // a start line and gantry at the start (the finish of a sprint)
            if (map.track) {
                const t = map.track, w = def.roadWidth || 16;
                map.fullTrack = t;
                map.fullGate = buildGate(t, map, t.closed ? 0 : t.length, w, !t.closed, !def.ownGantry);
                map.group.add(map.fullGate);
                // The half route: a sprint over the first half of the course. On a circuit it starts
                // 70 m behind the start line (room for the grid) and finishes halfway round.
                const L = t.length, from = t.closed ? L - 70 : 0, to = t.closed ? L + L / 2 : L / 2, pts = [];
                for (let s = from; s <= to; s += 4) { const p = t.at(s); pts.push(p.x, p.y, p.z); }
                map.halfTrack = createTrack({ points: pts, closed: false });
                buildRacingLine(map.halfTrack, clear, Math.max(2, w / 2 - 2.2));
                map.halfGate = buildGate(map.halfTrack, map, map.halfTrack.length, w, true, true);
                map.halfGate.visible = false;
                map.group.add(map.halfGate);
            }
            return map;
        });
        p.catch(() => built.delete(def.id));   // let a failed load be retried
        built.set(def.id, p);
    }
    return built.get(def.id);
}

async function loadGlbMap(def, onProgress) {
    const gltf = await loader.loadAsync(def.file, (e) => onProgress && onProgress(e.loaded / (e.total || def.size)));
    gltf.scene.scale.multiplyScalar(def.scale || 1);
    const group = new THREE.Group();
    group.name = `map:${def.id}`;
    group.add(mergeByMaterial(gltf.scene, def.lit));
    const walls = buildCollision(group);
    const st = walls.stats;
    console.info(`[map] ${def.id}: ${st.ground} ground tris, ${st.walls} wall segments (${st.trimmed} trimmed, ${st.dropped} see-through dropped)`);
    return {
        group,
        start: def.spawn,
        sky: def.sky,
        backdrop: def.backdrop,
        minY: new THREE.Box3().setFromObject(group).min.y,   // for the ground the backdrop lays out to the horizon
        fog: def.fog,
        groundAt: walls.groundAt,
        offRoad: () => false,
        walls,
        textureRoots: [group],
        credit: def.credit,
    };
}

// Compressed maps store positions, normals and UVs as normalised integers; collision and merging want plain floats.
function toFloat(attr) {
    if (attr.array instanceof Float32Array && !attr.normalized) return attr;
    const n = attr.itemSize, out = new Float32Array(attr.count * n);
    for (let i = 0; i < attr.count; i++) {
        out[i * n] = attr.getX(i);
        if (n > 1) out[i * n + 1] = attr.getY(i);
        if (n > 2) out[i * n + 2] = attr.getZ(i);
        if (n > 3) out[i * n + 3] = attr.getW(i);
    }
    return new THREE.BufferAttribute(out, n);
}

// One mesh per material instead of hundreds: far fewer draw calls, which phones care about.
// Unlit maps (lighting painted into the textures) drop their normals; lit ones keep them.
// "Blended" materials are drawn solid with an alpha cut-off so nothing needs sorting.
function mergeByMaterial(scene, lit) {
    const keep = lit ? ['position', 'uv', 'normal'] : ['position', 'uv'];
    scene.updateMatrixWorld(true);
    const groups = new Map();   // source material -> geometries in world space
    scene.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
        for (const name of Object.keys(g.attributes)) g.setAttribute(name, toFloat(g.attributes[name]));
        if (lit && !g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
        g.applyMatrix4(o.matrixWorld);
        if (!groups.has(o.material)) groups.set(o.material, []);
        groups.get(o.material).push(g);
    });

    const out = new THREE.Group();
    for (const [src, geoms] of groups) {
        const map = src.map;
        const mat = new (lit ? THREE.MeshLambertMaterial : THREE.MeshBasicMaterial)({
            name: src.name, map, color: src.color, side: THREE.DoubleSide,
            alphaTest: src.transparent || src.alphaTest ? 0.5 : 0,
        });
        const merged = mergeGeometries(geoms, false);
        if (merged) {
            const mesh = new THREE.Mesh(merged, mat);
            mesh.name = src.name;
            out.add(mesh);
        } else {
            for (const g of geoms) out.add(new THREE.Mesh(g, mat));   // mismatched attributes: keep them apart
        }
        for (const g of geoms) if (merged) g.dispose();
        src.dispose();
    }
    return out;
}
