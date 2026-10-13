// Shared game rules. No Three.js and no DOM here, so the same code runs in
// Free Area (locally) and later on the host tab as the authoritative sim.
// Units: metres and seconds. Position = centre of the player's feet.

export const TICK = 1 / 60;

export const PLAYER = {
    half: 0.35,          // half width of the player's box collider
    height: 1.8,
    crouchHeight: 1.2,
    eye: 1.65,
    crouchEye: 1.05,
    step: 0.45,          // highest ledge you walk up without jumping
};

export const MOVE = {
    run: 6.2,
    walk: 3.0,
    crouch: 2.4,
    accel: 10,
    airCap: 0.9,         // low air wish speed: lets you air-strafe, CS style
    friction: 6,
    stopSpeed: 1.5,
    gravity: 20,
    jump: 7.6,           // about 1.45 m jump height, clears a 1.2 m crate
    maxFall: 40,
};

const EPS = 1e-4;

export function createPlayer(x, z, yaw = 0, y = 0) {
    return {
        x, y, z, vx: 0, vy: 0, vz: 0,
        yaw, pitch: 0,
        onGround: false, crouch: false, jumpHeld: false,
    };
}

export function playerHeight(p) {
    return p.crouch ? PLAYER.crouchHeight : PLAYER.height;
}

export function eyeHeight(p) {
    return p.crouch ? PLAYER.crouchEye : PLAYER.eye;
}

// inp: { mx: strafe -1..1, mz: forward -1..1, jump, crouch, walk }
// boxes: map.json boxes, [x0, y0, z0, x1, y1, z1, colour]
export function stepPlayer(p, inp, boxes, dt = TICK) {
    // Crouch, and only stand up when there is room above.
    if (inp.crouch) p.crouch = true;
    else if (p.crouch && !collides(p, PLAYER.height, boxes)) p.crouch = false;
    const h = playerHeight(p);

    // Ground friction.
    if (p.onGround) {
        const speed = Math.hypot(p.vx, p.vz);
        if (speed > 0) {
            const drop = Math.max(speed, MOVE.stopSpeed) * MOVE.friction * dt;
            const k = Math.max(speed - drop, 0) / speed;
            p.vx *= k;
            p.vz *= k;
        }
    }

    // Wish direction from yaw (yaw 0 looks down -z, like the Three.js camera).
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    let wx = -sin * inp.mz + cos * inp.mx;
    let wz = -cos * inp.mz - sin * inp.mx;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
        wx /= len;
        wz /= len;
        const max = p.crouch ? MOVE.crouch : inp.walk ? MOVE.walk : MOVE.run;
        const wishSpeed = max * Math.min(len, 1);
        const cap = p.onGround ? wishSpeed : Math.min(wishSpeed, MOVE.airCap);
        const add = cap - (p.vx * wx + p.vz * wz);
        if (add > 0) {
            const a = Math.min(MOVE.accel * wishSpeed * dt, add);
            p.vx += a * wx;
            p.vz += a * wz;
        }
    }

    // Jump on press, not while held.
    if (inp.jump && !p.jumpHeld && p.onGround) {
        p.vy = MOVE.jump;
        p.onGround = false;
    }
    p.jumpHeld = !!inp.jump;

    p.vy = Math.max(p.vy - MOVE.gravity * dt, -MOVE.maxFall);

    const wasOnGround = p.onGround;
    slide(p, 'x', p.vx * dt, h, boxes);
    slide(p, 'z', p.vz * dt, h, boxes);

    const hitY = moveAxis(p, 'y', p.vy * dt, h, boxes);
    if (hitY && p.vy <= 0) {
        p.onGround = true;
        p.vy = 0;
    } else {
        if (hitY) p.vy = 0;  // head hit a ceiling
        p.onGround = false;
        // Stick to the ground when walking down steps instead of floating off them.
        if (wasOnGround && p.vy <= 0) {
            const y = p.y;
            if (moveAxis(p, 'y', -PLAYER.step, h, boxes)) {
                p.onGround = true;
                p.vy = 0;
            } else {
                p.y = y;
            }
        }
    }
}

