// Free-play multiplayer session over net.js. Star topology: the host is the hub.
//
// Every player drives their own car locally (no input lag) and sends its state ~20 times a second.
// The host runs the bots, keeps the roster, and sends everyone one snapshot ~20 times a second
// with every other car in it. Remote cars are drawn ~110 ms in the past, between two snapshots.
// Cars only push themselves out of each other, so nobody waits on anybody.
//
// Races: the host starts them (race { id, laps, in: ms until the lights go green }; laps -1 is a sprint over the half route). Each player
// counts their own laps and reports them with their car state; the host ranks everyone, bots
// included, and sends the order out with every snapshot. Late joiners sit the race out.
//
// Messages (reliable unless marked fast):
//   client -> host  hello { name, car }      st { c: car, s: carState, r: [raceId, lap, prog, finishMs] }  (fast)
//   host -> client  welcome { id, map, max }  full {}  roster { list }  map { i }  race { id, laps, in }
//                   sn { cars: [[id, car, ...carState]], rk?: [[id, lap, finishMs, prog]] in race order }  (fast)
import { hostRoom, joinRoom, cleanCode, Interp, packCar } from './net.js';

const SEND_MS = 50;
export const HOST_ID = 1;
export const MAX_CHOICES = [4, 6, 8];

// hooks: {
//   me() -> { name, car, pose }                      this player's car (pose: x, y, z, yaw, ...)
//   bots() -> [{ id, name, car, pose }]              host only
//   mapIndex() -> i
//   myRace() -> [raceId, lap, prog, finishMs] | null   this player's race progress
//   standings() -> [[id, lap, finishMs, prog]] | null    host only: the current race order
//   onMap(i), onRace({ id, laps, in }), onRoster(list), onEnd(reason), onStatus(text)
// }
export function createSession(hooks) {
    const s = {
        role: 'solo', code: '', myId: HOST_ID, max: 4,
        links: new Map(),      // host: id -> Link; client: HOST_ID -> Link
        roster: [],            // [{ id, name, bot? }]
        carOf: new Map(),      // id -> car index, from the latest state
        interp: new Interp(110),
        room: null, sendT: 0, nextId: 2,
        standings: null,       // client: the host's latest race order
    };

    const status = (t) => hooks.onStatus && hooks.onStatus(t);

    // ---------- host ----------
    async function host(max) {
        await leave();
        s.max = max;
        status('Opening a room…');
        const room = await hostRoom(onLink);
        Object.assign(s, { role: 'host', code: room.code, myId: HOST_ID, room, nextId: 2 });
        rebuildRoster();
        status(`Room ${room.code} is open`);
        return room.code;
    }

    function onLink(link) {
        let id = 0;
        link.onmsg = (m) => {
            if (m.t === 'hello' && !id) {
                const humans = 1 + s.links.size;
                if (humans >= s.max) {
                    link.send({ t: 'full' });
                    setTimeout(() => link.close('full'), 500);
                    return;
                }
                id = s.nextId++;
                link.name = String(m.name || 'Player').slice(0, 12);
                s.links.set(id, link);
                s.carOf.set(id, m.car | 0);
                link.send({ t: 'welcome', id, map: hooks.mapIndex(), max: s.max });
                rebuildRoster();
            } else if (m.t === 'st' && id) {
                s.carOf.set(id, m.c | 0);
                s.interp.push(id, performance.now(), m.s);
                link.latest = m.s;
                link.race = Array.isArray(m.r) ? m.r : null;
            }
        };
        link.onclose = () => {
            if (!id) return;
            s.links.delete(id);
            s.interp.drop(id);
            s.carOf.delete(id);
            rebuildRoster();
        };
    }

    // Host: who's in the room, sent to everyone whenever it changes (players join, leave, bots change).
    function rebuildRoster() {
        if (s.role !== 'host') return;
        const me = hooks.me();
        s.roster = [{ id: HOST_ID, name: me.name }];
        for (const [id, link] of s.links) s.roster.push({ id, name: link.name });
        for (const b of hooks.bots()) s.roster.push({ id: b.id, name: b.name, bot: true });
        for (const link of s.links.values()) link.send({ t: 'roster', list: s.roster });
        hooks.onRoster && hooks.onRoster(s.roster);
    }

    function sendMap(i) {
        if (s.role === 'host') for (const link of s.links.values()) link.send({ t: 'map', i });
    }

    // Host: start a race for everyone. `inMs` is how long until the lights go green.
    function sendRace(id, laps, inMs) {
        if (s.role === 'host') for (const link of s.links.values()) link.send({ t: 'race', id, laps, in: inMs });
    }

    // ---------- client ----------
    async function join(code, name, car) {
        await leave();
        code = cleanCode(code);
        if (code.length !== 5) throw new Error('Room codes are 5 letters.');
        status(`Joining ${code}…`);
        const link = await joinRoom(code);
        Object.assign(s, { role: 'client', code });
        s.links.set(HOST_ID, link);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { link.close('timeout'); reject(new Error('The host did not answer.')); }, 8000);
            link.onmsg = (m) => {
                if (m.t === 'welcome') {
                    clearTimeout(timer);
                    s.myId = m.id;
                    s.max = m.max;
                    status(`In room ${code}`);
                    hooks.onMap(m.map);
                    resolve(m);
                } else if (m.t === 'full') {
                    clearTimeout(timer);
                    reject(new Error('That room is full.'));
                } else if (m.t === 'roster') {
                    s.roster = m.list;
                    const ids = new Set(m.list.map((p) => p.id));
                    for (const id of [...s.carOf.keys()]) if (!ids.has(id)) { s.carOf.delete(id); s.interp.drop(id); }
                    hooks.onRoster && hooks.onRoster(s.roster);
                } else if (m.t === 'map') {
                    hooks.onMap(m.i);
                } else if (m.t === 'race') {
                    // the message took about half a round trip to get here
                    hooks.onRace && hooks.onRace({ id: m.id | 0, laps: m.laps | 0, in: (Number(m.in) || 0) - link.rtt / 2 });
                } else if (m.t === 'sn') {
                    const now = performance.now();
                    for (const c of m.cars) {
                        if (c[0] === s.myId) continue;
                        s.carOf.set(c[0], c[1] | 0);
                        s.interp.push(c[0], now, c.slice(2));
                    }
                    s.standings = Array.isArray(m.rk) ? m.rk : null;
                }
            };
            link.onclose = (reason) => {
                clearTimeout(timer);
                const was = s.role === 'client';
                reset();
                if (was) hooks.onEnd && hooks.onEnd(reason === 'full' ? 'That room is full.' : 'Lost the connection to the host.');
                reject(new Error('The connection closed.'));
            };
            link.send({ t: 'hello', name, car });
        });
    }

    // ---------- both ----------
    function tick(now) {
        if (s.role === 'solo' || now - s.sendT < SEND_MS) return;
        s.sendT = now;
        const me = hooks.me();
        if (s.role === 'client') {
            const link = s.links.get(HOST_ID);
            if (link) link.send({ t: 'st', c: me.car, s: packCar(me.pose), r: hooks.myRace && hooks.myRace() }, true);
            return;
        }
        // host: one snapshot per client, everything except that client's own car
        const cars = [[HOST_ID, me.car, ...packCar(me.pose)]];
        for (const b of hooks.bots()) cars.push([b.id, b.car, ...packCar(b.pose)]);
        for (const [id, link] of s.links) if (link.latest) cars.push([id, s.carOf.get(id) | 0, ...link.latest]);
        const rk = hooks.standings && hooks.standings();
        for (const [id, link] of s.links) link.send({ t: 'sn', cars: cars.filter((c) => c[0] !== id), ...(rk && { rk }) }, true);
    }

    // Cars that arrive over the network, posed for `now`: [{ id, name, car, pose }].
    // The host sees its clients here; a client sees everyone else, bots included.
    const poses = new Map();
    function remotes(now) {
        const out = [];
        for (const [id, car] of s.carOf) {
            if (id === s.myId) continue;
            let p = poses.get(id);
            if (!p) poses.set(id, (p = {}));
            if (!s.interp.sample(id, now, p)) continue;
            const entry = s.roster.find((r) => r.id === id);
            out.push({ id, car, name: entry ? entry.name : '', bot: !!(entry && entry.bot), pose: p });
        }
        return out;
    }

    function reset() {
        for (const link of s.links.values()) { link.onclose = null; link.close('left'); }
        s.links.clear();
        s.carOf.clear();
        s.interp.clear();
        s.roster = [];
        s.standings = null;
        if (s.room) s.room.close();
        Object.assign(s, { role: 'solo', code: '', myId: HOST_ID, room: null });
    }

    async function leave() {
        if (s.role !== 'solo') reset();
    }

    return {
        get role() { return s.role; },
        get code() { return s.code; },
        get myId() { return s.myId; },
        get max() { return s.max; },
        get roster() { return s.roster; },
        get players() { return s.roster.filter((r) => !r.bot).length || 1; },
        get standings() { return s.standings; },
        // host: a client's latest race report [raceId, lap, prog, finishMs], or null
        raceOf: (id) => (s.links.get(id) && s.links.get(id).race) || null,
        host, join, leave, tick, remotes, sendMap, sendRace, rebuildRoster,
        rtt: () => { const l = s.links.get(HOST_ID); return l ? Math.round(l.rtt) : 0; },
    };
}
