// Registers the service worker (sw.js) so the site keeps working offline,
// shows a one-time "ready offline" toast, and drives the optional
// "save everything" button (#saveOfflineBtn) on the main page.
//   <script src="offline.js"></script>   (path relative to the page)
(function () {
    if (!('serviceWorker' in navigator)) return;
    const base = new URL('.', document.currentScript.src);   // site root (offline.js lives there)
    const swUrl = new URL('sw.js', base);

    // http://localhost and https only; file:// can't run service workers
    if (!/^https?:$/.test(location.protocol)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register(swUrl.href, { scope: base.href }).catch(err => console.warn('Offline mode unavailable:', err));
    });

    function toast(text) {
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.textContent = text;
        Object.assign(el.style, {
            position: 'fixed', left: '50%', bottom: 'max(16px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)',
            zIndex: 9600, padding: '10px 14px', font: 'bold 12px/1.4 ui-monospace, "Courier New", monospace',
            color: '#0d0d0d', background: '#3ddc84', border: '3px solid #000', boxShadow: '3px 3px 0 #000',
            maxWidth: 'calc(100vw - 32px)', textAlign: 'center', pointerEvents: 'none',
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3800);
    }

    const btn = () => document.getElementById('saveOfflineBtn');
    const mb = bytes => Math.round(bytes / 1e6) + ' MB';
    function setButton(text, disabled) {
        const b = btn();
        if (!b) return;
        b.textContent = text;
        b.disabled = !!disabled;
    }

    navigator.serviceWorker.addEventListener('message', e => {
        const m = e.data || {};
        if (m.type === 'offline-ready') {
            let seen = null;
            try { seen = localStorage.getItem('offline-ready'); localStorage.setItem('offline-ready', m.version); } catch { }
            if (!seen) toast('✓ Saved! This site now works offline.');
            ask();
        } else if (m.type === 'status') {
            if (m.saved >= m.total) setButton('✓ Everything saved for offline', true);
            else setButton(`⬇ Save everything for offline (${mb(m.bytes)})`, false);
        } else if (m.type === 'save-progress') {
            setButton(`Saving… ${m.done}/${m.total}`, true);
        } else if (m.type === 'save-done') {
            setButton(m.saved >= m.total ? '✓ Everything saved for offline' : 'Some files failed — try again', m.saved >= m.total);
            if (m.saved >= m.total) toast('✓ Games and songs saved for offline too.');
        }
    });

    function ask() {
        navigator.serviceWorker.ready.then(reg => reg.active && reg.active.postMessage({ type: 'status' }));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const b = btn();
        if (!b) return;
        b.hidden = false;
        b.addEventListener('click', () => {
            setButton('Saving…', true);
            navigator.serviceWorker.ready.then(reg => reg.active.postMessage({ type: 'save-all' }));
        });
        ask();
    });
})();