// Horizontal move with step-up: if blocked on the ground, try the same move
// lifted by PLAYER.step and then drop back down onto the ledge.
function slide(p, axis, d, h, boxes) {
    if (!d) return;
    const start = p[axis];
    if (!moveAxis(p, axis, d, h, boxes)) return;

    const vel = axis === 'x' ? 'vx' : 'vz';
    if (p.onGround) {
        const blocked = { x: p.x, y: p.y, z: p.z };
        p[axis] = start;
        p.y += PLAYER.step;
        if (!collides(p, h, boxes) && !moveAxis(p, axis, d, h, boxes)) {
            moveAxis(p, 'y', -PLAYER.step, h, boxes);
            return;
        }
        p.x = blocked.x;
        p.y = blocked.y;
        p.z = blocked.z;
    }
    p[vel] = 0;
}

// Moves along one axis and pushes out of any box it ends up inside.
// Returns true when something was hit.
function moveAxis(p, axis, d, h, boxes) {
    p[axis] += d;
    let hit = false;
    for (const b of boxes) {
        if (!overlaps(p, h, b)) continue;
        hit = true;
        if (axis === 'x') p.x = d > 0 ? b[0] - PLAYER.half - EPS : b[3] + PLAYER.half + EPS;
        else if (axis === 'z') p.z = d > 0 ? b[2] - PLAYER.half - EPS : b[5] + PLAYER.half + EPS;
        else p.y = d > 0 ? b[1] - h - EPS : b[4] + EPS;
    }
    return hit;
}

export function collides(p, h, boxes) {
    for (const b of boxes) if (overlaps(p, h, b)) return true;
    return false;
}

function overlaps(p, h, b) {
    return p.x - PLAYER.half < b[3] && p.x + PLAYER.half > b[0]
        && p.y < b[4] && p.y + h > b[1]
        && p.z - PLAYER.half < b[5] && p.z + PLAYER.half > b[2];
}

// ---------------------------------------------------------------------------
// World: players, weapons, hitscan, kills and respawns.
// Every tick takes one input per player; the result is new state plus events
// (shot / hit / kill / spawn / reload / over) for effects and, later, the network.

export const HITBOX = { half: 0.3, head: 0.19 };   // body half width, head half size
const SPAWN_SHIELD = 1.5;
const SWITCH_TIME = 0.35;
const IDLE = { mx: 0, mz: 0 };

export function createWorld(map, weapons, rules = {}) {
    return {
        map, weapons,
        boxes: map.boxes,
        rules: { respawn: 3, killLimit: 0, timeLimit: 0, infiniteAmmo: false, ...rules },
        players: [],
        time: 0,
        tick: 0,
        events: [],
        score: { t: 0, ct: 0 },
        over: null,
        nextId: 1,
    };
}

export function addPlayer(world, { name, team, bot = false, loadout = ['rifle', 'pistol', 'shotgun'] }) {
    const p = Object.assign(createPlayer(0, 0), {
        id: world.nextId++, name, team, bot, loadout,
        hp: 0, alive: false, kills: 0, deaths: 0, respawnAt: 0,
    });
    world.players.push(p);
    respawn(world, p);
    return p;
}

export function removePlayer(world, id) {
    world.players = world.players.filter((p) => p.id !== id);
}

