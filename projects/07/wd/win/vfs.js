// Widget Desktop - a small virtual file system for the desktop apps.
// Your own files live in IndexedDB (in memory if that is blocked); the
// built-in wallpapers, project pictures and music library are read-only
// links to the site's real files.
'use strict';
const FS = (() => {
    const files = new Map();   // path -> record
    let db = null;
    const norm = p => ('/' + p).replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    const dirOf = p => p.slice(0, p.lastIndexOf('/')) || '/';
    const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
    const extOf = p => { const b = baseOf(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
    const MIME = {
        txt: 'text/plain', md: 'text/markdown', log: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf',
    };
    const TEXT = ['txt', 'md', 'log', 'csv', 'json', 'html', 'css', 'js', 'xml', 'ini'];
    const IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
    const ROOTS = ['/Desktop', '/Documents', '/Downloads', '/Music', '/Pictures', '/Recycle Bin'];
    const READ_ONLY_DIRS = ['/', '/Pictures/Wallpapers', '/Pictures/Projects'];
    const clean = s => s.replace(/[\\/:*?"<>|]/g, '').trim();

    function builtin() {
        const dir = path => files.set(path, { path, name: baseOf(path) || 'This PC', type: 'dir', builtin: true, mtime: 0 });
        const add = (path, o) => files.set(path, { path, name: baseOf(path), type: 'file', builtin: true, mtime: 0, size: 0, mime: MIME[extOf(path)], ...o });
        dir('/'); ROOTS.forEach(dir); dir('/Pictures/Wallpapers'); dir('/Pictures/Projects');
        BGS.forEach(b => add(`/Pictures/Wallpapers/${clean(b.name)}.webp`, { url: b.clear }));
        PROJECTS.forEach(p => add(`/Pictures/Projects/${clean(p[1])}.webp`, { url: p[0], link: p[2] }));
        Music.tracks.forEach((t, i) => add(`/Music/${clean(t.title + ' - ' + t.artist)}.mp3`, { url: t.src, track: i, cover: t.cover }));
    }

    function open() {
        return new Promise((res, rej) => {
            const r = indexedDB.open('wd-files', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'path' });
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
    }
    function tx(mode, fn) {
        return new Promise((res, rej) => {
            const t = db.transaction('files', mode), req = fn(t.objectStore('files'));
            t.oncomplete = () => res(req && req.result);
            t.onerror = () => rej(t.error);
        });
    }
    const changed = dir => document.dispatchEvent(new CustomEvent('fs', { detail: { dir } }));

    async function put(rec) {
        const { _url, ...keep } = rec;
        files.set(rec.path, keep);
        if (db) await tx('readwrite', st => st.put(keep)).catch(err => console.warn('could not save', rec.path, err));
        changed(dirOf(rec.path));
    }
    async function drop(path) {
        const r = files.get(path);
        if (r && r._url) URL.revokeObjectURL(r._url);
        files.delete(path);
        if (db) await tx('readwrite', st => st.delete(path)).catch(() => { });
    }
    const subtree = p => [...files.values()].filter(f => f.path === p || f.path.startsWith(p + '/'));

    async function mkdir(path) {
        path = norm(path);
        if (files.has(path)) return path;
        if (!files.has(dirOf(path))) await mkdir(dirOf(path));
        await put({ path, name: baseOf(path), type: 'dir', mtime: Date.now() });
        return path;
    }
    async function write(path, data, mime) {
        path = norm(path);
        const old = files.get(path);
        if (old && old.builtin) throw new Error('This is a built-in file and can’t be changed.');
        if (!files.has(dirOf(path))) await mkdir(dirOf(path));
        if (old && old._url) URL.revokeObjectURL(old._url);
        const size = typeof data === 'string' ? new Blob([data]).size : data.size;
        await put({ path, name: baseOf(path), type: 'file', mime: mime || MIME[extOf(path)] || 'application/octet-stream', data, size, mtime: Date.now() });
        return path;
    }
    function unique(dir, name) {
        const p = norm(dir + '/' + name);
        if (!files.has(p)) return p;
        const i = name.lastIndexOf('.'), b = i > 0 ? name.slice(0, i) : name, e = i > 0 ? name.slice(i) : '';
        for (let n = 2; ; n++) { const q = norm(`${dir}/${b} (${n})${e}`); if (!files.has(q)) return q; }
    }
    // rename or move a file / folder with everything inside it
    async function move(from, to) {
        from = norm(from); to = norm(to);
        if (from === to) return to;
        if (to.startsWith(from + '/')) throw new Error('A folder can’t go inside itself.');
        if (files.has(to)) throw new Error(`“${baseOf(to)}” already exists here.`);
        const recs = subtree(from);
        if (!recs.length) throw new Error('Not found.');
        if (recs.some(r => r.builtin)) throw new Error('Built-in items can’t be moved or renamed.');
        if (!files.has(dirOf(to))) await mkdir(dirOf(to));
        for (const r of recs) await drop(r.path);
        for (const r of recs) await put({ ...r, path: to + r.path.slice(from.length), name: r.path === from ? baseOf(to) : r.name, mtime: Date.now() });
        changed(dirOf(from));
        return to;
    }
    async function purge(path) {
        path = norm(path);
        const recs = subtree(path);
        if (recs.some(r => r.builtin)) throw new Error('Built-in items can’t be deleted.');
        for (const r of recs) await drop(r.path);
        changed(dirOf(path));
    }
    // delete = move to the Recycle Bin; deleting inside the bin is permanent
    async function remove(path) {
        path = norm(path);
        if (path.startsWith('/Recycle Bin/')) return purge(path);
        const to = await move(path, unique('/Recycle Bin', baseOf(path)));
        await put({ ...files.get(to), from: path });
    }
    async function restore(path) {
        const r = files.get(norm(path));
        if (!r || !r.from) return;
        await move(r.path, unique(dirOf(r.from), baseOf(r.from)));
    }
    async function readText(path) {
        const r = files.get(norm(path));
        if (!r || r.type !== 'file') throw new Error('File not found.');
        if (r.url) return (await fetch(r.url)).text();
        return typeof r.data === 'string' ? r.data : r.data.text();
    }
    async function readBlob(path) {
        const r = files.get(norm(path));
        if (!r || r.type !== 'file') throw new Error('File not found.');
        if (r.url) return (await fetch(r.url)).blob();
        return typeof r.data === 'string' ? new Blob([r.data], { type: r.mime }) : r.data;
    }
    function urlOf(path) {
        const r = files.get(norm(path));
        if (!r) return '';
        if (r.url) return r.url;
        if (!r._url) r._url = URL.createObjectURL(typeof r.data === 'string' ? new Blob([r.data], { type: r.mime }) : r.data);
        return r._url;
    }
    function download(path) {
        const r = files.get(norm(path));
        if (!r || r.type !== 'file') return;
        const a = document.createElement('a');
        a.href = urlOf(path); a.download = r.name;
        document.body.appendChild(a); a.click(); a.remove();
    }
    async function importFiles(list, dir) {
        const out = [];
        for (const f of list) out.push(await write(unique(dir, clean(f.name) || 'file'), f, f.type || MIME[extOf(f.name)]));
        return out;
    }
    const kind = r => r.type === 'dir' ? 'dir' : TEXT.includes(extOf(r.path)) ? 'text' : IMAGE.includes(extOf(r.path)) ? 'image' : (r.mime || '').startsWith('audio') ? 'audio' : 'other';
    const visible = r => !r.name.startsWith('.');
    const sortFn = (a, b) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true });
    function list(dir) {
        dir = norm(dir);
        return [...files.values()].filter(f => f.path !== dir && dirOf(f.path) === dir && visible(f)).sort(sortFn);
    }
    function search(q, under = '/') {
        q = q.toLowerCase(); under = norm(under);
        return [...files.values()].filter(f => f.path !== '/' && visible(f) && !f.path.includes('/.') && f.name.toLowerCase().includes(q) && (under === '/' || f.path.startsWith(under + '/'))).sort(sortFn);
    }
    // new files can go in the main folders and your own folders, not in built-in ones or the bin
    function canWrite(dir) {
        dir = norm(dir);
        if (dir === '/Recycle Bin' || dir.startsWith('/Recycle Bin/')) return false;
        if (ROOTS.includes(dir)) return true;
        if (READ_ONLY_DIRS.includes(dir)) return false;
        const r = files.get(dir);
        return !!r && r.type === 'dir' && !r.builtin;
    }
    const DIR_ICON = { '/Recycle Bin': 'recycle', '/Desktop': 'desktop', '/Music': 'music', '/Pictures': 'photos', '/Downloads': 'downloads', '/Documents': 'documents', '/': 'pc' };
    const CODE = ['html', 'css', 'js', 'json', 'xml'];
    function iconOf(r) {
        if (r.type === 'dir') return `<span class="fi">${wico(DIR_ICON[r.path] || 'folder')}</span>`;
        const k = kind(r);
        if (k === 'image') return `<img class="fi-img" src="${esc(urlOf(r.path))}" alt="" loading="lazy">`;
        if (r.cover) return `<img class="fi-img" src="${esc(r.cover)}" alt="" loading="lazy">`;
        return `<span class="fi">${wico(k === 'text' ? (CODE.includes(extOf(r.path)) ? 'code' : 'text') : k === 'audio' ? 'music' : 'file')}</span>`;
    }
    const sizeTxt = n => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

    const WELCOME = `Welcome to Widget Desktop!

This is a little desktop that runs in your browser.

  • Start button: every app, your pinned apps and recent files.
  • Widgets (far left of the taskbar, or press W): clocks, weather,
    music, games and 30 more.
  • File Explorer keeps your files in this browser, on this device.
    Upload files from your computer, or drag them onto the desktop.
  • Notepad and Paint save into Documents and Pictures.
  • Drag a window to the top of the screen to maximise it, or to the
    left / right edge to snap it to half the screen.
  • Move the mouse over the wallpaper to see it sharp through the lens.

Have fun!
`;

    const ready = (async () => {
        builtin();
        try {
            db = await open();
            const all = await tx('readonly', st => st.getAll());
            all.forEach(r => files.set(r.path, r));
        } catch (err) { console.warn('File storage unavailable, files will not be kept:', err); }
        if (!store.get('fsSeeded', false)) {
            store.set('fsSeeded', true);
            await write('/Documents/Welcome.txt', WELCOME);
            await write('/Documents/Ideas.txt', 'Ideas\n\n- \n');
            await mkdir('/Pictures/My drawings');
        }
    })();

    return {
        ready, norm, dirOf, baseOf, extOf, kind, list, search, unique, mkdir, write, move, remove, purge, restore,
        readText, readBlob, urlOf, download, importFiles, canWrite, iconOf, sizeTxt, clean,
        dirIcon: p => wico(DIR_ICON[norm(p)] || 'folder'),
        get: p => files.get(norm(p)),
        exists: p => files.has(norm(p)),
        all: () => [...files.values()].filter(f => f.type === 'file' && !f.path.includes('/.')),
    };
})();
