// One car in the world: its model, handling state and height, plus everything that moves it
// against a map (ground, walls, map edges, other cars) and poses its model. The player and the
// bots are both vehicles; remote players are only posed (see poseCar), never simulated here.
import * as THREE from './lib/three.module.min.js';
import { createDrive, placeDrive, stepDrive, TUNING } from './drive.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export const GRASS = { ...TUNING, maxSpeed: 26, roll: 3, grip: 6 };
const STEP_UP = 0.9, MAX_DROP = 2.5;   // how far ground may rise / fall under a car in one step
const STEP_DIST = 0.35;                // max metres per physics substep, well under a car's half-width

// ---------- shadow ----------
let blobTex = null;
function blobTexture() {
    if (blobTex) return blobTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.38)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return (blobTex = new THREE.CanvasTexture(c));
}

// A soft dark oval under a car model, stretched to its footprint.
export function addShadow(car) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.05;
    m.scale.set(car.size.x * 1.25, car.size.z * 1.12, 1);
    car.root.add(m);
}

// ---------- vehicles ----------
export function createVehicle() {
    return {
        car: null,
        drive: createDrive(),
        y: 0,                          // ground height under the car
        tilt: { pitch: 0, roll: 0 },   // from the ground
        lean: { pitch: 0, roll: 0 },   // from acceleration and cornering
        bump: 0,                       // hardest hit this frame (m/s)
    };
}

export function setVehicleCar(v, car) {
    if (v.car) v.car.root.removeFromParent();
    v.car = car;
    addShadow(car);
    for (const w of car.wheels) { w.angle = 0; w.shown = 0; }
}

// Ground near height y: ignores anything overhead, and a big drop counts as no ground (a cliff
// edge), which stops a car like the edge of the map.
export function groundNear(map, x, z, y) {
    const g = map.groundAt(x, z, y, STEP_UP);
    return g !== null && g > y - MAX_DROP ? g : null;
}

export function placeVehicle(v, map, p) {
    placeDrive(v.drive, p.x, p.z, p.yaw);
    v.y = p.y ?? map.groundAt(p.x, p.z) ?? 0;   // no hint: the topmost surface at that spot
    v.tilt.pitch = v.tilt.roll = 0;
}

// The three circles a car is made of, along its length.
export function carCircles(x, z, yaw, size) {
    const r = size.x / 2, reach = Math.max(0, size.z / 2 - r), fx = Math.sin(yaw), fz = Math.cos(yaw);
    return { r, pts: [[x - fx * reach, z - fz * reach], [x, z], [x + fx * reach, z + fz * reach]] };
}

// Step the handling, in substeps short enough that nothing thin can be skipped over.
// others: [{ x, y, z, yaw, size }] for every other car, which this one is pushed out of.
export function stepVehicle(v, map, input, dt, others = []) {
    const d = v.drive;
    const tune = map.offRoad(d.x, d.z) ? GRASS : TUNING;
    const n = clamp(Math.ceil((Math.hypot(d.vx, d.vz) * dt) / STEP_DIST), 1, 10);
    v.bump = 0;
    for (let i = 0; i < n; i++) {
        const px = d.x, pz = d.z, pyaw = d.yaw;
        stepDrive(d, input, dt / n, v.car.wheelbase, tune);
        collide(v, map, others, px, pz, pyaw);
    }
}