function respawn(world, p) {
    // Pick the team spawn farthest from the nearest living enemy.
    const enemies = world.players.filter((e) => e.alive && e.team !== p.team);
    const spots = world.map.spawns[p.team].slice().sort(() => Math.random() - 0.5);
    let best = spots[0], bestD = -1;
    for (const s of spots) {
        let d = Infinity;
        for (const e of enemies) d = Math.min(d, Math.hypot(e.x - s[0], e.z - s[1]));
        if (d > bestD) { bestD = d; best = s; }
    }
    Object.assign(p, createPlayer(best[0], best[1], best[2]), {
        hp: 100, alive: true,
        invulnUntil: world.time + SPAWN_SHIELD,
        inv: p.loadout.map((id) => ({ id, mag: world.weapons[id].mag, reserve: world.weapons[id].reserve })),
        slot: 0, nextFire: 0, reloadUntil: 0, switchUntil: world.time + SWITCH_TIME,
        fireHeld: false, trigger: false, bloom: 0,
        lastHitBy: 0, lastHitAt: -1,
    });
    world.events.push({ t: 'spawn', id: p.id });
}

// inputs: Map of player id -> { mx, mz, jump, crouch, walk, yaw, pitch, fire, reload, slot }
export function stepWorld(world, inputs) {
    world.time += TICK;
    world.tick++;
    const r = world.rules;

    for (const p of world.players) {
        if (!p.alive) {
            if (r.respawn >= 0 && !world.over && world.time >= p.respawnAt) respawn(world, p);
            continue;
        }
        const inp = inputs.get(p.id) || IDLE;
        if (inp.yaw !== undefined) p.yaw = inp.yaw;
        if (inp.pitch !== undefined) p.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch));
        stepPlayer(p, inp, world.boxes);
        if (p.y < -30) { killPlayer(world, p, null, 'fall', false); continue; }
        updateWeapon(world, p, inp);
    }

    if (!world.over) {
        const s = world.score;
        const lead = s.t === s.ct ? null : s.t > s.ct ? 't' : 'ct';
        if (r.killLimit && Math.max(s.t, s.ct) >= r.killLimit) endMatch(world, lead);
        else if (r.timeLimit && world.time >= r.timeLimit) endMatch(world, lead);
    }
}

function endMatch(world, winner) {
    world.over = { winner };
    world.events.push({ t: 'over', winner });
}

function updateWeapon(world, p, inp) {
    const t = world.time;

    if (inp.slot != null && inp.slot !== p.slot && p.inv[inp.slot]) {
        p.slot = inp.slot;
        p.switchUntil = t + SWITCH_TIME;
        p.reloadUntil = 0;
        p.trigger = false;
        p.bloom = 0;
    }
    const cur = p.inv[p.slot];
    const W = world.weapons[cur.id];

    if (p.reloadUntil && t >= p.reloadUntil) {
        const take = world.rules.infiniteAmmo ? W.mag - cur.mag : Math.min(W.mag - cur.mag, cur.reserve);
        cur.mag += take;
        if (!world.rules.infiniteAmmo) cur.reserve -= take;
        p.reloadUntil = 0;
    }

    const wantReload = inp.reload || (inp.fire && cur.mag === 0);
    if (wantReload && !p.reloadUntil && t >= p.switchUntil && cur.mag < W.mag
        && (cur.reserve > 0 || world.rules.infiniteAmmo)) {
        p.reloadUntil = t + W.reload;
        world.events.push({ t: 'reload', id: p.id });
    }

    // Semi-auto weapons fire once per press; the press is remembered until it can fire.
    if (inp.fire && !p.fireHeld) p.trigger = true;
    p.fireHeld = !!inp.fire;
    p.bloom = Math.max(0, p.bloom - TICK * 0.15);

    const wants = W.auto ? inp.fire : p.trigger;
    if (wants && !p.reloadUntil && t >= p.switchUntil && t >= p.nextFire && cur.mag > 0) {
        cur.mag--;
        p.nextFire = t + 1 / W.fireRate;
        p.trigger = false;
        p.invulnUntil = 0;         // shooting drops the spawn shield
        fire(world, p, W, cur.id);
        p.bloom = Math.min(p.bloom + (W.auto ? 0.005 : 0.012), 0.05);
    }
}

