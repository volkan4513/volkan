// Minimap: the whole route from above (north up, fitted to the box), the rest of the map's course
// dimmed, the finish, and every car as a dot: you in yellow with a nose, bots red, other players blue.
export function createMinimap(canvas) {
    const g = canvas.getContext('2d');
    let shapeFor = null, view = null;

    function fit(track) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < track.count; i++) {
            x0 = Math.min(x0, track.xs[i]); x1 = Math.max(x1, track.xs[i]);
            z0 = Math.min(z0, track.zs[i]); z1 = Math.max(z1, track.zs[i]);
        }
        const W = canvas.width, pad = W * 0.09, k = (W - pad * 2) / Math.max(x1 - x0, z1 - z0, 1);
        return { k, ox: W / 2 - ((x0 + x1) / 2) * k, oz: W / 2 - ((z0 + z1) / 2) * k };
    }
    const px = (x) => x * view.k + view.ox, pz = (z) => z * view.k + view.oz;

    function line(track, color, width) {
        g.beginPath();
        for (let i = 0; i < track.count; i++) (i ? g.lineTo : g.moveTo).call(g, px(track.xs[i]), pz(track.zs[i]));
        if (track.closed) g.closePath();
        g.strokeStyle = color;
        g.lineWidth = width;
        g.lineJoin = g.lineCap = 'round';
        g.stroke();
    }

    // route: the course being raced; full: the map's whole course; cars: [{ x, z, yaw, kind: 'me' | 'bot' | 'player' }]
    function draw(route, full, cars) {
        if (!route) return;
        if (shapeFor !== route) { view = fit(route); shapeFor = route; }
        const W = canvas.width;
        g.clearRect(0, 0, W, W);
        g.fillStyle = 'rgba(17,17,17,0.45)';
        g.fillRect(0, 0, W, W);
        if (full && full !== route) line(full, 'rgba(255,255,255,0.18)', W * 0.025);
        line(route, '#111', W * 0.06);
        line(route, '#f4f1e8', W * 0.03);
        // the finish: checkered square at the end of a sprint, or on the line of a circuit
        const f = route.at(route.closed ? 0 : route.length), s = W * 0.05;
        for (let i = 0; i < 4; i++) {
            g.fillStyle = (i % 2) ^ (i > 1) ? '#111' : '#fff';
            g.fillRect(px(f.x) - s + (i % 2) * s, pz(f.z) - s + (i > 1) * s, s, s);
        }
        const order = { player: 0, bot: 1, me: 2 };   // you on top
        for (const c of [...cars].sort((a, b) => order[a.kind] - order[b.kind])) {
            const x = px(c.x), z = pz(c.z);
            if (c.kind === 'me') {
                const r = W * 0.055, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
                g.beginPath();
                g.moveTo(x + fx * r * 1.5, z + fz * r * 1.5);
                g.lineTo(x - fz * r + -fx * r * 0.7, z + fx * r - fz * r * 0.7);
                g.lineTo(x + fz * r - fx * r * 0.7, z - fx * r - fz * r * 0.7);
                g.closePath();
                g.fillStyle = '#ffdf00';
                g.strokeStyle = '#111';
                g.lineWidth = W * 0.012;
                g.fill();
                g.stroke();
            } else {
                g.beginPath();
                g.arc(x, z, W * 0.032, 0, Math.PI * 2);
                g.fillStyle = c.kind === 'bot' ? '#ff5a4a' : '#4aa8ff';
                g.fill();
                g.strokeStyle = '#111';
                g.lineWidth = W * 0.01;
                g.stroke();
            }
        }
    }
    return { draw };
}
