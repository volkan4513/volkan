// Visual feedback for driving: sparks where a car scrapes or hits something, and tyre marks that
// the rear wheels leave on the road when a car slides or brakes hard. No DOM, no networking.
//   sparks   a pool of additive points with a little gravity; sparks(x, y, z, vx, vz, strength)
//   skids    one ring-buffer mesh of flat quads laid between successive wheel positions
import * as THREE from './lib/three.module.min.js';

const SPARKS = 220, MARKS = 1400, MARK_W = 0.22, MARK_STEP = 0.35;

export function createEffects(scene) {
    // ---------- sparks ----------
    const sPos = new Float32Array(SPARKS * 3), sCol = new Float32Array(SPARKS * 3), sVel = new Float32Array(SPARKS * 3), sLife = new Float32Array(SPARKS), sMax = new Float32Array(SPARKS);
    for (let i = 0; i < SPARKS; i++) sPos[i * 3 + 1] = -1e4;   // parked far below until used
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
    const sparksMesh = new THREE.Points(sGeo, new THREE.PointsMaterial({
        size: 0.22, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    sparksMesh.frustumCulled = false;
    sparksMesh.renderOrder = 5;
    scene.add(sparksMesh);
    let sNext = 0;

    // strength: impact speed in m/s. (vx, vz): which way the car was going, so the sparks fly back from it.
    function sparks(x, y, z, vx, vz, strength) {
        const n = Math.min(36, 4 + Math.round(strength * 2.2)), len = Math.hypot(vx, vz) || 1;
        for (let k = 0; k < n; k++) {
            const i = sNext;
            sNext = (sNext + 1) % SPARKS;
            const back = 1 + Math.random() * 3, side = (Math.random() - 0.5) * 5;
            sPos[i * 3] = x + (Math.random() - 0.5) * 0.8;
            sPos[i * 3 + 1] = y + 0.15 + Math.random() * 0.35;
            sPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
            sVel[i * 3] = (-vx / len) * back + (-vz / len) * side;
            sVel[i * 3 + 1] = 1.5 + Math.random() * (2 + strength * 0.25);
            sVel[i * 3 + 2] = (-vz / len) * back + (vx / len) * side;
            sLife[i] = sMax[i] = 0.3 + Math.random() * 0.45;
        }
    }

    // ---------- skid marks ----------
    const mPos = new Float32Array(MARKS * 4 * 3), mIdx = new Uint32Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) mIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
    mGeo.setIndex(new THREE.BufferAttribute(mIdx, 1));
    const marksMesh = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({
        color: 0x101010, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    }));
    marksMesh.frustumCulled = false;
    marksMesh.renderOrder = 2;
    scene.add(marksMesh);
    let mHead = 0, mDirty = false;
    const trails = new Map();   // car id -> [last point per rear wheel, or null]
    const tmp = new THREE.Vector3();

    function laySegment(a, b) {
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
        if (l < 1e-4) return;
        const px = (-dz / l) * (MARK_W / 2), pz = (dx / l) * (MARK_W / 2), o = mHead * 12;
        mPos.set([a.x + px, a.y, a.z + pz, a.x - px, a.y, a.z - pz, b.x + px, b.y, b.z + pz, b.x - px, b.y, b.z - pz], o);
        mHead = (mHead + 1) % MARKS;
        mDirty = true;
    }

    // Where a car's rear tyres touch, in its own space: each rear wheel, or two points a car-width
    // apart when the model has one pivot for the whole rear axle.
    function rearPoints(car) {
        if (car.skidPts) return car.skidPts;
        const rear = car.wheels.filter((w) => !w.front);
        const pts = rear.length === 1
            ? [-1, 1].map((side) => new THREE.Vector3(side * car.size.x * 0.32, 0, rear[0].steer.position.z))
            : rear.map((w) => new THREE.Vector3(w.steer.position.x, 0, w.steer.position.z));
        return (car.skidPts = pts);
    }

    // cars: [{ id, car, skidding, ground(x, z) -> y | null }]; call after the cars are posed this frame.
    function skids(cars) {
        for (const c of cars) {
            const pts = rearPoints(c.car);
            let trail = trails.get(c.id);
            if (!trail || trail.length !== pts.length) trails.set(c.id, (trail = pts.map(() => null)));
            pts.forEach((local, k) => {
                if (!c.skidding) { trail[k] = null; return; }
                tmp.copy(local);
                c.car.root.localToWorld(tmp);
                const g = c.ground(tmp.x, tmp.z);
                if (g === null) { trail[k] = null; return; }
                const p = { x: tmp.x, y: g + 0.04, z: tmp.z }, last = trail[k];
                if (!last) { trail[k] = p; return; }
                const d = Math.hypot(p.x - last.x, p.z - last.z);
                if (d < MARK_STEP) return;
                if (d > 6 || Math.abs(p.y - last.y) > 1) { trail[k] = p; return; }   // a jump or a teleport: no mark across it
                laySegment(last, p);
                trail[k] = p;
            });
        }
    }

    function clearMarks() {
        mPos.fill(0);
        mDirty = true;
        mHead = 0;
        trails.clear();
    }
    function forget(id) { trails.delete(id); }

    function update(dt) {
        for (let i = 0; i < SPARKS; i++) {
            if (sLife[i] <= 0) continue;
            sLife[i] -= dt;
            if (sLife[i] <= 0) { sPos[i * 3 + 1] = -1e4; sCol[i * 3] = sCol[i * 3 + 1] = sCol[i * 3 + 2] = 0; continue; }
            sVel[i * 3 + 1] -= 14 * dt;
            sPos[i * 3] += sVel[i * 3] * dt;
            sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
            sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
            const f = sLife[i] / sMax[i];   // white-hot to dull orange to nothing
            sCol[i * 3] = 1;
            sCol[i * 3 + 1] = 0.35 + 0.6 * f * f;
            sCol[i * 3 + 2] = 0.1 + 0.6 * f * f * f;
            sCol[i * 3] *= Math.min(1, f * 3);
            sCol[i * 3 + 1] *= Math.min(1, f * 3);
            sCol[i * 3 + 2] *= Math.min(1, f * 3);
        }
        sGeo.attributes.position.needsUpdate = true;
        sGeo.attributes.color.needsUpdate = true;
        if (mDirty) { mGeo.attributes.position.needsUpdate = true; mDirty = false; }
    }

    return { sparks, skids, update, clearMarks, forget, marks: marksMesh };
}
