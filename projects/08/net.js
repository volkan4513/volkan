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

const BIT = { jump: 1, crouch: 2, walk: 4, fire: 8, reload: 16, use: 32 };

// Inputs are quantised before the client predicts with them, so client and host step identical numbers.
export function quantiseInput(inp, seq) {
    return {
        seq,
        mx: r2(inp.mx), mz: r2(inp.mz),
        jump: !!inp.jump, crouch: !!inp.crouch, walk: !!inp.walk, fire: !!inp.fire, reload: !!inp.reload, use: !!inp.use,
        yaw: r3(inp.yaw), pitch: r3(inp.pitch), slot: inp.slot,
    };
}

// The last few unacknowledged inputs ride along in every packet, so a lost packet costs nothing.
export function packInputs(cmds) {
    return {
        t: 'in',
        c: cmds.map((c) => [
            c.seq, c.mx, c.mz,
            (c.jump ? BIT.jump : 0) | (c.crouch ? BIT.crouch : 0) | (c.walk ? BIT.walk : 0) | (c.fire ? BIT.fire : 0) | (c.reload ? BIT.reload : 0) | (c.use ? BIT.use : 0),
            c.yaw, c.pitch, c.slot,
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
        fire: !!(bits & BIT.fire), reload: !!(bits & BIT.reload), use: !!(bits & BIT.use),
        yaw: num(a[4]), pitch: num(a[5]), slot: a[6] | 0,
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

    // One input per host tick. Bursts are trimmed, short gaps repeat the last input,
    // and a long gap (tab hidden, link stalled) stops movement and fire.
    next() {
        if (this.q.length > 8) this.q.splice(0, this.q.length - 3);
        const c = this.q.shift();
        if (c) {
            this.ack = c.seq;
            this.last = c;
            this.starve = 0;
            return c;
        }
        if (!this.last) return null;
        if (++this.starve <= 5) return this.last;
        return { ...this.last, mx: 0, mz: 0, jump: false, fire: false, reload: false, use: false };
    }
}

// ---------- client side: remote players are drawn slightly in the past ----------
export class Interp {
    constructor(delayMs = 100) {
        this.delay = delayMs;
        this.buf = new Map();
    }

    push(id, now, x, y, z, yaw, pitch) {
        let b = this.buf.get(id);
        if (!b) this.buf.set(id, (b = []));
        b.push({ t: now, x, y, z, yaw, pitch });
        if (b.length > 30) b.shift();
    }

    drop(id) { this.buf.delete(id); }

    clear() { this.buf.clear(); }

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

// ---------- option B: manual handshake (copy/paste or QR, no signaling server) ----------
// Same links as the room code path, but offer and answer travel by hand. Non-trickle ICE:
// wait for gathering to finish so each code is one self-contained blob.
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
const GATHER_MS = 4000;

const toB64Url = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (str) => {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function streamBytes(stream, bytes) {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(out);
}

// 'z' + deflated JSON, or 'p' + plain JSON when CompressionStream is missing.
export async function packCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') return 'z' + toB64Url(await streamBytes(new CompressionStream('deflate-raw'), raw));
    return 'p' + toB64Url(raw);
}

export async function unpackCode(code) {
    const c = String(code).replace(/\s+/g, '');
    try {
        const bytes = fromB64Url(c.slice(1));
        if (c[0] === 'z') return JSON.parse(new TextDecoder().decode(await streamBytes(new DecompressionStream('deflate-raw'), bytes)));
        if (c[0] === 'p') return JSON.parse(new TextDecoder().decode(bytes));
    } catch { /* fall through */ }
    throw new Error('That code is not valid. Copy the whole code.');
}

// Gives Link the same small interface PeerJS connections have.
class ChannelConn {
    constructor(ch, pc) {
        this.ch = ch;
        this.pc = pc;
        this.h = {};
        ch.onmessage = (e) => this.emit('data', e.data);
        ch.onclose = () => this.emit('close');
        ch.onerror = () => this.emit('error');
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.emit('close');
        };
    }

    on(ev, fn) { (this.h[ev] || (this.h[ev] = [])).push(fn); }
    emit(ev, d) { for (const fn of this.h[ev] || []) fn(d); }
    send(s) { this.ch.send(s); }

    close() {
        try { this.ch.close(); } catch { /* already closed */ }
        try { this.pc.close(); } catch { /* already closed */ }
    }
}

function gathered(pc) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', onChange); resolve(); };
        const onChange = () => { if (pc.iceGatheringState === 'complete') done(); };
        const timer = setTimeout(done, GATHER_MS);
        pc.addEventListener('icegatheringstatechange', onChange);
    });
}

