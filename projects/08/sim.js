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
    step: 0.5,           // highest ledge you walk up without jumping (CS: 18 units, plus float room)
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

// inp: { mx: strafe -1..1, mz: forward -1..1, jump, crouch, walk, aim }
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
        const max = p.crouch ? MOVE.crouch : inp.walk || inp.aim ? MOVE.walk : MOVE.run;
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
    const x0 = p.x, z0 = p.z;
    p[axis] += d;
    let hit = false;
    for (const b of near(boxes, Math.min(x0, p.x) - PLAYER.half, Math.min(z0, p.z) - PLAYER.half, Math.max(x0, p.x) + PLAYER.half, Math.max(z0, p.z) + PLAYER.half)) {
        if (!overlaps(p, h, b)) continue;
        hit = true;
        if (axis === 'x') p.x = d > 0 ? b[0] - PLAYER.half - EPS : b[3] + PLAYER.half + EPS;
        else if (axis === 'z') p.z = d > 0 ? b[2] - PLAYER.half - EPS : b[5] + PLAYER.half + EPS;
        else p.y = d > 0 ? b[1] - h - EPS : b[4] + EPS;
    }
    return hit;
}

export function collides(p, h, boxes) {
    for (const b of near(boxes, p.x - PLAYER.half, p.z - PLAYER.half, p.x + PLAYER.half, p.z + PLAYER.half)) if (overlaps(p, h, b)) return true;
    return false;
}

// ---------- box grid ----------
// Big maps have thousands of boxes, so each box list gets a 4 m grid over x/z (built on first use).
// Lookups return boxes in list order, so results match a plain loop over the list exactly.
const CELL = 4;
const grids = new WeakMap();

function gridOf(boxes) {
    let g = grids.get(boxes);
    if (g) return g;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const b of boxes) {
        x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[2]);
        x1 = Math.max(x1, b[3]); z1 = Math.max(z1, b[5]);
    }
    const nx = Math.max(1, Math.ceil((x1 - x0) / CELL)), nz = Math.max(1, Math.ceil((z1 - z0) / CELL));
    g = { x0, z0, nx, nz, cells: Array.from({ length: nx * nz }, () => []), mark: new Uint32Array(boxes.length), stamp: 0 };
    boxes.forEach((b, i) => {
        for (let cz = cellOf(g, b[2], 'z'); cz <= cellOf(g, b[5], 'z'); cz++)
            for (let cx = cellOf(g, b[0], 'x'); cx <= cellOf(g, b[3], 'x'); cx++) g.cells[cz * nx + cx].push(i);
    });
    grids.set(boxes, g);
    return g;
}

function cellOf(g, v, axis) {
    const c = Math.floor((v - (axis === 'x' ? g.x0 : g.z0)) / CELL);
    return Math.max(0, Math.min((axis === 'x' ? g.nx : g.nz) - 1, c));
}

// Boxes whose x/z footprint may touch the rectangle, in list order.
function near(boxes, x0, z0, x1, z1) {
    if (boxes.length < 64) return boxes;
    const g = gridOf(boxes);
    const cx0 = cellOf(g, x0, 'x'), cx1 = cellOf(g, x1, 'x'), cz0 = cellOf(g, z0, 'z'), cz1 = cellOf(g, z1, 'z');
    if (cx0 === cx1 && cz0 === cz1) return g.cells[cz0 * g.nx + cx0].map((i) => boxes[i]);
    const stamp = ++g.stamp, ids = [];
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        for (const i of g.cells[cz * g.nx + cx]) if (g.mark[i] !== stamp) { g.mark[i] = stamp; ids.push(i); }
    }
    return ids.sort((a, b) => a - b).map((i) => boxes[i]);
}

