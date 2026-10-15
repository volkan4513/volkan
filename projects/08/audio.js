// Sound: every effect is synthesised with WebAudio (no files, works offline).
// World sounds go through a panner at their position; sounds behind a wall are muffled
// (the caller says whether the line to the listener is blocked).

export function createAudio() {
    let ctx = null, master = null, noise = null, volume = 0.7;

    // The context can only start after a user gesture; call this from click / touch handlers.
    function unlock() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -14;
            comp.ratio.value = 6;
            master = ctx.createGain();
            master.gain.value = volume;
            master.connect(comp).connect(ctx.destination);
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    function setVolume(v) {
        volume = v;
        if (master) master.gain.value = v;
    }

    // Ears at the camera, facing the look direction.
    function setListener(x, y, z, yaw, pitch) {
        if (!ctx) return;
        const L = ctx.listener, t = ctx.currentTime;
        const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
        if (L.positionX) {
            L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
            L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
            L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
        } else {
            L.setPosition(x, y, z);
            L.setOrientation(fx, fy, fz, 0, 1, 0);
        }
    }

    // Output for one sound: { at: [x, y, z], muffled, far } places it in the world, null plays it "in your head".
    function out(where, gain = 1) {
        const g = ctx.createGain();
        g.gain.value = gain;
        if (!where) {
            g.connect(master);
            return g;
        }
        const pan = ctx.createPanner();
        pan.panningModel = 'equalpower';
        pan.distanceModel = 'inverse';
        pan.refDistance = where.ref || 3;
        pan.rolloffFactor = 1.1;
        pan.maxDistance = 200;
        const [x, y, z] = where.at;
        if (pan.positionX) { pan.positionX.value = x; pan.positionY.value = y; pan.positionZ.value = z; }
        else pan.setPosition(x, y, z);
        let tail = pan;
        if (where.muffled) {
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 700;
            tail.connect(lp);
            tail = lp;
            g.gain.value *= 0.6;
        }
        g.connect(pan);
        tail.connect(master);
        return g;
    }

    // Filtered white noise with a fast attack and exponential decay.
    function burst(dest, t, { dur, type = 'bandpass', freq = 1500, q = 0.8, gain = 1, attack = 0.002, sweep = 0 }) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f).connect(g).connect(dest);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.05);
    }

    // A pitched tone gliding from f0 to f1.
    function tone(dest, t, { f0, f1 = f0, dur, type = 'sine', gain = 0.5, attack = 0.003 }) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    // Per-weapon recipe: a noise crack, a low thump and an optional echo tail.
    const GUNS = {
        pistol: { crack: { dur: 0.09, freq: 2200, q: 0.7, gain: 0.9 }, thump: { f0: 170, f1: 60, dur: 0.08, gain: 0.7 }, tail: 0.25 },
        rifle: { crack: { dur: 0.12, type: 'highpass', freq: 900, q: 0.5, gain: 0.8 }, thump: { f0: 130, f1: 45, dur: 0.1, gain: 0.9 }, tail: 0.35 },
        shotgun: { crack: { dur: 0.26, type: 'lowpass', freq: 2600, q: 0.6, gain: 1.1, sweep: 0.3 }, thump: { f0: 95, f1: 38, dur: 0.18, gain: 1 }, tail: 0.5 },
        sniper: { crack: { dur: 0.32, type: 'highpass', freq: 700, q: 0.4, gain: 1.2, sweep: 0.5 }, thump: { f0: 110, f1: 32, dur: 0.22, gain: 1.1 }, tail: 0.9 },
    };

    function gun(id, where) {
        if (!ctx) return;
        const r = GUNS[id] || GUNS.rifle, t = ctx.currentTime;
        const dest = out(where, where ? 1 : 0.55);
        burst(dest, t, r.crack);
        tone(dest, t, { ...r.thump, type: 'triangle' });
        // Echo off the walls: a quieter, darker copy a moment later.
        burst(dest, t + 0.06, { dur: r.tail, type: 'lowpass', freq: 900, q: 0.3, gain: 0.18, attack: 0.02 });
    }

    function step(where, loud = 1) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(where, (where ? 0.9 : 0.3) * loud);
        burst(dest, t, { dur: 0.06, type: 'lowpass', freq: 500 + Math.random() * 400, q: 1, gain: 0.8 });
        burst(dest, t + 0.012, { dur: 0.04, freq: 2600 + Math.random() * 800, q: 2, gain: 0.25 });
    }

    function land(where) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(where, where ? 0.9 : 0.45);
        burst(dest, t, { dur: 0.12, type: 'lowpass', freq: 380, q: 0.8, gain: 1 });
        tone(dest, t, { f0: 90, f1: 50, dur: 0.1, gain: 0.5 });
    }

    // Mag out, mag in, bolt: spread over the reload time.
    function reload(where, secs = 2) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(where, where ? 0.8 : 0.45);
        const click = (at, f) => {
            burst(dest, t + at, { dur: 0.05, freq: f, q: 4, gain: 0.6 });
            tone(dest, t + at, { f0: f * 0.5, dur: 0.04, type: 'square', gain: 0.08 });
        };
        click(0.1, 1800);
        click(secs * 0.55, 2400);
        click(secs * 0.85, 3200);
    }

    // Your bullet landed: a tick, or a ring for a headshot.
    function hit(hs) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(null, 0.5);
        if (hs) {
            tone(dest, t, { f0: 2400, dur: 0.35, gain: 0.35 });
            tone(dest, t, { f0: 3600, dur: 0.2, gain: 0.12 });
        } else {
            burst(dest, t, { dur: 0.04, freq: 1700, q: 3, gain: 0.7 });
        }
    }

    function hurt() {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(null, 0.6);
        tone(dest, t, { f0: 140, f1: 70, dur: 0.15, type: 'triangle', gain: 0.8 });
        burst(dest, t, { dur: 0.1, type: 'lowpass', freq: 700, gain: 0.6 });
    }

    function kill() {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(null, 0.35);
        tone(dest, t, { f0: 660, dur: 0.12, type: 'triangle', gain: 0.5 });
        tone(dest, t + 0.07, { f0: 990, dur: 0.18, type: 'triangle', gain: 0.4 });
    }

    function beep(where) {
        if (!ctx) return;
        tone(out(where, 0.7), ctx.currentTime, { f0: 2100, dur: 0.09, type: 'square', gain: 0.25 });
    }

    function plant(where) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(where, 0.8);
        for (let i = 0; i < 3; i++) tone(dest, t + i * 0.14, { f0: 1500 + i * 300, dur: 0.1, type: 'square', gain: 0.2 });
    }

    function defuse() {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(null, 0.6);
        burst(dest, t, { dur: 0.05, freq: 2500, q: 4, gain: 0.6 });
        tone(dest, t + 0.05, { f0: 1600, f1: 400, dur: 0.4, gain: 0.3 });
    }

    function explode(where) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(where ? { ...where, ref: 25 } : null, 1.4);
        burst(dest, t, { dur: 1.8, type: 'lowpass', freq: 1800, q: 0.4, gain: 1.2, sweep: 0.08 });
        tone(dest, t, { f0: 70, f1: 25, dur: 1.2, type: 'sine', gain: 1 });
    }

    // Interface sounds: round start / win / loss, buying, picking something up.
    function ui(kind) {
        if (!ctx) return;
        const t = ctx.currentTime, dest = out(null, 0.4);
        const seq = {
            go: [[520, 0], [780, 0.12]],
            win: [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.36]],
            lose: [[440, 0], [370, 0.15], [294, 0.3]],
            buy: [[1200, 0], [1800, 0.06]],
            pickup: [[880, 0], [1320, 0.08]],
        }[kind] || [];
        for (const [f, at] of seq) tone(dest, t + at, { f0: f, dur: 0.2, type: 'triangle', gain: 0.45 });
    }

    return { unlock, setVolume, setListener, gun, step, land, reload, hit, hurt, kill, beep, plant, defuse, explode, ui };
}
