// Photos: a gallery of every picture in the file system and a viewer with
// zoom, next / previous, edit in Paint and set as background.
'use strict';
WinApps.photos = {
    mount(w, args) {
        const b = w.body;
        let path = null, zoom = 0;   // zoom 0 = fit to window
        b.innerHTML = `<div class="ph">
            <div class="ph-bar"><button class="wbtn" data-a="gallery">▦ Gallery</button><span class="ph-name"></span><span class="grow"></span>
                <span class="ph-view-only"><button class="ib" data-a="out" aria-label="Zoom out">－</button><button class="wbtn" data-a="fit">Fit</button><button class="ib" data-a="in" aria-label="Zoom in">＋</button><span class="sep"></span>
                <button class="wbtn" data-a="paint">🎨 Edit</button><button class="wbtn" data-a="bg">🖼️ Set as background</button><button class="ib" data-a="dl" aria-label="Download" title="Download">⬇️</button><button class="ib" data-a="del" aria-label="Delete" title="Delete">🗑️</button></span></div>
            <div class="ph-stage"><button class="ph-nav prev" data-a="prev" aria-label="Previous">‹</button><div class="ph-scroll"><img alt=""></div><button class="ph-nav next" data-a="next" aria-label="Next">›</button></div>
            <div class="ph-gallery"></div></div>`;
        const $q = s => b.querySelector(s), img = $q('.ph-stage img');
        const pics = () => FS.all().filter(f => FS.kind(f) === 'image');
        const siblings = () => FS.list(FS.dirOf(path)).filter(f => FS.kind(f) === 'image');
        function gallery() {
            path = null;
            b.querySelector('.ph').classList.add('gal');
            w.setTitle('Photos');
            $q('.ph-name').textContent = '';
            const byDir = {};
            pics().forEach(f => (byDir[FS.dirOf(f.path)] = byDir[FS.dirOf(f.path)] || []).push(f));
            $q('.ph-gallery').innerHTML = Object.entries(byDir).map(([d, fs]) => `<h3>${esc(d.slice(1).replace(/\//g, ' › '))}</h3><div class="ph-grid">${fs.map(f => `<button data-p="${esc(f.path)}" title="${esc(f.name)}"><img src="${esc(FS.urlOf(f.path))}" alt="" loading="lazy"></button>`).join('')}</div>`).join('') || '<p class="ex-empty">No pictures yet. Draw one in Paint!</p>';
        }
        function view(p) {
            const f = FS.get(p);
            if (!f) return gallery();
            path = f.path; zoom = 0;
            b.querySelector('.ph').classList.remove('gal');
            img.src = FS.urlOf(path);
            w.setTitle(f.name + ' - Photos');
            const s = siblings(), i = s.findIndex(x => x.path === path);
            $q('.ph-name').textContent = `${f.name}  ·  ${i + 1} of ${s.length}`;
            $q('[data-a="del"]').disabled = !!f.builtin;
            apply();
        }
        function apply() {
            img.classList.toggle('fit', !zoom);
            img.style.width = zoom ? img.naturalWidth * zoom + 'px' : '';
            $q('[data-a="fit"]').textContent = zoom ? Math.round(zoom * 100) + '%' : 'Fit';
        }
        img.onload = apply;
        const step = d => { const s = siblings(); if (!s.length) return; const i = s.findIndex(x => x.path === path); view(s[(i + d + s.length) % s.length].path); };
        const zoomBy = k => { const base = zoom || Math.min(1, img.clientWidth / img.naturalWidth || 1); zoom = Math.max(0.1, Math.min(8, base * k)); apply(); };
        b.addEventListener('click', async e => {
            const g = e.target.closest('[data-p]'); if (g) { view(g.dataset.p); return; }
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'gallery') gallery();
            else if (a === 'prev') step(-1); else if (a === 'next') step(1);
            else if (a === 'in') zoomBy(1.25); else if (a === 'out') zoomBy(0.8); else if (a === 'fit') { zoom = zoom ? 0 : 1; apply(); }
            else if (a === 'paint') Shell.launch('paint', { path });
            else if (a === 'bg') Shell.useAsWallpaper(path);
            else if (a === 'dl') FS.download(path);
            else if (a === 'del') {
                const s = siblings(), i = s.findIndex(x => x.path === path);
                await FS.remove(path).catch(err => toast(err.message));
                const rest = s.filter(x => x.path !== path);
                rest.length ? view(rest[Math.min(i, rest.length - 1)].path) : gallery();
            }
        });
        $q('.ph-scroll').addEventListener('wheel', e => { if (!path) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
        $q('.ph-scroll').addEventListener('dblclick', () => { zoom = zoom ? 0 : 1; apply(); });
        w.el.addEventListener('keydown', e => {
            if (!path) return;
            if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
            else if (e.key === '+' || e.key === '=') zoomBy(1.25); else if (e.key === '-') zoomBy(0.8);
            else if (e.key === 'Escape') { e.stopPropagation(); gallery(); }
        });
        const onFs = () => { if (!path) gallery(); };
        document.addEventListener('fs', onFs);
        FS.ready.then(() => args.path ? view(args.path) : gallery());
        return {
            onArgs: a => a.path ? view(a.path) : gallery(),
            onDestroy: () => document.removeEventListener('fs', onFs),
        };
    },
};
