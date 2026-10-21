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
import { TUNING } from './drive.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const RAYS = [-0.9, -0.6, -0.35, -0.15, 0, 0.15, 0.35, 0.6, 0.9];   // radians off the nose (+ = left)
const STEP = 2;
const THINK = 0.1;   // seconds between looks; steering is smoothed in between
const CORNER_G = TUNING.maxLat * 0.7;   // m/s² of cornering a bot plans on
const BRAKE_PLAN = 9;                   // m/s² of braking a bot plans on (the car can do twice that)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const BOT_NAMES = ['Ace', 'Blitz', 'Comet', 'Dash', 'Echo', 'Flux', 'Gale'];

export function createBrain(seed) {
    return {
        t: Math.random() * THINK,
        steer: 0, target: 0, want: 10,
        stuck: 0, backing: 0, backSteer: 0, commit: 0, seg: -1, fails: [], clock: 0,
        topSpeed: 24 + (seed % 3) * 3,   // m/s: a little spread so they don't drive as a train
        bias: ((seed % 5) - 2) * 0.04,   // each one prefers a slightly different line
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
        const road = map.track ? followTrack(v, brain, map.track) : null;
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
        brain.want = clamp(Math.min(bestFree * 0.55, ahead * 0.55 + 8, road ? road.speed : Infinity), 6, brain.topSpeed);
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

// Which way the road goes from here (radians off the nose, + = left, aimed at a point further
// along the line) and how fast the bot can go and still make every corner in the next 80 m.
function followTrack(v, brain, track) {
    const d = v.drive, speed = Math.abs(d.speed);
    const p = track.project(d.x, v.y, d.z, brain.seg);
    brain.seg = p.seg;
    const to = track.at(p.s + clamp(10 + speed * 0.7, 10, 34));
    const aim = clamp(wrap(Math.atan2(to.x - d.x, to.z - d.z) - d.yaw), -1.2, 1.2);
    let limit = Infinity;
    for (const k of [6, 18, 32, 50, 80]) {
        const turn = Math.abs(wrap(track.at(p.s + k + 10).yaw - track.at(p.s + k - 10).yaw));
        const corner = Math.sqrt(CORNER_G * (20 / Math.max(turn, 1e-3)));   // v = sqrt(a r), r = arc / angle
        limit = Math.min(limit, Math.sqrt(corner * corner + 2 * BRAKE_PLAN * k));
    }
    return { aim, speed: limit };
}

// Other cars as the obstacles and collision partners one vehicle sees.
export function obstacle(v) {
    return { x: v.drive.x, y: v.y, z: v.drive.z, yaw: v.drive.yaw, size: v.car.size };
}

