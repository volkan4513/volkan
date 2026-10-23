// Solitaire (Klondike): drag runs between columns, click a card to send it
// where it fits, draw 1 or 3, undo, auto-finish, and the bouncing-cards win.
// Game code and card design made for this site.
'use strict';
WinApps.solitaire = {
    mount(w) {
        const b = w.body;
        const SUIT = ['♠', '♥', '♦', '♣'], RED = [false, true, true, false];
        const RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suit = id => Math.floor(id / 13), rank = id => id % 13 + 1, red = id => RED[suit(id)];
        let S, hist = [], drawN = store.get('solDraw', 1), back = store.get('solBack', 0), score = 0, moves = 0, secs = 0, passes = 0, won = false, timer = 0, G = {};
        const pos = {};   // id -> {x, y} where layout() last put the card
        const stats = store.get('solStats', { played: 0, won: 0, best: 0 });

        b.innerHTML = `<div class="sol back-${back}">
            <div class="sol-bar"><button class="wbtn" data-a="new">New game</button><button class="wbtn" data-a="undo">↶ Undo</button><button class="wbtn pri" data-a="auto" hidden>Auto-finish</button>
                <select class="dlg-in sol-draw" aria-label="Cards to draw"><option value="1">Draw 1</option><option value="3">Draw 3</option></select><button class="wbtn" data-a="back">Card back</button>
                <span class="grow"></span><span class="sol-stat" aria-live="polite"></span><button class="ib" data-a="about" title="About" aria-label="About">ⓘ</button></div>
            <div class="sol-board"><div class="sol-slots"></div><div class="sol-cards"></div><canvas class="sol-fx" hidden></canvas><div class="sol-msg" hidden></div></div></div>`;
        const root = b.querySelector('.sol'), board = b.querySelector('.sol-board'), layer = b.querySelector('.sol-cards'), fx = b.querySelector('.sol-fx'), msg = b.querySelector('.sol-msg');
        b.querySelector('.sol-draw').value = drawN;

        // ---- the 52 card elements (created once, moved with transforms)
        const face = id => {
            const r = RANK[id % 13], s = SUIT[suit(id)], n = rank(id);
            const mid = n > 10 ? `<span class="cm court">${r}<small>${s}</small></span>` : `<span class="cm${n === 1 ? ' ace' : ''}">${s}</span>`;
            return `<div class="cface"><span class="cc tl">${r}<br>${s}</span>${mid}<span class="cc br">${r}<br>${s}</span></div><div class="cback"></div>`;
        };
        const els = [...Array(52).keys()].map(id => {
            const e = document.createElement('div');
            e.className = 'card' + (red(id) ? ' red' : '');
            e.dataset.id = id;
            e.innerHTML = face(id);
            layer.appendChild(e);
            return e;
        });

        // ---- state
        function fresh() {
            const d = [...Array(52).keys()];
            for (let i = 51; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
            S = { stock: [], waste: [], f: [[], [], [], []], t: [[], [], [], [], [], [], []], up: Array(52).fill(false) };
            for (let c = 0; c < 7; c++) for (let r = c; r < 7; r++) S.t[r].push(d.pop());
            S.t.forEach(col => { S.up[col[col.length - 1]] = true; });
            S.stock = d;
        }
        function newGame() {
            fresh();
            hist = []; score = 0; moves = 0; secs = 0; passes = 0; won = false;
            stopTimer();
            stats.played++; store.set('solStats', stats);
            msg.hidden = true; stopFx();
            layout('deal'); hud(); persist();
        }
        const persist = () => store.set('solGame', won ? null : { S, score, moves, secs, passes, drawN });
        const pile = l => l.pile === 'stock' ? S.stock : l.pile === 'waste' ? S.waste : S[l.pile][l.i];
        function find(id) {
            for (const p of ['stock', 'waste']) { const k = S[p].indexOf(id); if (k >= 0) return { pile: p, k }; }
            for (const p of ['f', 't']) for (let i = 0; i < S[p].length; i++) { const k = S[p][i].indexOf(id); if (k >= 0) return { pile: p, i, k }; }
            return null;
        }
        const top = a => a[a.length - 1];
        const canF = (id, fi) => { const p = S.f[fi]; return p.length ? suit(top(p)) === suit(id) && rank(id) === rank(top(p)) + 1 : rank(id) === 1; };
        const canT = (id, ti) => { const p = S.t[ti]; if (!p.length) return rank(id) === 13; const t = top(p); return S.up[t] && red(t) !== red(id) && rank(id) === rank(t) - 1; };
        function save() { hist.push(JSON.stringify({ S, score, moves, passes })); if (hist.length > 300) hist.shift(); }
        function undo() {
            if (!hist.length || won) return;
            const h = JSON.parse(hist.pop());
            ({ S, score, moves, passes } = h);
            layout(); hud(); persist();
        }
        function startTimer() { if (!timer && !won) timer = setInterval(() => { secs++; hud(); }, 1000); }
        function stopTimer() { clearInterval(timer); timer = 0; }
        function move(group, from, to) {
            save();
            const src = pile(from);
            src.splice(from.k);
            pile(to).push(...group);
            if (to.pile === 'f') score += 10;
            if (from.pile === 'waste' && to.pile === 't') score += 5;
            if (from.pile === 'f' && to.pile === 't') score = Math.max(0, score - 15);
            if (from.pile === 't' && src.length && !S.up[top(src)]) { S.up[top(src)] = true; score += 5; }
            moves++;
            startTimer();
            layout(); hud(); persist();
            checkWin();
        }
        function draw() {
            if (won) return;
            if (S.stock.length) {
                save();
                for (let i = 0; i < drawN && S.stock.length; i++) { const id = S.stock.pop(); S.up[id] = true; S.waste.push(id); }
            } else if (S.waste.length) {
                save();
                S.stock = S.waste.reverse(); S.waste = [];
                S.stock.forEach(id => { S.up[id] = false; });
                passes++;
                score = Math.max(0, score - (drawN === 1 ? 100 : passes > 3 ? 20 : 0));
            } else return;
            moves++;
            startTimer();
            layout(); hud(); persist();
        }
        // click / tap: foundation first, then a column that already has cards, then an empty one
        function autoMove(id, loc) {
            const group = loc.pile === 't' ? S.t[loc.i].slice(loc.k) : [id];
            if (group.length === 1) for (let f = 0; f < 4; f++) if (canF(id, f) && !(loc.pile === 'f' && loc.i === f)) return move(group, loc, { pile: 'f', i: f });
            const cols = [...Array(7).keys()].filter(t => !(loc.pile === 't' && loc.i === t));
            let t = cols.find(c => S.t[c].length && canT(id, c));
            if (t == null && !(loc.pile === 't' && loc.k === 0)) t = cols.find(c => !S.t[c].length && canT(id, c));
            if (t != null) return move(group, loc, { pile: 't', i: t });
            group.forEach(g => { els[g].classList.remove('shake'); void els[g].offsetWidth; els[g].classList.add('shake'); });
        }
        const canAuto = () => !S.stock.length && !S.waste.length && S.t.every(c => c.every(id => S.up[id]));
        function autoFinish() {
            const step = () => {
                if (won) return;
                for (let c = 0; c < 7; c++) {
                    const col = S.t[c]; if (!col.length) continue;
                    const id = top(col);
                    for (let f = 0; f < 4; f++) if (canF(id, f)) { move([id], { pile: 't', i: c, k: col.length - 1 }, { pile: 'f', i: f }); return setTimeout(step, 70); }
                }
            };
            step();
        }
        function checkWin() {
            if (!S.f.every(p => p.length === 13)) return;
            won = true;
            stopTimer();
            stats.won++;
            stats.played = Math.max(stats.played, stats.won);   // a game resumed from an older save
            if (!stats.best || secs < stats.best) stats.best = secs;
            store.set('solStats', stats);
            persist();
            hud();
            setTimeout(celebrate, 400);
        }
        const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        function hud() {
            b.querySelector('.sol-stat').textContent = `Score ${score}   ·   Moves ${moves}   ·   ${mmss(secs)}`;
            b.querySelector('[data-a="undo"]').disabled = !hist.length || won;
            b.querySelector('[data-a="auto"]').hidden = won || !canAuto();
        }

        // ---- layout
        function geo() {
            const W = board.clientWidth, H = board.clientHeight;
            const gap = Math.max(6, Math.min(18, W * 0.014));
            const cw = Math.max(36, Math.min(120, (W - gap * 8) / 7, (H - gap * 3) / 1.42 / 2.6)), ch = cw * 1.42;
            const ox = (W - (cw * 7 + gap * 6)) / 2;
            G = { W, H, gap, cw, ch, x: c => ox + c * (cw + gap), top: gap, tabTop: gap * 2 + ch };
            board.style.setProperty('--cw', cw + 'px');
            board.style.setProperty('--ch', ch + 'px');
        }
        function place(id, x, y, z, up) {
            pos[id] = { x, y };
            const e = els[id];
            e.style.transform = `translate(${x}px, ${y}px)`;
            e.style.zIndex = z;
            e.classList.toggle('up', up);
        }
        function layout(mode) {
            geo();
            b.querySelector('.sol-slots').innerHTML = [`<div class="slot stock" data-s="stock" style="left:${G.x(0)}px;top:${G.top}px">${S.stock.length ? '' : '↻'}</div>`, `<div class="slot" style="left:${G.x(1)}px;top:${G.top}px"></div>`]
                .concat([0, 1, 2, 3].map(f => `<div class="slot found" style="left:${G.x(3 + f)}px;top:${G.top}px">${SUIT[f]}</div>`))
                .concat([...Array(7).keys()].map(c => `<div class="slot" style="left:${G.x(c)}px;top:${G.tabTop}px"></div>`)).join('');
            if (mode === 'deal') {   // fly every card out of the stock
                layer.classList.add('still');
                for (let id = 0; id < 52; id++) place(id, G.x(0), G.top, id, false);
                void layer.offsetWidth;
                layer.classList.remove('still');
            } else if (mode === 'still') layer.classList.add('still');
            S.stock.forEach((id, i) => place(id, G.x(0) + Math.min(i, 8) * 0.3, G.top - Math.min(i, 8) * 0.3, i, false));
            const n = S.waste.length;
            S.waste.forEach((id, i) => { const k = drawN === 3 ? Math.max(0, i - (n - 3)) : 0; place(id, G.x(1) + k * G.cw * 0.24, G.top, 60 + i, true); });
            S.f.forEach((p, f) => p.forEach((id, i) => place(id, G.x(3 + f), G.top, 120 + i, true)));
            S.t.forEach((col, c) => {
                const offs = col.map(id => S.up[id] ? G.ch * 0.27 : G.ch * 0.12), sum = offs.slice(0, -1).reduce((a, v) => a + v, 0);
                const room = G.H - G.tabTop - G.ch - G.gap, k = sum > room ? room / sum : 1;
                let y = G.tabTop;
                col.forEach((id, i) => { place(id, G.x(c), y, 200 + i, S.up[id]); y += offs[i] * k; });
            });
            if (mode === 'deal') S.t.flat().forEach((id, i) => { els[id].style.transitionDelay = i * 22 + 'ms'; setTimeout(() => { els[id].style.transitionDelay = ''; }, 900); });
            if (mode === 'still') requestAnimationFrame(() => layer.classList.remove('still'));
        }

        // ---- dragging
        board.addEventListener('pointerdown', e => {
            if (won || e.button > 0) return;
            const ce = e.target.closest('.card');
            if (!ce) { if (e.target.closest('[data-s="stock"]')) draw(); return; }
            const id = +ce.dataset.id, loc = find(id);
            if (loc.pile === 'stock') { draw(); return; }
            if (!S.up[id]) return;
            if (loc.pile !== 't' && loc.k !== pile(loc).length - 1) return;
            const group = loc.pile === 't' ? S.t[loc.i].slice(loc.k) : [id];
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            let dragging = false;
            ce.setPointerCapture(e.pointerId);
            const mv = ev => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (!dragging && Math.hypot(dx, dy) < 5) return;
                if (!dragging) { dragging = true; group.forEach((g, i) => { els[g].classList.add('drag'); els[g].style.zIndex = 1000 + i; }); }
                group.forEach(g => { els[g].style.transform = `translate(${pos[g].x + dx}px, ${pos[g].y + dy}px)`; });
            };
            const up = ev => {
                ce.removeEventListener('pointermove', mv); ce.removeEventListener('pointerup', up); ce.removeEventListener('pointercancel', up);
                group.forEach(g => els[g].classList.remove('drag'));
                if (!dragging) { autoMove(id, loc); return; }
                const dx = ev.clientX - sx, dy = ev.clientY - sy, hx = pos[id].x + dx, hy = pos[id].y + dy;
                const overlap = (x, y, wd, ht) => Math.max(0, Math.min(hx + G.cw, x + wd) - Math.max(hx, x)) * Math.max(0, Math.min(hy + G.ch, y + ht) - Math.max(hy, y));
                let best = null, area = 0;
                if (group.length === 1) for (let f = 0; f < 4; f++) { const a = overlap(G.x(3 + f), G.top, G.cw, G.ch); if (a > area && canF(id, f)) { area = a; best = { pile: 'f', i: f }; } }
                for (let c = 0; c < 7; c++) {
                    if (loc.pile === 't' && loc.i === c) continue;
                    const col = S.t[c], last = col.length ? pos[top(col)].y : G.tabTop;
                    const a = overlap(G.x(c), G.tabTop, G.cw, last - G.tabTop + G.ch);
                    if (a > area && canT(id, c)) { area = a; best = { pile: 't', i: c }; }
                }
                if (best) move(group, loc, best); else layout();
            };
            ce.addEventListener('pointermove', mv); ce.addEventListener('pointerup', up); ce.addEventListener('pointercancel', up);
        });

        // ---- the win: cards bounce off the foundations, leaving trails
        let fxRaf = 0;
        function drawCard(g, id, x, y) {
            const cw = G.cw, ch = G.ch, r = cw * 0.08;
            g.fillStyle = '#fff'; g.strokeStyle = '#999'; g.lineWidth = 1;
            g.beginPath(); g.roundRect ? g.roundRect(x, y, cw, ch, r) : g.rect(x, y, cw, ch); g.fill(); g.stroke();
            g.fillStyle = red(id) ? '#d01818' : '#111';
            g.font = `700 ${cw * 0.2}px Georgia, serif`; g.textAlign = 'left'; g.textBaseline = 'top';
            g.fillText(RANK[id % 13], x + cw * 0.08, y + ch * 0.05);
            g.fillText(SUIT[suit(id)], x + cw * 0.08, y + ch * 0.05 + cw * 0.22);
            g.font = `${cw * 0.5}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(rank(id) > 10 ? RANK[id % 13] : SUIT[suit(id)], x + cw / 2, y + ch / 2);
        }
        function celebrate() {
            fx.width = G.W; fx.height = G.H; fx.hidden = false;
            const g = fx.getContext('2d');
            layer.style.visibility = 'hidden';
            const queue = [];
            for (let r = 12; r >= 0; r--) for (let f = 0; f < 4; f++) queue.push({ id: S.f[f][r], x: G.x(3 + f), y: G.top });
            S.f.forEach((p, f) => drawCard(g, top(p), G.x(3 + f), G.top));
            let c = null;
            const frame = () => {
                if (!c) {
                    if (!queue.length) { showWin(); return; }
                    c = queue.shift();
                    c.vx = (Math.random() * 5 + 2.5) * (Math.random() < 0.5 ? -1 : 1);
                    c.vy = -Math.random() * 8;
                }
                c.vy += 0.55; c.x += c.vx; c.y += c.vy;
                if (c.y + G.ch > G.H) { c.y = G.H - G.ch; c.vy *= -0.78; }
                drawCard(g, c.id, c.x, c.y);
                if (c.x < -G.cw || c.x > G.W) c = null;
                fxRaf = requestAnimationFrame(frame);
            };
            frame();
            showWin(true);
        }
        function stopFx() { cancelAnimationFrame(fxRaf); fx.hidden = true; layer.style.visibility = ''; }
        function showWin(quiet) {
            msg.innerHTML = `<b>You won! 🎉</b><span>Score ${score} · ${moves} moves · ${mmss(secs)}</span><span class="muted">Games won: ${stats.won} of ${stats.played} · best time ${mmss(stats.best)}</span><button class="wbtn pri" data-a="new">Play again</button>`;
            msg.hidden = false;
            msg.classList.toggle('quiet', !!quiet);
        }
        function about() {
            msg.innerHTML = `<b>Solitaire</b><span>Klondike: build the four suits up from Ace to King. In the columns, stack down in alternating colours; only a King can fill an empty column.</span>
                <span>Drag cards, or click one to send it where it fits. Ctrl+Z undoes. Draw 3 is harder.</span>
                <span class="muted">Played ${stats.played} · won ${stats.won}${stats.best ? ' · best time ' + mmss(stats.best) : ''}</span>
                <span class="muted">Game code and card design made for this site. Klondike is a traditional game, free for everyone.</span><button class="wbtn" data-a="closemsg">Close</button>`;
            msg.hidden = false;
            msg.classList.remove('quiet');
        }

        b.addEventListener('click', e => {
            const a = e.target.closest('[data-a]')?.dataset.a;
            if (a === 'new') newGame();
            else if (a === 'undo') undo();
            else if (a === 'auto') autoFinish();
            else if (a === 'about') about();
            else if (a === 'closemsg') msg.hidden = true;
            else if (a === 'back') { root.classList.remove('back-' + back); back = (back + 1) % 4; root.classList.add('back-' + back); store.set('solBack', back); }
            else if (fx && !fx.hidden && e.target === fx) { stopFx(); }
        });
        fx.addEventListener('click', () => { stopFx(); showWin(); });
        b.querySelector('.sol-draw').onchange = e => { drawN = +e.target.value; store.set('solDraw', drawN); newGame(); };
        w.el.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
            else if (e.key === 'F2') { e.preventDefault(); newGame(); }
            else if (e.key.toLowerCase() === 'd' || e.key === ' ') { e.preventDefault(); draw(); }
        });
        const ro = new ResizeObserver(() => { if (S) { layout('still'); if (won && !fx.hidden) { stopFx(); showWin(); } } });
        ro.observe(board);

        const saved = store.get('solGame', null);
        if (saved && saved.S && saved.drawN === drawN) {
            ({ S, score, moves, secs, passes } = saved);
            requestAnimationFrame(() => { layout('still'); hud(); });
            if (moves) startTimer();
        } else requestAnimationFrame(newGame);
        return {
            onDestroy() { stopTimer(); stopFx(); ro.disconnect(); persist(); },
        };
    },
};
