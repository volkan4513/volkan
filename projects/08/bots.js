// Bot AI. Runs only where the world sim runs (Free Area, or the host tab).
// A bot is an ordinary player in the sim; this file just produces its input
// each tick, the same shape a human's keyboard or touch input has.
import { TICK, MOVE, ZONE, playerHeight, eyeHeight, clearLine, isBomb, isBR, sameSide, actKind, outsideZone } from './sim.js';

const DIFFICULTY = {
    easy:   { react: 0.65, turn: 3.5, err: 0.05,  fov: 1.6, burst: 0.25, rest: 0.5,  strafe: false, head: 0,    engage: 22 },
    normal: { react: 0.38, turn: 7,   err: 0.028, fov: 2.0, burst: 0.35, rest: 0.35, strafe: true,  head: 0.15, engage: 35 },
    hard:   { react: 0.2,  turn: 12,  err: 0.014, fov: 2.4, burst: 0.5,  rest: 0.25, strafe: true,  head: 0.35, engage: 50 },
};

export const BOT_NAMES = ['Pixel', 'Crate', 'Vertex', 'Bolt', 'Ink', 'Moss', 'Rivet', 'Tofu', 'Static', 'Gizmo', 'Nacho', 'Pebble', 'Sprocket', 'Wedge'];

// ---------- waypoint graph ----------
// Waypoints are [x, z] or [x, z, y] in map.json. Without y, height comes from the floor under them, and
// two points are linked when a player-sized line between them is clear.
export function buildGraph(map) {
    const nodes = map.waypoints.map(([x, z, y], i) => ({ i, x, z, y: y ?? groundY(map.boxes, x, z), links: [] }));
    for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
            const A = nodes[a], B = nodes[b];
            if (Math.hypot(A.x - B.x, A.z - B.z) < 24 && walkable(map.boxes, A, B)) {
                A.links.push(B);
                B.links.push(A);
            }
        }
    }
    return nodes;
}

function groundY(boxes, x, z) {
    let y = 0;
    for (const b of boxes) {
        if (x > b[0] && x < b[3] && z > b[2] && z < b[5] && b[4] <= 1.5) y = Math.max(y, b[4]);
    }
    return y;
}

function walkable(boxes, A, B) {
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    const px = -dz / len * 0.45, pz = dx / len * 0.45;    // side offset: a bit more than the body half width
    for (const side of [-1, 0, 1]) {
        for (const h of [0.55, 1.6]) {
            const a = [A.x + px * side, A.y + h, A.z + pz * side];
            const b = [B.x + px * side, B.y + h, B.z + pz * side];
            if (!clearLine(boxes, a, b)) return false;
        }
    }
    return true;
}

function nearestNode(graph, boxes, x, y, z) {
    let best = null, bestD = Infinity;
    for (const n of graph) {
        const d = Math.hypot(n.x - x, (n.y - y) * 3, n.z - z);
        if (d < bestD && clearLine(boxes, [x, y + 1, z], [n.x, n.y + 1, n.z])) { bestD = d; best = n; }
    }
    if (best) return best;
    for (const n of graph) {
        const d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = n; }
    }
    return best;
}

function findPath(start, goal) {
    const open = new Set([start]);
    const from = new Map(), g = new Map([[start, 0]]);
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
    const f = new Map([[start, h(start)]]);
    while (open.size) {
        let cur = null;
        for (const n of open) if (!cur || f.get(n) < f.get(cur)) cur = n;
        if (cur === goal) {
            const path = [cur];
            while (from.has(path[0])) path.unshift(from.get(path[0]));
            return path;
        }
        open.delete(cur);
        for (const nb of cur.links) {
            const cost = g.get(cur) + Math.hypot(nb.x - cur.x, nb.z - cur.z);
            if (cost < (g.has(nb) ? g.get(nb) : Infinity)) {
                from.set(nb, cur);
                g.set(nb, cost);
                f.set(nb, cost + h(nb));
                open.add(nb);
            }
        }
    }
    return [goal];
}

// ---------- brain ----------
export function createBrain(difficulty = 'normal') {
    return {
        d: DIFFICULTY[difficulty] || DIFFICULTY.normal,
        path: [], target: null, seenSince: 0, lastSeen: null,
        err: [0, 0], errAt: 0, aimHead: false,
        strafe: 1, strafeAt: 0,
        burstUntil: 0, restUntil: 0,
        stuck: 0, lastX: 0, lastZ: 0,
        think: 0, wasAlive: false, wantSlot: 0,
        round: 0, goalPos: null, lootId: -1,
        chase: null, chaseAt: 0,                 // waypoint path toward a target behind a wall
        progN: null, progD: 0, progT: 0,         // progress toward the next waypoint
    };
}

