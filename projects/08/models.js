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
export function createPlayerModel(team) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const legL = new THREE.Group(), legR = new THREE.Group();
    legL.position.set(-0.13, 0.8, 0);
    legR.position.set(0.13, 0.8, 0);
    part(legL, 0.2, 0.8, 0.24, 0, -0.4, 0, 0x323834);
    part(legR, 0.2, 0.8, 0.24, 0, -0.4, 0, 0x323834);
    body.add(legL, legR);

    part(body, 0.56, 0.66, 0.34, 0, 1.11, 0, TEAM_COLORS[team]);

    const head = new THREE.Group();
    head.position.set(0, 1.44, 0);
    part(head, 0.34, 0.34, 0.34, 0, 0.18, 0, 0xf2d7b6);
    part(head, 0.36, 0.08, 0.36, 0, 0.3, 0, TEAM_COLORS[team], 0.015);   // headband
    part(head, 0.06, 0.06, 0.02, -0.08, 0.17, -0.175, 0x111111, 0);
    part(head, 0.06, 0.06, 0.02, 0.08, 0.17, -0.175, 0x111111, 0);
    body.add(head);

    const arms = new THREE.Group();
    arms.position.set(0, 1.3, 0);
    part(arms, 0.1, 0.1, 0.5, 0.18, -0.02, -0.3, 0x222222);            // gun
    part(arms, 0.12, 0.12, 0.3, 0.22, -0.06, -0.08, TEAM_COLORS[team]); // arm
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

// ---------- first-person weapon ----------
const VM_X = 0.26, VM_Y = -0.27, VM_Z = -0.55;
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

    const guns = {};
    const muzzle = {};

    guns.rifle = new THREE.Group();
    part(guns.rifle, 0.08, 0.1, 0.42, 0, 0, -0.2, 0x2b2f2c);
    part(guns.rifle, 0.035, 0.035, 0.26, 0, 0.02, -0.53, 0x1a1a1a);
    part(guns.rifle, 0.06, 0.16, 0.08, 0, -0.12, -0.22, 0xffdf00);
    part(guns.rifle, 0.07, 0.1, 0.2, 0, -0.03, 0.08, 0xff6050);
    muzzle.rifle = -0.68;

    guns.pistol = new THREE.Group();
    part(guns.pistol, 0.06, 0.07, 0.22, 0, 0, -0.12, 0x2b2f2c);
    part(guns.pistol, 0.055, 0.14, 0.07, 0, -0.09, -0.03, 0xffdf00).rotation.x = 0.25;
    muzzle.pistol = -0.25;

    guns.shotgun = new THREE.Group();
    part(guns.shotgun, 0.07, 0.07, 0.62, 0, 0.01, -0.3, 0x1a1a1a);
    part(guns.shotgun, 0.09, 0.08, 0.2, 0, -0.06, -0.4, 0xff6050);
    part(guns.shotgun, 0.08, 0.11, 0.24, 0, -0.03, 0.06, 0x00a5ff);
    muzzle.shotgun = -0.63;

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
        // speed: horizontal m/s, reload/raise: 0..1 progress (1 = done)
        update(dt, speed, onGround, reload, raise) {
            bob += dt * speed * 1.6;
            const b = onGround ? Math.min(speed / 6, 1) : 0;
            kick = Math.max(0, kick - dt * 9);
            flashT -= dt;
            flash.visible = flashT > 0;
            const dip = Math.sin(Math.min(reload, 1) * Math.PI) * 0.18 + (1 - raise) * 0.25;
            holder.position.set(VM_X + Math.cos(bob) * 0.012 * b, VM_Y + Math.abs(Math.sin(bob)) * 0.014 * b - dip, VM_Z + kick * 0.05);
            holder.rotation.set(kick * 0.08 - dip * 1.2, 0, 0);
        },
        muzzleWorld(camera, out) {
            out.set(VM_X, VM_Y + 0.02, VM_Z + muzzle[current || 'rifle']);
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