// Distance to the nearest box along a ray (Infinity when nothing within max). Walks the grid
// cells the ray crosses, nearest first, and stops once a hit is closer than the next cell.
// any: return the first hit found instead of the nearest.
function rayBoxes(boxes, o, d, max, any = false) {
    let best = max;
    if (boxes.length < 64) {
        for (const b of boxes) {
            const t = rayBox(o, d, b, best);
            if (t < best) { best = t; if (any) break; }
        }
        return best < max ? best : Infinity;
    }
    const g = gridOf(boxes), stamp = ++g.stamp;
    // Clip the ray to the grid's x/z rectangle.
    let t = 0, tEnd = max;
    for (const [k, lo, n] of [[0, g.x0, g.nx], [2, g.z0, g.nz]]) {
        const hi = lo + n * CELL;
        if (Math.abs(d[k]) < 1e-12) {
            if (o[k] < lo || o[k] > hi) return Infinity;
            continue;
        }
        let ta = (lo - o[k]) / d[k], tb = (hi - o[k]) / d[k];
        if (ta > tb) [ta, tb] = [tb, ta];
        t = Math.max(t, ta);
        tEnd = Math.min(tEnd, tb);
    }
    if (t > tEnd) return Infinity;
    let cx = cellOf(g, o[0] + d[0] * t, 'x'), cz = cellOf(g, o[2] + d[2] * t, 'z');
    const sx = Math.abs(d[0]) < 1e-12 ? 0 : Math.sign(d[0]), sz = Math.abs(d[2]) < 1e-12 ? 0 : Math.sign(d[2]);
    const dtx = sx ? CELL / Math.abs(d[0]) : Infinity, dtz = sz ? CELL / Math.abs(d[2]) : Infinity;
    let tx = sx ? (g.x0 + (cx + (sx > 0 ? 1 : 0)) * CELL - o[0]) / d[0] : Infinity;
    let tz = sz ? (g.z0 + (cz + (sz > 0 ? 1 : 0)) * CELL - o[2]) / d[2] : Infinity;
    while (t <= best) {
        for (const i of g.cells[cz * g.nx + cx]) {
            if (g.mark[i] === stamp) continue;
            g.mark[i] = stamp;
            const tb = rayBox(o, d, boxes[i], best);
            if (tb < best) {
                best = tb;
                if (any) return best;
            }
        }
        if (tx < tz) {
            t = tx; tx += dtx; cx += sx;
            if (cx < 0 || cx >= g.nx) break;
        } else {
            t = tz; tz += dtz; cz += sz;
            if (cz < 0 || cz >= g.nz) break;
        }
    }
    return best < max ? best : Infinity;
}

// Everything that blocks movement: map boxes plus player-only clips.
export function solidsOf(map) {
    if (!map.solids) map.solids = map.clips && map.clips.length ? map.boxes.concat(map.clips) : map.boxes;
    return map.solids;
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
        solids: solidsOf(map),
        rules: { mode: 'tdm', rounds: 6, respawn: 3, killLimit: 0, timeLimit: 0, infiniteAmmo: false, zone: true, ...rules },
        players: [],
        att: 't',                       // bomb mode: the squad (team) attacking right now
        round: null,                    // bomb mode: { n, phase: 'buy' | 'live' | 'end', until, winner, reason }
        bomb: null,                     // bomb mode: { state, carrier, x, y, z, site, fuseAt }
        zone: null,                     // battle royale: the safe circle, see stepZone
        loot: null,                     // battle royale: [{ id, kind, x, y, z, taken }]
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
        hist: null,                     // lag compensation: set to [] on a network host
    };
}

export const isBomb = (world) => world.rules.mode === 'bomb';

