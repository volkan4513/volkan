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

// Bomb mode: all times in seconds, money in dollars.
export const BOMB = { buy: 15, live: 105, end: 5, plant: 3, defuse: 5, fuse: 40, defuseRange: 2.2, pickupRange: 1.1 };
export const ECON = { start: 1600, win: 3000, loss: 1400, streak: 500, maxStreak: 4, kill: 300, plant: 300, defuse: 300, cap: 9000 };
const SPAWN_SHIELD = 1.5;
const SWITCH_TIME = 0.35;
const IDLE = { mx: 0, mz: 0 };

export function createWorld(map, weapons, rules = {}) {
    return {
        map, weapons,
        boxes: map.boxes,
        rules: { mode: 'tdm', rounds: 6, respawn: 3, killLimit: 0, timeLimit: 0, infiniteAmmo: false, ...rules },
        players: [],
        att: 't',                       // bomb mode: the squad (team) attacking right now
        round: null,                    // bomb mode: { n, phase: 'buy' | 'live' | 'end', until, winner, reason }
        bomb: null,                     // bomb mode: { state, carrier, x, y, z, site, fuseAt }
        plan: { site: 'A' },            // bomb mode: where attacking bots head this round
        lossStreak: { t: 0, ct: 0 },
        roundsPlayed: 0,
        swapped: false,
        time: 0,
        tick: 0,
        events: [],
        score: { t: 0, ct: 0 },
        over: null,
        nextId: 1,
    };
}

export const isBomb = (world) => world.rules.mode === 'bomb';

export function addPlayer(world, { name, team, bot = false, loadout }) {
    const bomb = isBomb(world);
    const p = Object.assign(createPlayer(0, 0), {
        id: world.nextId++, name, team, bot,
        loadout: loadout || (bomb ? ['pistol'] : ['rifle', 'pistol', 'shotgun']),
        hp: 0, alive: false, kills: 0, deaths: 0, respawnAt: 0,
        money: bomb ? ECON.start : 0, act: 0, keepInv: false,
    });
    world.players.push(p);
    // Bomb mode: someone joining mid-round waits for the next one.
    if (!bomb || !world.round || world.round.phase === 'buy') respawn(world, p);
    else p.inv = p.loadout.map((id) => ({ id, mag: world.weapons[id].mag, reserve: world.weapons[id].reserve }));
    return p;
}

export function removePlayer(world, id) {
    const p = world.players.find((x) => x.id === id);
    if (p) dropBomb(world, p);
    world.players = world.players.filter((x) => x.id !== id);
}

// Team spawn for TDM: the free spot farthest from the nearest living enemy.
// Bomb rounds pass the spot in, so nobody stacks.
function respawn(world, p, spot = null) {
    const side = isBomb(world) && p.team !== world.att ? 'ct' : isBomb(world) ? 't' : p.team;
    let best = spot;
    if (!best) {
        const enemies = world.players.filter((e) => e.alive && e.team !== p.team);
        const mates = world.players.filter((e) => e.alive && e !== p);
        let spots = world.map.spawns[side].filter((s) => !mates.some((m) => Math.hypot(m.x - s[0], m.z - s[1]) < 1.5));
        if (!spots.length) spots = world.map.spawns[side];
        spots = spots.slice().sort(() => Math.random() - 0.5);
        best = spots[0];
        let bestD = -1;
        for (const s of spots) {
            let d = Infinity;
            for (const e of enemies) d = Math.min(d, Math.hypot(e.x - s[0], e.z - s[1]));
            if (d > bestD) { bestD = d; best = s; }
        }
    }
    const keep = isBomb(world) && p.keepInv && p.inv;
    const money = p.money, act = 0;
    Object.assign(p, createPlayer(best[0], best[1], best[2]), {
        hp: 100, alive: true,
        invulnUntil: isBomb(world) ? 0 : world.time + SPAWN_SHIELD,
        inv: keep || p.loadout.map((id) => ({ id, mag: world.weapons[id].mag, reserve: world.weapons[id].reserve })),
        slot: 0, nextFire: 0, reloadUntil: 0, switchUntil: world.time + SWITCH_TIME,
        fireHeld: false, trigger: false, bloom: 0,
        lastHitBy: 0, lastHitAt: -1, money, act,
    });
    world.events.push({ t: 'spawn', id: p.id, yaw: p.yaw });
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
        const raw = inputs.get(p.id) || IDLE;
        const inp = isBomb(world) ? effectiveInput(world, p, raw) : raw;
        if (inp.yaw !== undefined) p.yaw = inp.yaw;
        if (inp.pitch !== undefined) p.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch));
        stepPlayer(p, inp, world.boxes);
        if (p.y < -30) { killPlayer(world, p, null, 'fall', false); continue; }
        updateWeapon(world, p, inp);
        if (isBomb(world) && world.round) bombActions(world, p, raw);
    }

    if (isBomb(world) && world.round && !world.over) stepRound(world);

    if (!world.over && !isBomb(world)) {
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
        world.events.push({ t: 'shot', by: p.id, to: end, hit: res.player ? (res.player.team === p.team ? 'm' : 'p') : res.wall ? 'w' : '' });
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
    dropBomb(world, p);
    p.act = 0;
    if (by && by !== p) {
        by.kills++;
        if (isBomb(world)) {
            if (by.team !== p.team) by.money = Math.min(ECON.cap, by.money + ECON.kill);
        } else {
            world.score[by.team]++;
        }
    }
    world.events.push({ t: 'kill', by: by ? by.id : 0, tgt: p.id, w: weaponId, hs: hs ? 1 : 0 });
}

