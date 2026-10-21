// Networking: WebRTC links through PeerJS with a room code (the transport from project 08), the
// car-state wire format and interpolation. No DOM and no game rules in here.
//
// Each peer pair has two DataChannels:
//   rel  - ordered and reliable (PeerJS's own channel): hello, welcome, roster, map changes, heartbeat
//   fast - unordered, maxRetransmits 0: car states (~20 Hz each way)
// The joiner opens 'fast' itself once 'rel' is up. If 'fast' never opens, everything falls back
// to 'rel', so a broken fast channel only costs latency.
//
// Test knobs in the page URL: ?lag=120 delays everything this tab sends by that many ms,
// ?loss=5 drops that percent of 'fast' packets.

const PEER_SRC = 'lib/peerjs.min.js';   // PeerJS 1.5.4 (MIT), local copy
const ID_PREFIX = 'pxracer-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0, 1
const params = new URLSearchParams(location.search);
const LAG = Math.max(0, Number(params.get('lag')) || 0);
const LOSS = Math.min(100, Math.max(0, Number(params.get('loss')) || 0));

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 6000;

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
        conn.on('data', (d) => this.recv(d));
        conn.on('close', () => this.close('closed'));
        conn.on('error', () => this.close('error'));
        this.timer = setInterval(() => this.beat(), 500);
    }

    attachFast(ch) {
        this.fast = ch;
        ch.onmessage = (e) => this.recv(e.data);
    }

    beat() {
        const now = performance.now();
        if (now - this.lastRecv > TIMEOUT_MS) return this.close('timeout');
        if (now - this.lastBeat >= HEARTBEAT_MS) {
            this.lastBeat = now;
            this.send({ t: 'hb', ts: now });
        }
    }

    recv(data) {
        if (this.closed || typeof data !== 'string') return;
        this.lastRecv = performance.now();
        let m;
        try { m = JSON.parse(data); } catch { return; }
        if (m.t === 'hb') return this.send({ t: 'hbr', ts: m.ts });
        if (m.t === 'hbr') {
            const rtt = this.lastRecv - m.ts;
            this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
            return;
        }
        if (this.onmsg) this.onmsg(m);
    }

    // fast = true prefers the unreliable channel (car states).
    send(msg, fast = false) {
        if (this.closed) return;
        const s = JSON.stringify(msg);
        const ch = fast && this.fast && this.fast.readyState === 'open' ? this.fast : null;
        if (ch && LOSS && Math.random() * 100 < LOSS) return;
        const go = () => {
            if (this.closed) return;
            try { if (ch) ch.send(s); else this.conn.send(s); } catch { /* channel closing */ }
        };
        if (LAG) setTimeout(go, LAG + (ch ? Math.random() * LAG * 0.2 : 0));
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

// ---------- wire format: one car = [x, y, z, yaw, pitch, roll, speed, steer] ----------
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
export const packCar = (p) => [r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), r3(p.roll), r2(p.speed), r3(p.steer)];
export function unpackCar(a, out = {}) {
    const n = (i) => (Number.isFinite(a[i]) ? a[i] : 0);
    out.x = n(0); out.y = n(1); out.z = n(2); out.yaw = n(3); out.pitch = n(4); out.roll = n(5); out.speed = n(6); out.steer = n(7);
    return out;
}

// ---------- remote cars are drawn slightly in the past, between the two states around then ----------
export class Interp {
    constructor(delayMs = 100) {
        this.delay = delayMs;
        this.buf = new Map();
    }

    push(id, now, state) {
        let b = this.buf.get(id);
        if (!b) this.buf.set(id, (b = []));
        b.push({ t: now, s: unpackCar(state) });
        if (b.length > 30) b.shift();
    }

    drop(id) { this.buf.delete(id); }

    clear() { this.buf.clear(); }

    // Fills `out` with { x, y, z, yaw, pitch, roll, speed, steer }; false when nothing is known yet.
    sample(id, now, out) {
        const b = this.buf.get(id);
        if (!b || !b.length) return false;
        const t = now - this.delay;
        let i = b.length - 1;
        while (i > 0 && b[i - 1].t > t) i--;
        const a = b[Math.max(0, i - 1)].s, c = b[i].s;
        // Before the oldest sample or beyond the newest: hold it (no extrapolation).
        if (t >= b[i].t || a === c) { Object.assign(out, c); return true; }
        let k = (t - b[i - 1].t) / (b[i].t - b[i - 1].t);
        if (Math.hypot(c.x - a.x, c.z - a.z) > 15) k = 1;      // reset or teleport: don't slide across the map
        const lerp = (p, q) => p + (q - p) * k, angle = (p, q) => p + Math.atan2(Math.sin(q - p), Math.cos(q - p)) * k;
        out.x = lerp(a.x, c.x); out.y = lerp(a.y, c.y); out.z = lerp(a.z, c.z);
        out.yaw = angle(a.yaw, c.yaw); out.pitch = lerp(a.pitch, c.pitch); out.roll = lerp(a.roll, c.roll);
        out.speed = lerp(a.speed, c.speed); out.steer = lerp(a.steer, c.steer);
        return true;
    }
}
