// Clock: timers, alarms, stopwatch and world clock. Alarms and timers are
// watched by the shell (Shell.clock), so they ring with the app closed.
'use strict';
WinApps.clock = {
    mount(w, args) {
        const b = w.body, C = Shell.clock;
        let tab = args.tab || store.get('clockTab', 'timer'), int = 0;
        let sw = { acc: 0, start: 0, run: false, laps: [] };
        const swNow = () => sw.acc + (sw.run ? performance.now() - sw.start : 0);
        const two = n => String(Math.floor(n)).padStart(2, '0');
        const hms = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${two(s / 3600)}:${two(s / 60 % 60)}:${two(s % 60)}`; };
        const swFmt = ms => `${two(ms / 3600000)}:${two(ms / 60000 % 60)}:${two(ms / 1000 % 60)}.${two(ms / 10 % 100)}`;
        const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const ZONES = ['Pacific/Honolulu', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul', 'Africa/Cairo', 'Africa/Lagos', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];
        const city = z => z.split('/').pop().replace(/_/g, ' ');

        b.innerHTML = `<div class="ck2">
            <nav class="app-nav">${[['timer', '⏳', 'Timer'], ['alarm', '⏰', 'Alarm'], ['stopwatch', '⏱️', 'Stopwatch'], ['world', '🌍', 'World clock']].map(([id, ic, n]) => `<button data-t="${id}"><span>${ic}</span>${n}</button>`).join('')}</nav>
            <main class="ck2-main"></main></div>`;
        const main = b.querySelector('.ck2-main');

        function leftOf(t) { return t.end ? t.end - Date.now() : t.left != null ? t.left : t.total; }
        function ring(p) { const r = 44, c = 2 * Math.PI * r; return `<svg viewBox="0 0 100 100" class="ck2-ring"><circle cx="50" cy="50" r="${r}" class="bg"/><circle cx="50" cy="50" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/></svg>`; }
        function renderTimer() {
            const ts = C.timers();
            main.innerHTML = `<h2>Timer</h2><div class="ck2-timers">${ts.map(t => {
                const left = leftOf(t), p = 1 - left / t.total;
                return `<div class="ck2-card" data-id="${t.id}"><div class="ck2-card-h"><b>${esc(t.label)}</b><button class="ib" data-a="del" aria-label="Delete timer">🗑</button></div>
                    <div class="ck2-dial">${ring(t.end || t.left != null ? p : 0)}<span class="ck2-left">${hms(left)}</span></div>
                    <div class="ck2-btns"><button class="wbtn pri" data-a="go">${t.end ? 'Pause' : 'Start'}</button><button class="wbtn" data-a="reset">Reset</button></div></div>`;
            }).join('')}</div>
            <form class="ck2-add"><b>New timer</b><input type="number" min="0" max="23" value="0" aria-label="Hours" class="dlg-in"> h <input type="number" min="0" max="59" value="10" aria-label="Minutes" class="dlg-in"> m <input type="number" min="0" max="59" value="0" aria-label="Seconds" class="dlg-in"> s <input type="text" placeholder="Name" maxlength="24" aria-label="Timer name" class="dlg-in"><button class="wbtn pri">Add</button></form>`;
        }
        function tickTimer() {
            C.timers().forEach(t => {
                const card = main.querySelector(`[data-id="${t.id}"]`);
                if (!card) return;
                const left = leftOf(t), r = card.querySelector('.fg'), c = 2 * Math.PI * 44;
                card.querySelector('.ck2-left').textContent = hms(left);
                r.setAttribute('stroke-dashoffset', (c * (1 - (t.end || t.left != null ? 1 - left / t.total : 0))).toFixed(1));
            });
        }
        function renderAlarm() {
            const al = C.alarms(), now = new Date();
            const next = a => { const d = new Date(now); d.setHours(a.h, a.m, 0, 0); for (let i = 0; i < 8; i++) { if (d > now && (!a.days?.length || a.days.includes(d.getDay()))) return d; d.setDate(d.getDate() + 1); } return null; };
            main.innerHTML = `<h2>Alarm</h2><div class="ck2-alarms">${al.length ? al.map(a => {
                const n = a.on && next(a), mins = n ? Math.round((n - now) / 6e4) : 0;
                return `<div class="ck2-al ${a.on ? '' : 'off'}" data-id="${a.id}"><div><div class="ck2-time">${two(a.h)}:${two(a.m)}</div><div class="ck2-sub">${esc(a.label || 'Alarm')} · ${a.days?.length ? a.days.map(d => DAYS[d]).join(' ') : 'Once'}${n ? ` · rings in ${Math.floor(mins / 60)}h ${mins % 60}m` : ''}</div></div>
                    <label class="sw"><input type="checkbox" data-a="toggle" ${a.on ? 'checked' : ''} aria-label="Alarm on"><i></i></label><button class="ib" data-a="del" aria-label="Delete alarm">🗑</button></div>`;
            }).join('') : '<p class="ck2-sub">No alarms yet.</p>'}</div>
            <form class="ck2-add"><b>New alarm</b><input type="time" value="08:00" required aria-label="Time" class="dlg-in"><input type="text" placeholder="Label" maxlength="24" aria-label="Label" class="dlg-in">
                <span class="ck2-days">${DAYS.map((d, i) => `<label><input type="checkbox" value="${i}">${d}</label>`).join('')}</span><button class="wbtn pri">Add</button></form>
            <p class="ck2-sub">Alarms ring while this page is open in your browser.</p>`;
        }
        function renderSw() {
            main.innerHTML = `<h2>Stopwatch</h2><div class="ck2-big ck2-sw">${swFmt(swNow())}</div>
                <div class="ck2-btns center"><button class="wbtn pri" data-a="sw-go">${sw.run ? 'Pause' : sw.acc ? 'Resume' : 'Start'}</button><button class="wbtn" data-a="sw-lap" ${sw.run ? '' : 'disabled'}>Lap</button><button class="wbtn" data-a="sw-reset">Reset</button></div>
                <table class="ck2-laps">${sw.laps.map((l, i) => `<tr><td>Lap ${sw.laps.length - i}</td><td>${swFmt(l.split)}</td><td>${swFmt(l.total)}</td></tr>`).join('')}</table>`;
        }
        function renderWorld() {
            const zones = store.get('zones', ['Europe/London', 'America/New_York', 'Asia/Tokyo']), now = new Date();
            const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const row = (z, rm) => {
                const t = new Intl.DateTimeFormat([], { timeZone: z, hour: '2-digit', minute: '2-digit' }).format(now);
                const h = +new Intl.DateTimeFormat('en-GB', { timeZone: z, hour: '2-digit', hour12: false }).format(now);
                const off = (new Date(now.toLocaleString('en-US', { timeZone: z })) - new Date(now.toLocaleString('en-US'))) / 36e5;
                const day = new Intl.DateTimeFormat([], { timeZone: z, weekday: 'short' }).format(now);
                return `<div class="ck2-wc"><span class="ck2-dn">${h >= 6 && h < 19 ? '☀️' : '🌙'}</span><div><b>${esc(city(z))}</b><div class="ck2-sub">${day} · ${off === 0 ? 'Same time' : (off > 0 ? '+' : '') + Math.round(off * 2) / 2 + ' h'}</div></div><span class="ck2-wt">${t}</span>${rm ? `<button class="ib" data-z="${z}" aria-label="Remove ${esc(city(z))}">✕</button>` : '<span></span>'}</div>`;
            };
            main.innerHTML = `<h2>World clock</h2><div class="ck2-world">${row(local, false)}${zones.map(z => row(z, true)).join('')}</div>
                <div class="ck2-add"><select class="dlg-in" aria-label="Add a city"><option value="">Add a city…</option>${ZONES.filter(z => !zones.includes(z)).map(z => `<option value="${z}">${esc(city(z))}</option>`).join('')}</select></div>`;
        }
        const RENDER = { timer: renderTimer, alarm: renderAlarm, stopwatch: renderSw, world: renderWorld };
        function go(t) {
            tab = t; store.set('clockTab', t);
            b.querySelectorAll('.app-nav button').forEach(x => x.classList.toggle('on', x.dataset.t === t));
            RENDER[t]();
            clearInterval(int);
            int = setInterval(() => {
                if (tab === 'timer') tickTimer();
                else if (tab === 'stopwatch') { const e = main.querySelector('.ck2-sw'); if (e) e.textContent = swFmt(swNow()); }
                else if (tab === 'world' && new Date().getSeconds() === 0) renderWorld();
            }, tab === 'stopwatch' ? 50 : 250);
        }
        b.querySelector('.app-nav').addEventListener('click', e => { const t = e.target.closest('[data-t]'); if (t) go(t.dataset.t); });
        main.addEventListener('click', e => {
            const a = e.target.closest('[data-a]')?.dataset.a, card = e.target.closest('[data-id]'), id = card && +card.dataset.id;
            if (tab === 'timer' && a) {
                const ts = C.timers(), t = ts.find(x => x.id === id);
                if (a === 'del') C.saveTimers(ts.filter(x => x !== t));
                else if (a === 'reset') { t.end = null; t.left = null; C.saveTimers(ts); }
                else if (a === 'go') {
                    if (t.end) { t.left = t.end - Date.now(); t.end = null; }
                    else t.end = Date.now() + (t.left != null ? t.left : t.total);
                    C.saveTimers(ts);
                }
                renderTimer();
            } else if (tab === 'alarm' && a === 'del') { C.saveAlarms(C.alarms().filter(x => x.id !== id)); renderAlarm(); }
            else if (a === 'sw-go') { if (sw.run) { sw.acc = swNow(); sw.run = false; } else { sw.start = performance.now(); sw.run = true; } renderSw(); }
            else if (a === 'sw-lap') { const t = swNow(); sw.laps.unshift({ total: t, split: t - (sw.laps[0] ? sw.laps[0].total : 0) }); renderSw(); }
            else if (a === 'sw-reset') { sw = { acc: 0, start: 0, run: false, laps: [] }; renderSw(); }
            const z = e.target.closest('[data-z]');
            if (z) { store.set('zones', store.get('zones', []).filter(x => x !== z.dataset.z)); renderWorld(); }
        });
        main.addEventListener('change', e => {
            if (e.target.dataset.a === 'toggle') {
                const al = C.alarms(), a = al.find(x => x.id === +e.target.closest('[data-id]').dataset.id);
                a.on = e.target.checked; C.saveAlarms(al); renderAlarm();
            }
            if (e.target.tagName === 'SELECT' && e.target.value) { store.set('zones', [...store.get('zones', ['Europe/London', 'America/New_York', 'Asia/Tokyo']), e.target.value].slice(-8)); renderWorld(); }
        });
        main.addEventListener('submit', e => {
            e.preventDefault();
            const f = e.target, ins = f.querySelectorAll('input');
            if (tab === 'timer') {
                const total = ((+ins[0].value || 0) * 3600 + (+ins[1].value || 0) * 60 + (+ins[2].value || 0)) * 1000;
                if (!total) return toast('Set a time first');
                const ts = C.timers();
                ts.push({ id: Date.now(), label: ins[3].value.trim() || hms(total), total });
                C.saveTimers(ts); renderTimer();
            } else if (tab === 'alarm') {
                const [h, m] = ins[0].value.split(':').map(Number);
                const days = [...f.querySelectorAll('.ck2-days input:checked')].map(x => +x.value);
                const al = C.alarms();
                al.push({ id: Date.now(), h, m, label: ins[1].value.trim(), on: true, days });
                C.saveAlarms(al); renderAlarm();
                toast(`Alarm set for ${two(h)}:${two(m)}`);
            }
        });
        const onSvc = () => { if (tab === 'timer') renderTimer(); else if (tab === 'alarm') renderAlarm(); };
        document.addEventListener('clocksvc', onSvc);
        go(tab);
        return {
            onArgs: a => { if (a.tab) go(a.tab); },
            onDestroy() { clearInterval(int); document.removeEventListener('clocksvc', onSvc); },
        };
    },
};
