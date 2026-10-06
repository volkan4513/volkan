// Click surprises for the collage stickers + the PIXEL MODE easter egg.
// index.html calls CollageFun.run(name, img, fx) for layers listed in
// functions_to_work.json -> "click_fx" (e.g. "V": "jump").
//
// Easter egg: type the Konami code (up up down down left right left right B A)
// or "pixel", or tap the "portfolio" sticker 5 times fast, to toggle a
// pixelated page. Esc turns it off.
//
// Hint toasts lead people to the secrets: a nudge after ~40s, "spell it"
// after the first letter click, the pixel-mode hint after spelling it, and a
// countdown while tapping the portfolio sticker. Each hint shows once per
// visit, with at least 15s between hints.
(function () {
    const LETTERS = ['V', 'O', 'L', 'K', 'A', 'N'];
    const NOTES = { V: 523, O: 587, L: 659, K: 784, A: 880, N: 1047 };   // C D E G A C
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blip = f => window.Ambient?.blip(f);
    const isTouch = window.matchMedia('(hover: none)').matches;
    let spelled = [];

    // ---- hints
    let lastHint = 0, foundPixel = false;
    function hint(id, text, { force = false } = {}) {
        let seen = '';
        try { seen = sessionStorage.getItem('hint-' + id); } catch { }
        if (seen) return false;
        if (!force && Date.now() - lastHint < 15000) return false;
        try { sessionStorage.setItem('hint-' + id, '1'); } catch { }
        lastHint = Date.now();
        toast('HINT: ' + text, 'hint');
        return true;
    }
    const pixelHint = () => isTouch
        ? 'poke the "portfolio" sticker 5 times, fast.'
        : 'old-school gamers know a code: \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192 B A  (or type "pixel")';

    // gentle nudge for people who haven't clicked anything fun yet
    setTimeout(() => {
        if (!foundPixel) hint('start', 'the stickers are clickable \u2014 and a few hide secrets.');
    }, 40000);

    // animate with the individual translate/rotate/scale properties so the
    // hover scale (on `transform`) isn't disturbed; pivot on the sticker
    function animate(img, frames, opts) {
        if (reduced) return Promise.resolve();
        const origin = img.style.transformOrigin;
        img.style.transformOrigin = '50% 50%';
        const a = img.animate(frames, { duration: 600, easing: 'ease-out', ...opts });
        return a.finished.catch(() => { }).finally(() => { img.style.transformOrigin = origin; });
    }

    const FX = {
        jump(img, name) {
            blip(NOTES[name] || 660);
            animate(img, [
                { translate: '0 0', rotate: '0deg' },
                { translate: '0 -14%', rotate: '-8deg', offset: 0.35 },
                { translate: '0 3%', rotate: '5deg', offset: 0.7 },
                { translate: '0 0', rotate: '0deg' },
            ], { duration: 520 });
            if (LETTERS.includes(name)) {
                hint('spell', 'click the letters in order: V-O-L-K-A-N.', { force: true });
                spelled = [...spelled, name].slice(-LETTERS.length);
                if (spelled.join('') === LETTERS.join('')) {
                    spelled = [];
                    setTimeout(() => { confetti(); toast('V-O-L-K-A-N! You spelled it.'); }, 250);
                    setTimeout(() => { if (!foundPixel) hint('pixel', 'one more secret \u2014 ' + pixelHint(), { force: true }); }, 3400);
                }
            }
        },
        spin(img) {
            blip(990);
            animate(img, [{ rotate: '0deg', scale: '1' }, { rotate: '200deg', scale: '1.25', offset: 0.5 }, { rotate: '360deg', scale: '1' }], { duration: 700, easing: 'ease-in-out' });
        },
        peel(img) {
            blip(440);
            animate(img, [
                { rotate: '0deg', scale: '1', translate: '0 0', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
                { rotate: '-9deg', scale: '1.12', translate: '0 -12%', filter: 'drop-shadow(6px 10px 0 rgba(0,0,0,.35))', offset: 0.45 },
                { rotate: '2deg', scale: '0.97', translate: '0 2%', offset: 0.8 },
                { rotate: '0deg', scale: '1', translate: '0 0', filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' },
            ], { duration: 800 });
            countPortfolioTap();
        },
        wobble(img) {
            blip(330);
            animate(img, [
                { rotate: '0deg' }, { rotate: '-14deg' }, { rotate: '11deg' }, { rotate: '-7deg' }, { rotate: '4deg' }, { rotate: '0deg' },
            ], { duration: 700, easing: 'linear' });
        },
        hearts(img, name, e) {
            blip(1175);
            animate(img, [{ scale: '1' }, { scale: '1.3', offset: 0.3 }, { scale: '1' }], { duration: 450 });
            const r = img.getBoundingClientRect();
            const x = e?.clientX ?? r.left + r.width / 2, y = e?.clientY ?? r.top + r.height / 2;
            for (let i = 0; i < 7; i++) floatHeart(x, y, i);
        },
    };

    function run(name, img, fx, e) {
        (FX[fx] || FX.jump)(img, name, e);
    }

    // ---- pixel hearts
    const HEART = '<svg viewBox="0 0 7 6" width="100%" height="100%" shape-rendering="crispEdges"><path fill="#ff4d6d" d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z"/><path fill="#fff" d="M1 1h1v1H1z"/></svg>';
    function floatHeart(x, y, i) {
        const h = document.createElement('div');
        const size = 14 + Math.random() * 12;
        Object.assign(h.style, { position: 'fixed', left: x - size / 2 + 'px', top: y - size / 2 + 'px', width: size + 'px', height: size + 'px', zIndex: 9000, pointerEvents: 'none' });
        h.innerHTML = HEART;
        document.body.appendChild(h);
        const dx = (Math.random() - 0.5) * 120, dy = -80 - Math.random() * 90;
        h.animate([
            { transform: 'translate(0,0) scale(.6)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0 },
        ], { duration: 900 + i * 60, easing: 'steps(12)' }).finished.then(() => h.remove());
    }

    // ---- confetti of pixel squares
    function confetti() {
        if (reduced) return;
        const cv = document.createElement('canvas');
        Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 9000, pointerEvents: 'none', imageRendering: 'pixelated' });
        const scale = 4;
        cv.width = Math.ceil(innerWidth / scale);
        cv.height = Math.ceil(innerHeight / scale);
        document.body.appendChild(cv);
        const g = cv.getContext('2d');
        const colors = ['#ffdf00', '#00a5ff', '#ff6050', '#3ddc84', '#ff7ad9', '#fff'];
        const bits = Array.from({ length: 140 }, () => ({
            x: cv.width / 2 + (Math.random() - 0.5) * 20, y: cv.height * 0.55,
            vx: (Math.random() - 0.5) * 4, vy: -2 - Math.random() * 4,
            c: colors[(Math.random() * colors.length) | 0], s: 1 + ((Math.random() * 2) | 0),
        }));
        const start = performance.now();
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f), i * 90));
        const tick = now => {
            g.clearRect(0, 0, cv.width, cv.height);
            bits.forEach(b => {
                b.vy += 0.12; b.x += b.vx; b.y += b.vy;
                g.fillStyle = b.c;
                g.fillRect(b.x | 0, b.y | 0, b.s, b.s);
            });
            if (now - start < 2200) requestAnimationFrame(tick);
            else cv.remove();
        };
        requestAnimationFrame(tick);
    }

    // ---- small toast
    let currentToast = null;
    function toast(text, kind) {
        currentToast?.remove();
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.textContent = text;
        const isHint = kind === 'hint';
        Object.assign(el.style, {
            position: 'fixed', left: '50%', top: 'max(70px, env(safe-area-inset-top))', transform: 'translateX(-50%)', zIndex: 9600,
            padding: '10px 14px', font: 'bold 13px/1.4 ui-monospace, "Courier New", monospace',
            color: isHint ? '#f4f1e8' : '#0d0d0d', background: isHint ? '#1b1d22' : '#ffd23f',
            border: '3px solid ' + (isHint ? '#ff7ad9' : '#000'), boxShadow: '3px 3px 0 #000', pointerEvents: 'none',
            maxWidth: 'min(460px, calc(100vw - 32px))', textAlign: 'center',
        });
        document.body.appendChild(el);
        currentToast = el;
        el.animate([{ transform: 'translate(-50%, -12px)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 180, easing: 'steps(3)' });
        setTimeout(() => el.remove(), isHint ? 5200 : 2600);
    }

    // =====================================================================
    // Easter egg: PIXEL MODE
    // An SVG filter pixelates the collage and the section below it (flood a
    // dot per block, keep the source colour under it, grow it to fill the
    // block) and a discrete transfer posterizes the colours.
    // =====================================================================
    const BLOCK = window.innerWidth < 600 ? 4 : 6;   // smaller blocks on phones
    function ensureFilter() {
        if (document.getElementById('fx-pixelate')) return;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.setAttribute('aria-hidden', 'true');
        svg.style.position = 'absolute';
        const half = BLOCK / 2;
        svg.innerHTML = `
            <filter id="fx-pixelate" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
                <feFlood x="${half}" y="${half}" width="1" height="1" flood-color="#000"/>
                <feComposite width="${BLOCK}" height="${BLOCK}"/>
                <feTile result="grid"/>
                <feComposite in="SourceGraphic" in2="grid" operator="in"/>
                <feMorphology operator="dilate" radius="${half}"/>
                <feComponentTransfer>
                    <feFuncR type="discrete" tableValues="0 .2 .4 .6 .8 1"/>
                    <feFuncG type="discrete" tableValues="0 .2 .4 .6 .8 1"/>
                    <feFuncB type="discrete" tableValues="0 .2 .4 .6 .8 1"/>
                </feComponentTransfer>
            </filter>`;
        document.body.appendChild(svg);
        const style = document.createElement('style');
        style.textContent = `
            body.pixel-mode #wrapper, body.pixel-mode .more-inner { filter: url(#fx-pixelate); }
            body.pixel-mode::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 8999;
                background: repeating-linear-gradient(0deg, rgba(0,0,0,.12) 0 1px, transparent 1px 3px); }
        `;
        document.head.appendChild(style);
    }

    function togglePixelMode(force) {
        ensureFilter();
        const on = force ?? !document.body.classList.contains('pixel-mode');
        foundPixel = true;
        try { sessionStorage.setItem('hint-pixel', '1'); sessionStorage.setItem('hint-start', '1'); } catch { }
        document.body.classList.toggle('pixel-mode', on);
        [392, 523, 659].forEach((f, i) => setTimeout(() => blip(on ? f : 1000 - f), i * 80));
        toast(on ? (isTouch ? 'PIXEL MODE ON (tap "portfolio" 5x to exit)' : 'PIXEL MODE ON  (Esc to exit)') : 'Pixel mode off');
    }

    // keyboard: Konami code or typing "pixel"
    const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let keys = [], typed = '';
    window.addEventListener('keydown', e => {
        if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
        if (e.key === 'Escape' && document.body.classList.contains('pixel-mode')) return togglePixelMode(false);
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        keys = [...keys, k].slice(-KONAMI.length);
        if (keys.join() === KONAMI.join()) { keys = []; togglePixelMode(); return; }
        if (k.length === 1) {
            typed = (typed + k).slice(-5);
            if (typed === 'pixel') { typed = ''; togglePixelMode(); }
        }
    });

    // touch: 5 quick taps on the "portfolio" sticker
    let taps = [];
    function countPortfolioTap() {
        const now = Date.now();
        taps = [...taps.filter(t => now - t < 3000), now];
        if (taps.length >= 5) { taps = []; togglePixelMode(); }
        else if (taps.length >= 2 && !document.body.classList.contains('pixel-mode')) toast(`${5 - taps.length} more\u2026`);
    }

    window.CollageFun = { run, togglePixelMode, confetti };
})();
