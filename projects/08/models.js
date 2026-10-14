// Low-poly meshes built from boxes: players, the first-person weapon, tracers and hit bits.
import * as THREE from './three.module.min.js';

export const TEAM_COLORS = { t: 0xff6050, ct: 0x00a5ff };

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide });
const mats = new Map();
const lambert = (color) => {
    if (!mats.has(color)) mats.set(color, new THREE.MeshLambertMaterial({ color }));
    return mats.get(color);
};

// A box with an ink outline (a slightly bigger back-face copy as its child).
function part(parent, w, h, d, x, y, z, color, outline = 0.025) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
    m.position.set(x, y, z);
    if (outline) m.add(new THREE.Mesh(new THREE.BoxGeometry(w + outline * 2, h + outline * 2, d + outline * 2), outlineMat));
    parent.add(m);
    return m;
}

// ---------- players ----------
// Sizes match the sim hitboxes: legs 0-0.8 m, torso to 1.44 m, head 1.42-1.8 m.
// team is 't' / 'ct', or a colour (battle royale gives everyone their own).
export function createPlayerModel(team) {
    const color = typeof team === 'number' ? team : TEAM_COLORS[team];
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const legL = new THREE.Group(), legR = new THREE.Group();
    legL.position.set(-0.13, 0.8, 0);
    legR.position.set(0.13, 0.8, 0);
    part(legL, 0.2, 0.8, 0.24, 0, -0.4, 0, 0x323834);
    part(legR, 0.2, 0.8, 0.24, 0, -0.4, 0, 0x323834);
    body.add(legL, legR);

    part(body, 0.56, 0.66, 0.34, 0, 1.11, 0, color);

    const head = new THREE.Group();
    head.position.set(0, 1.44, 0);
    part(head, 0.34, 0.34, 0.34, 0, 0.18, 0, 0xf2d7b6);
    part(head, 0.36, 0.08, 0.36, 0, 0.3, 0, color, 0.015);   // headband
    part(head, 0.06, 0.06, 0.02, -0.08, 0.17, -0.175, 0x111111, 0);
    part(head, 0.06, 0.06, 0.02, 0.08, 0.17, -0.175, 0x111111, 0);
    body.add(head);

    const arms = new THREE.Group();
    arms.position.set(0, 1.3, 0);
    part(arms, 0.1, 0.1, 0.5, 0.18, -0.02, -0.3, 0x222222);            // gun
    part(arms, 0.12, 0.12, 0.3, 0.22, -0.06, -0.08, color); // arm
    body.add(arms);

    return { root, body, legL, legR, head, arms, phase: 0, dead: 0 };
}

export function updatePlayerModel(m, p, x, y, z, dt) {
    m.root.position.set(x, y, z);
    m.root.rotation.y = p.yaw;
    m.root.visible = p.alive || m.dead < 3;

    if (!p.alive) {
        // Fall over backwards, then sink into the floor.
        m.dead += dt;
        const k = Math.min(m.dead / 0.35, 1);
        m.body.rotation.x = k * k * (Math.PI / 2);
        m.body.position.y = -Math.max(0, m.dead - 2) * 0.6;
        return;
    }
    m.dead = 0;
    m.body.rotation.x = 0;
    m.body.position.y = 0;
    m.body.scale.y = p.crouch ? 0.67 : 1;

    const speed = Math.hypot(p.vx, p.vz);
    m.phase += dt * speed * 2.2;
    const swing = p.onGround ? Math.sin(m.phase) * Math.min(speed / 6, 1) * 0.7 : 0.4;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    m.head.rotation.x = p.pitch * 0.5;
    m.arms.rotation.x = p.pitch * 0.8;
}