const REACH = 0.7;      // a waypoint counts as reached this close: near enough to stay on the cleared line
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;

export function botInput(world, p, brain, graph) {
    const t = world.time, d = brain.d;
    const inp = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, use: false, aim: false, yaw: p.yaw, pitch: p.pitch, slot: null };

    if (!p.alive) {
        brain.wasAlive = false;
        return inp;
    }
    if (!brain.wasAlive) {
        // Fresh spawn: forget everything, pick a weapon (mostly rifle).
        Object.assign(brain, { wasAlive: true, path: [], target: null, lastSeen: null, stuck: 0, lastX: p.x, lastZ: p.z, goalPos: null, lootId: -1, chase: null });
        const r = Math.random(), pick = r < 0.65 ? 'rifle' : r < 0.85 ? 'shotgun' : 'sniper';
        brain.wantSlot = Math.max(0, p.inv.findIndex((w) => w.id === pick));
    }
    if (p.slot !== brain.wantSlot) inp.slot = brain.wantSlot;
    const rn = world.round ? world.round.n : 0;
    if (brain.round !== rn) {
        // New round: drop the old plan.
        Object.assign(brain, { round: rn, path: [], target: null, lastSeen: null, goalPos: null });
    }

    if (t >= brain.think) {
        brain.think = t + 0.1;
        perceive(world, p, brain);
        if (world.zone) brThink(world, p, brain);
    }

    const cur = p.inv[p.slot];
    const W = world.weapons[cur.id];
    let lookYaw = p.yaw, lookPitch = 0;
    let wx = 0, wz = 0;   // wanted move direction in world space
    const tgt = brain.target;

    if (tgt) {
        const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
        if (t >= brain.errAt) {
            brain.errAt = t + 0.35;
            // Aim settles the longer the bot tracks the same target.
            const settle = Math.max(0.35, 1 - (t - brain.seenSince) / 1.5);
            const e = d.err * settle * (0.6 + Math.random() * 0.8);
            brain.err = [gauss() * e, gauss() * e * 0.6];
            brain.aimHead = Math.random() < d.head;
        }
        const aimY = tgt.y + playerHeight(tgt) - (brain.aimHead ? 0.18 : 0.75);
        const dy = aimY - (p.y + eyeHeight(p));
        lookYaw = Math.atan2(-dx, -dz) + brain.err[0];
        lookPitch = Math.atan2(dy, dist) + brain.err[1];

        const onTarget = Math.abs(wrap(lookYaw - p.yaw)) < 0.05 + 0.4 / Math.max(dist, 1);
        // Scope in once the target is settled; the sniper is hopeless without it.
        if (W.scope && t - brain.seenSince >= d.react * 0.6) inp.aim = W.scope.type === 'sniper' || dist > 12;
        if (t - brain.seenSince >= d.react && onTarget && dist < W.range) {
            if (W.auto) {
                if (t >= brain.restUntil && t >= brain.burstUntil) {
                    brain.burstUntil = t + d.burst;
                    brain.restUntil = brain.burstUntil + d.rest;
                }
                inp.fire = t < brain.burstUntil;
            } else {
                inp.fire = world.tick % 10 < 5;   // tap the trigger
            }
        }

        const sx = -dz / (dist || 1), sz = dx / (dist || 1);   // sideways
        if (p.hp < 35) {
            wx = -dx / (dist || 1) + sx * brain.strafe * 0.5;
            wz = -dz / (dist || 1) + sz * brain.strafe * 0.5;
        } else if (dist > Math.min(d.engage, W.range * 0.7)) {
            [wx, wz] = chase(world, p, brain, graph, tgt);    // too far to hit reliably: close in
        } else if (inp.fire) {
            // Stand still while shooting: running spread is huge, same as for players.
        } else if (d.strafe) {
            if (t >= brain.strafeAt) {
                brain.strafe = -brain.strafe;
                brain.strafeAt = t + 0.35 + Math.random() * 0.6;
            }
            wx = sx * brain.strafe;
            wz = sz * brain.strafe;
        }
        if (cur.mag === 0) inp.reload = true;
    } else {
        if (isBomb(world) && actKind(world, p)) {
            inp.use = true;         // standing where the bomb can be planted or defused: hold E
        } else {
            if (!brain.path.length) plan(world, p, brain, graph);
            let n = brain.path[0];
            while (n && Math.hypot(n.x - p.x, n.z - p.z) < REACH) {
                brain.path.shift();
                if (brain.lastSeen && !brain.path.length) brain.lastSeen = null;
                n = brain.path[0];
            }
            // Path used up: walk the last stretch straight to the exact spot (bomb, site).
            const g = !n && brain.goalPos;
            if (g && Math.hypot(g[0] - p.x, g[1] - p.z) > 0.7) n = { x: g[0], z: g[1] };
            if (n) {
                // No progress toward this waypoint for 2 s (caught on a corner): hop and plan again.
                const dn = Math.hypot(n.x - p.x, n.z - p.z);
                if (n !== brain.progN || dn < brain.progD - 0.3) Object.assign(brain, { progN: n, progD: dn, progT: t });
                else if (t - brain.progT > 2) Object.assign(brain, { path: [], progN: null, goalPos: null }), inp.jump = true;
                const dx = n.x - p.x, dz = n.z - p.z, len = Math.hypot(dx, dz);
                wx = dx / len;
                wz = dz / len;
                lookYaw = Math.atan2(-dx, -dz);
            } else if (g) {
                brain.goalPos = null;    // arrived with nothing to do: pick a new spot next time
            }
        }
        if (cur.mag < world.weapons[cur.id].mag * 0.5) inp.reload = true;
    }

    // Turn toward the look target at a limited speed: this is most of what makes bots beatable.
    const maxTurn = d.turn * TICK;
    inp.yaw = p.yaw + clamp(wrap(lookYaw - p.yaw), -maxTurn, maxTurn);
    inp.pitch = p.pitch + clamp(lookPitch - p.pitch, -maxTurn, maxTurn);

    // World direction -> local strafe/forward for the chosen yaw.
    const len = Math.hypot(wx, wz);
    if (len > 0) {
        wx /= len;
        wz /= len;
        const s = Math.sin(inp.yaw), c = Math.cos(inp.yaw);
        inp.mz = -wx * s - wz * c;
        inp.mx = wx * c - wz * s;
    }

    // Stuck on a crate edge: jump, then give up on this path.
    const moved = Math.hypot(p.x - brain.lastX, p.z - brain.lastZ);
    brain.lastX = p.x;
    brain.lastZ = p.z;
    if (len > 0 && moved < MOVE.run * TICK * 0.15) brain.stuck += TICK;
    else brain.stuck = Math.max(0, brain.stuck - TICK);
    if (brain.stuck > 0.25) inp.jump = true;
    if (brain.stuck > 1.2) {
        brain.stuck = 0;
        brain.path = [];
    }
    return inp;
}

