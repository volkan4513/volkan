// Retro pixel-block page transition, shared by index.html and page2.html.
//   PixelTransition.reveal()        - uncover the page (call on load)
//   PixelTransition.cover()         - fill the screen with blocks; resolves when done
//   PixelTransition.go(url)         - cover, then navigate
// Blocks fill in a noisy diagonal sweep. Honours prefers-reduced-motion.
(function () {
    const BLOCK = 32;           // css px per block
    const DURATION = 420;       // ms for a full sweep
    const COLOR = '#0d0d0d';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let canvas, ctx, cols, rows, order, raf = 0;

    function setup() {
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.setAttribute('aria-hidden', 'true');
            Object.assign(canvas.style, {
                position: 'fixed', inset: '0', width: '100vw', height: '100vh',
                zIndex: '10000', pointerEvents: 'none', imageRendering: 'pixelated',
            });
            document.body.appendChild(canvas);
            ctx = canvas.getContext('2d');
        }
        cols = Math.ceil(window.innerWidth / BLOCK);
        rows = Math.ceil(window.innerHeight / BLOCK);
        canvas.width = cols;    // one canvas px per block, scaled up by CSS
        canvas.height = rows;
        // diagonal sweep with jitter so it reads as "pixels", not a wipe
        order = new Float32Array(cols * rows);
        const span = cols + rows;
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++)
                order[y * cols + x] = Math.min(1, ((x + y) / span) * 0.8 + Math.random() * 0.2);
    }

    // progress 0 = nothing covered, 1 = fully covered
    function paint(progress) {
        ctx.clearRect(0, 0, cols, rows);
        ctx.fillStyle = COLOR;
        for (let i = 0; i < order.length; i++)
            if (order[i] < progress) ctx.fillRect(i % cols, (i / cols) | 0, 1, 1);
    }

    function run(from, to) {
        cancelAnimationFrame(raf);
        setup();
        canvas.style.display = 'block';
        if (reduced) {
            paint(to >= 1 ? 1.01 : 0);
            if (to < 1) canvas.style.display = 'none';
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const start = performance.now();
            const tick = now => {
                const t = Math.min(1, (now - start) / DURATION);
                paint(from + (to - from) * t + (to >= 1 ? 0.01 : 0));
                if (t < 1) raf = requestAnimationFrame(tick);
                else {
                    if (to < 1) canvas.style.display = 'none';
                    resolve();
                }
            };
            raf = requestAnimationFrame(tick);
        });
    }

    const api = {
        reveal: () => run(1, 0),
        cover: () => run(0, 1),
        go(url) {
            return api.cover().then(() => { window.location.href = url; });
        },
    };

    // coming back via the browser's back button restores a covered page
    // from the bfcache - uncover it again
    window.addEventListener('pageshow', e => { if (e.persisted) api.reveal(); });

    window.PixelTransition = api;
})();