export function addPlayer(world, { name, team, bot = false, loadout }) {
    const bomb = isBomb(world), br = isBR(world);
    const p = Object.assign(createPlayer(0, 0), {
        id: world.nextId++, name, team, bot,
        loadout: loadout || (bomb || br ? ['pistol'] : ['rifle', 'pistol', 'shotgun', 'sniper']),
        hp: 0, alive: false, kills: 0, deaths: 0, respawnAt: 0,
        money: bomb ? ECON.start : 0, act: 0, keepInv: false, place: 0,
    });
    world.players.push(p);
    // Bomb mode: someone joining mid-round waits for the next one. Battle royale: for the next match.
    if (br ? !world.zone : !bomb || !world.round || world.round.phase === 'buy') respawn(world, p);
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
    let best = spot, y = 0;
    if (!best && isBR(world)) {
        // Drop in from the sky over the open-air waypoint farthest from everyone else.
        const others = world.players.filter((e) => e.alive && e !== p);
        const covered = (s) => world.boxes.some((b) => b[1] > (s[2] ?? 0) + 1 && s[0] > b[0] && s[0] < b[3] && s[1] > b[2] && s[1] < b[5]);
        let pt = null, bestD = -1;
        for (const s of shuffled(world.map.waypoints)) {
            if (covered(s)) continue;
            let d = Infinity;
            for (const e of others) d = Math.min(d, Math.hypot(e.x - s[0], e.z - s[1]));
            if (d > bestD) { bestD = d; pt = s; }
        }
        best = [pt[0], pt[1], Math.random() * Math.PI * 2];
        y = (pt[2] ?? groundAt(world.boxes, pt[0], pt[1])) + BR.drop;
    } else if (!best) {
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
    Object.assign(p, createPlayer(best[0], best[1], best[2], best[3] ?? y), {    // spawns: [x, z, yaw, y?]
        hp: 100, alive: true,
        invulnUntil: isBomb(world) ? 0 : world.time + (isBR(world) ? BR.shield : SPAWN_SHIELD),
        inv: keep || p.loadout.map((id) => ({ id, mag: world.weapons[id].mag, reserve: world.weapons[id].reserve })),
        slot: 0, nextFire: 0, reloadUntil: 0, switchUntil: world.time + SWITCH_TIME,
        fireHeld: false, trigger: false, bloom: 0, aim: false, zoneAt: 0,
        lastHitBy: 0, lastHitAt: -1, money, act, place: 0,
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
        const inp = effectiveInput(world, p, raw);
        if (inp.yaw !== undefined) p.yaw = inp.yaw;
        if (inp.pitch !== undefined) p.pitch = Math.max(-1.55, Math.min(1.55, inp.pitch));
        p.aim = !!inp.aim;
        stepPlayer(p, inp, world.solids);
        if (p.y < -30) { killPlayer(world, p, null, 'fall', false); continue; }
        updateWeapon(world, p, inp);
        if (isBomb(world) && world.round) bombActions(world, p, raw);
        if (world.zone) {
            lootPickup(world, p);
            zoneDamage(world, p);
        }
    }

    if (isBomb(world) && world.round && !world.over) stepRound(world);

    if (world.zone && !world.over) {
        stepZone(world);
        const alive = world.players.filter((p) => p.alive);
        if (alive.length <= 1 && world.players.length > 1) {
            if (alive[0]) alive[0].place = 1;
            endMatch(world, alive[0] ? alive[0].id : 0);
        }
    }

    if (!world.over && !isBomb(world) && !isBR(world)) {
        const s = world.score;
        const lead = s.t === s.ct ? null : s.t > s.ct ? 't' : 'ct';
        if (r.killLimit && Math.max(s.t, s.ct) >= r.killLimit) endMatch(world, lead);
        else if (r.timeLimit && world.time >= r.timeLimit) endMatch(world, lead);
    }
    if (world.hist) recordHistory(world);
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
        fire(world, p, W, cur.id, inp.view);
        p.bloom = Math.min(p.bloom + (W.auto ? 0.005 : 0.012), 0.05);
    }
}

// Current cone half-angle in radians: moving, jumping and spraying all widen it; a scope tightens it.
export function spreadOf(p, W) {
    const speed = Math.hypot(p.vx, p.vz);
    const base = p.aim && W.scope ? W.scope.spread : W.spread;
    const s = base + W.moveSpread * Math.min(speed / MOVE.run, 1) + (p.onGround ? 0 : 0.08) + (p.bloom || 0);
    return p.crouch ? s * 0.7 : s;
}

function fire(world, p, W, weaponId, view) {
    const undo = world.hist && view != null ? rewind(world, p, view) : null;
    const o = [p.x, p.y + eyeHeight(p), p.z];
    const spread = spreadOf(p, W);
    const hits = new Map();
    for (let i = 0; i < W.pellets; i++) {
        const r = spread * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        const yaw = p.yaw + r * Math.cos(a), pitch = p.pitch + r * Math.sin(a);
        const d = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
        const res = castRay(world, o, d, W.range, p);
        const end = o.map((v, k) => round2(v + d[k] * res.t));
        // w (weapon) only on the first pellet: one gunshot sound per trigger pull.
        world.events.push({
            t: 'shot', by: p.id, to: end, hit: res.player ? (sameSide(world, res.player, p) ? 'm' : 'p') : res.wall ? 'w' : '',
            ...(i === 0 ? { w: weaponId } : {}),
        });
        if (res.player) {
            const h = hits.get(res.player) || { dmg: 0, hs: false };
            h.dmg += W.damage * (res.head ? W.headshot : 1);
            h.hs = h.hs || res.head;
            hits.set(res.player, h);
        }
    }
    if (undo) undo();
    for (const [tgt, h] of hits) damage(world, p, tgt, Math.round(h.dmg), h.hs, weaponId);
}

// ---------------------------------------------------------------------------
// Lag compensation. A remote client sees other players in the past (its link delay plus
// the interpolation delay) and sends the host tick it is looking at with each input.
// When it fires, everyone else is moved back to that tick for the ray, then put back.

export const LAGCOMP = { maxTicks: 30 };    // rewind at most 0.5 s

function recordHistory(world) {
    world.hist.push({ k: world.tick, ps: world.players.map((p) => [p, p.x, p.y, p.z, p.crouch]) });
    if (world.hist.length > LAGCOMP.maxTicks + 1) world.hist.shift();
}

// Moves every other living player to where they were at tick `view` (fractional).
// Returns a function that puts them back.
function rewind(world, shooter, view) {
    const h = world.hist;
    if (!h.length || !Number.isFinite(view)) return null;
    const k = Math.max(world.tick - LAGCOMP.maxTicks, Math.min(world.tick, view));
    if (k >= h[h.length - 1].k) return null;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].k > k) i--;
    const a = h[Math.max(0, i - 1)], c = h[i];
    const f = a === c ? 1 : Math.max(0, Math.min(1, (k - a.k) / (c.k - a.k)));
    const from = new Map(a.ps.map((e) => [e[0], e]));
    const saved = [];
    for (const e of c.ps) {
        const p = e[0];
        if (p === shooter || !p.alive) continue;
        const b = from.get(p) || e;
        // Respawn or teleport between the two ticks: do not slide across the map.
        const t = Math.hypot(e[1] - b[1], e[3] - b[3]) > 6 ? 1 : f;
        saved.push([p, p.x, p.y, p.z, p.crouch]);
        p.x = b[1] + (e[1] - b[1]) * t;
        p.y = b[2] + (e[2] - b[2]) * t;
        p.z = b[3] + (e[3] - b[3]) * t;
        p.crouch = t < 0.5 ? b[4] : e[4];
    }
    return () => { for (const [p, x, y, z, cr] of saved) { p.x = x; p.y = y; p.z = z; p.crouch = cr; } };
}

