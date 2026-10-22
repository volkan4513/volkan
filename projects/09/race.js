// Races: tracks, lap counting and positions. No DOM and no networking in here.
//
// A track is the middle of the road in race order. On a circuit it starts at the start/finish line;
// on a sprint it starts behind the grid and ends at the finish. Projecting a car onto it says how
// far along the lap the car is, which gives lap counting, checkpoints, race positions, the wrong-way
// warning, the starting grid and the bots' sense of where the road goes.
//
// Checkpoints are evenly spaced gates along the line that must be passed in order, so a lap only
// counts if the car went all the way round (no reversing over the line, no short cuts across the
// infield that skip a gate).

const SPACING = 4;          // metres between resampled points
const WINDOW = 15;          // points searched either side of the last match (60 m)
const LOST = 20;            // further than this from the local match: search the whole line
const GATE_EVERY = 150;     // metres between checkpoints (about)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// def: { points: flat [x, y, z, ...], closed? = true }
export function createTrack(def) {
    const closed = def.closed !== false;
    const src = [];
    for (let i = 0; i + 2 < def.points.length; i += 3) src.push([def.points[i], def.points[i + 1], def.points[i + 2]]);
    if (closed) src.push(src[0]);

    // resample to even spacing, so a point index is a distance
    let total = 0;
    const cum = [0];
    for (let i = 1; i < src.length; i++) cum.push((total += Math.hypot(src[i][0] - src[i - 1][0], src[i][2] - src[i - 1][2])));
    const n = Math.max(2, Math.round(total / SPACING)), step = total / n;
    const count = closed ? n : n + 1;
    const xs = new Float32Array(count), ys = new Float32Array(count), zs = new Float32Array(count);
    for (let k = 0, j = 0; k < count; k++) {
        const s = k * step;
        while (j < src.length - 2 && cum[j + 1] < s) j++;
        const t = clamp((s - cum[j]) / (cum[j + 1] - cum[j] || 1), 0, 1);
        xs[k] = src[j][0] + (src[j + 1][0] - src[j][0]) * t;
        ys[k] = src[j][1] + (src[j + 1][1] - src[j][1]) * t;
        zs[k] = src[j][2] + (src[j + 1][2] - src[j][2]) * t;
    }
    const segs = closed ? count : count - 1;
    const next = (i) => (closed ? (i + 1) % count : Math.min(i + 1, count - 1));

    // Nearest point on the line to (x, z) among segments [from, to]. Height counts too, but only
    // beyond a couple of metres, so a road passing over or under another one isn't mistaken for it.
    function nearest(x, y, z, from, to) {
        let best = Infinity, bi = 0, bt = 0;
        for (let k = from; k <= to; k++) {
            const i = closed ? ((k % segs) + segs) % segs : clamp(k, 0, segs - 1), j = next(i);
            const dx = xs[j] - xs[i], dz = zs[j] - zs[i];
            const t = clamp(((x - xs[i]) * dx + (z - zs[i]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
            const qx = xs[i] + dx * t - x, qz = zs[i] + dz * t - z;
            const dy = y === undefined ? 0 : Math.max(0, Math.abs(ys[i] + (ys[j] - ys[i]) * t - y) - 2.5);
            const d = qx * qx + qz * qz + dy * dy * 16;
            if (d < best) { best = d; bi = i; bt = t; }
        }
        return { seg: bi, t: bt };
    }

    const track = {
        closed, length: total, step, count, xs, ys, zs,
        gates: Math.max(4, Math.round(total / GATE_EVERY)),
        // -> { s, seg, dist (sideways from the line), side (+ = left of the line) }
        project(x, y, z, hint = -1) {
            let r = hint >= 0 ? nearest(x, y, z, hint - WINDOW, hint + WINDOW) : null;
            let out = r && measure(r);
            if (!out || out.dist > LOST) out = measure(nearest(x, y, z, 0, segs - 1));
            return out;

            function measure({ seg, t }) {
                const j = next(seg), dx = xs[j] - xs[seg], dz = zs[j] - zs[seg], len = Math.hypot(dx, dz) || 1;
                const side = ((x - xs[seg]) * dz - (z - zs[seg]) * dx) / len;   // + = left of travel
                const px = xs[seg] + dx * t, pz = zs[seg] + dz * t;
                return { s: (seg + t) * step, seg, dist: Math.hypot(x - px, z - pz), side };
            }
        },
        // Position and heading at distance s along the line (wraps on a circuit).
        at(s, out = {}) {
            s = closed ? ((s % total) + total) % total : clamp(s, 0, total);
            const f = s / step, i = Math.min(Math.floor(f), segs - 1), j = next(i), t = f - i;
            out.x = xs[i] + (xs[j] - xs[i]) * t;
            out.y = ys[i] + (ys[j] - ys[i]) * t;
            out.z = zs[i] + (zs[j] - zs[i]) * t;
            out.yaw = Math.atan2(xs[j] - xs[i], zs[j] - zs[i]);
            return out;
        },
    };
    return track;
}

// ---------- racing line ----------
// The centre line is where the road goes; a driver takes a smoother path through it, wide into a
// corner, clipping the inside, wide out. buildRacingLine finds each point's room to the left and
// right (clear(x, z, y) says whether a car fits there), then relaxes the line toward a straight
// path between its neighbours, never closer to either edge than the margin. The result is a lateral
// offset (m, + = left) per point; raceAt gives the position and heading on the line.
export function buildRacingLine(track, clear, maxOff = 6, halfCar = 1.0, margin = 1.4) {
    const n = track.count, closed = track.closed, { xs, ys, zs } = track;
    const prev = (i) => (closed ? (i + n - 1) % n : Math.max(0, i - 1)), next = (i) => (closed ? (i + 1) % n : Math.min(n - 1, i + 1));
    const nx = new Float32Array(n), nz = new Float32Array(n), lo = new Float32Array(n), hi = new Float32Array(n), off = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const tx = xs[next(i)] - xs[prev(i)], tz = zs[next(i)] - zs[prev(i)], l = Math.hypot(tx, tz) || 1;
        nx[i] = tz / l;    // left of travel: heading is (sin yaw, cos yaw), left is (cos yaw, -sin yaw)
        nz[i] = -tx / l;
        const room = (side) => {
            let d = 0;
            while (d < 14 && clear(xs[i] + nx[i] * side * (d + 0.75), zs[i] + nz[i] * side * (d + 0.75), ys[i])) d += 0.75;
            return d;
        };
        const left = room(1), right = room(-1), keep = halfCar + margin;
        hi[i] = clamp(left - keep, 0, maxOff);
        lo[i] = -clamp(right - keep, 0, maxOff);
    }
    const px = (i) => xs[i] + nx[i] * off[i], pz = (i) => zs[i] + nz[i] * off[i];
    for (let pass = 0; pass < 400; pass++) {
        for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
            const p = prev(i), q = next(i);
            const target = ((px(p) + px(q)) / 2 - xs[i]) * nx[i] + ((pz(p) + pz(q)) / 2 - zs[i]) * nz[i];
            off[i] = clamp(off[i] + 0.6 * (target - off[i]), lo[i], hi[i]);
        }
    }
    track.race = { off, lo, hi };
    return track.race;
}

// Position and heading on the racing line at distance s (the centre line if there isn't one).
export function raceAt(track, s, out = {}) {
    const c = track.at(s, out);
    if (!track.race) return c;
    const place = (d, o) => {
        const a = track.at(d, o), f = (track.closed ? ((d % track.length) + track.length) % track.length : clamp(d, 0, track.length)) / track.step;
        const i = Math.min(Math.floor(f), track.count - 1), j = track.closed ? (i + 1) % track.count : Math.min(i + 1, track.count - 1), t = f - i;
        const off = track.race.off[i] + (track.race.off[j] - track.race.off[i]) * t;
        o.x = a.x + Math.cos(a.yaw) * off;
        o.z = a.z - Math.sin(a.yaw) * off;
        o.yaw = a.yaw;
        return o;
    };
    const here = place(s, out), a = place(s - 2, {}), b = place(s + 2, {});
    here.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    return here;
}

// Starting grid: two abreast, 8 m between rows, left lane first. On a circuit the front row is
// just behind the line; on a sprint the grid sits at the start of the line, with room for 8 rows.
export const GRID_ROWS = 8;
export function gridPose(track, map, i) {
    const row = Math.floor(i / 2), side = i % 2 ? -1 : 1;
    const s = track.closed ? track.length - 7 - row * 8 : 6 + (GRID_ROWS - 1 - row) * 8;
    const p = track.at(s), lx = Math.cos(p.yaw), lz = -Math.sin(p.yaw);   // the car's left
    const x = p.x + lx * side * 2.8, z = p.z + lz * side * 2.8;
    const y = map.groundAt(x, z, p.y, 2.5) ?? map.groundAt(p.x, p.z, p.y, 2.5) ?? p.y;
    return { x, y, z, yaw: p.yaw };
}

// ---------- one car's progress ----------
// lap counts line crossings on a circuit (0 while still behind it on the grid); a sprint is lap 1
// throughout. next is the gate to pass next (1..gates; gate `gates` is the line or the finish).
export function createRunner(track) {
    return {
        lap: track.closed ? 0 : 1, next: track.closed ? track.gates : 1, seg: -1, s: 0, prog: 0,
        lapStart: 0, lapTimes: [], best: 0, finish: 0, wrongT: 0, wrong: false,
    };
}

// Advance a runner for a car at (x, y, z) heading yaw, at race time t (seconds since the start).
// Returns 'lap' when a lap is completed, 'finish' when the race is, otherwise null.
// laps = 0 is free roam: laps are timed but the race never ends.
export function stepRunner(r, track, car, t, dt, laps) {
    const p = track.project(car.x, car.y, car.z, r.seg);
    r.seg = p.seg;
    r.s = p.s;
    const L = track.length, N = track.gates;
    const gate = (r.next / N) * L;
    let s = p.s;
    if (track.closed) {
        // unwrap around the middle of the stretch before the next gate, so crossing the line in
        // either direction keeps progress continuous
        const ref = gate - L / (2 * N);
        s += L * Math.round((ref - s) / L);
    }
    let event = null;
    if (!r.finish && s >= gate) {
        if (r.next < N) r.next++;
        else if (!track.closed) {
            r.lapTimes.push(t);
            r.best = t;
            event = finish(r, t);
        }
        else {
            // the line: the first crossing starts lap 1 (timed from the start lights), later ones complete a lap
            if (r.lap >= 1) {
                const lapTime = t - r.lapStart;
                r.lapTimes.push(lapTime);
                if (!r.best || lapTime < r.best) r.best = lapTime;
                event = 'lap';
            }
            if (r.lap >= 1 || !laps) r.lapStart = t;   // free roam: the clock starts at the line
            r.lap++;
            r.next = 1;
            s -= L;
            if (laps && r.lap > laps) event = finish(r, t);
        }
    }
    r.prog = r.finish ? Infinity : track.closed ? (r.lap - 1) * L + s : s;

    // wrong way: pointing back down the road while moving, for a moment
    const a = track.at(p.s), dot = Math.sin(car.yaw) * Math.sin(a.yaw) + Math.cos(car.yaw) * Math.cos(a.yaw);
    r.wrongT = dot < -0.4 && Math.abs(car.speed) > 3 ? r.wrongT + dt : Math.max(0, r.wrongT - dt * 2);
    r.wrong = r.wrongT > 1;
    return event;
}

function finish(r, t) {
    r.finish = t;
    return 'finish';
}

// Race order: finishers by time, then everyone else by how far round they are.
export function rank(entries) {
    return [...entries].sort((a, b) => (a.finish && b.finish ? a.finish - b.finish : a.finish ? -1 : b.finish ? 1 : b.prog - a.prog));
}

export function formatTime(t) {
    if (!(t > 0)) return '-:--.---';
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
