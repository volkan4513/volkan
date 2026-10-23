// Notepad: tabs, open / save in the virtual file system or your device,
// word wrap, zoom, find, status bar.
'use strict';
WinApps.notepad = {
    mount(w, args) {
        const b = w.body;
        let tabs = [], cur = 0, seq = 0, wrap = store.get('npWrap', true), zoom = store.get('npZoom', 100), status = store.get('npStatus', true);
        b.innerHTML = `<div class="np">
            <div class="np-tabs"><div class="np-tablist" role="tablist"></div><button class="np-add" title="New tab" aria-label="New tab">+</button></div>
            <div class="app-menu"><button data-m="file">File</button><button data-m="edit">Edit</button><button data-m="view">View</button></div>
            <div class="np-find" hidden><input type="text" placeholder="Find" aria-label="Find"><button class="wbtn" data-f="prev" aria-label="Previous">↑</button><button class="wbtn" data-f="next" aria-label="Next">↓</button><span class="np-fc"></span><button class="wbtn" data-f="close" aria-label="Close find">✕</button></div>
            <textarea class="np-text" spellcheck="false" aria-label="Text"></textarea>
            <div class="app-status np-status"><span class="np-pos"></span><span class="np-len"></span><span class="np-zoom"></span><span>Windows (CRLF)</span><span>UTF-8</span></div>
        </div>`;
        const ta = b.querySelector('.np-text'), q = s => b.querySelector(s);
        const dirty = t => t.text !== t.saved;

        function newTab(o = {}) {
            const t = { id: ++seq, path: null, name: 'Untitled', text: '', saved: '', sel: [0, 0], scroll: 0, ...o };
            tabs.push(t);
            show(tabs.length - 1);
            return t;
        }
        function stash() {
            const t = tabs[cur];
            if (!t) return;
            t.text = ta.value; t.sel = [ta.selectionStart, ta.selectionEnd]; t.scroll = ta.scrollTop;
        }
        function show(i) {
            stash();
            cur = i;
            const t = tabs[cur];
            ta.value = t.text;
            ta.setSelectionRange(t.sel[0], t.sel[1]);
            ta.scrollTop = t.scroll;
            render();
            ta.focus({ preventScroll: true });
        }
        function render() {
            const t = tabs[cur];
            q('.np-tablist').innerHTML = tabs.map((x, i) => `<div class="np-tab ${i === cur ? 'on' : ''}" data-i="${i}" role="tab" aria-selected="${i === cur}" title="${esc(x.path || x.name)}"><span>${esc(x.name)}</span><button data-close="${i}" aria-label="Close tab">${dirty(x) ? '●' : '✕'}</button></div>`).join('');
            w.setTitle(`${dirty(t) ? '*' : ''}${t.name} - Notepad`);
            ta.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
            ta.style.overflowX = wrap ? 'hidden' : 'auto';
            ta.style.fontSize = (15 * zoom / 100).toFixed(1) + 'px';
            q('.np-status').hidden = !status;
            caret();
        }
        function caret() {
            const v = ta.value, p = ta.selectionStart, before = v.slice(0, p), ln = before.split('\n').length, col = p - before.lastIndexOf('\n');
            q('.np-pos').textContent = `Ln ${ln}, Col ${col}`;
            q('.np-len').textContent = `${v.length} characters`;
            q('.np-zoom').textContent = zoom + '%';
        }
        async function openPath(path) {
            const ex = tabs.findIndex(t => t.path === path);
            if (ex >= 0) return show(ex);
            try {
                const text = await FS.readText(path), f = FS.get(path);
                const blank = tabs[cur] && !tabs[cur].path && !tabs[cur].text && !dirty(tabs[cur]);
                const o = { path: f.builtin ? null : path, name: f.name, text, saved: text };
                if (blank) { stash(); Object.assign(tabs[cur], o); show(cur); } else newTab(o);
                Shell.addRecent('file:' + path);
            } catch (err) { toast(err.message); }
        }
        async function openDialog() {
            const r = await Shell.filePicker({ mode: 'open', title: 'Open', dir: '/Documents', exts: ['txt', 'md', 'log', 'csv', 'json', 'html', 'css', 'js', 'xml', 'ini'] });
            if (!r) return;
            if (r.path) return openPath(r.path);
            const text = await r.file.text();
            newTab({ name: r.file.name, text, saved: '' });
        }
        async function save(as) {
            stash();
            const t = tabs[cur];
            let path = t.path;
            if (!path || as) {
                const r = await Shell.filePicker({ mode: 'save', title: 'Save as', dir: path ? FS.dirOf(path) : '/Documents', name: t.name === 'Untitled' ? 'Untitled.txt' : t.name, exts: ['txt', 'md', 'json', 'html', 'css', 'js', 'csv', 'log'] });
                if (!r) return false;
                path = r.path;
            }
            try {
                await FS.write(path, t.text, FS.get(path)?.mime);
                Object.assign(t, { path, name: FS.baseOf(path), saved: t.text });
                Shell.addRecent('file:' + path);
                render();
                return true;
            } catch (err) { toast(err.message); return false; }
        }
        function download() {
            stash();
            const t = tabs[cur], a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([t.text], { type: 'text/plain' }));
            a.download = /\.\w+$/.test(t.name) ? t.name : t.name + '.txt';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }
        async function closeTab(i) {
            stash();
            if (dirty(tabs[i]) && !(await Shell.confirm(`Close “${tabs[i].name}” without saving?`, 'Close tab', 'Unsaved changes'))) return;
            tabs.splice(i, 1);
            if (!tabs.length) { w.close(); return; }
            if (i < cur) cur--;
            cur = Math.min(cur, tabs.length - 1);
            const t = tabs[cur];
            ta.value = t.text;
            ta.setSelectionRange(t.sel[0], t.sel[1]);
            ta.scrollTop = t.scroll;
            render();
        }
        function setZoom(z) { zoom = Math.max(50, Math.min(300, z)); store.set('npZoom', zoom); render(); }
        function insert(text) { ta.focus(); document.execCommand('insertText', false, text) || ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); onInput(); }
        // find
        function find(dir) {
            const needle = q('.np-find input').value;
            if (!needle) return;
            const v = ta.value.toLowerCase(), n = needle.toLowerCase();
            let i = dir < 0 ? v.lastIndexOf(n, ta.selectionStart - 1) : v.indexOf(n, ta.selectionEnd);
            if (i < 0) i = dir < 0 ? v.lastIndexOf(n) : v.indexOf(n);
            const count = v.split(n).length - 1;
            q('.np-fc').textContent = count ? `${count} found` : 'No matches';
            if (i < 0) return;
            ta.focus();
            ta.setSelectionRange(i, i + n.length);
            // scroll the match into view
            const line = ta.value.slice(0, i).split('\n').length;
            ta.scrollTop = Math.max(0, (line - 3) * parseFloat(getComputedStyle(ta).lineHeight || 20));
            q('.np-find input').focus();
        }
        function openFind() { q('.np-find').hidden = false; const s = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (s && !s.includes('\n')) q('.np-find input').value = s; q('.np-find input').select(); }

        const MENUS = {
            file: () => [
                { label: 'New tab', fn: () => newTab() },
                { label: 'New window', fn: () => Shell.launch('notepad', { fresh: true }) },
                { label: 'Open…', key: 'Ctrl+O', fn: openDialog },
                { label: 'Save', key: 'Ctrl+S', fn: () => save(false) },
                { label: 'Save as…', key: 'Ctrl+Shift+S', fn: () => save(true) },
                { label: 'Download', fn: download },
                '-', { label: 'Close tab', fn: () => closeTab(cur) }, { label: 'Exit', fn: () => w.close() },
            ],
            edit: () => [
                { label: 'Undo', key: 'Ctrl+Z', fn: () => { ta.focus(); document.execCommand('undo'); } },
                '-',
                { label: 'Cut', key: 'Ctrl+X', fn: () => { ta.focus(); document.execCommand('cut'); onInput(); } },
                { label: 'Copy', key: 'Ctrl+C', fn: () => { ta.focus(); document.execCommand('copy'); } },
                { label: 'Paste', key: 'Ctrl+V', fn: () => navigator.clipboard?.readText().then(insert).catch(() => toast('Press Ctrl+V to paste')) },
                { label: 'Delete', key: 'Del', fn: () => insert('') },
                '-',
                { label: 'Find…', key: 'Ctrl+F', fn: openFind },
                { label: 'Select all', key: 'Ctrl+A', fn: () => { ta.focus(); ta.select(); caret(); } },
                { label: 'Time / Date', key: 'F5', fn: () => insert(new Date().toLocaleString()) },
            ],
            view: () => [
                { label: 'Zoom in', key: 'Ctrl+=', fn: () => setZoom(zoom + 10) },
                { label: 'Zoom out', key: 'Ctrl+-', fn: () => setZoom(zoom - 10) },
                { label: 'Restore default zoom', key: 'Ctrl+0', fn: () => setZoom(100) },
                '-',
                { label: 'Word wrap', check: wrap, fn: () => { wrap = !wrap; store.set('npWrap', wrap); render(); } },
                { label: 'Status bar', check: status, fn: () => { status = !status; store.set('npStatus', status); render(); } },
            ],
        };
        q('.app-menu').addEventListener('click', e => {
            const m = e.target.closest('[data-m]'); if (!m) return;
            const r = m.getBoundingClientRect();
            Shell.menu(r.left, r.bottom + 2, MENUS[m.dataset.m]());
        });
        q('.np-add').onclick = () => newTab();
        q('.np-tablist').addEventListener('click', e => {
            const c = e.target.closest('[data-close]');
            if (c) { closeTab(+c.dataset.close); return; }
            const t = e.target.closest('.np-tab');
            if (t) show(+t.dataset.i);
        });
        q('.np-tablist').addEventListener('auxclick', e => { const t = e.target.closest('.np-tab'); if (t && e.button === 1) closeTab(+t.dataset.i); });
        const onInput = () => {
            const t = tabs[cur], was = dirty(t);
            t.text = ta.value;
            if (was !== dirty(t)) render(); else caret();
        };
        ta.addEventListener('input', onInput);
        ['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, caret));
        ta.addEventListener('keydown', e => {
            if (e.key === 'Tab' && !e.ctrlKey) { e.preventDefault(); insert('\t'); }
        });
        q('.np-find').addEventListener('click', e => {
            const f = e.target.closest('[data-f]')?.dataset.f;
            if (f === 'close') { q('.np-find').hidden = true; ta.focus(); } else if (f) find(f === 'prev' ? -1 : 1);
        });
        q('.np-find input').addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { e.stopPropagation(); q('.np-find').hidden = true; ta.focus(); }
        });
        w.el.addEventListener('keydown', e => {
            const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
            if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); }
            else if (mod && k === 'o') { e.preventDefault(); openDialog(); }
            else if (mod && k === 'f') { e.preventDefault(); openFind(); }
            else if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom(zoom + 10); }
            else if (mod && k === '-') { e.preventDefault(); setZoom(zoom - 10); }
            else if (mod && k === '0') { e.preventDefault(); setZoom(100); }
            else if (e.key === 'F5') { e.preventDefault(); insert(new Date().toLocaleString()); }
        });
        // drop a text file onto the window
        b.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
        b.addEventListener('drop', async e => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            for (const f of e.dataTransfer.files) newTab({ name: f.name, text: await f.text(), saved: '' });
        });

        newTab();
        if (args.path) openPath(args.path);
        return {
            onArgs: a => { if (a.path) openPath(a.path); },
            onFocus: () => setTimeout(() => { if (!w.el.contains(document.activeElement) || document.activeElement === w.el) ta.focus({ preventScroll: true }); }, 0),
            async onClose() {
                stash();
                const n = tabs.filter(dirty).length;
                return !n || Shell.confirm(`${n} tab${n > 1 ? 's have' : ' has'} unsaved changes. Close anyway?`, 'Close', 'Unsaved changes');
            },
        };
    },
};