// ---------- weapons ----------
// Gun meshes, muzzle z and the height of the sight above the gun's origin
// (aiming lines that up with the eye).
const GUNS = {
    rifle(g) {
        part(g, 0.08, 0.1, 0.42, 0, 0, -0.2, 0x2b2f2c);
        part(g, 0.035, 0.035, 0.26, 0, 0.02, -0.53, 0x1a1a1a);
        part(g, 0.06, 0.16, 0.08, 0, -0.12, -0.22, 0xffdf00);
        part(g, 0.07, 0.1, 0.2, 0, -0.03, 0.08, 0xff6050);
        part(g, 0.02, 0.03, 0.02, 0, 0.06, -0.14, 0x1a1a1a, 0);           // scope mounts
        part(g, 0.02, 0.03, 0.02, 0, 0.06, -0.24, 0x1a1a1a, 0);
        part(g, 0.05, 0.05, 0.16, 0, 0.095, -0.19, 0x3a3f3b, 0.015);      // short scope
        return { muzzle: -0.68, sight: 0.095 };
    },
    pistol(g) {
        part(g, 0.06, 0.07, 0.22, 0, 0, -0.12, 0x2b2f2c);
        part(g, 0.055, 0.14, 0.07, 0, -0.09, -0.03, 0xffdf00).rotation.x = 0.25;
        part(g, 0.05, 0.012, 0.06, 0, 0.041, -0.07, 0x1a1a1a, 0);         // red dot: base and an open frame
        part(g, 0.008, 0.05, 0.012, -0.024, 0.072, -0.07, 0x1a1a1a, 0);
        part(g, 0.008, 0.05, 0.012, 0.024, 0.072, -0.07, 0x1a1a1a, 0);
        part(g, 0.056, 0.008, 0.012, 0, 0.1, -0.07, 0x1a1a1a, 0);
        return { muzzle: -0.25, sight: 0.07 };
    },
    shotgun(g) {
        part(g, 0.07, 0.07, 0.62, 0, 0.01, -0.3, 0x1a1a1a);
        part(g, 0.09, 0.08, 0.2, 0, -0.06, -0.4, 0xff6050);
        part(g, 0.08, 0.11, 0.24, 0, -0.03, 0.06, 0x00a5ff);
        return { muzzle: -0.63, sight: 0.05 };
    },
    sniper(g) {
        part(g, 0.08, 0.1, 0.5, 0, 0, -0.22, 0x3b4a2c);
        part(g, 0.03, 0.03, 0.42, 0, 0.02, -0.68, 0x1a1a1a);
        part(g, 0.07, 0.12, 0.24, 0, -0.03, 0.12, 0x3b4a2c);
        part(g, 0.05, 0.12, 0.06, 0, -0.12, -0.1, 0x1a1a1a);
        part(g, 0.065, 0.065, 0.3, 0, 0.11, -0.2, 0x1a1a1a, 0.015);      // long scope
        part(g, 0.085, 0.085, 0.04, 0, 0.11, -0.36, 0x1a1a1a, 0);
        part(g, 0.075, 0.075, 0.04, 0, 0.11, -0.05, 0x1a1a1a, 0);
        return { muzzle: -0.9, sight: 0.11 };
    },
};

// A gun lying on the floor in battle royale, or a med kit. Spins over a coloured disc.
const LOOT_COLORS = { rifle: 0x00a5ff, shotgun: 0x3cc85a, sniper: 0xffb020, med: 0xff6050 };

export function createLootModel(kind) {
    const root = new THREE.Group();
    const item = new THREE.Group();
    if (GUNS[kind]) {
        GUNS[kind](item);
        item.scale.setScalar(1.7);
        item.rotation.y = Math.PI / 2;
    } else {
        part(item, 0.42, 0.26, 0.3, 0, 0, 0, 0xf7f1e3);
        part(item, 0.24, 0.07, 0.31, 0, 0, 0, 0xff3030, 0);
        part(item, 0.07, 0.2, 0.31, 0, 0, 0, 0xff3030, 0);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 16),
        new THREE.MeshBasicMaterial({ color: LOOT_COLORS[kind], transparent: true, opacity: 0.55 }));
    disc.position.y = -0.42;
    root.add(item, disc);
    return { root, item, disc };
}

