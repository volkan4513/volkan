// Bots. Each bot feels its way along whatever map it is on, using the same ground and wall queries
// the physics uses. A fan of rays is walked forward in 2 m steps; a ray ends where the ground
// disappears or jumps (map edge, cliff, steep bank), where a wall or another car is, or (on maps
// that have one) where the road ends. The bot steers toward the most open direction and picks its
// speed from how much room there is in front. If it gets stuck it reverses out.
//
// On a map with a track (race.js) the rays also prefer the way the road goes, a point a little
// further along the line, and the bot brakes in time for the corners it can see coming on the line.
// Without one they prefer straight ahead. A bot that keeps getting stuck on a track map is put back
// on the line where it was, the way R does it for the player.
import { groundNear, placeVehicle } from './vehicle.js';
import { raceAt } from './race.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const RAYS = [-0.9, -0.6, -0.35, -0.15, 0, 0.15, 0.35, 0.6, 0.9];   // radians off the nose (+ = left)
const STEP = 2;
const THINK = 0.1;   // seconds between looks; steering is smoothed in between
const CORNER_FRAC = 0.74;   // share of the car's cornering grip a bot plans on
const BRAKE_FRAC = 0.5;     // share of its braking a bot plans on
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const BOT_NAMES = ['Ace', 'Blitz', 'Comet', 'Dash', 'Echo', 'Flux', 'Gale'];

export function createBrain(seed) {
    return {
        t: Math.random() * THINK,
        steer: 0, target: 0, want: 10,
        stuck: 0, backing: 0, backSteer: 0, commit: 0, seg: -1, fails: [], clock: 0,
        skill: 0.72 + (seed % 4) * 0.05,   // share of the car's top speed it will use: a spread, so they don't drive as a train
        topSpeed: null,                    // m/s: an absolute cap instead, if set
        lane: ((seed % 5) - 2) * 0.35,     // metres off the racing line each one prefers
        bias: ((seed % 5) - 2) * 0.02,     // and a hair of steering preference
        rubber: 1,                         // speed factor from the game: more when behind the player, less when far ahead
        pass: 0, passT: 0, extra: 0,       // overtaking: side (+ left), time left, current sideways shift (m)
    };
}

// How far a ray gets before it's blocked.
function feel(v, map, others, angle, len) {
    const d = v.drive, dir = d.yaw + angle, fx = Math.sin(dir), fz = Math.cos(dir);
    const nose = v.car.size.z / 2;
    let y = v.y, x = d.x + Math.sin(d.yaw) * nose, z = d.z + Math.cos(d.yaw) * nose;
    for (let s = STEP; s <= len; s += STEP) {
        x += fx * STEP;
        z += fz * STEP;
        const g = groundNear(map, x, z, y);
        if (g === null || map.offRoad(x, z)) return s - STEP;
        if (map.walls && map.walls.pushCircle(x, z, 1.1, g)) return s - STEP;
        for (const o of others) {
            if ((o.x - x) ** 2 + (o.z - z) ** 2 < 9 && Math.abs(o.y - g) < 2) return s - STEP;
        }
        y = g;
    }
    return len;
}

export function botInput(v, brain, map, others, dt) {
    const d = v.drive;
    brain.t -= dt;
    brain.clock += dt;
    if (brain.t <= 0) {
        brain.t = THINK;
        const len = clamp(14 + Math.abs(d.speed) * 1.6, 14, 70);
        const tune = v.tune, top = (brain.topSpeed ?? tune.maxSpeed * brain.skill) * brain.rubber;
        const traffic = watchTraffic(v, brain, others, top);
        const road = map.track ? followTrack(v, brain, map.track, tune, brain.lane + brain.extra) : null;
        const aim = road ? road.aim : 0, pull = road ? 30 : 10;
        let best = 0, bestScore = -Infinity, bestFree = 0, ahead = len;
        for (const a of RAYS) {
            const free = feel(v, map, others, a + brain.bias, len);
            if (a === 0) ahead = free;
            const score = free - Math.abs(a + brain.bias - aim) * pull;
            if (score > bestScore) { bestScore = score; best = a + brain.bias; bestFree = free; }
        }
        brain.target = clamp(-best / 0.55, -1, 1);   // steer input: + is right, ray angles + are left
        // speed for the way it's going (so it commits to passing a slow car), but no faster than
        // the room straight ahead allows plus some, since it still has to turn into the gap
        brain.want = clamp(Math.min(bestFree * 0.55, ahead * 0.55 + 8, road ? road.speed * (1 + (brain.rubber - 1) * 0.6) : Infinity, traffic), 6, top);
        // Not moving while trying to: back out, turning the other way, then pull away on full lock.
        // With a track, "the way" is where the road goes; nose-first into a bank on a hairpin the
        // rays can't tell which way round to turn.
        if (!brain.backing && !brain.commit && Math.abs(d.speed) < 1.2) brain.stuck += THINK; else brain.stuck = 0;
        if (brain.stuck > 1.2 && road && rescue(v, brain, map)) return botInput(v, brain, map, others, dt);
        if (brain.stuck > 1.2) {
            const want = road ? -Math.sign(road.aim || 1) : brain.target;   // steer input, + is right
            brain.backing = 1.4;
            brain.backSteer = want >= 0 ? -1 : 1;
            brain.commit = road ? 0.8 : 0;
            brain.stuck = 0;
        }
    }
    if (brain.backing > 0) {
        brain.backing = Math.max(0, brain.backing - dt);   // exactly 0 when done, so the stuck check runs again
        return { throttle: 0, brake: 1, steer: brain.backSteer, handbrake: false, analog: true };
    }
    if (brain.commit > 0) {
        brain.commit = Math.max(0, brain.commit - dt);
        brain.steer = -brain.backSteer;
        return { throttle: 0.6, brake: 0, steer: brain.steer, handbrake: false, analog: true };
    }
    brain.steer += (brain.target - brain.steer) * Math.min(1, dt * 8);
    const speed = d.speed;
    return {
        throttle: speed < brain.want ? 1 : 0,
        brake: speed > brain.want + 4 ? 1 : 0,
        steer: brain.steer,
        handbrake: false,
        analog: true,
    };
}

