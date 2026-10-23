// Paint: pencil, brush, eraser, fill, text, colour picker and shapes, two
// colours (left / right click), undo / redo, canvas resize, zoom, and
// open / save as PNG in the virtual file system.
'use strict';
WinApps.paint = {
    mount(w, args) {
        const b = w.body;
        let tool = 'brush', prevTool = 'brush', size = store.get('ptSize', 4), c1 = '#000000', c2 = '#ffffff', fillMode = 'outline', zoom = 1;
        let path = null, name = 'Untitled.png', dirty = false, drawing = null, undo = [], redo = [];
        const PAL = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
            '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
        const TOOLS = [['pencil', '✏️', 'Pencil (P)'], ['brush', '🖌️', 'Brush (B)'], ['eraser', '🧽', 'Eraser (E)'], ['fill', '🪣', 'Fill (F)'], ['text', '🔤', 'Text (T)'], ['picker', '💧', 'Colour picker (I)'],
            ['line', '╱', 'Line (L)'], ['rect', '▭', 'Rectangle (R)'], ['ellipse', '◯', 'Ellipse (O)'], ['rrect', '▢', 'Rounded rectangle'], ['tri', '△', 'Triangle'], ['arrow', '➔', 'Arrow']];
        const KEYS = { p: 'pencil', b: 'brush', e: 'eraser', f: 'fill', t: 'text', i: 'picker', l: 'line', r: 'rect', o: 'ellipse' };
        const SHAPES = ['line', 'rect', 'ellipse', 'rrect', 'tri', 'arrow'];
        const toolBtn = ([id, ic, t]) => `<button class="pt-tool" data-t="${id}" title="${t}" aria-label="${t}">${ic}</button>`;
        b.innerHTML = `<div class="pt">
            <div class="app-menu"><button data-m="file">File</button><span class="sep"></span><button data-a="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${wico('undo')}</button><button data-a="redo" title="Redo (Ctrl+Y)" aria-label="Redo">${wico('redo')}</button><span class="sep"></span><button data-a="resize">Resize canvas</button><button data-a="clear">Clear</button></div>
            <div class="pt-ribbon">
                <div class="pt-grp"><div class="pt-tools">${TOOLS.slice(0, 6).map(toolBtn).join('')}</div><small>Tools</small></div>
                <div class="pt-grp"><div class="pt-tools">${TOOLS.slice(6).map(toolBtn).join('')}</div><small>Shapes</small></div>
                <div class="pt-grp"><select class="dlg-in pt-fill" aria-label="Shape style"><option value="outline">Outline</option><option value="fill">Fill</option><option value="both">Outline + fill</option></select><small>Shape style</small></div>
                <div class="pt-grp"><div class="pt-sz"><input type="range" class="pt-size" min="1" max="60" aria-label="Size"><b class="pt-sv"></b></div><small>Size</small></div>
                <div class="pt-grp"><div class="pt-colors"><span class="pt-cs"><button class="pt-c c1" title="Colour 1 (left click)" aria-label="Colour 1"></button><button class="pt-c c2" title="Colour 2 (right click)" aria-label="Colour 2"></button></span>
                    <div class="pt-pal">${PAL.map(c => `<button data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div><label class="pt-custom" title="Edit colour 1">🎨<input type="color" aria-label="Custom colour"></label></div><small>Colours · right-click for colour 2</small></div>
            </div>
            <div class="pt-area"><div class="pt-stage"><canvas class="pt-cv"></canvas><canvas class="pt-ov"></canvas><textarea class="pt-txt" hidden aria-label="Text"></textarea><i class="pt-rz" title="Drag to resize the canvas"></i></div></div>
            <div class="app-status"><span class="pt-xy"></span><span class="pt-dim"></span><span class="grow"></span><button class="ib" data-a="zout" aria-label="Zoom out">－</button><input type="range" class="pt-zoom" min="25" max="400" step="25" value="100" aria-label="Zoom"><button class="ib" data-a="zin" aria-label="Zoom in">＋</button><span class="pt-zl">100%</span></div>
        </div>`;
        const $q = s => b.querySelector(s), cv = $q('.pt-cv'), ov = $q('.pt-ov'), stage = $q('.pt-stage'), txt = $q('.pt-txt');
        const ctx = cv.getContext('2d', { willReadFrequently: true }), octx = ov.getContext('2d');

        function blank(W = 960, H = 600) {
            cv.width = ov.width = W; cv.height = ov.height = H;
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
            setZoom(zoom);
        }
        function setZoom(z) {
            zoom = Math.max(0.25, Math.min(4, z));
            [cv, ov].forEach(c => { c.style.width = cv.width * zoom + 'px'; c.style.height = cv.height * zoom + 'px'; });
            stage.style.width = cv.width * zoom + 'px'; stage.style.height = cv.height * zoom + 'px';
            stage.classList.toggle('pix', zoom > 1);
            $q('.pt-zoom').value = Math.round(zoom * 100);
            $q('.pt-zl').textContent = Math.round(zoom * 100) + '%';
            $q('.pt-dim').textContent = `${cv.width} × ${cv.height}px`;
        }
        function title() { w.setTitle(`${dirty ? '*' : ''}${name} - Paint`); }
        function touch() { if (!dirty) { dirty = true; title(); } }
        function ui() {
            b.querySelectorAll('.pt-tool').forEach(x => x.classList.toggle('on', x.dataset.t === tool));
            $q('.c1').style.background = c1; $q('.c2').style.background = c2;
            $q('.pt-size').value = size; $q('.pt-sv').textContent = size + 'px';
            $q('.pt-custom input').value = c1;
            ov.style.cursor = tool === 'text' ? 'text' : tool === 'picker' || tool === 'fill' ? 'cell' : 'crosshair';
        }
        // ---- history
        function snapshot() {
            undo.push(ctx.getImageData(0, 0, cv.width, cv.height));
            if (undo.length > 20) undo.shift();
            redo = [];
        }
        function restore(img) {
            if (img.width !== cv.width || img.height !== cv.height) { cv.width = ov.width = img.width; cv.height = ov.height = img.height; setZoom(zoom); }
            ctx.putImageData(img, 0, 0);
            touch();
        }
        function doUndo() { if (!undo.length) return; redo.push(ctx.getImageData(0, 0, cv.width, cv.height)); restore(undo.pop()); }
        function doRedo() { if (!redo.length) return; undo.push(ctx.getImageData(0, 0, cv.width, cv.height)); restore(redo.pop()); }
        // ---- drawing
        const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
        function pen(g, col) {
            g.strokeStyle = col; g.fillStyle = col;
            if (tool === 'pencil') { g.lineWidth = Math.max(1, Math.round(size / 3)); g.lineCap = 'square'; g.lineJoin = 'miter'; }
            else if (tool === 'eraser') { g.lineWidth = size * 2; g.lineCap = 'square'; g.lineJoin = 'miter'; }
            else { g.lineWidth = size; g.lineCap = 'round'; g.lineJoin = 'round'; }
        }
        function shape(g, k, x0, y0, x1, y1, shift, col, alt) {
            if (shift) {
                if (k === 'line' || k === 'arrow') { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(a) * d; y1 = y0 + Math.sin(a) * d; }
                else { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
            }
            g.lineWidth = size; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = col;
            g.beginPath();
            const l = Math.min(x0, x1), t = Math.min(y0, y1), wd = Math.abs(x1 - x0), ht = Math.abs(y1 - y0);
            if (k === 'line' || k === 'arrow') {
                g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
                if (k === 'arrow') {
                    const a = Math.atan2(y1 - y0, x1 - x0), h = Math.max(10, size * 3);
                    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - h * Math.cos(a - 0.45), y1 - h * Math.sin(a - 0.45)); g.lineTo(x1 - h * Math.cos(a + 0.45), y1 - h * Math.sin(a + 0.45)); g.closePath();
                    g.fillStyle = col; g.fill();
                }
                return;
            }
            if (k === 'rect') g.rect(l, t, wd, ht);
            else if (k === 'ellipse') g.ellipse(l + wd / 2, t + ht / 2, wd / 2, ht / 2, 0, 0, Math.PI * 2);
            else if (k === 'tri') { g.moveTo(l + wd / 2, t); g.lineTo(l + wd, t + ht); g.lineTo(l, t + ht); g.closePath(); }
            else if (k === 'rrect') {
                const r = Math.min(wd, ht) * 0.22;
                g.moveTo(l + r, t); g.arcTo(l + wd, t, l + wd, t + ht, r); g.arcTo(l + wd, t + ht, l, t + ht, r); g.arcTo(l, t + ht, l, t, r); g.arcTo(l, t, l + wd, t, r); g.closePath();
            }
            if (fillMode === 'fill') { g.fillStyle = col; g.fill(); }
            else if (fillMode === 'both') { g.fillStyle = alt; g.fill(); g.stroke(); }
            else g.stroke();
        }
        function flood(x, y, hex) {
            const W = cv.width, H = cv.height;
            if (x < 0 || y < 0 || x >= W || y >= H) return;
            const img = ctx.getImageData(0, 0, W, H), d = new Uint32Array(img.data.buffer), seen = new Uint8Array(W * H);
            const n = parseInt(hex.slice(1), 16), fill = (255 << 24 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0;
            const target = d[y * W + x], tol = 48 * 48;
            if (target === fill) return;
            const match = c => { const dr = (c & 255) - (target & 255), dg = (c >> 8 & 255) - (target >> 8 & 255), db = (c >> 16 & 255) - (target >> 16 & 255), da = (c >>> 24) - (target >>> 24); return dr * dr + dg * dg + db * db + da * da <= tol; };
            const ok = i => !seen[i] && match(d[i]);
            const stack = [x, y];
            while (stack.length) {
                const yy = stack.pop();
                let xx = stack.pop(), i = yy * W + xx;
                while (xx > 0 && ok(i - 1)) { xx--; i--; }
                let up = false, dn = false;
                while (xx < W && ok(i)) {
                    d[i] = fill; seen[i] = 1;
                    if (yy > 0) { const m = ok(i - W); if (m && !up) { stack.push(xx, yy - 1); up = true; } else if (!m) up = false; }
                    if (yy < H - 1) { const m = ok(i + W); if (m && !dn) { stack.push(xx, yy + 1); dn = true; } else if (!m) dn = false; }
                    xx++; i++;
                }
            }
            ctx.putImageData(img, 0, 0);
        }
        // ---- text
        let textAt = null;
        function startText(p, col) {
            commitText();
            const fs = Math.max(12, size * 3);
            textAt = { x: p.x, y: p.y, col, fs };
            Object.assign(txt.style, { left: p.x * zoom + 'px', top: p.y * zoom + 'px', fontSize: fs * zoom + 'px', color: col, width: Math.max(120, (cv.width - p.x) * zoom * 0.6) + 'px' });
            txt.value = ''; txt.hidden = false;
            setTimeout(() => txt.focus(), 0);
        }
        function commitText() {
            if (!textAt || txt.hidden) return;
            const v = txt.value;
            txt.hidden = true;
            if (v.trim()) {
                snapshot();
                ctx.fillStyle = textAt.col; ctx.textBaseline = 'top'; ctx.font = `${textAt.fs}px 'Segoe UI', sans-serif`;
                v.split('\n').forEach((line, i) => ctx.fillText(line, textAt.x + 2, textAt.y + 2 + i * textAt.fs * 1.25));
                touch();
            }
            textAt = null;
        }
        txt.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); txt.hidden = true; textAt = null; }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
        });
        txt.addEventListener('blur', commitText);

        ov.addEventListener('contextmenu', e => e.preventDefault());
        ov.addEventListener('pointerdown', e => {
            if (e.button > 2 || e.button === 1) return;
            e.preventDefault();
            const p = pos(e), col = e.button === 2 ? c2 : c1, alt = e.button === 2 ? c1 : c2;
            if (tool === 'picker') {
                const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data, hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
                if (e.button === 2) c2 = hex; else c1 = hex;
                tool = prevTool; ui(); return;
            }
            if (tool === 'fill') { snapshot(); flood(Math.floor(p.x), Math.floor(p.y), col); touch(); return; }
            if (tool === 'text') { startText(p, col); return; }
            ov.setPointerCapture(e.pointerId);
            snapshot();
            drawing = { x0: p.x, y0: p.y, last: p, col: tool === 'eraser' ? alt : col, alt };
            if (!SHAPES.includes(tool)) { pen(ctx, drawing.col); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.01, p.y); ctx.stroke(); touch(); }
        });
        ov.addEventListener('pointermove', e => {
            const p = pos(e);
            $q('.pt-xy').textContent = `${Math.max(0, Math.floor(p.x))}, ${Math.max(0, Math.floor(p.y))}px`;
            if (!drawing) return;
            if (SHAPES.includes(tool)) {
                octx.clearRect(0, 0, ov.width, ov.height);
                shape(octx, tool, drawing.x0, drawing.y0, p.x, p.y, e.shiftKey, drawing.col, drawing.alt);
            } else {
                pen(ctx, drawing.col);
                (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => {
                    const q = pos(ev);
                    ctx.beginPath(); ctx.moveTo(drawing.last.x, drawing.last.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                    drawing.last = q;
                });
            }
        });
        const end = e => {
            if (!drawing) return;
            if (SHAPES.includes(tool)) {
                const p = pos(e);
                octx.clearRect(0, 0, ov.width, ov.height);
                if (Math.hypot(p.x - drawing.x0, p.y - drawing.y0) > 1) { shape(ctx, tool, drawing.x0, drawing.y0, p.x, p.y, e.shiftKey, drawing.col, drawing.alt); touch(); }
                else undo.pop();
            }
            drawing = null;
        };
        ov.addEventListener('pointerup', end);
        ov.addEventListener('pointercancel', end);
        ov.addEventListener('pointerleave', () => { $q('.pt-xy').textContent = ''; });

        // ---- canvas resize (dialog or the corner handle)
        function resizeCanvas(W, H) {
            W = Math.round(Math.max(1, Math.min(4096, W))); H = Math.round(Math.max(1, Math.min(4096, H)));
            if (W === cv.width && H === cv.height) return;
            snapshot();
            const old = ctx.getImageData(0, 0, cv.width, cv.height);
            cv.width = ov.width = W; cv.height = ov.height = H;
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
            ctx.putImageData(old, 0, 0);
            setZoom(zoom); touch();
        }
        $q('.pt-rz').addEventListener('pointerdown', e => {
            e.preventDefault(); e.stopPropagation();
            const h = e.target, sx = e.clientX, sy = e.clientY, W0 = cv.width, H0 = cv.height;
            h.setPointerCapture(e.pointerId);
            stage.classList.add('resizing');
            let W = W0, H = H0;
            const mv = ev => { W = Math.max(1, Math.round(W0 + (ev.clientX - sx) / zoom)); H = Math.max(1, Math.round(H0 + (ev.clientY - sy) / zoom)); stage.style.width = W * zoom + 'px'; stage.style.height = H * zoom + 'px'; $q('.pt-dim').textContent = `${W} × ${H}px`; };
            const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); stage.classList.remove('resizing'); resizeCanvas(W, H); setZoom(zoom); };
            h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up);
        });

        // ---- files
        const blob = () => new Promise(r => cv.toBlob(r, 'image/png'));
        async function loadImage(src, nm, p) {
            const im = new Image();
            await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; }).catch(() => { throw new Error('Couldn’t open that picture'); });
            const k = Math.min(1, 4096 / Math.max(im.naturalWidth, im.naturalHeight));
            undo = []; redo = [];
            cv.width = ov.width = Math.round(im.naturalWidth * k); cv.height = ov.height = Math.round(im.naturalHeight * k);
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.drawImage(im, 0, 0, cv.width, cv.height);
            const fit = Math.min(1, ($q('.pt-area').clientWidth - 40) / cv.width, ($q('.pt-area').clientHeight - 40) / cv.height);
            setZoom(fit < 1 ? Math.max(0.25, Math.floor(fit * 4) / 4) : 1);
            path = p; name = nm.replace(/\.[^.]+$/, '') + (p ? nm.slice(nm.lastIndexOf('.')) : '.png'); dirty = false; title();
        }
        async function openPath(p) {
            const f = FS.get(p); if (!f) return;
            try { await loadImage(FS.urlOf(p), f.name, !f.builtin && FS.extOf(p) === 'png' ? p : null); Shell.addRecent('file:' + p); } catch (err) { toast(err.message); }
        }
        async function askSave() { return !dirty || Shell.confirm(`Discard the changes to “${name}”?`, 'Discard', 'Unsaved changes'); }
        async function openDialog() {
            if (!(await askSave())) return;
            const r = await Shell.filePicker({ mode: 'open', title: 'Open a picture', dir: '/Pictures', exts: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] });
            if (!r) return;
            if (r.path) return openPath(r.path);
            const u = URL.createObjectURL(r.file);
            loadImage(u, r.file.name, null).catch(err => toast(err.message)).finally(() => URL.revokeObjectURL(u));
        }
        async function save(as) {
            commitText();
            let p = path;
            if (!p || as) {
                const r = await Shell.filePicker({ mode: 'save', title: 'Save picture', dir: p ? FS.dirOf(p) : '/Pictures/My drawings', name: name.replace(/\.[^.]+$/, '') + '.png', exts: ['png'] });
                if (!r) return false;
                p = r.path;
            }
            try { await FS.write(p, await blob(), 'image/png'); path = p; name = FS.baseOf(p); dirty = false; title(); Shell.addRecent('file:' + p); toast('Saved to ' + FS.dirOf(p).slice(1)); return true; }
            catch (err) { toast(err.message); return false; }
        }
        async function download() { const u = URL.createObjectURL(await blob()), a = document.createElement('a'); a.href = u; a.download = name.replace(/\.[^.]+$/, '') + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
        const FILE = () => [
            { label: 'New', fn: async () => { if (await askSave()) { undo = []; redo = []; blank(); path = null; name = 'Untitled.png'; dirty = false; title(); } } },
            { label: 'Open…', key: 'Ctrl+O', fn: openDialog },
            { label: 'Save', key: 'Ctrl+S', fn: () => save(false) },
            { label: 'Save as…', key: 'Ctrl+Shift+S', fn: () => save(true) },
            { label: 'Download PNG', fn: download },
            '-', { label: 'Set as desktop background', icon: wico('photos'), fn: async () => Shell.addWallpaper(await blob(), name) },
            '-', { label: 'Exit', fn: () => w.close() },
        ];

        // ---- controls
        b.querySelector('.app-menu').addEventListener('click', async e => {
            const m = e.target.closest('[data-m]');
            if (m) { const r = m.getBoundingClientRect(); Shell.menu(r.left, r.bottom + 2, FILE()); return; }
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'undo') doUndo(); else if (a === 'redo') doRedo();
            else if (a === 'clear') { snapshot(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); touch(); }
            else if (a === 'resize') {
                const v = await Shell.ask({ title: 'Resize canvas', label: 'Width × height, in pixels', value: `${cv.width} × ${cv.height}`, select: false });
                const m2 = v && v.match(/(\d+)\D+(\d+)/);
                if (m2) resizeCanvas(+m2[1], +m2[2]); else if (v) toast('Type it like 800 × 600');
            }
        });
        b.querySelector('.app-status').addEventListener('click', e => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'zin') setZoom(zoom * 2 > 4 ? 4 : zoom >= 1 ? zoom + 0.5 : zoom * 2);
            if (a === 'zout') setZoom(zoom > 1 ? zoom - 0.5 : zoom / 2);
        });
        $q('.pt-zoom').oninput = e => setZoom(+e.target.value / 100);
        b.querySelector('.pt-ribbon').addEventListener('click', e => {
            const t = e.target.closest('[data-t]');
            if (t) { commitText(); if (t.dataset.t === 'picker' && tool !== 'picker') prevTool = tool; tool = t.dataset.t; ui(); return; }
            const c = e.target.closest('[data-c]');
            if (c) { c1 = c.dataset.c; ui(); }
            if (e.target.closest('.c2')) { [c1, c2] = [c2, c1]; ui(); }
        });
        $q('.pt-pal').addEventListener('contextmenu', e => { const c = e.target.closest('[data-c]'); if (c) { e.preventDefault(); c2 = c.dataset.c; ui(); } });
        $q('.pt-custom input').oninput = e => { c1 = e.target.value; ui(); };
        $q('.pt-size').oninput = e => { size = +e.target.value; store.set('ptSize', size); ui(); };
        $q('.pt-fill').onchange = e => { fillMode = e.target.value; };
        $q('.pt-area').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.25 : 0.8)); }, { passive: false });
        w.el.addEventListener('keydown', e => {
            if (e.target === txt) return;
            const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
            if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
            else if (mod && k === 'y') { e.preventDefault(); doRedo(); }
            else if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); }
            else if (mod && k === 'o') { e.preventDefault(); openDialog(); }
            else if (!mod && KEYS[k]) { if (KEYS[k] === 'picker' && tool !== 'picker') prevTool = tool; tool = KEYS[k]; ui(); }
            else if (!mod && (k === '[' || k === ']')) { size = Math.max(1, Math.min(60, size + (k === ']' ? 1 : -1))); ui(); }
            else if (!mod && k === 'x') { [c1, c2] = [c2, c1]; ui(); }
        });
        // drop a picture onto the window to open it
        b.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
        b.addEventListener('drop', async e => {
            const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
            if (!f) return;
            e.preventDefault(); e.stopPropagation();
            if (!(await askSave())) return;
            const u = URL.createObjectURL(f);
            loadImage(u, f.name, null).catch(err => toast(err.message)).finally(() => URL.revokeObjectURL(u));
        });

        blank(); ui(); title();
        if (args.path) FS.ready.then(() => openPath(args.path));
        return {
            onArgs: async a => { if (a.path && await askSave()) openPath(a.path); },
            onClose: async () => { commitText(); return askSave(); },
        };
    },
};
