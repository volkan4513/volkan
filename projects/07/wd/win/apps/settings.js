// Settings: pages in the style of Windows 11, wired to the real options of
// this desktop (wallpaper, accent, lens, notifications, taskbar, data...).
'use strict';
WinApps.settings = {
    mount(w, args) {
        const b = w.body;
        let page = args.page || 'system';
        const PAGES = [
            ['system', wico('pc'), 'System'], ['personal', wico('paint'), 'Personalisation'], ['apps', wico('widgets'), 'Apps'],
            ['time', wico('clock'), 'Time & language'], ['privacy', wico('lock'), 'Privacy & security'], ['about', wico('info'), 'About'],
        ];
        b.innerHTML = `<div class="st2">
            <nav class="app-nav st2-nav"><div class="st2-user"><span class="st-av">V</span><div><b>Volkan</b><small>Local account</small></div></div>
                <input type="search" class="dlg-in st2-q" placeholder="Find a setting" aria-label="Find a setting">
                ${PAGES.map(([id, ic, n]) => `<button data-p="${id}"><span>${ic}</span>${n}</button>`).join('')}</nav>
            <main class="st2-main"></main></div>`;
        const main = b.querySelector('.st2-main');
        const card = (title, desc, ctrl, ic = '') => `<div class="st2-card">${ic ? `<span class="st2-ic">${ic}</span>` : ''}<div class="st2-txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div><div class="st2-ctl">${ctrl}</div></div>`;
        const sw = (id, on) => `<label class="sw"><input type="checkbox" data-sw="${id}" ${on ? 'checked' : ''}><i></i></label>`;
        const head = t => `<h2>${t}</h2>`;

        const VIEWS = {
            system() {
                const files = FS.all().filter(f => !f.builtin), bytes = files.reduce((a, f) => a + (f.size || 0), 0);
                return head('System') + `<h3>Display</h3>`
                    + card('Wallpaper brightness', 'Dim the desktop background', `<input type="range" min="0.35" max="1" step="0.01" value="${store.get('dim', 1)}" data-r="dim" aria-label="Wallpaper brightness">`, '🔆')
                    + `<h3>Sound</h3>` + card('Music volume', 'For the Music widget and the songs in File Explorer', `<input type="range" min="0" max="1" step="0.01" value="${Music.audio.volume}" data-r="vol" aria-label="Music volume">`, '🔊')
                    + `<h3>Notifications</h3>`
                    + card('Do not disturb', 'Hide pop-ups; notifications still collect in the notification centre', sw('dnd', dnd), '🔕')
                    + card('Random messages', 'Friends, project news and reminders arrive every minute or two', sw('nfRandom', store.get('nfRandom', true)), '💬')
                    + card('Send a test notification', '', `<button class="wbtn" data-act="testnf">Send</button>`, '🔔')
                    + `<h3>Storage</h3>` + card('Your files', `${files.length} files · ${FS.sizeTxt(bytes)} kept in this browser`, `<button class="wbtn" data-act="explorer">Open File Explorer</button>`, '💾');
            },
            personal() {
                const align = store.get('tbAlign', 'left');
                return head('Personalisation') + `<h3>Background</h3><div class="st2-bgs">${BGS.map((g, i) => `<button class="st2-bg ${i === bgIndex ? 'on' : ''}" data-bg="${i}" title="${esc(g.name)}"><img src="${esc(g.blur)}" alt=""><span>${esc(g.name)}</span>${g.custom ? `<i data-rmbg="${esc(g.custom)}" title="Remove" role="button" aria-label="Remove wallpaper">✕</i>` : ''}</button>`).join('')}
                    <button class="st2-bg st2-add" data-act="addbg"><span class="st2-plus">＋</span><span>Your photo</span></button></div><input type="file" accept="image/*" hidden class="st2-file">`
                    + card('Wallpaper picker', 'All backgrounds, your photos and brightness in one place', `<button class="wbtn" data-act="picker">Open</button>`, wico('photos'))
                    + `<h3>Colours</h3>` + card('Accent colour', 'Used for highlights, the start button and selections', `<span class="st2-sws">${ACCENTS.map(c => `<button class="swatch ${store.get('accent') === c ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="Accent ${c}"></button>`).join('')}<input type="color" value="${store.get('accent', ACCENTS[0])}" data-r="accent" aria-label="Custom accent"></span>`, '🎨')
                    + `<h3>Lens</h3>` + card('Shape', 'The window that shows the sharp photo', `<span class="seg">${SHAPES.map(s => `<button class="${Lens.shape.id === s.id ? 'on' : ''}" data-shape="${s.id}">${s.label}</button>`).join('')}</span>`, '🔍')
                    + card('Size', '', `<input type="range" min="0.6" max="2.2" step="0.1" value="${Lens.scale}" data-r="lens" aria-label="Lens size">`, '↔️')
                    + card('Pin the lens', 'Keep it in one place instead of following the mouse', sw('pin', Lens.pinned), '📌')
                    + card('Film grain', 'A subtle noise over the wallpaper', sw('grain', !document.body.classList.contains('no-grain')), '🎞️')
                    + `<h3>Taskbar</h3>` + card('Taskbar alignment', '', `<span class="seg"><button class="${align === 'left' ? 'on' : ''}" data-align="left">Left</button><button class="${align === 'center' ? 'on' : ''}" data-align="center">Centre</button></span>`, '▭');
            },
            apps() {
                const pins = store.get('tbPins', null) || ['explorer', 'browser', 'notepad', 'paint', 'calculator', 'solitaire', 'settings'];
                return head('Apps') + `<h3>Taskbar</h3>` + Shell.apps.map(a => card(`${a.icon} ${a.name}`, '', `<label class="sw"><input type="checkbox" data-pin="${a.id}" ${pins.includes(a.id) ? 'checked' : ''} aria-label="Pin ${a.name} to the taskbar"><i></i></label>`)).join('')
                    + `<h3>Default apps</h3>` + card('Text files', '.txt .md .json .html .css .js', 'Notepad', '📄') + card('Pictures', '.png .jpg .webp .gif', 'Photos', '🖼️') + card('Music', '.mp3', 'Music widget', '🎵')
                    + `<h3>Reset</h3>` + card('Widgets board and phone home screen', 'Puts the default widgets back. Your notes and to-dos stay.', `<button class="wbtn" data-act="resetlayout">Reset</button>`, '🧩')
                    + card('Window sizes and pinned apps', '', `<button class="wbtn" data-act="resetwins">Reset</button>`, '🪟');
            },
            time() {
                const g = Geo.get();
                return head('Time & language') + card('24-hour clock', 'In the taskbar and the Clock widget', sw('h24', store.get('h24', true)), '🕒')
                    + card('Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone, '', '🌍')
                    + `<h3>Weather location</h3>` + card(g ? esc(g.name) : 'Not set', g ? `${g.lat}, ${g.lon}` : 'Used by the weather widgets', `<button class="wbtn" data-act="locate">Use my location</button>`, '📍')
                    + `<form class="st2-card st2-city"><span class="st2-ic">🏙️</span><input type="text" class="dlg-in" placeholder="Search a city" aria-label="City"><button class="wbtn pri">Set</button></form>`;
            },
            privacy() {
                return head('Privacy & security') + card('Where your data lives', 'Notes, files, layouts and settings stay in this browser on this device. Nothing is uploaded.', '', '🔒')
                    + card('Location', 'Only asked for when you press “Use my location”, and only used for weather and sunrise times.', '', '📍')
                    + card('Clear everything', 'Removes your files, notes, layouts and settings from this browser', `<button class="wbtn danger" data-act="wipe">Clear all data</button>`, '🧹');
            },
            about() {
                const ua = navigator.userAgent, browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
                const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
                const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
                return head('About') + `<div class="st2-about"><span class="st-av big">V</span><div><b>Widget Desktop</b><small>by Volkan · a desktop that lives in your browser</small></div></div>`
                    + `<h3>Device specifications</h3><dl class="st2-dl">${row('Browser', browser)}${row('System', os)}${row('Processor', (navigator.hardwareConcurrency || '?') + ' logical cores')}${row('Memory', navigator.deviceMemory ? '~' + navigator.deviceMemory + ' GB' : 'Not reported')}${row('Screen', `${screen.width} × ${screen.height} at ${devicePixelRatio}×`)}${row('Language', navigator.language)}</dl>`
                    + `<h3>Credits</h3><dl class="st2-dl">${row('Design', 'Inspired by Windows 11. Not made by or connected to Microsoft.')}${row('Weather', '<a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0)')}${row('Search', 'Results from <a href="https://www.wikipedia.org/" target="_blank" rel="noopener">Wikipedia</a>')}${row('Solitaire', 'Klondike rules; code and card design made for this site')}${row('Music', 'Songs from the PS Music Player project')}${row('Icons', 'Your system’s emoji font')}</dl>`;
            },
        };
        function go(p) {
            page = p;
            b.querySelectorAll('.st2-nav [data-p]').forEach(x => x.classList.toggle('on', x.dataset.p === p));
            main.innerHTML = VIEWS[p]();
            main.scrollTop = 0;
        }
        b.querySelector('.st2-nav').addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) go(p.dataset.p); });
        b.querySelector('.st2-q').addEventListener('input', e => {
            const v = e.target.value.trim().toLowerCase();
            if (!v) return go(page);
            // search every page's cards by their text
            const found = PAGES.flatMap(([id, , name]) => {
                const tmp = document.createElement('div'); tmp.innerHTML = VIEWS[id]();
                return [...tmp.querySelectorAll('.st2-card b')].filter(x => x.textContent.toLowerCase().includes(v) || x.parentElement.textContent.toLowerCase().includes(v)).map(x => ({ id, name, t: x.textContent }));
            });
            main.innerHTML = `<h2>Results</h2>` + (found.length ? found.map(f => `<button class="st2-card st2-hit" data-p="${f.id}"><div class="st2-txt"><b>${esc(f.t)}</b><small>${esc(f.name)}</small></div><span>›</span></button>`).join('') : '<p class="ck2-sub">No settings match.</p>');
        });
        main.addEventListener('click', async e => {
            const t = e.target;
            const hit = t.closest('.st2-hit'); if (hit) { b.querySelector('.st2-q').value = ''; go(hit.dataset.p); return; }
            const rm = t.closest('[data-rmbg]'); if (rm) { e.stopPropagation(); await Shell.removeWallpaper(rm.dataset.rmbg); go('personal'); return; }
            const bg = t.closest('[data-bg]'); if (bg) { setBg(+bg.dataset.bg); go('personal'); return; }
            const c = t.closest('[data-c]'); if (c) { setAccent(c.dataset.c); go('personal'); return; }
            const sh = t.closest('[data-shape]'); if (sh) { setShape(sh.dataset.shape); go('personal'); return; }
            const al = t.closest('[data-align]'); if (al) { Shell.setTaskbarAlign(al.dataset.align); go('personal'); return; }
            const a = t.closest('[data-act]')?.dataset.act;
            if (a === 'addbg') main.querySelector('.st2-file').click();
            else if (a === 'picker') Shell.wallpaperPicker();
            else if (a === 'testnf') addNotif({ app: 'Settings', icon: '⚙️', color: '#57606f', title: 'Test notification', text: 'Notifications are working.', act: 'win:settings' });
            else if (a === 'explorer') Shell.launch('explorer', { path: '/Documents' });
            else if (a === 'locate') Geo.locate().then(() => Weather.refresh(true)).then(() => go('time')).catch(() => toast('Location not available — search a city instead'));
            else if (a === 'resetlayout') { if (await Shell.confirm('Put the default widgets back on the board and the phone home screen?', 'Reset')) resetLayout(); }
            else if (a === 'resetwins') { if (await Shell.confirm('Forget window sizes and reset the pinned apps?', 'Reset')) { ['winBounds', 'tbPins', 'startPins'].forEach(k => localStorage.removeItem('wd.' + k)); toast('Done — reopen windows to see the change'); } }
            else if (a === 'wipe') {
                if (!(await Shell.confirm('This deletes your files, notes, layouts and settings in this browser. It can’t be undone.', 'Clear everything', 'Clear all data?'))) return;
                Object.keys(localStorage).filter(k => k.startsWith('wd.')).forEach(k => localStorage.removeItem(k));
                indexedDB.deleteDatabase('wd-files');
                location.reload();
            }
        });
        main.addEventListener('change', e => {
            const t = e.target;
            if (t.classList.contains('st2-file') && t.files[0]) { Shell.addWallpaper(t.files[0], t.files[0].name).then(() => go('personal')).catch(() => toast('Couldn’t use that picture')); return; }
            const k = t.dataset.sw, p = t.dataset.pin;
            if (k === 'dnd') { dnd = t.checked; store.set('dnd', dnd); }
            else if (k === 'nfRandom') store.set('nfRandom', t.checked);
            else if (k === 'pin') { if (Lens.pinned !== t.checked) togglePin(); }
            else if (k === 'grain') setGrain(t.checked);
            else if (k === 'h24') { store.set('h24', t.checked); Shell.tick(new Date()); }
            else if (p) {
                const cur = store.get('tbPins', null) || ['explorer', 'browser', 'notepad', 'paint', 'calculator', 'solitaire', 'settings'];
                store.set('tbPins', t.checked ? [...cur, p] : cur.filter(x => x !== p));
                Shell.refreshTaskbar();
            }
        });
        main.addEventListener('input', e => {
            const r = e.target.dataset.r, v = +e.target.value;
            if (r === 'dim') setDim(v);
            else if (r === 'vol') { Music.audio.volume = v; store.set('vol', v); }
            else if (r === 'lens') setLensScale(v);
            else if (r === 'accent') setAccent(e.target.value);
        });
        main.addEventListener('submit', e => {
            e.preventDefault();
            const q = e.target.querySelector('input').value.trim();
            if (q) Geo.search(q).then(() => Weather.refresh(true)).then(() => go('time')).catch(() => toast('City not found'));
        });
        go(page);
        return { onArgs: a => { if (a.page) go(a.page); } };
    },
};
