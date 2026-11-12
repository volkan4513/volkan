// Small "How it works" button for project pages. Hidden inside the main-page panels (?embed=1) and in screenshot mode.
//   <script src="../../info-link.js" data-info="info.html"></script>
(function () {
    if (/[?&](embed|shot)=1/.test(location.search)) return;
    const me = document.currentScript;
    const href = (me && me.dataset.info) || 'info.html';
    // data-slot="css selector": put the button inside that element, in normal page flow (nothing can overlap it).
    // data-pos="tr|tl|br|bl" (default tr) and data-pos-narrow (phones, under 700px) choose a fixed corner. data-pos="none" = no button.
    const slot = me && me.dataset.slot;
    const pos = (me && me.dataset.pos) || 'tr';
    const posNarrow = (me && me.dataset.posNarrow) || pos;
    if (pos === 'none' && !slot) return;
    const corner = (p) => (p[0] === 'b' ? 'bottom: max(10px, env(safe-area-inset-bottom));' : 'top: max(10px, env(safe-area-inset-top));')
        + (p[1] === 'l' ? 'left: max(10px, env(safe-area-inset-left)); right: auto;' : 'right: max(10px, env(safe-area-inset-right)); left: auto;');
    const style = document.createElement('style');
    style.textContent = `
        .site-info-btn { all: unset; box-sizing: border-box; position: fixed; z-index: 9400;
            ${corner(pos)}
            min-height: 36px; padding: 8px 12px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
            font: bold 12px/1 ui-monospace, 'Courier New', monospace; letter-spacing: 1px; color: #fff; background: #00a5ff;
            border: 3px solid #000; box-shadow: 3px 3px 0 #000; opacity: .9; text-decoration: none; touch-action: manipulation; }
        @media (max-width: 700px) { .site-info-btn:not(.inline) { top: auto; bottom: auto; ${corner(posNarrow)} } }
        .site-info-btn.inline { position: static; flex: none; min-height: 0; padding: 6px 8px; font-size: 11px; margin-left: 6px; white-space: nowrap; }
        .site-info-btn:hover { opacity: 1; }
        .site-info-btn:active { transform: translate(3px, 3px); box-shadow: none; }
        @media print { .site-info-btn { display: none; } }`;
    document.head.appendChild(style);
    function mount() {
        const a = document.createElement('a');
        a.className = 'site-info-btn';
        a.href = href;
        a.setAttribute('aria-label', 'How this project works');
        a.innerHTML = '<span aria-hidden="true">i</span> HOW IT WORKS';
        a.addEventListener('click', (e) => {
            if (window.PixelTransition && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); window.PixelTransition.go(a.href); }
        });
        const host = slot && document.querySelector(slot);
        if (host) { a.classList.add('inline'); a.innerHTML = '<span aria-hidden="true">i</span> INFO'; host.appendChild(a); }
        else if (pos === 'none') return;
        else document.body.appendChild(a);
    }
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
