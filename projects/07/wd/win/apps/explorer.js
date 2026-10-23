// File Explorer: browse the virtual file system (wd/win/vfs.js).
'use strict';
WinApps.explorer = {
    mount(w, args) {
        const b = w.body;
        let cur = args.path && FS.exists(args.path) ? FS.norm(args.path) : '/', hist = [cur], hi = 0, sel = new Set(), view = store.get('exView', 'grid'), q = '', anchor = null;
        const SIDE = ['/Desktop', '/Documents', '/Downloads', '/Music', '/Pictures', '-', '/', '/Recycle Bin'];
        const inBin = () => cur === '/Recycle Bin';
        b.innerHTML = `<div class="ex">
            <div class="ex-top">
                <button class="ib" data-a="back" title="Back (Alt+←)" aria-label="Back">${wico('back')}</button><button class="ib" data-a="fwd" title="Forward" aria-label="Forward">${wico('forward')}</button><button class="ib" data-a="up" title="Up" aria-label="Up">${wico('up')}</button>
                <div class="ex-crumbs" role="navigation" aria-label="Location"></div>
                <input class="dlg-in ex-q" type="search" placeholder="Search" aria-label="Search this folder">
            </div>
            <div class="ex-cmd">
                <button data-a="newfolder">${wico('newfolder')} New folder</button><button data-a="newtext">${wico('newfile')} New text file</button><span class="sep"></span>
                <button data-a="upload">${wico('upload')} Upload</button><button data-a="download">${wico('download')} Download</button><span class="sep"></span>
                <button data-a="rename">${wico('rename')} Rename</button><button data-a="delete">${wico('delete')} Delete</button><button data-a="restore">${wico('restore')} Restore</button><button data-a="empty">${wico('broom')} Empty Recycle Bin</button>
                <span class="grow"></span><button data-a="view" aria-label="Change view">${wico('view')} View</button>
            </div>
            <div class="ex-main"><nav class="ex-side app-nav">${SIDE.map(p => p === '-' ? '<hr>' : `<button data-go="${p}">${FS.dirIcon(p)} ${p === '/' ? 'This PC' : p.slice(1)}</button>`).join('')}</nav>
                <div class="ex-list" tabindex="0" aria-label="Files"></div></div>
            <div class="app-status ex-status"></div>
            <input type="file" multiple hidden class="ex-file">
        </div>`;
        const list = b.querySelector('.ex-list'), $q = s => b.querySelector(s);

        function items() { return q ? FS.search(q, cur) : FS.list(cur); }
        function render() {
            const its = items(), f = FS.get(cur);
            w.setTitle(q ? `Search results in ${f.name}` : f.name);
            const parts = cur === '/' ? [] : cur.slice(1).split('/');
            $q('.ex-crumbs').innerHTML = `<button data-go="/">💻 This PC</button>` + parts.map((p, i) => `<span>›</span><button data-go="/${parts.slice(0, i + 1).join('/')}">${esc(p)}</button>`).join('');
            b.querySelectorAll('.ex-side [data-go]').forEach(x => x.classList.toggle('on', x.dataset.go === cur));
            list.className = 'ex-list ' + view;
            list.innerHTML = its.length ? (view === 'list' ? '<div class="ex-lh"><span>Name</span><span>Date modified</span><span>Size</span></div>' : '') + its.map(f => `<div class="ex-it ${sel.has(f.path) ? 'sel' : ''}" data-p="${esc(f.path)}" draggable="false" title="${esc(f.name)}"><span class="ex-ic">${FS.iconOf(f)}</span><span class="ex-nm">${esc(f.name)}</span>${view === 'list' ? `<span class="ex-dt">${f.mtime ? new Date(f.mtime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}</span><span class="ex-sz">${f.type === 'dir' ? '' : FS.sizeTxt(f.size)}</span>` : ''}${q ? `<span class="ex-loc">${esc(FS.dirOf(f.path))}</span>` : ''}</div>`).join('')
                : `<p class="ex-empty">${q ? 'No items match your search.' : inBin() ? 'The Recycle Bin is empty.' : 'This folder is empty.'}${!q && FS.canWrite(cur) ? '<br><small>Drop files here from your computer, or use Upload.</small>' : ''}</p>`;
            const s = [...sel].map(FS.get).filter(Boolean), writable = FS.canWrite(cur);
            const set = (a, on, show = true) => { const x = $q(`[data-a="${a}"]`); x.disabled = !on; x.hidden = !show; };
            set('newfolder', writable && !q, !inBin()); set('newtext', writable && !q, !inBin()); set('upload', writable, !inBin());
            set('download', s.some(f => f.type === 'file'), !inBin());
            set('rename', s.length === 1 && !s[0].builtin, !inBin());
            set('delete', s.length && s.every(f => !f.builtin));
            set('restore', s.length > 0, inBin()); set('empty', FS.list('/Recycle Bin').length > 0, inBin());
            $q('[data-a="back"]').disabled = hi === 0; $q('[data-a="fwd"]').disabled = hi >= hist.length - 1; $q('[data-a="up"]').disabled = cur === '/';
            const bytes = s.reduce((a, f) => a + (f.size || 0), 0);
            $q('.ex-status').textContent = `${its.length} item${its.length === 1 ? '' : 's'}` + (s.length ? `   ${s.length} selected${bytes ? '  ' + FS.sizeTxt(bytes) : ''}` : '') + (s.length === 1 && s[0].builtin ? '   Built-in, read-only' : '');
        }
        function nav(p, push = true) {
            if (!FS.exists(p)) return;
            cur = FS.norm(p); sel.clear(); q = ''; $q('.ex-q').value = '';
            if (push) { hist = hist.slice(0, hi + 1); hist.push(cur); hi = hist.length - 1; }
            render();
            list.focus({ preventScroll: true });
        }
        function open(p) {
            const f = FS.get(p);
            if (!f) return;
            if (f.type === 'dir') nav(f.path);
            else Shell.openPath(f.path);
        }
        const run = p => p.catch(err => toast(err.message));
        async function rename() {
            const p = [...sel][0]; if (!p) return;
            const n = await Shell.ask({ title: 'Rename', value: FS.baseOf(p) });
            if (!n || n === FS.baseOf(p)) return;
            const to = FS.norm(FS.dirOf(p) + '/' + FS.clean(n));
            await run(FS.move(p, to).then(() => { sel = new Set([to]); render(); }));
        }
        async function del() {
            const ps = [...sel]; if (!ps.length) return;
            if (inBin() && !(await Shell.confirm(`Delete ${ps.length === 1 ? `“${FS.baseOf(ps[0])}”` : ps.length + ' items'} for good?`, 'Delete', 'Delete permanently'))) return;
            for (const p of ps) await run(FS.remove(p));
            sel.clear(); render();
            if (!inBin()) toast(`Moved ${ps.length} item${ps.length > 1 ? 's' : ''} to the Recycle Bin`);
        }
        async function act(a) {
            if (a === 'back' && hi > 0) { hi--; nav(hist[hi], false); }
            else if (a === 'fwd' && hi < hist.length - 1) { hi++; nav(hist[hi], false); }
            else if (a === 'up' && cur !== '/') nav(FS.dirOf(cur));
            else if (a === 'newfolder') { const p = FS.unique(cur, 'New folder'); await run(FS.mkdir(p)); sel = new Set([p]); render(); rename(); }
            else if (a === 'newtext') { const p = FS.unique(cur, 'New text document.txt'); await run(FS.write(p, '')); sel = new Set([p]); render(); rename(); }
            else if (a === 'upload') $q('.ex-file').click();
            else if (a === 'download') [...sel].forEach(p => FS.download(p));
            else if (a === 'rename') rename();
            else if (a === 'delete') del();
            else if (a === 'restore') { for (const p of [...sel]) await run(FS.restore(p)); sel.clear(); render(); }
            else if (a === 'empty') {
                if (!(await Shell.confirm('Permanently delete everything in the Recycle Bin?', 'Empty', 'Empty Recycle Bin'))) return;
                for (const f of FS.list('/Recycle Bin')) await run(FS.purge(f.path));
                sel.clear(); render();
            } else if (a === 'view') {
                const r = $q('[data-a="view"]').getBoundingClientRect();
                Shell.menu(r.left, r.bottom + 2, [['grid', 'Large icons'], ['tiles', 'Small icons'], ['list', 'Details']].map(([v, n]) => ({ label: n, check: view === v, fn: () => { view = v; store.set('exView', v); render(); } })));
            }
        }
        b.addEventListener('click', e => {
            const go = e.target.closest('[data-go]'); if (go) { nav(go.dataset.go); return; }
            const a = e.target.closest('.ex-top [data-a], .ex-cmd [data-a]'); if (a && !a.disabled) act(a.dataset.a);
        });
        list.addEventListener('click', e => {
            const it = e.target.closest('.ex-it');
            if (!it) { sel.clear(); render(); return; }
            const p = it.dataset.p, all = items().map(f => f.path);
            if (e.shiftKey && anchor) { const a = all.indexOf(anchor), z = all.indexOf(p); sel = new Set(all.slice(Math.min(a, z), Math.max(a, z) + 1)); }
            else if (e.ctrlKey || e.metaKey) { sel.has(p) ? sel.delete(p) : sel.add(p); anchor = p; }
            else { sel = new Set([p]); anchor = p; }
            render();
            if (e.pointerType === 'touch') open(p);
        });
        list.addEventListener('dblclick', e => { const it = e.target.closest('.ex-it'); if (it) open(it.dataset.p); });
        list.addEventListener('contextmenu', e => {
            e.preventDefault();
            const it = e.target.closest('.ex-it');
            if (it && !sel.has(it.dataset.p)) { sel = new Set([it.dataset.p]); render(); }
            const s = [...sel].map(FS.get).filter(Boolean), one = s.length === 1 ? s[0] : null, writable = FS.canWrite(cur);
            const items = it ? [
                { label: 'Open', fn: () => open(one ? one.path : s[0].path), disabled: !s.length },
                ...(one && FS.kind(one) === 'image' ? [{ label: 'Edit in Paint', icon: wico('paint'), fn: () => Shell.launch('paint', { path: one.path }) }, { label: 'Set as desktop background', icon: wico('photos'), fn: () => Shell.useAsWallpaper(one.path) }] : []),
                ...(one && FS.kind(one) === 'text' ? [{ label: 'Edit in Notepad', icon: wico('notepad'), fn: () => Shell.launch('notepad', { path: one.path }) }] : []),
                ...(one && one.link ? [{ label: 'Open the project', icon: wico('browser'), fn: () => Shell.launch('browser', { url: new URL(one.link, location.href).href }) }] : []),
                '-',
                ...(inBin() ? [{ label: 'Restore', icon: wico('restore'), fn: () => act('restore') }, { label: 'Delete permanently', icon: wico('delete'), fn: () => act('delete') }]
                    : [{ label: 'Download', icon: wico('download'), disabled: !s.some(f => f.type === 'file'), fn: () => act('download') },
                    { label: 'Rename', icon: wico('rename'), key: 'F2', disabled: !one || one.builtin, fn: rename },
                    { label: 'Delete', icon: wico('delete'), key: 'Del', disabled: !s.length || s.some(f => f.builtin), fn: del }]),
            ] : [
                { label: 'View', icon: wico('view'), fn: () => act('view') },
                { label: 'Refresh', icon: wico('refresh'), fn: render },
                '-',
                { label: 'New folder', icon: wico('newfolder'), disabled: !writable || inBin(), fn: () => act('newfolder') },
                { label: 'New text file', icon: wico('newfile'), disabled: !writable || inBin(), fn: () => act('newtext') },
                { label: 'Upload files…', icon: wico('upload'), disabled: !writable, fn: () => act('upload') },
                ...(inBin() ? ['-', { label: 'Empty Recycle Bin', icon: wico('broom'), fn: () => act('empty') }] : []),
            ];
            Shell.menu(e.clientX, e.clientY, items);
        });
        list.addEventListener('keydown', e => {
            if (e.key === 'Delete') { e.preventDefault(); del(); }
            else if (e.key === 'F2') { e.preventDefault(); rename(); }
            else if (e.key === 'Enter' && sel.size) { e.preventDefault(); open([...sel][0]); }
            else if (e.key === 'Backspace') { e.preventDefault(); act('back'); }
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); sel = new Set(items().map(f => f.path)); render(); }
        });
        w.el.addEventListener('keydown', e => { if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); act('back'); } if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); act('fwd'); } if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); act('up'); } });
        $q('.ex-q').addEventListener('input', e => { q = e.target.value.trim(); sel.clear(); render(); });
        $q('.ex-file').addEventListener('change', e => {
            const files = [...e.target.files]; e.target.value = '';
            if (files.length) run(FS.importFiles(files, cur).then(ps => toast(`Uploaded ${ps.length} file${ps.length > 1 ? 's' : ''}`)));
        });
        // drag files in from your computer
        list.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files') && FS.canWrite(cur)) { e.preventDefault(); list.classList.add('drop'); } });
        list.addEventListener('dragleave', () => list.classList.remove('drop'));
        list.addEventListener('drop', e => {
            list.classList.remove('drop');
            if (!e.dataTransfer.files.length || !FS.canWrite(cur)) return;
            e.preventDefault(); e.stopPropagation();
            run(FS.importFiles(e.dataTransfer.files, cur).then(ps => toast(`Added ${ps.length} file${ps.length > 1 ? 's' : ''}`)));
        });
        const onFs = e => { if (q || e.detail.dir === cur || cur.startsWith(e.detail.dir) || e.detail.dir.startsWith(cur)) { if (!FS.exists(cur)) cur = '/'; render(); } };
        document.addEventListener('fs', onFs);
        FS.ready.then(render);
        render();
        return {
            onArgs: a => { if (a.path) nav(a.path); },
            onDestroy: () => document.removeEventListener('fs', onFs),
        };
    },
};