// ---------------------------------------------------------------------------
// Bomb mode. Squads keep their colour for the whole match; world.att says which
// squad attacks, and halftime flips it. Rounds: buy (frozen) -> live -> end.

export const siteAt = (map, x, z) => {
    for (const k of Object.keys(map.sites)) {
        const r = map.sites[k];
        if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return k;
    }
    return '';
};

// 'plant' / 'defuse' when this player could be doing it right now, else null.
export function actKind(world, p) {
    const b = world.bomb, rd = world.round;
    if (!b || !rd || rd.phase !== 'live' || !p.alive) return null;
    if (p.team === world.att) {
        if (b.state === 'carried' && b.carrier === p.id && p.onGround && siteAt(world.map, p.x, p.z)) return 'plant';
    } else if (b.state === 'planted' && Math.hypot(p.x - b.x, p.z - b.z) < BOMB.defuseRange && Math.abs(p.y - b.y) < 1.5) {
        return 'defuse';
    }
    return null;
}

// What the player's input really does this tick: frozen while buying, rooted while planting or defusing.
// The client predicts with the same function.
export function effectiveInput(world, p, inp) {
    const rd = world.round;
    if (!isBomb(world) || !rd) return inp;
    if (rd.phase === 'buy' || (inp.use && actKind(world, p))) return { ...inp, mx: 0, mz: 0, jump: false, fire: false };
    return inp;
}

export function buyItem(world, p, item) {
    const rd = world.round, W = world.weapons[item];
    if (!isBomb(world) || !rd || rd.phase !== 'buy' || !p.alive || !W || !W.price) return false;
    if (p.inv.some((w) => w.id === item) || p.money < W.price) return false;
    p.money -= W.price;
    const entry = { id: item, mag: W.mag, reserve: W.reserve };
    const idx = p.inv.findIndex((w) => world.weapons[w.id].slot === 1);
    if (idx >= 0) p.inv[idx] = entry;
    else p.inv.unshift(entry);
    p.slot = p.inv.indexOf(entry);
    p.switchUntil = world.time + SWITCH_TIME;
    p.reloadUntil = 0;
    world.events.push({ t: 'buy', id: p.id, item });
    return true;
}

function dropBomb(world, p) {
    const b = world.bomb;
    if (!b || b.state !== 'carried' || b.carrier !== p.id) return;
    Object.assign(b, { state: 'dropped', carrier: 0, x: p.x, y: p.y, z: p.z });
    world.events.push({ t: 'bombdrop', x: round2(p.x), y: round2(p.y), z: round2(p.z) });
}

function bombActions(world, p, inp) {
    const rd = world.round, b = world.bomb;
    if (rd.phase !== 'live' || !p.alive || !b) { p.act = 0; return; }
    const kind = actKind(world, p);
    if (kind && inp.use) {
        p.act += TICK;
        if (kind === 'plant' && p.act >= BOMB.plant) {
            Object.assign(b, {
                state: 'planted', carrier: 0, x: p.x, y: p.y, z: p.z,
                site: siteAt(world.map, p.x, p.z), fuseAt: world.time + BOMB.fuse,
            });
            p.money = Math.min(ECON.cap, p.money + ECON.plant);
            p.act = 0;
            world.events.push({ t: 'plant', by: p.id, site: b.site });
        } else if (kind === 'defuse' && p.act >= BOMB.defuse) {
            b.state = 'defused';
            p.money = Math.min(ECON.cap, p.money + ECON.defuse);
            p.act = 0;
            world.events.push({ t: 'defuse', by: p.id });
            endRound(world, p.team, 'defused');
        }
    } else {
        p.act = 0;
    }
    if (b.state === 'dropped' && p.team === world.att && Math.hypot(p.x - b.x, p.z - b.z) < BOMB.pickupRange && Math.abs(p.y - b.y) < 1.5) {
        Object.assign(b, { state: 'carried', carrier: p.id });
        world.events.push({ t: 'bombpick', by: p.id });
    }
}