function damage(world, by, tgt, dmg, hs, weaponId) {
    if (!tgt.alive || sameSide(world, tgt, by) || world.time < tgt.invulnUntil) return;
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
    if (isBR(world)) p.place = world.players.filter((q) => q.alive).length + 1;
    if (by && by !== p) {
        by.kills++;
        if (isBomb(world)) {
            if (by.team !== p.team) by.money = Math.min(ECON.cap, by.money + ECON.kill);
        } else if (!isBR(world)) {
            world.score[by.team]++;
        }
    }
    world.events.push({ t: 'kill', by: by ? by.id : 0, tgt: p.id, w: weaponId, hs: hs ? 1 : 0, pl: p.place || 0 });
}

// ---------------------------------------------------------------------------
// Battle royale: everyone for themselves and no respawns. Players drop in from the sky
// with a pistol, pick up loot by walking over it and stay inside a shrinking zone.
// The last one alive wins.

export const isBR = (world) => world.rules.mode === 'br';
export const sameSide = (world, a, b) => a === b || (!isBR(world) && a.team === b.team);

export const LOOT_KINDS = ['rifle', 'shotgun', 'sniper', 'med'];
const LOOT_ODDS = [0.3, 0.25, 0.15, 0.3];
export const BR = { drop: 18, shield: 3, pickup: 1.2, med: 50, fill: 10 };
// Zone stages: [wait s, shrink s, radius after shrinking as a share of the first circle, damage per second outside].
export const ZONE = [[20, 15, 0.52, 2], [15, 12, 0.29, 4], [12, 10, 0.15, 7], [10, 8, 0.05, 12], [8, 10, 0, 20]];
const ZONE_OFF_R = 1e4;           // zone turned off: a circle far bigger than any map