// ---------- first-person weapon ----------
const VM_X = 0.26, VM_Y = -0.27, VM_Z = -0.55, ADS_Z = -0.42;
// Lives in its own scene, drawn after the world with a cleared depth buffer,
// so it never pokes into walls.
export function createViewModel() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a968c, 2.4));
    const sun = new THREE.DirectionalLight(0xfff4dc, 2);
    sun.position.set(0.5, 1, 0.3);
    scene.add(sun);

    const holder = new THREE.Group();
    holder.position.set(VM_X, VM_Y, VM_Z);
    scene.add(holder);

    const guns = {}, muzzle = {}, sight = {};
    for (const [id, build] of Object.entries(GUNS)) {
        guns[id] = new THREE.Group();
        ({ muzzle: muzzle[id], sight: sight[id] } = build(guns[id]));
    }

    for (const g of Object.values(guns)) {
        part(g, 0.09, 0.09, 0.13, 0.01, -0.1, 0.02, 0xf2d7b6);   // hand
        g.visible = false;
        holder.add(g);
    }

    const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshBasicMaterial({ color: 0xfff066 }));
    flash.visible = false;
    holder.add(flash);

    let current = null, kick = 0, flashT = 0, bob = 0;

    return {
        scene,
        holder,
        show(id) {
            if (current === id) return;
            for (const [k, g] of Object.entries(guns)) g.visible = k === id;
            current = id;
            flash.position.set(0, 0.02, muzzle[id]);
        },
        fire() {
            kick = 1;
            flashT = 0.05;
            flash.rotation.set(Math.random() * 3, Math.random() * 3, 0);
            flash.scale.setScalar(0.8 + Math.random() * 0.6);
        },
        // speed: horizontal m/s, reload/raise: 0..1 progress (1 = done), ads: 0..1 aiming down the sight
        update(dt, speed, onGround, reload, raise, ads = 0) {
            bob += dt * speed * 1.6;
            const b = (onGround ? Math.min(speed / 6, 1) : 0) * (1 - ads * 0.8);
            kick = Math.max(0, kick - dt * 9);
            flashT -= dt;
            flash.visible = flashT > 0;
            const dip = Math.sin(Math.min(reload, 1) * Math.PI) * 0.18 + (1 - raise) * 0.25;
            const x = VM_X + (0 - VM_X) * ads, y = VM_Y + (-sight[current || 'rifle'] - VM_Y) * ads, z = VM_Z + (ADS_Z - VM_Z) * ads;
            holder.position.set(x + Math.cos(bob) * 0.012 * b, y + Math.abs(Math.sin(bob)) * 0.014 * b - dip, z + kick * 0.05);
            holder.rotation.set(kick * (0.08 - ads * 0.05) - dip * 1.2, 0, 0);
        },
        muzzleWorld(camera, out) {
            out.copy(holder.position);
            out.z += muzzle[current || 'rifle'];
            out.y += 0.02;
            return camera.localToWorld(out);
        },
    };
}

// ---------- tracers and impact bits ----------
export function createEffects(scene) {
    const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1).translate(0, 0, 0.5);
    const tracers = [];
    for (let i = 0; i < 32; i++) {
        const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, depthWrite: false }));
        m.visible = false;
        m.life = 0;
        scene.add(m);
        tracers.push(m);
    }

    const bitGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const bits = [];
    for (let i = 0; i < 80; i++) {
        const m = new THREE.Mesh(bitGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        m.visible = false;
        m.life = 0;
        m.v = new THREE.Vector3();
        scene.add(m);
        bits.push(m);
    }
    let ti = 0, bi = 0;

    return {
        tracer(from, to) {
            const m = tracers[ti++ % tracers.length];
            m.position.copy(from);
            m.lookAt(to);
            m.scale.set(1, 1, Math.max(0.01, from.distanceTo(to)));
            m.life = 0.07;
            m.material.opacity = 0.9;
            m.visible = true;
        },
        impact(at, color, n = 5) {
            for (let k = 0; k < n; k++) {
                const m = bits[bi++ % bits.length];
                m.position.copy(at);
                m.v.set((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3);
                m.material.color.setHex(color);
                m.life = 0.45;
                m.scale.setScalar(1);
                m.visible = true;
            }
        },
        update(dt) {
            for (const m of tracers) {
                if (!m.visible) continue;
                m.life -= dt;
                m.material.opacity = Math.max(0, m.life / 0.07) * 0.9;
                if (m.life <= 0) m.visible = false;
            }
            for (const m of bits) {
                if (!m.visible) continue;
                m.life -= dt;
                m.v.y -= 12 * dt;
                m.position.addScaledVector(m.v, dt);
                m.scale.setScalar(Math.max(0.01, m.life / 0.45));
                if (m.life <= 0) m.visible = false;
            }
        },
    };
}