// Third time stuck in 20 s: put the bot back on the line, pointing down the road. Returns true if it did.
function rescue(v, brain, map) {
    brain.fails = brain.fails.filter((t) => brain.clock - t < 20);
    brain.fails.push(brain.clock);
    if (brain.fails.length < 3) return false;
    const d = v.drive, track = map.track;
    const p = track.at(track.project(d.x, v.y, d.z, brain.seg).s);
    placeVehicle(v, map, { x: p.x, z: p.z, yaw: p.yaw, y: map.groundAt(p.x, p.z, p.y, 2.5) ?? p.y });
    Object.assign(brain, { fails: [], stuck: 0, backing: 0, commit: 0, steer: 0, t: 0 });
    return true;
}

// Which way to head to follow the racing line (radians off the nose, + = left, aimed at a point
// further along it, shifted sideways by `shift` metres) and how fast the bot can go and still make
// every corner in the next 80 m, with this car's grip and brakes.
function followTrack(v, brain, track, tune, shift) {
    const d = v.drive, speed = Math.abs(d.speed);
    const p = track.project(d.x, v.y, d.z, brain.seg);
    brain.seg = p.seg;
    const to = raceAt(track, p.s + clamp(10 + speed * 0.7, 10, 34));
    const tx = to.x + Math.cos(to.yaw) * shift, tz = to.z - Math.sin(to.yaw) * shift;
    const aim = clamp(wrap(Math.atan2(tx - d.x, tz - d.z) - d.yaw), -1.2, 1.2);
    const cornerG = tune.maxLat * CORNER_FRAC, brakePlan = tune.brake * BRAKE_FRAC;
    let limit = Infinity;
    for (const k of [6, 18, 32, 50, 80]) {
        const turn = Math.abs(wrap(raceAt(track, p.s + k + 10).yaw - raceAt(track, p.s + k - 10).yaw));
        const corner = Math.sqrt(cornerG * (20 / Math.max(turn, 1e-3)));   // v = sqrt(a r), r = arc / angle
        limit = Math.min(limit, Math.sqrt(corner * corner + 2 * brakePlan * k));
    }
    return { aim, speed: limit };
}

// Other cars on the road ahead: don't drive into the back of one (follow at its speed), and when
// this car is quicker, pull out and go round it. Sets brain.extra (the sideways shift that
// followTrack aims for) and returns a speed cap.
function watchTraffic(v, brain, others, top) {
    const d = v.drive, sin = Math.sin(d.yaw), cos = Math.cos(d.yaw);
    let cap = Infinity, ahead = null, alongside = false;
    for (const o of others) {
        if (Math.abs(o.y - v.y) > 3) continue;
        const dx = o.x - d.x, dz = o.z - d.z, f = dx * sin + dz * cos, l = dx * cos - dz * sin;   // + f ahead, + l left
        if (f > 1.5 && f < 32 && Math.abs(l) < 2.8 && (!ahead || f < ahead.f)) ahead = { f, l, speed: o.speed ?? d.speed * 0.6 };
        if (f > -6 && f <= 1.5 && Math.abs(l) < 3.4) alongside = true;
    }
    if (ahead) {
        // close behind a slower car: slow to its pace, unless there is room to go round
        if (ahead.f < 16) cap = ahead.speed * 0.97 + Math.max(0, ahead.f - 8) * 0.7;
        if (top > ahead.speed + 1.5 && ahead.f < 24) {
            if (!brain.pass) brain.pass = Math.abs(ahead.l) < 0.4 ? (brain.lane >= 0 ? 1 : -1) : ahead.l > 0 ? -1 : 1;
            brain.passT = 1.1;
        }
    } else if (alongside && brain.pass) brain.passT = 1.1;   // still level: hold the line out
    else brain.passT -= THINK;
    if (brain.passT <= 0) brain.pass = 0;
    if (brain.pass && ahead && ahead.f < 9 && Math.abs(ahead.l) < 1.6) cap = Math.min(cap, ahead.speed * 0.97);   // not through the gap yet
    if (brain.pass && alongside) cap = Infinity;
    brain.extra += ((brain.pass ? brain.pass * 3.4 : 0) - brain.extra) * 0.35;
    return cap;
}

// Other cars as the obstacles and collision partners one vehicle sees.
export function obstacle(v) {
    return { x: v.drive.x, y: v.y, z: v.drive.z, yaw: v.drive.yaw, size: v.car.size, speed: v.drive.speed };
}