// Host: makes an offer code. finish(answerCode) resolves with a Link once the channels open.
export async function manualOffer() {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const rel = pc.createDataChannel('rel', { ordered: true });
    const fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const code = await packCode({ sdp: pc.localDescription.sdp });
    const finish = async (answerCode) => {
        const a = await unpackCode(answerCode);
        if (typeof a.sdp !== 'string') throw new Error('That is not an answer code.');
        await pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pc.close(); reject(new Error('Could not connect. Different networks or a strict firewall can block this.')); }, 20000);
            const ready = () => {
                clearTimeout(timer);
                const link = new Link(new ChannelConn(rel, pc));
                link.attachFast(fast);
                resolve(link);
            };
            if (rel.readyState === 'open') ready();
            else rel.onopen = ready;
        });
    };
    return { code, finish, cancel: () => pc.close() };
}

// Joiner: turns an offer code into an answer code; link resolves when the host has connected.
export async function manualAnswer(offerCode) {
    const o = await unpackCode(offerCode);
    if (typeof o.sdp !== 'string') throw new Error('That is not an offer code.');
    const pc = new RTCPeerConnection(RTC_CONFIG);
    let rel = null, fast = null, link = null, onLink = null;
    const open = () => {
        if (link || !rel || rel.readyState !== 'open') return;
        link = new Link(new ChannelConn(rel, pc));
        if (fast) link.attachFast(fast);
        if (onLink) onLink(link);
    };
    pc.ondatachannel = (e) => {
        if (e.channel.label === 'fast') {
            fast = e.channel;
            if (link) link.attachFast(fast);
        } else {
            rel = e.channel;
            rel.onopen = open;
            open();
        }
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    const code = await packCode({ sdp: pc.localDescription.sdp });
    const linkPromise = new Promise((resolve, reject) => {
        onLink = resolve;
        if (link) resolve(link);
        setTimeout(() => { if (!link) { pc.close(); reject(new Error('The host did not connect in time.')); } }, 120000);
    });
    return { code, link: linkPromise, cancel: () => pc.close() };
}

// ---------- QR codes ----------
let qrLoad = null;
function loadQr() {
    if (!qrLoad) {
        qrLoad = new Promise((resolve, reject) => {
            if (window.qrcode) return resolve(window.qrcode);
            const s = document.createElement('script');
            s.src = 'qrcode.js';
            s.onload = () => resolve(window.qrcode);
            s.onerror = () => { qrLoad = null; reject(new Error('QR library missing')); };
            document.head.append(s);
        });
    }
    return qrLoad;
}

// Draws text as a QR code on a canvas. Returns false when it does not fit.
export async function drawQr(canvas, text) {
    const qrcode = await loadQr();
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    try { qr.make(); } catch { return false; }
    const n = qr.getModuleCount(), scale = 4, quiet = 4;
    const size = (n + quiet * 2) * scale;
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    return true;
}

export const canScan = () => 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// Opens the camera on `video` until a QR code is read. result resolves with the text.
export function scanQr(video) {
    let stream = null, stopped = false;
    const stop = () => {
        stopped = true;
        if (stream) for (const t of stream.getTracks()) t.stop();
        video.srcObject = null;
    };
    const result = (async () => {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = stream;
        await video.play();
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        while (!stopped) {
            try {
                const found = await det.detect(video);
                if (found.length) { stop(); return found[0].rawValue; }
            } catch { /* frame not ready */ }
            await new Promise((r) => setTimeout(r, 200));
        }
        return null;
    })();
    return { result, stop };
}
