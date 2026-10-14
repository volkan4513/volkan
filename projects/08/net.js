// Networking: WebRTC links through PeerJS (room code), wire format, input queue
// and snapshot interpolation. No DOM and no game rules in here.
//
// Each peer pair has two DataChannels:
//   rel  - ordered and reliable (PeerJS's own channel): hello, roster, events, heartbeat
//   fast - unordered, maxRetransmits 0: inputs (~30 Hz) and snapshots (~20 Hz)
// The joiner opens 'fast' itself once 'rel' is up. If 'fast' never opens, everything
// falls back to 'rel', so a broken fast channel only costs latency.
//
// Test knobs in the page URL: ?lag=120 delays everything this tab sends by that many ms,
// ?loss=5 drops that percent of 'fast' packets. DevTools throttling does not touch WebRTC.

const PEER_SRC = 'peerjs.min.js';       // PeerJS 1.5.4 (MIT), local copy
const ID_PREFIX = 'lpstrike-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0, 1
const params = new URLSearchParams(location.search);
const LAG = Math.max(0, Number(params.get('lag')) || 0);
const LOSS = Math.min(100, Math.max(0, Number(params.get('loss')) || 0));

export const HEARTBEAT_MS = 2000;
export const TIMEOUT_MS = 6000;
export const SIM_NET = { lag: LAG, loss: LOSS };
export const netStats = { out: 0, outBytes: 0, inn: 0, inBytes: 0 };

export const randomCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const cleanCode = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

let peerLoad = null;
function loadPeer() {
    if (!peerLoad) {
        peerLoad = new Promise((resolve, reject) => {
            if (window.Peer) return resolve(window.Peer);
            const s = document.createElement('script');
            s.src = PEER_SRC;
            s.onload = () => (window.Peer ? resolve(window.Peer) : reject(new Error('Networking library missing')));
            s.onerror = () => {
                peerLoad = null;
                reject(new Error('Could not load the networking library. Are you offline?'));
            };
            document.head.append(s);
        });
    }
    return peerLoad;
}

function openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
        const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
        const timer = setTimeout(() => {
            peer.destroy();
            reject(new Error('The signaling server is not answering. Try again, or check your connection.'));
        }, 10000);
        peer.on('open', () => { clearTimeout(timer); resolve(peer); });
        peer.on('error', (err) => { clearTimeout(timer); peer.destroy(); reject(err); });
    });
}

// One connected remote peer. Messages are plain objects; heartbeats are handled here.
export class Link {
    constructor(conn) {
        this.conn = conn;
        this.peer = null;           // set on the joiner so closing the link frees the PeerJS peer
        this.fast = null;
        this.rtt = 0;
        this.onmsg = null;          // (msg, viaFast)
        this.onclose = null;        // (reason)
        this.closed = false;
        this.lastRecv = performance.now();
        this.lastBeat = 0;
        conn.on('data', (d) => this.recv(d, false));
        conn.on('close', () => this.close('closed'));
        conn.on('error', () => this.close('error'));
        this.timer = setInterval(() => this.beat(), 500);
    }

    attachFast(ch) {
        this.fast = ch;
        ch.onmessage = (e) => this.recv(e.data, true);
    }

    beat() {
        const now = performance.now();
        if (now - this.lastRecv > TIMEOUT_MS) return this.close('timeout');
        if (now - this.lastBeat >= HEARTBEAT_MS) {
            this.lastBeat = now;
            this.send({ t: 'hb', ts: now });
        }
    }

    recv(data, viaFast) {
        if (this.closed || typeof data !== 'string') return;
        this.lastRecv = performance.now();
        netStats.inn++;
        netStats.inBytes += data.length;
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m.t === 'hb') return this.send({ t: 'hbr', ts: m.ts });
        if (m.t === 'hbr') {
            const rtt = this.lastRecv - m.ts;
            this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
            return;
        }
        if (this.onmsg) this.onmsg(m, viaFast);
    }

    // fast = true prefers the unreliable channel (inputs, snapshots).
    send(msg, fast = false) {
        if (this.closed) return;
        const s = JSON.stringify(msg);
        const ch = fast && this.fast && this.fast.readyState === 'open' ? this.fast : null;
        if (ch && LOSS && Math.random() * 100 < LOSS) return;
        netStats.out++;
        netStats.outBytes += s.length;
        const go = () => {
            if (this.closed) return;
            try { if (ch) ch.send(s); else this.conn.send(s); } catch { /* channel closing */ }
        };
        if (LAG) setTimeout(go, LAG + (ch ? Math.random() * LAG * 0.2 : 0));   // jitter only where reordering is allowed
        else go();
    }

    close(reason = 'closed') {
        if (this.closed) return;
        this.closed = true;
        clearInterval(this.timer);
        try { this.conn.close(); } catch { /* already gone */ }
        try { if (this.fast) this.fast.close(); } catch { /* already gone */ }
        if (this.peer) { try { this.peer.destroy(); } catch { /* already gone */ } }
        if (this.onclose) this.onclose(reason);
    }
}

