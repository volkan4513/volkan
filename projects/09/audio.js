// Sound: everything is synthesised with WebAudio (no files, works offline).
//   engines   one voice per car: two oscillators through a low-pass, pitch from a made-up gearbox.
//             The player's is "in your head"; other cars are placed in the world, nearest few only.
//   tyres     filtered noise from sideways slip
//   bumps     a noise burst and a low thump
//   beeps     countdown, laps, finish
//   music     a looping synth track: pad + arpeggio + bass, with drums once a race is on
// The context can only start after a user gesture, so call unlock() from a click / key / touch.

const MAX_WORLD_VOICES = 5, HEARD_WITHIN = 140;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Am - F - C - G, one bar each (root as a MIDI note, then the triad)
const CHORDS = [
    { root: 45, tones: [0, 3, 7] },
    { root: 41, tones: [0, 4, 7] },
    { root: 48, tones: [0, 4, 7] },
    { root: 43, tones: [0, 4, 7] },
];
const BPM = 132, STEP = 60 / BPM / 4;   // a sixteenth note
const BASS = [0, -1, 0, -1, 12, -1, 0, -1, 0, -1, 0, 12, -1, -1, 7, -1];   // semitones above the root; -1 = rest
const ARP = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 1, 2, 1];

export function createAudio({ sound = true, music = true, maxSpeed = 42 } = {}) {
    let ctx = null, master = null, sfxBus = null, musicBus = null, drumBus = null, noise = null;
    let soundOn = sound, musicOn = music, scene = 0, ducked = false;
    const voices = new Map();   // car id -> engine voice
    let skid = null, lastBump = 0;

    function unlock() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            ctx = new AC();
            const comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -12;
            comp.ratio.value = 5;
            master = ctx.createGain();
            master.gain.value = 0.85;
            master.connect(comp).connect(ctx.destination);
            sfxBus = ctx.createGain();
            sfxBus.connect(master);
            musicBus = ctx.createGain();
            musicBus.connect(master);
            drumBus = ctx.createGain();
            drumBus.connect(musicBus);
            noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            applyLevels(true);
            startMusic();
            // no point burning battery while the tab is hidden
            document.addEventListener('visibilitychange', () => {
                if (!ctx) return;
                if (document.hidden) ctx.suspend(); else ctx.resume();
            });
        }
        if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
    }

    function applyLevels(now) {
        if (!ctx) return;
        const t = ctx.currentTime, k = now ? 0.001 : 0.25;
        sfxBus.gain.setTargetAtTime(soundOn ? 1 : 0, t, k);
        musicBus.gain.setTargetAtTime(musicOn ? (ducked ? 0.1 : scene ? 0.3 : 0.38) : 0, t, k);
        drumBus.gain.setTargetAtTime(scene ? 1 : 0, t, 0.4);
    }
    const setSound = (on) => { soundOn = on; applyLevels(); };
    const setMusic = (on) => { musicOn = on; applyLevels(); };
    // scene: 0 menu (no drums), 1 racing. ducked: paused / in a settings screen
    function setScene(s, duck) {
        if (s === scene && duck === ducked) return;
        scene = s;
        ducked = duck;
        applyLevels();
    }

    // ---------- little building blocks ----------
    function tone(type, freq, t0, dur, gain, dest, cutoff = 0, attack = 0.005) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        let node = o;
        if (cutoff) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = cutoff;
            o.connect(f);
            node = f;
        }
        node.connect(g).connect(dest);
        o.start(t0);
        o.stop(t0 + dur + 0.05);
    }
    function burst(t0, dur, gain, type, freq, dest, q = 0.7) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise;
        s.playbackRate.value = 0.8 + Math.random() * 0.4;
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        g.gain.setValueAtTime(gain, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        s.connect(f).connect(g).connect(dest);
        s.start(t0, Math.random());
        s.stop(t0 + dur + 0.05);
    }

    // ---------- music ----------
    let step = 0, nextT = 0, timer = 0;
    function startMusic() {
        nextT = ctx.currentTime + 0.1;
        timer = setInterval(() => {
            if (!ctx || ctx.state !== 'running') { nextT = Math.max(nextT, ctx ? ctx.currentTime : 0); return; }
            while (nextT < ctx.currentTime + 0.3) {
                if (musicOn) playStep(step, nextT);
                step = (step + 1) % 128;   // eight bars
                nextT += STEP;
            }
        }, 60);
    }
    function playStep(n, t) {
        const i = n % 16, bar = (n / 16) | 0, ch = CHORDS[bar % 4];
        if (i === 0) for (const tn of ch.tones) tone('triangle', mtof(ch.root + 12 + tn), t, STEP * 16, 0.05, musicBus, 1400, 0.25);
        const b = BASS[i];
        if (b >= 0) tone('sawtooth', mtof(ch.root + b), t, STEP * 1.8, 0.13, musicBus, 700);
        // the arpeggio steps up an octave in the second half of the loop
        const a = ch.root + 24 + ch.tones[ARP[i] % 3] + (bar >= 4 && i % 4 === 3 ? 12 : 0);
        tone('square', mtof(a), t, STEP * 0.9, 0.045, musicBus, 2600);
        // drums (the drum bus is silent in the menu)
        if (i % 4 === 0) { tone('sine', 120, t, 0.16, 0.5, drumBus); tone('sine', 55, t, 0.2, 0.45, drumBus); }
        if (i === 4 || i === 12) burst(t, 0.16, 0.22, 'bandpass', 1900, drumBus, 0.8);
        if (i % 2 === 0) burst(t, 0.04, 0.07, 'highpass', 7000, drumBus);
        if (bar % 4 === 3 && i >= 12) burst(t, 0.07, 0.12, 'bandpass', 2500, drumBus, 0.8);   // fill
    }

    // ---------- engines ----------
    function makeVoice(local) {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
        const m1 = ctx.createGain(), m2 = ctx.createGain(), m3 = ctx.createGain();
        m1.gain.value = 0.55; m2.gain.value = 0.3; m3.gain.value = 0.35;
        const lp = ctx.createBiquadFilter(), g = ctx.createGain();
        lp.type = 'lowpass';
        lp.Q.value = 1.2;
        g.gain.value = 0;
        o1.connect(m1).connect(lp); o2.connect(m2).connect(lp); o3.connect(m3).connect(lp);
        lp.connect(g);
        let pan = null;
        if (local) g.connect(sfxBus);
        else {
            pan = ctx.createPanner();
            pan.panningModel = 'equalpower';
            pan.distanceModel = 'inverse';
            pan.refDistance = 6;
            pan.rolloffFactor = 1.2;
            pan.maxDistance = HEARD_WITHIN;
            g.connect(pan).connect(sfxBus);
        }
        o1.start(); o2.start(); o3.start();
        return { o1, o2, o3, lp, g, pan, rpm: 0.18, gear: 0, local };
    }
    function dropVoice(id) {
        const v = voices.get(id);
        if (!v) return;
        const t = ctx.currentTime;
        v.g.gain.setTargetAtTime(0, t, 0.05);
        for (const o of [v.o1, v.o2, v.o3]) o.stop(t + 0.4);
        setTimeout(() => { try { (v.pan || v.g).disconnect(); } catch { /* gone */ } }, 600);
        voices.delete(id);
    }
    function driveVoice(v, c, dt) {
        const t = ctx.currentTime, sp = Math.abs(c.speed), band = maxSpeed / 5;
        const gear = Math.min(4, Math.floor(sp / band)), within = clamp((sp - gear * band) / band, 0, 1);
        const thr = clamp(c.throttle || 0, 0, 1);
        let target = sp < 0.6 ? 0.16 + thr * 0.3 : 0.3 + within * 0.62 + thr * 0.07;
        if (gear !== v.gear) { target -= 0.18; v.gear = gear; }   // the dip between gears
        v.rpm += (target - v.rpm) * (1 - Math.exp(-11 * dt));
        const f = 34 + v.rpm * 128;
        v.o1.frequency.setTargetAtTime(f, t, 0.03);
        v.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
        v.o3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
        v.lp.frequency.setTargetAtTime(240 + v.rpm * 1500 + thr * 800, t, 0.05);
        v.g.gain.setTargetAtTime((v.local ? 0.2 : 0.16) + thr * 0.1 + v.rpm * 0.05, t, 0.05);
        if (v.pan) {
            if (v.pan.positionX) {
                v.pan.positionX.setTargetAtTime(c.x, t, 0.05);
                v.pan.positionY.setTargetAtTime(c.y, t, 0.05);
                v.pan.positionZ.setTargetAtTime(c.z, t, 0.05);
            } else v.pan.setPosition(c.x, c.y, c.z);
        }
    }

    // Ears at the camera, facing the way it looks (yaw 0 faces +Z).
    function setListener(x, y, z, yaw) {
        if (!ctx) return;
        const L = ctx.listener, t = ctx.currentTime, fx = Math.sin(yaw), fz = Math.cos(yaw);
        if (L.positionX) {
            L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
            L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t);
            L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
        } else {
            L.setPosition(x, y, z);
            L.setOrientation(fx, 0, fz, 0, 1, 0);
        }
    }

    // cars: [{ id, x, y, z, speed, throttle, local?, slip? }]. Call once a frame; pass [] when nothing should be heard.
    function update(dt, listener, cars) {
        if (!ctx || ctx.state !== 'running') return;
        setListener(listener.x, listener.y, listener.z, listener.yaw);
        const keep = new Set();
        const near = [];
        let me = null;
        for (const c of cars) {
            if (c.local) { me = c; keep.add(c.id); continue; }
            const d = Math.hypot(c.x - listener.x, c.z - listener.z);
            if (d < HEARD_WITHIN) near.push([d, c]);
        }
        near.sort((a, b) => a[0] - b[0]);
        for (const [, c] of near.slice(0, MAX_WORLD_VOICES)) keep.add(c.id);
        for (const id of [...voices.keys()]) if (!keep.has(id)) dropVoice(id);
        for (const c of me ? [me, ...near.slice(0, MAX_WORLD_VOICES).map((e) => e[1])] : near.slice(0, MAX_WORLD_VOICES).map((e) => e[1])) {
            let v = voices.get(c.id);
            if (!v) voices.set(c.id, (v = makeVoice(!!c.local)));
            driveVoice(v, c, dt);
        }
        // tyre squeal follows my car's sideways slip
        const want = me ? clamp((Math.abs(me.slip || 0) - 1.6) / 5, 0, 1) * clamp(Math.abs(me.speed) / 8, 0, 1) : 0;
        if (want > 0.01 && !skid) {
            const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
            s.buffer = noise; s.loop = true;
            f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.6;
            g.gain.value = 0;
            s.connect(f).connect(g).connect(sfxBus);
            s.start();
            skid = { s, f, g };
        }
        if (skid) {
            const t = ctx.currentTime;
            skid.g.gain.setTargetAtTime(want * 0.3, t, 0.05);
            skid.f.frequency.setTargetAtTime(1100 + want * 900 + (me ? Math.abs(me.speed) * 8 : 0), t, 0.08);
            if (want < 0.01 && skid.g.gain.value < 0.003) { skid.s.stop(); skid = null; }
        }
    }

    // ---------- one-shots ----------
    function bump(strength) {
        if (!ctx || ctx.state !== 'running') return;
        const now = ctx.currentTime;
        if (now - lastBump < 0.12) return;
        lastBump = now;
        const k = clamp(strength / 14, 0.15, 1);
        burst(now, 0.22 + k * 0.2, 0.55 * k, 'lowpass', 700 + k * 900, sfxBus);
        tone('sine', 90, now, 0.22, 0.6 * k, sfxBus);
        tone('sine', 48, now + 0.02, 0.28, 0.5 * k, sfxBus);
    }
    function beep(freq, dur = 0.14, gain = 0.22) {
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime;
        tone('square', freq, t, dur, gain, sfxBus, 4000);
    }
    function lapChime() {
        beep(660, 0.1);
        setTimeout(() => beep(880, 0.16), 90);
    }
    function finishJingle() {
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, 0.2), i * 110));
    }

    return {
        unlock, setSound, setMusic, setScene, update, bump, beep, lapChime, finishJingle,
        get running() { return !!ctx && ctx.state === 'running'; },
    };
}