// Current cone half-angle in radians: moving, jumping and spraying all widen it.
export function spreadOf(p, W) {
    const speed = Math.hypot(p.vx, p.vz);
    const s = W.spread + W.moveSpread * Math.min(speed / MOVE.run, 1) + (p.onGround ? 0 : 0.08) + (p.bloom || 0);
    return p.crouch ? s * 0.7 : s;
}

function fire(world, p, W, weaponId) {
    const o = [p.x, p.y + eyeHeight(p), p.z];
    const spread = spreadOf(p, W);
    const hits = new Map();
    for (let i = 0; i < W.pellets; i++) {
        const r = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        const yaw = p.yaw + r * Math.cos(a), pitch = p.pitch + r * Math.sin(a);
        const d = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
        const res = castRay(world, o, d, W.range, p);
        const end = o.map((v, k) => round2(v + d[k] * res.t));
        world.events.push({ t: 'shot', by: p.id, to: end, hit: res.player ? 'p' : res.wall ? 'w' : '' });
        if (res.player) {
            const h = hits.get(res.player) || { dmg: 0, hs: false };
            h.dmg += W.damage * (res.head ? W.headshot : 1);
            h.hs = h.hs || res.head;
            hits.set(res.player, h);
        }
    }
    for (const [tgt, h] of hits) damage(world, p, tgt, Math.round(h.dmg), h.hs, weaponId);
}

function damage(world, by, tgt, dmg, hs, weaponId) {
    if (!tgt.alive || tgt.team === by.team || world.time < tgt.invulnUntil) return;
    tgt.hp -= dmg;
    tgt.lastHitBy = by.id;
    tgt.lastHitAt = world.time;
    world.events.push({ t: 'hit', by: by.id, tgt: tgt.id, dmg, hs: hs ? 1 : 0 });
    if (tgt.hp <= 0) killPlayer(world, tgt, by, weaponId, hs);
}

function killPlayer(world, p, by, weaponId, hs) {
    p.alive = false;
    p.hp = 0;
    p.deaths++;
    p.respawnAt = world.time + world.rules.respawn;
    if (by && by !== p) {
        by.kills++;
        world.score[by.team]++;
    }
    world.events.push({ t: 'kill', by: by ? by.id : 0, tgt: p.id, w: weaponId, hs: hs ? 1 : 0 });
}

// Nearest hit along a ray: map boxes and every living player except `skip`.
export function castRay(world, o, d, max, skip) {
    let best = { t: max, player: null, head: false, wall: false };
    for (const b of world.boxes) {
        const t = rayBox(o, d, b, best.t);
        if (t < best.t) best = { t, player: null, head: false, wall: true };
    }
    for (const p of world.players) {
        if (p === skip || !p.alive) continue;
        const h = playerHeight(p), s = HITBOX.head, top = p.y + h;
        const head = [p.x - s, top - s * 2, p.z - s, p.x + s, top, p.z + s];
        const body = [p.x - HITBOX.half, p.y, p.z - HITBOX.half, p.x + HITBOX.half, top - s * 2, p.z + HITBOX.half];
        const th = rayBox(o, d, head, best.t);
        if (th < best.t) best = { t: th, player: p, head: true, wall: false };
        const tb = rayBox(o, d, body, best.t);
        if (tb < best.t) best = { t: tb, player: p, head: false, wall: false };
    }
    return best;
}

// True when nothing in the map blocks the straight line from a to b.
export function clearLine(boxes, a, b) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return true;
    for (let k = 0; k < 3; k++) d[k] /= len;
    for (const box of boxes) if (rayBox(a, d, box, len) < len) return false;
    return true;
}

// Slab test. Returns the entry distance, or Infinity when the ray misses within max.
function rayBox(o, d, b, max) {
    let t0 = 0, t1 = max;
    for (let k = 0; k < 3; k++) {
        const inv = 1 / (d[k] || 1e-12);
        let ta = (b[k] - o[k]) * inv, tb = (b[k + 3] - o[k]) * inv;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return Infinity;
    }
    return t0;
}

const round2 = (v) => Math.round(v * 100) / 100;