// Walls and other cars push each circle out and take away the velocity going into them (with a
// small bounce). If either end ends up over nothing, the step is undone: that's the edge of the map.
function collide(v, map, others, px, pz, pyaw) {
    const d = v.drive;
    const push = (hit) => {
        d.x += hit.x;
        d.z += hit.z;
        const vn = d.vx * hit.nx + d.vz * hit.nz;
        if (vn >= 0) return;
        d.vx = (d.vx - 1.1 * vn * hit.nx) * 0.97;   // 10% bounce, a little scrub
        d.vz = (d.vz - 1.1 * vn * hit.nz) * 0.97;
        v.bump = Math.max(v.bump, -vn);
    };
    for (let it = 0; it < 2; it++) {
        const me = carCircles(d.x, d.z, d.yaw, v.car.size);
        if (map.walls) {
            for (const [cx, cz] of me.pts) {
                const hit = map.walls.pushCircle(cx, cz, me.r, v.y);
                if (hit) push(hit);
            }
        }
        for (const o of others) {
            if (Math.abs(o.y - v.y) > 2 || (o.x - d.x) ** 2 + (o.z - d.z) ** 2 > 64) continue;
            const them = carCircles(o.x, o.z, o.yaw, o.size), reach = me.r + them.r;
            for (const [ax, az] of me.pts) {
                for (const [bx, bz] of them.pts) {
                    const dx = ax - bx, dz = az - bz, dist = Math.hypot(dx, dz);
                    if (dist >= reach || dist < 1e-4) continue;
                    // each car only moves itself, so take half the overlap
                    const k = (reach - dist) / 2;
                    push({ x: (dx / dist) * k, z: (dz / dist) * k, nx: dx / dist, nz: dz / dist });
                }
            }
        }
    }
    const me = carCircles(d.x, d.z, d.yaw, v.car.size), was = carCircles(px, pz, pyaw, v.car.size);
    const centre = groundNear(map, d.x, d.z, v.y) !== null;
    for (const k of [0, 2]) {
        if (groundNear(map, me.pts[k][0], me.pts[k][1], v.y) !== null) continue;
        // already hanging over the edge before this step (pushed there): let it move as long as
        // its middle is on the ground, or it could never drive back on
        if (centre && groundNear(map, was.pts[k][0], was.pts[k][1], v.y) === null) continue;
        d.x = px;
        d.z = pz;
        d.yaw = pyaw;
        d.vx *= -0.3;
        d.vz *= -0.3;
        return;
    }
    const g = groundNear(map, d.x, d.z, v.y);
    if (g !== null) v.y = g;
}

// Sit the model on the ground, tilt it with the slope, lean the body with the forces on it, and
// turn the wheels.
export function poseVehicle(v, map, dt, wheelStyle, wheelSpeed = v.drive.speed) {
    if (!v.car) return;
    const d = v.drive, car = v.car;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), lx = fz, lz = -fx;   // forward, left
    const hz = car.size.z * 0.4, hx = car.size.x * 0.45;
    const at = (dx, dz) => (map ? groundNear(map, d.x + dx, d.z + dz, v.y) : null) ?? v.y;
    const yF = at(fx * hz, fz * hz), yB = at(-fx * hz, -fz * hz), yL = at(lx * hx, lz * hx), yR = at(-lx * hx, -lz * hx);
    const kt = dt ? damp(14, dt) : 1;
    v.tilt.pitch += (-Math.atan2(yF - yB, 2 * hz) - v.tilt.pitch) * kt;
    v.tilt.roll += (Math.atan2(yL - yR, 2 * hx) - v.tilt.roll) * kt;
    d.grade = clamp((yF - yB) / (2 * hz), -0.6, 0.6);
    const k = dt ? damp(6, dt) : 1;
    v.lean.pitch += (clamp(-d.accLong * 0.005, -0.06, 0.06) - v.lean.pitch) * k;
    v.lean.roll += (clamp(d.accLat * 0.0045, -0.08, 0.08) - v.lean.roll) * k;
    poseCar(car, { x: d.x, y: v.y, z: d.z, yaw: d.yaw, pitch: v.tilt.pitch, roll: v.tilt.roll, speed: wheelSpeed, steer: d.steer }, dt, wheelStyle);
    car.body.rotation.set(v.lean.pitch, 0, v.lean.roll);
}

// ---------- posing a model (also used for remote players) ----------
// The wheel's true angle keeps counting; what's drawn is capped per frame so fast wheels
// don't strobe backwards, and in "stepped" style it snaps to 16 positions like a sprite flipbook.
const WHEEL_CAP = 0.25;   // rad per frame: under half the spoke gap of a 12-spoke rim, so fast wheels never seem to run backwards
const WHEEL_STEP = (Math.PI * 2) / 16;

export function poseCar(car, p, dt, wheelStyle) {
    car.root.position.set(p.x, p.y, p.z);
    car.root.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    for (const w of car.wheels) {
        if (w.front) w.steer.rotation.y = p.steer;
        const turn = (p.speed / w.radius) * dt;
        w.angle += turn;
        w.shown += clamp(turn, -WHEEL_CAP, WHEEL_CAP);
        w.spin.rotation.x = wheelStyle === 'stepped' ? Math.round(w.shown / WHEEL_STEP) * WHEEL_STEP : w.shown;
    }
}