const shuffled = (a) => a.slice().sort(() => Math.random() - 0.5);

// Begin the match (all players already added) or the next round.
export function startRound(world, fresh = false) {
    const n = world.round ? world.round.n + 1 : 1;
    world.round = { n, phase: 'buy', until: world.time + BOMB.buy, winner: '', reason: '' };
    world.plan = { site: Math.random() < 0.5 ? 'A' : 'B' };
    for (const squad of ['t', 'ct']) {
        const spots = shuffled(world.map.spawns[squad === world.att ? 't' : 'ct']);
        world.players.filter((p) => p.team === squad).forEach((p, i) => {
            if (fresh) p.money = ECON.start;
            p.keepInv = !fresh && p.alive;
            respawn(world, p, spots[i % spots.length]);
            if (p.bot) autoBuy(world, p);
        });
    }
    const carriers = world.players.filter((p) => p.alive && p.team === world.att);
    const c = carriers.length ? carriers[Math.floor(Math.random() * carriers.length)] : null;
    world.bomb = { state: c ? 'carried' : 'dropped', carrier: c ? c.id : 0, x: 0, y: 0, z: 0, site: '', fuseAt: 0 };
    if (!c) {
        const s = world.map.spawns.t[0];
        Object.assign(world.bomb, { x: s[0], y: 0, z: s[1] });
    }
    world.events.push({ t: 'round', phase: 'buy', n, att: world.att, sc: [world.score.t, world.score.ct], half: fresh && n > 1 });
}

function autoBuy(world, p) {
    if (p.money >= world.weapons.rifle.price) buyItem(world, p, 'rifle');
    else if (p.money >= world.weapons.shotgun.price && Math.random() < 0.7) buyItem(world, p, 'shotgun');
}

function endRound(world, winner, reason) {
    const rd = world.round;
    if (rd.phase === 'end') return;
    rd.phase = 'end';
    rd.until = world.time + BOMB.end;
    rd.winner = winner;
    rd.reason = reason;
    world.roundsPlayed++;
    world.score[winner]++;
    const loser = winner === 't' ? 'ct' : 't';
    world.lossStreak[loser] = Math.min(ECON.maxStreak, world.lossStreak[loser] + 1);
    world.lossStreak[winner] = 0;
    for (const p of world.players) {
        const bonus = p.team === winner ? ECON.win : ECON.loss + ECON.streak * (world.lossStreak[loser] - 1);
        p.money = Math.min(ECON.cap, p.money + bonus);
    }
    world.events.push({ t: 'round', phase: 'end', n: rd.n, winner, reason, sc: [world.score.t, world.score.ct] });
    if (world.score[winner] >= world.rules.rounds) endMatch(world, winner);
}

function stepRound(world) {
    const rd = world.round, b = world.bomb, t = world.time;
    if (rd.phase === 'buy') {
        if (t >= rd.until) {
            rd.phase = 'live';
            rd.until = t + BOMB.live;
            world.events.push({ t: 'round', phase: 'live', n: rd.n, att: world.att, sc: [world.score.t, world.score.ct] });
        }
        return;
    }
    if (rd.phase === 'end') {
        if (t < rd.until || world.over) return;
        // Halftime: after (rounds - 1) rounds the squads swap sides and everyone starts over.
        let fresh = false;
        if (!world.swapped && world.roundsPlayed >= world.rules.rounds - 1) {
            world.swapped = true;
            world.att = world.att === 't' ? 'ct' : 't';
            world.lossStreak = { t: 0, ct: 0 };
            for (const p of world.players) { p.keepInv = false; p.alive = false; }
            fresh = true;
        }
        startRound(world, fresh);
        return;
    }
    const att = world.att, def = att === 't' ? 'ct' : 't';
    const aliveA = world.players.filter((p) => p.alive && p.team === att).length;
    const aliveD = world.players.filter((p) => p.alive && p.team === def).length;
    if (b.state === 'planted') {
        if (t >= b.fuseAt) {
            b.state = 'exploded';
            world.events.push({ t: 'explode', x: round2(b.x), y: round2(b.y), z: round2(b.z) });
            endRound(world, att, 'bomb');
        } else if (aliveD === 0) {
            endRound(world, att, 'elim');
        }
    } else if (aliveA === 0 && aliveD === 0) {
        endRound(world, def, 'time');
    } else if (aliveA === 0) {
        endRound(world, def, 'elim');
    } else if (aliveD === 0) {
        endRound(world, att, 'elim');
    } else if (t >= rd.until) {
        endRound(world, def, 'time');
    }
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