// Closing in on a target: straight at them when nothing is in the way, else along the waypoints.
function chase(world, p, brain, graph, tgt) {
    const dir = (x, z) => {
        const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
        return [dx / d, dz / d];
    };
    if (walkable(world.boxes, p, tgt)) {
        brain.chase = null;
        return dir(tgt.x, tgt.z);
    }
    if (!brain.chase || world.time >= brain.chaseAt) {
        brain.chaseAt = world.time + 1;
        const a = nearestNode(graph, world.boxes, p.x, p.y, p.z), b = nearestNode(graph, world.boxes, tgt.x, tgt.y, tgt.z);
        brain.chase = a && b ? findPath(a, b) : [];
    }
    while (brain.chase.length && Math.hypot(brain.chase[0].x - p.x, brain.chase[0].z - p.z) < REACH) brain.chase.shift();
    return brain.chase.length ? dir(brain.chase[0].x, brain.chase[0].z) : [0, 0];
}

function perceive(world, p, brain) {
    const t = world.time, d = brain.d;
    const eye = [p.x, p.y + eyeHeight(p), p.z];
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    let best = null, bestD = Infinity;
    // Battle royale with only a pistol: go loot rather than start long-range fights.
    const reach = world.zone && p.inv.length < 2 ? 14 : Infinity;

    for (const e of world.players) {
        if (!e.alive || sameSide(world, e, p)) continue;
        const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
        const hitByThem = e.id === p.lastHitBy && t - p.lastHitAt < 0.6;
        if (dist > reach && !hitByThem) continue;
        const inFov = (dx * fx + dz * fz) / (dist || 1) > Math.cos(d.fov / 2);
        if (!inFov && dist > 6 && !hitByThem) continue;
        const h = playerHeight(e);
        const seen = clearLine(world.boxes, eye, [e.x, e.y + h - 0.2, e.z])
            || clearLine(world.boxes, eye, [e.x, e.y + h * 0.5, e.z]);
        if (seen && dist < bestD) { bestD = dist; best = e; }
    }

    if (best) {
        if (best !== brain.target) brain.seenSince = t;
        brain.target = best;
        brain.lastSeen = { x: best.x, y: best.y, z: best.z };
        brain.path = [];
    } else if (brain.target) {
        brain.target = null;
        brain.path = [];   // re-plan toward where they were last seen
    }
}