// Highest walkable surface (top at most 1.5 m) under a point.
export function groundAt(boxes, x, z) {
    let y = 0;
    for (const b of near(boxes, x, z, x, z)) {
        if (x > b[0] && x < b[3] && z > b[2] && z < b[5] && b[4] <= 1.5) y = Math.max(y, b[4]);
    }
    return y;
}

// Floor extent [x0, z0, x1, z1]: map.bounds, else every box whose top sits at ground level.
function mapBounds(map) {
    if (map.bounds) return map.bounds;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of map.boxes) {
        if (Math.abs(f[4]) > 0.01) continue;
        b[0] = Math.min(b[0], f[0]); b[1] = Math.min(b[1], f[2]);
        b[2] = Math.max(b[2], f[3]); b[3] = Math.max(b[3], f[5]);
    }
    return b;
}

// Call once all players are added: scatters loot and starts the zone.
// With rules.zone off the zone still exists (it marks the match as running) but never shrinks or hurts.
export function startBR(world) {
    const b = mapBounds(world.map);
    const x = (b[0] + b[2]) / 2, z = (b[1] + b[3]) / 2, r0 = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 + 2;    // covers the corners
    if (world.rules.zone === false) {
        world.zone = { x, z, r: ZONE_OFF_R, r0, fx: x, fz: z, fr: ZONE_OFF_R, tx: x, tz: z, tr: 0, stage: ZONE.length, shrinking: false, until: world.time, dps: 0, off: true };
    } else {
        world.zone = { x, z, r: r0, r0, fx: x, fz: z, fr: r0, tx: x, tz: z, tr: r0, stage: 0, shrinking: false, until: world.time + ZONE[0][0], dps: ZONE[0][3] };
        nextZoneTarget(world);
    }
    const spots = shuffled(world.map.waypoints);
    const n = Math.min(spots.length, Math.max(16, world.players.length * 2));
    world.loot = spots.slice(0, n).map(([lx, lz, ly], id) => {
        let k = 0, r = Math.random();
        while (k < LOOT_ODDS.length - 1 && (r -= LOOT_ODDS[k]) > 0) k++;
        return { id, kind: LOOT_KINDS[k], x: lx, y: ly ?? groundAt(world.boxes, lx, lz), z: lz, taken: false };
    });
}

// The next circle lies fully inside the current one, centre kept on the map.
function nextZoneTarget(world) {
    const zn = world.zone, tr = ZONE[zn.stage][2] * zn.r0, b = mapBounds(world.map);
    const room = Math.max(0, zn.r - tr);
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * room;
    zn.tx = Math.max(b[0] + 4, Math.min(b[2] - 4, zn.x + Math.cos(a) * d));
    zn.tz = Math.max(b[1] + 4, Math.min(b[3] - 4, zn.z + Math.sin(a) * d));
    zn.tr = tr;
}

