// Quiet lo-fi background ambience for the main page, synthesised with Web
// Audio (no audio files, so it works offline): slow soft chords plus a faint
// vinyl crackle, at very low volume. Browsers only allow sound after the
// first tap / key press, so it fades in then. A small speaker button turns it
// off and the choice is remembered. Also exposes Ambient.blip() for soft UI
// click sounds that follow the same on/off setting.
(function () {
    const VOLUME = 0.045;            // master level - keep it in the background
    const STORE = 'ambient-sound';   // 'on' | 'off'
    const CHORDS = [                  // Fmaj7  Em7  Dm7  Cmaj7 (Hz)
        [174.61, 220.0, 261.63, 329.63],
        [164.81, 196.0, 246.94, 293.66],
        [146.83, 174.61, 220.0, 261.63],
        [130.81, 164.81, 196.0, 246.94],
    ];
    const CHORD_SECONDS = 8;

    let enabled = true;
    try { enabled = localStorage.getItem(STORE) !== 'off'; } catch { }

    let ctx = null, master = null, started = false, chordTimer = 0, chordIndex = 0;

    function setup() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0;
        // soften everything a little more, like an old tape
        const tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 1800;
        master.connect(tone).connect(ctx.destination);
        startCrackle();
        return true;
    }

    // ---- vinyl crackle: sparse clicks + a little hiss, looped
    function startCrackle() {
        const seconds = 4, rate = ctx.sampleRate;
        const buf = ctx.createBuffer(1, seconds * rate, rate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
            let v = (Math.random() * 2 - 1) * 0.012;                  // hiss
            if (Math.random() < 0.0006) v += (Math.random() * 2 - 1) * 0.5; // pop
            d[i] = v;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2400;
        bp.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.value = 0.35;
        src.connect(bp).connect(g).connect(master);
        src.start();
    }

    // ---- soft pad: each chord swells in and out, slightly detuned
    function playChord() {
        const now = ctx.currentTime;
        const notes = CHORDS[chordIndex++ % CHORDS.length];
        const dur = CHORD_SECONDS + 2;
        notes.forEach((f, i) => {
            [-6, 6].forEach(cents => {
                const o = ctx.createOscillator();
                o.type = i === 0 ? 'triangle' : 'sine';
                o.frequency.value = f;
                o.detune.value = cents;
                // gentle tape wobble
                const lfo = ctx.createOscillator();
                const lfoGain = ctx.createGain();
                lfo.frequency.value = 0.3 + Math.random() * 0.2;
                lfoGain.gain.value = 4;
                lfo.connect(lfoGain).connect(o.detune);
                const g = ctx.createGain();
                const peak = i === 0 ? 0.16 : 0.09;
                g.gain.setValueAtTime(0, now);
                g.gain.linearRampToValueAtTime(peak, now + 2.5);
                g.gain.setValueAtTime(peak, now + dur - 3);
                g.gain.linearRampToValueAtTime(0, now + dur);
                o.connect(g).connect(master);
                o.start(now);
                lfo.start(now);
                o.stop(now + dur + 0.1);
                lfo.stop(now + dur + 0.1);
            });
        });
    }

    function start() {
        if (started || !enabled) return;
        if (!ctx && !setup()) return;
        started = true;
        ctx.resume();
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 3);
        playChord();
        chordTimer = setInterval(() => { if (!document.hidden) playChord(); }, CHORD_SECONDS * 1000);
        render();
    }

    function stop() {
        if (!started) return;
        started = false;
        clearInterval(chordTimer);
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(0, t + 0.6);
        setTimeout(() => { if (!started) ctx.suspend(); }, 700);
        render();
    }

    // first interaction starts it (browser autoplay rules)
    const kick = () => { if (enabled) start(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(t => window.addEventListener(t, kick, { once: true, passive: true }));

    // quiet while the tab is hidden; the music player page has its own audio
    document.addEventListener('visibilitychange', () => {
        if (!ctx || !started) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
    window.addEventListener('pagehide', () => { if (ctx && started) ctx.suspend(); });
    window.addEventListener('pageshow', e => { if (e.persisted && ctx && started) ctx.resume(); });

    // ---- soft click blip for UI (only when sound is on)
    function blip(freq = 660) {
        if (!enabled) return;
        if (!ctx && !setup()) return;
        if (ctx.state === 'suspended') ctx.resume();
        const t = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.06);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.1);
    }

    // ---- speaker toggle button (pixel style)
    const ICON_ON = '<svg viewBox="0 0 12 12" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 4h2v4H1zM3 4h1V3h1V2h1v8H5V9H4V8H3zM8 4h1v4H8zM10 2h1v8h-1z"/></svg>';
    const ICON_OFF = '<svg viewBox="0 0 12 12" width="20" height="20" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M1 4h2v4H1zM3 4h1V3h1V2h1v8H5V9H4V8H3zM8 4h1v1H8zM9 5h1v1H9zM10 6h1v1h-1zM10 4h1v1h-1zM8 7h1v1H8z"/></svg>';
    let btn = null;

    function render() {
        if (!btn) return;
        const on = enabled;
        btn.innerHTML = on ? ICON_ON : ICON_OFF;
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? 'Background sound on - turn off' : 'Background sound off - turn on');
        btn.title = on ? 'Sound: on' : 'Sound: off';
        btn.classList.toggle('off', !on);
    }

    function mount() {
        const style = document.createElement('style');
        style.textContent = `
            .ambient-btn {
                position: fixed;
                left: max(12px, env(safe-area-inset-left));
                bottom: max(12px, env(safe-area-inset-bottom));
                z-index: 60;
                width: 44px;
                height: 44px;
                display: grid;
                place-items: center;
                color: #0d0d0d;
                background: #ffd23f;
                border: 3px solid #000;
                box-shadow: inset -3px -3px 0 rgba(0,0,0,.3), inset 3px 3px 0 rgba(255,255,255,.45), 3px 3px 0 #000;
                cursor: pointer;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
                opacity: .9;
            }
            .ambient-btn.off { background: #c9ccd4; }
            .ambient-btn:hover { opacity: 1; }
            .ambient-btn:active { transform: translate(3px, 3px); box-shadow: inset 3px 3px 0 rgba(0,0,0,.3); }
            .ambient-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
            body.popup-open .ambient-btn { display: none; }
            /* phones: the bottom edge belongs to the "try the puzzle" button */
            @media (max-width: 768px) {
                .ambient-btn { bottom: auto; left: auto; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); }
            }
        `;
        document.head.appendChild(style);
        btn = document.createElement('button');
        btn.className = 'ambient-btn';
        btn.type = 'button';
        btn.addEventListener('click', e => {
            e.stopPropagation();
            enabled = !enabled;
            try { localStorage.setItem(STORE, enabled ? 'on' : 'off'); } catch { }
            if (enabled) { start(); blip(880); } else stop();
            render();
        });
        document.body.appendChild(btn);
        render();
    }

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);

    window.Ambient = { start, stop, blip, get enabled() { return enabled; } };
})();
