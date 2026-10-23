// Calculator: standard + scientific modes, history, keyboard. Has its own
// parser (no eval): + - × ÷ ^ %, !, functions, π, e and implied ×.
'use strict';
WinApps.calculator = {
    mount(w) {
        const b = w.body;
        let mode = store.get('calcMode', 'standard'), deg = store.get('calcDeg', true), expr = '', done = false, hist = store.get('calcHist', []), showHist = false;
        const FN = {
            sin: x => Math.sin(deg ? x * Math.PI / 180 : x), cos: x => Math.cos(deg ? x * Math.PI / 180 : x), tan: x => Math.tan(deg ? x * Math.PI / 180 : x),
            asin: x => (deg ? 180 / Math.PI : 1) * Math.asin(x), acos: x => (deg ? 180 / Math.PI : 1) * Math.acos(x), atan: x => (deg ? 180 / Math.PI : 1) * Math.atan(x),
            ln: Math.log, log: Math.log10, '√': Math.sqrt, abs: Math.abs,
        };
        const fact = n => { if (n < 0 || n !== Math.floor(n)) return NaN; if (n > 170) return Infinity; let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
        function tokens(src) {
            const out = [], re = /\s*(\d*\.?\d+(?:e[+-]?\d+)?|asin|acos|atan|sin|cos|tan|ln|log|abs|√|π|e|[-+×÷*/^%!()])/gy;
            let m;
            while (re.lastIndex < src.length && (m = re.exec(src))) out.push(m[1]);
            if (re.lastIndex < src.length && src.slice(re.lastIndex).trim()) throw 0;
            // implied multiplication: 2π, 3(4), (1)(2), 2sin(30)
            const val = t => /^[\d.]/.test(t) || t === 'π' || t === 'e' || t === ')' || t === '!' || t === '%';
            const starts = t => /^[\d.]/.test(t) || t === 'π' || t === 'e' || t === '(' || t in FN;
            const res = [];
            out.forEach((t, i) => { if (i && val(out[i - 1]) && starts(t)) res.push('×'); res.push(t); });
            return res;
        }
        function evaluate(src) {
            const t = tokens(src);
            let i = 0;
            const peek = () => t[i], take = () => t[i++];
            function sum() { let v = prod(); while (peek() === '+' || peek() === '-') v = take() === '+' ? v + prod() : v - prod(); return v; }
            function prod() { let v = unary(); while (['×', '÷', '*', '/'].includes(peek())) { const o = take(), r = unary(); v = o === '×' || o === '*' ? v * r : v / r; } return v; }
            function unary() { if (peek() === '-') { take(); return -unary(); } if (peek() === '+') { take(); return unary(); } return power(); }
            function power() { const b = post(); if (peek() === '^') { take(); return Math.pow(b, unary()); } return b; }
            function post() { let v = atom(); for (; ;) { if (peek() === '!') { take(); v = fact(v); } else if (peek() === '%') { take(); v /= 100; } else return v; } }
            function atom() {
                const x = take();
                if (x === undefined) throw 0;
                if (x === '(') { const v = sum(); if (peek() === ')') take(); return v; }   // a missing ")" is forgiven
                if (x === 'π') return Math.PI;
                if (x === 'e') return Math.E;
                if (x in FN) { if (peek() === '(') { take(); const v = sum(); if (peek() === ')') take(); return FN[x](v); } return FN[x](post()); }
                const n = parseFloat(x); if (isNaN(n)) throw 0; return n;
            }
            const v = sum();
            if (i < t.length) throw 0;
            return v;
        }
        const fmt = v => {
            if (!isFinite(v)) return isNaN(v) ? 'Not a number' : 'Infinity';
            const r = +v.toPrecision(14);
            return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-9 && r !== 0) ? r.toExponential(8).replace(/\.?0+e/, 'e') : r.toLocaleString(undefined, { maximumFractionDigits: 12 });
        };
        const plain = v => String(+v.toPrecision(14));
        // the operand at the end of the expression (a number, a constant or a bracketed group)
        function lastOperand() {
            const m = expr.match(/(\d*\.?\d+(?:e[+-]?\d+)?|π|e)$/);
            if (m) return m.index;
            if (expr.endsWith(')')) { let d = 0; for (let i = expr.length - 1; i >= 0; i--) { if (expr[i] === ')') d++; if (expr[i] === '(' && --d === 0) { while (i > 0 && /[a-z√]/.test(expr[i - 1])) i--; return i; } } }
            return -1;
        }
        function wrapLast(f) {
            if (done) { done = false; }
            const i = lastOperand();
            if (i < 0) return;
            expr = expr.slice(0, i) + f(expr.slice(i));
        }
        function press(k) {
            if (k === 'C') { expr = ''; done = false; }
            else if (k === 'CE') { const i = lastOperand(); expr = i >= 0 ? expr.slice(0, i) : ''; }
            else if (k === '⌫') { if (done) expr = ''; else expr = expr.replace(/(asin|acos|atan|sin|cos|tan|ln|log|abs)\($|.$/, ''); done = false; }
            else if (k === '=') {
                if (!expr) return;
                try {
                    const v = evaluate(expr);
                    hist.unshift({ e: expr, r: plain(v) });
                    hist = hist.slice(0, 30);
                    store.set('calcHist', hist);
                    q('.cl-expr').textContent = expr + ' =';
                    expr = isFinite(v) ? plain(v) : '';
                    done = true;
                    render(fmt(v));
                    return;
                } catch { render('Can’t calculate that'); return; }
            }
            else if (k === '±') wrapLast(s => s.startsWith('(-') && s.endsWith(')') ? s.slice(2, -1) : `(-${s})`);
            else if (k === '1/x') wrapLast(s => `1÷(${s})`);
            else if (k === 'x²') wrapLast(s => `(${s})^2`);
            else if (k === '√x') wrapLast(s => `√(${s})`);
            else if (k === '%') { done = false; expr += '%'; }
            else if (k === 'n!') { done = false; expr += '!'; }
            else if (k === 'xʸ') { done = false; expr += '^'; }
            else if (['sin', 'cos', 'tan', 'ln', 'log', 'asin', 'acos', 'atan'].includes(k)) { if (done) { expr = `${k}(${expr})`; } else expr += k + '('; done = false; }
            else {
                // digits and operators; typing a digit after a result starts over
                if (done && /[\d.πe(]/.test(k)) expr = '';
                done = false;
                if (/[×÷+\-^]/.test(k) && /[×÷+^]$/.test(expr)) expr = expr.slice(0, -1);
                expr += k;
            }
            if (k !== '=') q('.cl-expr').textContent = '';
            render();
        }
        function preview() {
            if (!expr || done) return '';
            try { const v = evaluate(expr); return /[-+×÷^%!(a-z√π]/.test(expr.replace(/^-/, '')) ? '= ' + fmt(v) : ''; } catch { return ''; }
        }
        const q = s => b.querySelector(s);
        const STD = ['%', 'CE', 'C', '⌫', '1/x', 'x²', '√x', '÷', '7', '8', '9', '×', '4', '5', '6', '-', '1', '2', '3', '+', '±', '0', '.', '='];
        const SCI = ['sin', 'cos', 'tan', 'π', 'e', 'asin', 'acos', 'atan', '(', ')', 'ln', 'log', 'xʸ', 'n!', 'DEG'];
        function keys() {
            q('.cl-sci').innerHTML = mode === 'scientific' ? SCI.map(k => `<button class="ck fn" data-k="${k}">${k === 'DEG' ? (deg ? 'DEG' : 'RAD') : k}</button>`).join('') : '';
            q('.cl-keys').innerHTML = STD.map(k => `<button class="ck ${/^[\d.±]$/.test(k) ? 'num' : ''} ${k === '=' ? 'eq' : ''}" data-k="${k}">${k}</button>`).join('');
            q('.cl-mode').textContent = mode === 'scientific' ? 'Scientific' : 'Standard';
        }
        function render(val) {
            q('.cl-val').textContent = val ?? (expr ? expr.replace(/\*/g, '×').replace(/\//g, '÷') : '0');
            q('.cl-prev').textContent = val ? '' : preview();
            const len = q('.cl-val').textContent.length;
            q('.cl-val').style.fontSize = (len > 20 ? 24 : len > 14 ? 32 : 44) + 'px';
            q('.cl-hist').innerHTML = hist.length ? hist.map((h, i) => `<button data-h="${i}"><small>${esc(h.e)} =</small><b>${esc(fmt(+h.r))}</b></button>`).join('') + '<button class="wbtn cl-clr">Clear history</button>' : '<p>There’s no history yet</p>';
        }
        b.innerHTML = `<div class="cl ${showHist ? 'hist' : ''}">
            <div class="cl-top"><button class="cl-menu" aria-label="Change mode">☰ <span class="cl-mode"></span></button><button class="cl-hbtn" aria-label="History" title="History">🕘</button></div>
            <div class="cl-screen"><div class="cl-expr"></div><div class="cl-val" aria-live="polite">0</div><div class="cl-prev"></div></div>
            <div class="cl-main"><div class="cl-pad"><div class="cl-sci"></div><div class="cl-keys"></div></div><div class="cl-hist"></div></div>
        </div>`;
        q('.cl-pad').addEventListener('click', e => {
            const k = e.target.closest('[data-k]')?.dataset.k;
            if (!k) return;
            if (k === 'DEG') { deg = !deg; store.set('calcDeg', deg); keys(); render(); return; }
            press(k);
        });
        q('.cl-menu').onclick = e => {
            const r = e.currentTarget.getBoundingClientRect();
            Shell.menu(r.left, r.bottom + 2, ['standard', 'scientific'].map(m => ({ label: m[0].toUpperCase() + m.slice(1), check: mode === m, fn: () => { mode = m; store.set('calcMode', m); keys(); } })));
        };
        q('.cl-hbtn').onclick = () => { showHist = !showHist; q('.cl').classList.toggle('hist', showHist); };
        q('.cl-hist').addEventListener('click', e => {
            if (e.target.closest('.cl-clr')) { hist = []; store.set('calcHist', hist); render(); return; }
            const h = e.target.closest('[data-h]');
            if (h) { expr = hist[+h.dataset.h].r; done = true; render(); }
        });
        w.el.addEventListener('keydown', e => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const map = { '*': '×', '/': '÷', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'CE', '^': 'xʸ', '!': 'n!', p: 'π' };
            let k = map[e.key] || e.key;
            if (k === 'C' && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
            if (/^[\d.+\-()%e]$/.test(k) || ['×', '÷', '=', '⌫', 'C', 'CE', 'xʸ', 'n!', 'π'].includes(k)) {
                e.preventDefault();
                press(k);
                const btn = b.querySelector(`[data-k="${CSS.escape(k)}"]`);
                if (btn) { btn.classList.add('down'); setTimeout(() => btn.classList.remove('down'), 120); }
            }
        });
        keys(); render();
        return { onResize() { } };
    },
};