function stepZone(world) {
    const zn = world.zone, t = world.time;
    if (zn.stage >= ZONE.length) return;
    const st = ZONE[zn.stage];
    if (!zn.shrinking) {
        if (t >= zn.until) Object.assign(zn, { shrinking: true, fx: zn.x, fz: zn.z, fr: zn.r, until: t + st[1] });
        return;
    }
    const k = Math.min(1, 1 - (zn.until - t) / st[1]);
    zn.x = zn.fx + (zn.tx - zn.fx) * k;
    zn.z = zn.fz + (zn.tz - zn.fz) * k;
    zn.r = zn.fr + (zn.tr - zn.fr) * k;
    if (k < 1) return;
    zn.stage++;
    zn.shrinking = false;
    if (zn.stage < ZONE.length) {
        zn.until = t + ZONE[zn.stage][0];
        zn.dps = ZONE[zn.stage][3];
        nextZoneTarget(world);
    }
}

export const outsideZone = (zn, p) => Math.hypot(p.x - zn.x, p.z - zn.z) > zn.r;

// Outside the circle: damage in half-second chunks.
function zoneDamage(world, p) {
    if (world.zone.off || !outsideZone(world.zone, p)) { p.zoneAt = 0; return; }
    if (!p.zoneAt) p.zoneAt = world.time + 0.5;
    if (world.time < p.zoneAt) return;
    p.zoneAt = world.time + 0.5;
    const dmg = Math.max(1, Math.round(world.zone.dps * 0.5));
    p.hp -= dmg;
    world.events.push({ t: 'hit', by: 0, tgt: p.id, dmg, hs: 0 });
    if (p.hp <= 0) killPlayer(world, p, null, 'zone', false);
}

// Walking over loot takes it: a new weapon, ammo for one you have, or a med kit when hurt.
function lootPickup(world, p) {
    for (const l of world.loot) {
        if (l.taken || Math.hypot(p.x - l.x, p.z - l.z) > BR.pickup || Math.abs(p.y - l.y) > 1.5) continue;
        if (l.kind === 'med') {
            if (p.hp >= 100) continue;
            p.hp = Math.min(100, p.hp + BR.med);
        } else {
            const W = world.weapons[l.kind], own = p.inv.find((w) => w.id === l.kind);
            if (own && own.reserve >= W.reserve) continue;
            if (own) own.reserve = W.reserve;
            else p.inv.push({ id: l.kind, mag: W.mag, reserve: W.reserve });
        }
        l.taken = true;
        world.events.push({ t: 'loot', by: p.id, id: l.id, kind: l.kind, slot: p.inv.findIndex((w) => w.id === l.kind) });
    }
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

// True when the weapon in hand has a scope and is ready (not reloading or being drawn).
export function canAim(world, p) {
    const cur = p.inv && p.inv[p.slot], W = cur && world.weapons[cur.id];
    return !!(W && W.scope) && p.alive && !p.reloadUntil && world.time >= p.switchUntil;
}

// What the player's input really does this tick: no scope without one, frozen while buying,
// rooted while planting or defusing. The client predicts with the same function.
export function effectiveInput(world, p, inp) {
    const rd = world.round;
    const out = inp.aim && !canAim(world, p) ? { ...inp, aim: false } : inp;
    if (!isBomb(world) || !rd) return out;
    if (rd.phase === 'buy' || (inp.use && actKind(world, p))) return { ...out, mx: 0, mz: 0, jump: false, fire: false, aim: false };
    return out;
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
        Object.assign(world.bomb, { x: s[0], y: s[3] ?? 0, z: s[1] });
    }
    world.events.push({ t: 'round', phase: 'buy', n, att: world.att, sc: [world.score.t, world.score.ct], half: fresh && n > 1 });
}

function autoBuy(world, p) {
    if (p.money >= world.weapons.sniper.price + 1000 && Math.random() < 0.25) buyItem(world, p, 'sniper');
    else if (p.money >= world.weapons.rifle.price) buyItem(world, p, 'rifle');
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
    const tw = rayBoxes(world.boxes, o, d, max);
    if (tw < max) best = { t: tw, player: null, head: false, wall: true };
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
    return rayBoxes(boxes, a, d, len, true) === Infinity;
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