function plan(world, p, brain, graph) {
    const start = nearestNode(graph, world.boxes, p.x, p.y, p.z);
    let goal;
    if (brain.lastSeen) {
        goal = nearestNode(graph, world.boxes, brain.lastSeen.x, brain.lastSeen.y, brain.lastSeen.z);
    } else if (world.zone) {
        const g = brGoal(world, p, brain);
        brain.goalPos = g;
        goal = nearestNode(graph, world.boxes, g[0], 0, g[1]);
    } else if (isBomb(world) && world.bomb && world.round) {
        const g = bombGoal(world, p);
        brain.goalPos = g;
        goal = nearestNode(graph, world.boxes, g[0], 0, g[1]);
    } else {
        // Wander, leaning toward the enemy's side of the map.
        const enemyTeam = p.team === 't' ? 'ct' : 't';
        const enemyZ = world.map.spawns[enemyTeam][0][1];
        const pool = Math.random() < 0.6 ? graph.filter((n) => Math.sign(n.z) === Math.sign(enemyZ)) : graph;
        goal = pool[Math.floor(Math.random() * pool.length)];
    }
    brain.path = start && goal ? findPath(start, goal) : [];
}

// Where a bomb-mode bot wants to be: attackers take the bomb to the chosen site and guard it,
// defenders hold a site and rush the bomb once it is planted.
function bombGoal(world, p) {
    const b = world.bomb, sites = world.map.sites;
    const inSite = (k) => {
        const r = sites[k], m = 2;
        return [r[0] + m + Math.random() * (r[2] - r[0] - m * 2), r[1] + m + Math.random() * (r[3] - r[1] - m * 2)];
    };
    if (p.team === world.att) {
        if (b.state === 'dropped') return [b.x, b.z];
        if (b.state === 'planted') {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 5;
            return [b.x + Math.cos(a) * r, b.z + Math.sin(a) * r];
        }
        return inSite(world.plan.site);
    }
    if (b.state === 'planted') return [b.x, b.z];
    return inSite(p.id % 2 ? 'A' : 'B');
}

// ---------- battle royale ----------
// The circle bots should be in: the next one once it is known, else the current one.
function safeCircle(zn) {
    return zn.stage < ZONE.length ? [zn.tx, zn.tz, zn.tr] : [zn.x, zn.z, zn.r];
}

// Checked every think: drop plans that lead out of the zone or to loot someone else took,
// and pick the weapon for the range.
function brThink(world, p, brain) {
    const zn = world.zone, [cx, cz, cr] = safeCircle(zn);
    const g = brain.goalPos;
    const goalSafe = g && Math.hypot(g[0] - cx, g[1] - cz) < Math.max(cr, 2);
    const lootGone = brain.lootId >= 0 && world.loot[brain.lootId].taken;
    if (!brain.target && ((g && !goalSafe) || (!g && outsideZone(zn, p)) || lootGone)) {
        brain.path = [];
        brain.goalPos = null;
        brain.lootId = -1;
        brain.lastSeen = null;
    }
    const has = (id) => p.inv.findIndex((w) => w.id === id);
    const dist = brain.target ? Math.hypot(brain.target.x - p.x, brain.target.z - p.z) : 20;
    const order = dist > 30 ? ['sniper', 'rifle', 'shotgun'] : dist < 10 ? ['shotgun', 'rifle', 'sniper'] : ['rifle', 'shotgun', 'sniper'];
    const best = order.map(has).find((i) => i >= 0);
    if (!brain.target || p.slot === has('pistol')) brain.wantSlot = best >= 0 ? best : Math.max(0, has('pistol'));
}

// Loot first (a weapon while holding only a pistol, a med kit when hurt), else a spot in the zone.
function brGoal(world, p, brain) {
    const [cx, cz, cr] = safeCircle(world.zone);
    const safe = (x, z) => Math.hypot(x - cx, z - cz) < Math.max(cr - 1.5, 1);
    const want = world.loot.filter((l) => !l.taken && safe(l.x, l.z)
        && (l.kind === 'med' ? p.hp < 70 : p.inv.length < 3 && !p.inv.some((w) => w.id === l.kind)));
    let best = null, bestD = 45;
    for (const l of want) {
        const d = Math.hypot(l.x - p.x, l.z - p.z);
        if (d < bestD) { bestD = d; best = l; }
    }
    brain.lootId = best ? best.id : -1;
    if (best) return [best.x, best.z];
    const spots = world.map.waypoints.filter(([x, z]) => safe(x, z));
    return spots.length ? spots[Math.floor(Math.random() * spots.length)] : [cx, cz];
}
