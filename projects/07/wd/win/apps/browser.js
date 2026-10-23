// Browser: tabs, address bar, history, bookmarks. Pages from this site load
// inside the window; so do sites that allow being embedded (Wikipedia,
// YouTube embeds, OpenStreetMap). Most other sites refuse to be shown in a
// frame, so those get a page with a button to open them in a real tab.
'use strict';
WinApps.browser = {
    mount(w, args) {
        const b = w.body;
        const SITE = new URL('../../', location.href).href;
        const HOME_TILES = [
            ...PROJECTS.map(p => ({ name: p[1], url: new URL(p[2], location.href).href, img: p[0] })),
            { name: 'Portfolio home', url: SITE + 'index.html', icon: '🏠' },
            { name: 'Wikipedia', url: 'https://en.m.wikipedia.org/wiki/Main_Page', icon: '📚' },
            { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=-0.2,51.47,0.02,51.55&layer=mapnik', icon: '🗺️' },
        ];
        const BOOKMARKS = [
            { name: '🏠 Portfolio', url: SITE + 'index.html' }, { name: '🏎️ Pixel Racer', url: SITE + 'projects/09/index.html' },
            { name: '🎯 Low-Poly Strike', url: SITE + 'projects/08/index.html' }, { name: '🖥️ Windows 98', url: SITE + 'projects/05/index.html' },
            { name: '📚 Wikipedia', url: 'https://en.m.wikipedia.org/wiki/Main_Page' },
        ];
        // hosts that allow being shown inside another page
        const EMBED = ['en.m.wikipedia.org', 'en.wikipedia.org', 'www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com', 'www.openstreetmap.org'];
        let tabs = [], cur = null, seq = 0;
        b.innerHTML = `<div class="br">
            <div class="br-tabs"><div class="br-tablist" role="tablist"></div><button class="br-new" title="New tab" aria-label="New tab">+</button></div>
            <div class="br-bar"><button class="ib" data-a="back" aria-label="Back" title="Back">${wico('back')}</button><button class="ib" data-a="fwd" aria-label="Forward" title="Forward">${wico('forward')}</button><button class="ib" data-a="reload" aria-label="Reload" title="Reload">${wico('refresh')}</button><button class="ib" data-a="home" aria-label="Home" title="Home">${wico('house')}</button>
                <form class="br-addr"><span class="br-lock"></span><input type="text" spellcheck="false" autocomplete="off" placeholder="Search or type a web address" aria-label="Address"></form>
                <button class="ib" data-a="ext" title="Open in a real browser tab" aria-label="Open in a new browser tab">↗</button></div>
            <div class="br-bm">${BOOKMARKS.map(m => `<button data-url="${esc(m.url)}">${esc(m.name)}</button>`).join('')}</div>
            <div class="br-view"></div></div>`;
        const $q = s => b.querySelector(s), view = $q('.br-view'), addr = $q('.br-addr input');

        function resolve(t) {
            t = t.trim();
            if (!t) return { k: 'home' };
            let u = null;
            if (/^(https?|blob):/i.test(t)) u = t;
            else if (/^(\.\.?\/|\/)/.test(t)) u = new URL(t, location.href).href;
            else if (/^localhost(:\d+)?(\/|$)/.test(t)) u = 'http://' + t;
            else if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t)) u = 'https://' + t;
            if (!u) return { k: 'search', q: t };
            // nicer embeddable forms
            try {
                const x = new URL(u);
                if (/(^|\.)youtube\.com$/.test(x.hostname) && x.searchParams.get('v')) u = 'https://www.youtube-nocookie.com/embed/' + x.searchParams.get('v');
                else if (x.hostname === 'youtu.be') u = 'https://www.youtube-nocookie.com/embed' + x.pathname;
                else if (/^(\w+\.)?wikipedia\.org$/.test(x.hostname) && x.hostname !== 'en.m.wikipedia.org' && x.pathname.startsWith('/wiki/')) u = 'https://en.m.wikipedia.org' + x.pathname;
            } catch { }
            return { k: 'url', url: u };
        }
        function frameable(url) {
            try {
                const x = new URL(url);
                if (x.protocol === 'blob:' || x.origin === location.origin) return true;
                return EMBED.includes(x.hostname) && (x.hostname !== 'www.youtube.com' || x.pathname.startsWith('/embed'));
            } catch { return false; }
        }
        // a readable tab title for pages we can't read the title of (other sites)
        function guessTitle(url) {
            try {
                const x = new URL(url), m = x.pathname.match(/\/wiki\/([^/?#]+)/);
                if (m && /wikipedia\.org$/.test(x.hostname)) return decodeURIComponent(m[1]).replace(/_/g, ' ') + ' - Wikipedia';
                return x.hostname || 'Page';
            } catch { return 'Page'; }
        }

        function newTab(entry = { k: 'home' }, focus = true) {
            const t = { id: ++seq, hist: [], i: -1, title: 'New tab', frame: null, page: document.createElement('div') };
            t.page.className = 'br-page';
            view.appendChild(t.page);
            tabs.push(t);
            if (focus) select(t);
            go(t, entry);
            return t;
        }
        function select(t) {
            cur = t;
            tabs.forEach(x => { x.page.hidden = x !== t; if (x.frame) x.frame.hidden = x !== t; });
            renderTabs(); syncBar();
        }
        function closeTab(t) {
            const i = tabs.indexOf(t);
            t.page.remove(); t.frame?.remove();
            tabs.splice(i, 1);
            if (!tabs.length) { w.close(); return; }
            if (cur === t) select(tabs[Math.min(i, tabs.length - 1)]); else renderTabs();
        }
        function renderTabs() {
            $q('.br-tablist').innerHTML = tabs.map(t => `<div class="br-tab ${t === cur ? 'on' : ''}" data-id="${t.id}" role="tab" title="${esc(t.title)}"><span class="br-fav">${t.fav || '🌐'}</span><span class="br-tt">${esc(t.title)}</span><button data-close aria-label="Close tab">✕</button></div>`).join('');
            w.setTitle(cur ? `${cur.title} - Browser` : 'Browser');
        }
        function syncBar() {
            const e = cur && cur.hist[cur.i];
            if (!e) return;
            addr.value = e.k === 'home' ? '' : e.k === 'search' ? e.q : e.url;
            const secure = e.k === 'url' && /^https:|^blob:/.test(e.url) || (e.k === 'url' && e.url.startsWith(location.origin));
            $q('.br-lock').textContent = e.k === 'url' ? (secure ? '🔒' : 'ⓘ') : '🔍';
            $q('[data-a="back"]').disabled = cur.i <= 0;
            $q('[data-a="fwd"]').disabled = cur.i >= cur.hist.length - 1;
        }
        function go(t, entry, push = true) {
            if (push) { t.hist = t.hist.slice(0, t.i + 1); t.hist.push(entry); t.i = t.hist.length - 1; }
            show(t);
        }
        function setTitle(t, title, fav) { t.title = title || 'Untitled'; t.fav = fav; if (t === cur) renderTabs(); }
        function show(t) {
            const e = t.hist[t.i];
            const usesFrame = e.k === 'url' && frameable(e.url) && (navigator.onLine || new URL(e.url).origin === location.origin);
            if (usesFrame) {
                if (!t.frame) {
                    t.frame = document.createElement('iframe');
                    t.frame.className = 'br-frame';
                    t.frame.setAttribute('allow', 'fullscreen; autoplay; gamepad; pointer-lock');
                    t.frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
                    t.frame.addEventListener('load', () => onLoad(t));
                    view.appendChild(t.frame);
                }
                t.page.hidden = true;
                t.frame.hidden = t !== cur;
                if (t.frame.dataset.src !== e.url) { t.frame.dataset.src = e.url; t.frame.src = e.url; }
                setTitle(t, e.title || guessTitle(e.url), e.url.startsWith(SITE) ? '📁' : '🌐');
            } else {
                if (t.frame) { t.frame.hidden = true; t.frame.dataset.src = ''; t.frame.src = 'about:blank'; }
                t.page.hidden = t !== cur;
                if (e.k === 'home') homePage(t);
                else if (e.k === 'search') searchPage(t, e.q);
                else if (!navigator.onLine) offlinePage(t, e.url);
                else blockedPage(t, e.url);
            }
            if (t === cur) syncBar();
        }
        // same-site pages: follow links clicked inside the frame
        function onLoad(t) {
            let href = '', title = '';
            try { href = t.frame.contentWindow.location.href; title = t.frame.contentDocument.title; } catch { }
            const e = t.hist[t.i];
            if (!e || e.k !== 'url') return;
            if (href && href !== 'about:blank' && href !== e.url && !href.startsWith('blob:')) {
                t.hist = t.hist.slice(0, t.i + 1);
                t.hist.push({ k: 'url', url: href, title });
                t.i++;
                t.frame.dataset.src = href;
            } else if (title) e.title = title;
            setTitle(t, title || e.title || guessTitle(e.url), (href || e.url).startsWith(SITE) ? '📁' : '🌐');
            if (t === cur) syncBar();
        }
        function homePage(t) {
            setTitle(t, 'New tab', '⭐');
            t.page.innerHTML = `<div class="br-home"><h1>Where to?</h1><form class="br-hs"><input type="search" class="dlg-in" placeholder="Search Wikipedia or type an address" aria-label="Search"><button class="wbtn pri">Search</button></form>
                <div class="br-tiles">${HOME_TILES.map(x => `<button data-url="${esc(x.url)}">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy">` : `<span>${x.icon}</span>`}<b>${esc(x.name)}</b></button>`).join('')}</div>
                <p class="br-note">Pages from this portfolio open right here. Most other websites don’t allow being shown inside another page, so those open in a real browser tab.</p></div>`;
            t.page.querySelector('form').onsubmit = ev => { ev.preventDefault(); const v = t.page.querySelector('input').value; if (v.trim()) go(t, resolve(v)); };
            if (t === cur) setTimeout(() => t.page.querySelector('input')?.focus(), 30);
        }
        async function searchPage(t, q) {
            setTitle(t, q, '🔍');
            t.page.innerHTML = `<div class="br-res"><p class="br-note">Searching Wikipedia for “${esc(q)}”…</p></div>`;
            if (!navigator.onLine) { offlinePage(t, null); return; }
            try {
                const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*&srlimit=12`);
                const j = await r.json(), hits = j.query?.search || [];
                if (t.hist[t.i].k !== 'search' || t.hist[t.i].q !== q) return;
                const strip = s => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");
                t.page.innerHTML = `<div class="br-res"><p class="br-note">${hits.length ? `About ${j.query.searchinfo.totalhits.toLocaleString()} results on Wikipedia` : 'No Wikipedia articles found.'} · <a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Search the whole web in a new tab ↗</a></p>
                    ${hits.map(h => `<a class="br-hit" href="#" data-url="https://en.m.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, '_'))}"><small>en.wikipedia.org › wiki</small><b>${esc(h.title)}</b><span>${esc(strip(h.snippet))}…</span></a>`).join('')}</div>`;
            } catch { t.page.innerHTML = `<div class="br-res"><p class="br-note">Search didn’t work just now. <a href="https://duckduckgo.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Search in a new tab ↗</a></p></div>`; }
        }
        function blockedPage(t, url) {
            let host = url; try { host = new URL(url).hostname; } catch { }
            setTitle(t, host, '🚫');
            t.page.innerHTML = `<div class="br-block"><div class="br-big">🧱</div><h2>${esc(host)} can’t be shown in here</h2>
                <p>Most websites tell browsers not to show them inside another page, to keep their visitors safe. This little browser respects that.</p>
                <button class="wbtn pri" data-open="${esc(url)}">Open ${esc(host)} in a new tab ↗</button><p class="br-note">${esc(url)}</p></div>`;
        }
        function offlinePage(t, url) {
            setTitle(t, 'No internet', '📴');
            t.page.innerHTML = `<div class="br-block"><div class="br-big">📴</div><h2>You’re offline</h2><p>Pages from this portfolio still work. Others need a connection.</p>${url ? `<button class="wbtn" data-retry>Try again</button>` : ''}</div>`;
        }

        // ---- events
        $q('.br-new').onclick = () => newTab();
        $q('.br-tablist').addEventListener('click', e => {
            const tb = e.target.closest('.br-tab'); if (!tb) return;
            const t = tabs.find(x => x.id === +tb.dataset.id);
            if (e.target.closest('[data-close]')) closeTab(t); else select(t);
        });
        $q('.br-tablist').addEventListener('auxclick', e => { const tb = e.target.closest('.br-tab'); if (tb && e.button === 1) closeTab(tabs.find(x => x.id === +tb.dataset.id)); });
        $q('.br-addr').onsubmit = e => { e.preventDefault(); go(cur, resolve(addr.value)); addr.blur(); };
        addr.addEventListener('focus', () => addr.select());
        $q('.br-bar').addEventListener('click', e => {
            const a = e.target.closest('[data-a]')?.dataset.a, t = cur;
            if (!a || !t) return;
            if (a === 'back' && t.i > 0) { t.i--; show(t); }
            else if (a === 'fwd' && t.i < t.hist.length - 1) { t.i++; show(t); }
            else if (a === 'reload') { if (t.frame && !t.frame.hidden) { try { t.frame.contentWindow.location.reload(); } catch { t.frame.src = t.frame.dataset.src; } } else show(t); }
            else if (a === 'home') go(t, { k: 'home' });
            else if (a === 'ext') { const en = t.hist[t.i]; window.open(en.k === 'url' ? en.url : en.k === 'search' ? 'https://duckduckgo.com/?q=' + encodeURIComponent(en.q) : SITE + 'index.html', '_blank', 'noopener'); }
        });
        b.addEventListener('click', e => {
            const u = e.target.closest('[data-url]');
            if (u) { e.preventDefault(); if (e.ctrlKey || e.button === 1) newTab({ k: 'url', url: u.dataset.url }, false); else go(cur, { k: 'url', url: u.dataset.url }); return; }
            const o = e.target.closest('[data-open]');
            if (o) { window.open(o.dataset.open, '_blank', 'noopener'); return; }
            if (e.target.closest('[data-retry]')) show(cur);
        });
        w.el.addEventListener('keydown', e => {
            const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
            if ((mod && k === 'l') || e.key === 'F6') { e.preventDefault(); addr.focus(); }
            else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); $q('[data-a="back"]').click(); }
            else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); $q('[data-a="fwd"]').click(); }
            else if (e.key === 'F5') { e.preventDefault(); $q('[data-a="reload"]').click(); }
        });
        const onOnline = () => cur && show(cur);
        addEventListener('online', onOnline);

        const open = a => newTab(a.url ? { k: 'url', url: a.url, title: a.title } : a.q ? { k: 'search', q: a.q } : { k: 'home' });
        open(args);
        return { onArgs: a => open(a), onDestroy: () => removeEventListener('online', onOnline) };
    },
};
