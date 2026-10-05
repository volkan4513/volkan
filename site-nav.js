// Shared "back to portfolio" button for project pages.
//   <script src="../../pixel-transition.js"></script>
//   <script src="../../site-nav.js" data-home="../../index.html"></script>
// Optional: data-position="top-right" (default top-left), data-label="HOME".
(function () {
    const me = document.currentScript;
    const home = (me && me.dataset.home) || '../../index.html';
    const label = (me && me.dataset.label) || 'HOME';
    const right = me && me.dataset.position === 'top-right';

    const style = document.createElement('style');
    style.textContent = `
        .site-home-btn {
            all: unset;
            box-sizing: border-box;
            width: auto;
            height: auto;
            border-radius: 0;
            transform: none;
            position: fixed;
            top: max(10px, env(safe-area-inset-top));
            ${right ? 'right' : 'left'}: max(10px, env(safe-area-inset-${right ? 'right' : 'left'}));
            z-index: 9500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: 36px;
            padding: 8px 12px;
            font: bold 12px/1 ui-monospace, 'Courier New', monospace;
            letter-spacing: 1px;
            color: #0d0d0d;
            background: #ffd23f;
            border: 3px solid #000;
            box-shadow: inset -3px -3px 0 rgba(0,0,0,.3), inset 3px 3px 0 rgba(255,255,255,.45), 3px 3px 0 #000;
            cursor: pointer;
            touch-action: manipulation;
            -webkit-tap-highlight-color: transparent;
            opacity: .92;
        }
        .site-home-btn:hover { opacity: 1; transform: none; background: #ffd23f; }
        .site-home-btn:active { transform: translate(3px, 3px); box-shadow: inset 3px 3px 0 rgba(0,0,0,.3); }
        .site-home-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
        @media print { .site-home-btn { display: none; } }
    `;
    document.head.appendChild(style);

    function mount() {
        const btn = document.createElement('button');
        btn.className = 'site-home-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Back to portfolio');
        btn.innerHTML = '<span aria-hidden="true">&#9664;</span> ' + label;
        btn.addEventListener('click', () => {
            if (window.PixelTransition) window.PixelTransition.go(home);
            else window.location.href = home;
        });
        document.body.appendChild(btn);
    }

    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