// Host: register a room code with the signaling server and hand every connected peer to onLink.
export async function hostRoom(onLink) {
    const Peer = await loadPeer();
    let peer = null, code = '';
    for (let attempt = 0; attempt < 6 && !peer; attempt++) {
        code = randomCode();
        try {
            peer = await openPeer(Peer, ID_PREFIX + code);
        } catch (err) {
            if (err.type !== 'unavailable-id') throw err;
        }
    }
    if (!peer) throw new Error('Could not get a free room code. Try again.');

    peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* destroyed */ } });
    peer.on('error', () => { /* a failed joiner must not take the room down */ });
    peer.on('connection', (conn) => {
        let link = null, fast = null;
        const pc = conn.peerConnection;
        if (pc) {
            const orig = pc.ondatachannel;
            pc.ondatachannel = (e) => {
                if (e.channel.label !== 'fast') return orig && orig.call(pc, e);
                fast = e.channel;
                if (link) link.attachFast(fast);
            };
        }
        conn.on('open', () => {
            link = new Link(conn);
            if (fast) link.attachFast(fast);
            onLink(link);
        });
    });
    return { code, close: () => peer.destroy() };
}

// Joiner: resolves with a Link to the host, or rejects with a readable Error.
export async function joinRoom(code) {
    const Peer = await loadPeer();
    const peer = await openPeer(Peer);
    return new Promise((resolve, reject) => {
        const fail = (err) => {
            clearTimeout(timer);
            peer.destroy();
            reject(err);
        };
        const timer = setTimeout(() => fail(new Error('Could not reach the host. Strict firewalls and some mobile networks block direct connections.')), 15000);
        peer.on('error', (err) => fail(err.type === 'peer-unavailable' ? new Error('No room with that code.') : err));
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('error', fail);
        conn.on('open', () => {
            clearTimeout(timer);
            const link = new Link(conn);
            link.peer = peer;
            link.attachFast(conn.peerConnection.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
            resolve(link);
        });
    });
}

// ---------- wire format ----------
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
export { r2, r3 };

const BIT = { jump: 1, crouch: 2, walk: 4, fire: 8, reload: 16, use: 32, aim: 64 };

// Inputs are quantised before the client predicts with them, so client and host step identical numbers.
export function quantiseInput(inp, seq) {
    return {
        seq,
        mx: r2(inp.mx), mz: r2(inp.mz),
        jump: !!inp.jump, crouch: !!inp.crouch, walk: !!inp.walk, fire: !!inp.fire, reload: !!inp.reload, use: !!inp.use, aim: !!inp.aim,
        yaw: r3(inp.yaw), pitch: r3(inp.pitch), slot: inp.slot,
        view: inp.view == null ? null : Math.round(inp.view * 10) / 10,
    };
}

// The last few unacknowledged inputs ride along in every packet, so a lost packet costs nothing.
export function packInputs(cmds) {
    return {
        t: 'in',
        c: cmds.map((c) => [
            c.seq, c.mx, c.mz,
            (c.jump ? BIT.jump : 0) | (c.crouch ? BIT.crouch : 0) | (c.walk ? BIT.walk : 0) | (c.fire ? BIT.fire : 0) | (c.reload ? BIT.reload : 0) | (c.use ? BIT.use : 0) | (c.aim ? BIT.aim : 0),
            c.yaw, c.pitch, c.slot, c.view,
        ]),
    };
}

export function unpackInput(a) {
    const bits = a[3] | 0;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    return {
        seq: a[0] | 0,
        mx: Math.max(-1, Math.min(1, num(a[1]))), mz: Math.max(-1, Math.min(1, num(a[2]))),
        jump: !!(bits & BIT.jump), crouch: !!(bits & BIT.crouch), walk: !!(bits & BIT.walk),
        fire: !!(bits & BIT.fire), reload: !!(bits & BIT.reload), use: !!(bits & BIT.use), aim: !!(bits & BIT.aim),
        yaw: num(a[4]), pitch: num(a[5]), slot: a[6] | 0,
        view: Number.isFinite(a[7]) ? a[7] : null,     // host tick the client sees others at
    };
}

export const FLAG = { alive: 1, crouch: 2, reload: 4, shield: 8, ground: 16 };

// ---------- host side: one queue of client inputs per remote player ----------
export class InputQueue {
    constructor() {
        this.q = [];
        this.maxSeq = 0;
        this.ack = 0;
        this.last = null;
        this.starve = 0;
        this.low = 99;     // shallowest queue seen this window
        this.win = 0;
        this.drain = 0;    // extra inputs to skip, decided once per window
    }

    push(list) {
        for (const a of list) {
            const c = unpackInput(a);
            if (c.seq > this.maxSeq) {
                this.maxSeq = c.seq;
                this.q.push(c);
            }
        }
    }

    // One input per host tick, like a jitter buffer: bursts are played out, and only a backlog
    // that never drained below 2 for half a second is caught up, one extra input per tick.
    // A huge backlog (tab was hidden) collapses to the newest 3. Skipped inputs are merged,
    // so presses survive. Short gaps repeat the last input, and a long gap (link stalled)
    // stops movement and fire. A held plant/defuse survives gaps up to 1 s: a slow phone
    // sends in bursts, and a reset there means starting over.
    next() {
        this.low = Math.min(this.low, this.q.length);
        if (++this.win >= 30) {
            this.drain = Math.max(0, this.low - 2);
            this.low = 99;
            this.win = 0;
        }
        let c = this.q.shift();
        let skip = this.q.length > 60 ? this.q.length - 3 : this.drain > 0 && this.q.length > 1 ? 1 : 0;
        if (skip === 1) this.drain--;
        while (skip-- > 0) {
            const n = this.q.shift();
            c = { ...n, jump: c.jump || n.jump, fire: c.fire || n.fire, reload: c.reload || n.reload };
        }
        if (c) {
            this.ack = c.seq;
            this.last = c;
            this.starve = 0;
            return c;
        }
        if (!this.last) return null;
        if (++this.starve <= 5) return this.last;
        return { ...this.last, mx: 0, mz: 0, jump: false, fire: false, reload: false, use: this.last.use && this.starve <= 60 };
    }
}

// ---------- client side: remote players are drawn slightly in the past ----------
export class Interp {
    constructor(delayMs = 100) {
        this.delay = delayMs;
        this.buf = new Map();
        this.ticks = [];       // host tick of each snapshot, by arrival time
    }

    // Called once per snapshot, so tickAt() can tell which host tick is on screen.
    mark(now, k) {
        this.ticks.push({ t: now, k });
        if (this.ticks.length > 30) this.ticks.shift();
    }

    // Host tick the remote players are drawn at right now (fractional), or null.
    tickAt(now) {
        const b = this.ticks;
        if (!b.length) return null;
        const t = now - this.delay;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > t) i--;
        const a = b[Math.max(0, i - 1)], c = b[i];
        if (t >= c.t || a === c) return c.k;
        return a.k + (c.k - a.k) * Math.max(0, (t - a.t) / (c.t - a.t));
    }

    push(id, now, x, y, z, yaw, pitch) {
        let b = this.buf.get(id);
        if (!b) this.buf.set(id, (b = []));
        b.push({ t: now, x, y, z, yaw, pitch });
        if (b.length > 30) b.shift();
    }

    drop(id) { this.buf.delete(id); }

    clear() { this.buf.clear(); this.ticks.length = 0; }

    // Fills out {x, y, z, yaw, pitch}; false when nothing is known yet.
    sample(id, now, out) {
        const b = this.buf.get(id);
        if (!b || !b.length) return false;
        const t = now - this.delay;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > t) i--;
        const a = b[Math.max(0, i - 1)], c = b[i];
        let k = 0;
        // Before the oldest sample: hold it. Beyond the newest: hold it (no extrapolation).
        if (t >= c.t || a === c) {
            Object.assign(out, c);
            return true;
        }
        k = (t - a.t) / (c.t - a.t);
        if (Math.hypot(c.x - a.x, c.z - a.z) > 6) k = 1;      // respawn or teleport: do not slide across the map
        out.x = a.x + (c.x - a.x) * k;
        out.y = a.y + (c.y - a.y) * k;
        out.z = a.z + (c.z - a.z) * k;
        out.yaw = a.yaw + Math.atan2(Math.sin(c.yaw - a.yaw), Math.cos(c.yaw - a.yaw)) * k;
        out.pitch = a.pitch + (c.pitch - a.pitch) * k;
        return true;
    }
}
