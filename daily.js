// Daily puzzle challenge, shared by index.html (the card) and page2.html
// (the game). Everyone gets the same level on the same day; results and the
// streak are saved in this browser only.
//   Daily.index(total)        -> today's level index (0-based)
//   Daily.state()             -> { today, done: {moves, stars} | null, streak, bestStreak }
//   Daily.record(moves, stars)-> saves today's result, updates the streak
(function () {
    const KEY = 'parking-daily';
    const pad = n => String(n).padStart(2, '0');
    const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dayNumber = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
    const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); };

    // step by 7 (coprime with 20) so consecutive days jump around but every
    // level comes up once per cycle
    function index(total, date = new Date()) {
        return total ? (dayNumber(date) * 7 + 3) % total : 0;
    }

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    }
    function save(s) {
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { }
    }

    function state() {
        const s = load(), today = ymd(new Date());
        const alive = s.last === today || s.last === yesterday();
        return {
            today,
            done: (s.results && s.results[today]) || null,
            streak: alive ? s.streak || 0 : 0,
            bestStreak: s.bestStreak || 0,
        };
    }

    function record(moves, stars) {
        const s = load(), today = ymd(new Date());
        if (s.last !== today) {
            s.streak = s.last === yesterday() ? (s.streak || 0) + 1 : 1;
            s.last = today;
        }
        s.bestStreak = Math.max(s.bestStreak || 0, s.streak);
        s.results = s.results || {};
        const prev = s.results[today];
        if (!prev || moves < prev.moves) s.results[today] = { moves, stars };
        const days = Object.keys(s.results).sort();
        while (days.length > 40) delete s.results[days.shift()];
        save(s);
        return state();
    }

    window.Daily = { index, state, record, ymd };
})();
