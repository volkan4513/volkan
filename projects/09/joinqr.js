// Join-by-QR helpers (classic script, needs qrcode.js first).
//   JoinQR.draw(canvas, url)      draw a QR code for url
//   JoinQR.canScan                true when the browser can read QR codes from the camera
//   JoinQR.scan(onCode)           open a camera overlay; onCode(code) gets the 5-char room code
//   JoinQR.codeFrom(text)         pull a room code out of a scanned link or plain code
(function () {
    const CODE_RE = /^[A-Z2-9]{5}$/;

    function codeFrom(text) {
        text = String(text || '').trim();
        try {
            const j = new URL(text).searchParams.get('join');
            if (j) text = j;
        } catch { /* not a URL */ }
        text = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        return CODE_RE.test(text) ? text : '';
    }

    function draw(canvas, url) {
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        const n = qr.getModuleCount(), quiet = 2, cell = 6, size = (n + quiet * 2) * cell;
        canvas.width = canvas.height = size;
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, size, size);
        g.fillStyle = '#111';
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
    }

    const canScan = 'BarcodeDetector' in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    function scan(onCode) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font:700 16px system-ui,sans-serif;color:#fff';
        const video = document.createElement('video');
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.style.cssText = 'max-width:100%;max-height:75%;border:4px solid #fff';
        const msg = document.createElement('div');
        msg.textContent = 'Point the camera at the room QR code';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Cancel';
        close.style.cssText = 'font:inherit;padding:10px 24px;border:3px solid #fff;background:#222;color:#fff;cursor:pointer';
        wrap.append(video, msg, close);
        document.body.append(wrap);

        let stream = null, alive = true;
        const stop = () => {
            alive = false;
            if (stream) stream.getTracks().forEach((t) => t.stop());
            wrap.remove();
        };
        close.onclick = stop;

        (async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
                if (!alive) return stream.getTracks().forEach((t) => t.stop());
                video.srcObject = stream;
                await video.play();
                const det = new BarcodeDetector({ formats: ['qr_code'] });
                while (alive) {
                    const hits = await det.detect(video).catch(() => []);
                    for (const h of hits) {
                        const code = codeFrom(h.rawValue);
                        if (code) { stop(); onCode(code); return; }
                    }
                    await new Promise((r) => setTimeout(r, 250));
                }
            } catch (err) {
                msg.textContent = 'Camera unavailable: ' + (err && err.message || err);
            }
        })();
    }

    window.JoinQR = { draw, scan, canScan, codeFrom };
})();
