// Radar: a rotating top-down map around the player, CS style (forward is up).
// The background is map.radar (an image made by the map's build tool) or, for box maps, drawn
// here from map.boxes. Players, the bomb, sites and the battle royale zone are drawn on top.

const RANGE = 36;     // metres from the centre to the edge

export function createRadar(canvas) {
    const g = canvas.getContext('2d');
    let bg = null;    // { img, x0, z0, x1, z1 }
    let mapRef = null;

    function setMap(map) {
        mapRef = map;
        bg = null;
        if (map.radar) {
            const img = new Image();
            const [x0, z0, x1, z1] = map.radar.bounds;
            img.onload = () => { if (mapRef === map) bg = { img, x0, z0, x1, z1 }; };
            img.src = map.radar.src;
        } else {
            bg = drawBoxes(map);
        }
    }

    // Box maps: floor light, crates mid, walls dark, seen from above.
    function drawBoxes(map) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const b of map.boxes) {
            x0 = Math.min(x0, b[0]); z0 = Math.min(z0, b[2]);
            x1 = Math.max(x1, b[3]); z1 = Math.max(z1, b[5]);
        }
        const PX = 4, c = document.createElement('canvas');
        c.width = Math.ceil((x1 - x0) * PX);
        c.height = Math.ceil((z1 - z0) * PX);
        const k = c.getContext('2d');
        const rect = (b) => k.fillRect((b[0] - x0) * PX, (b[2] - z0) * PX, (b[3] - b[0]) * PX, (b[5] - b[2]) * PX);
        const sorted = map.boxes.slice().sort((a, b) => a[4] - b[4]);
        for (const b of sorted) {
            const top = b[4];
            k.fillStyle = top <= 0.1 ? 'rgba(206, 196, 170, 0.92)' : top <= 1.6 ? 'rgba(150, 140, 118, 0.95)' : 'rgba(58, 54, 48, 0.95)';
            rect(b);
        }
        return { img: c, x0, z0, x1, z1 };
    }

    // view: { x, z, yaw, me, players: [{ x, z, y, yaw, kind: 'me' | 'mate' | 'enemy', color }], bomb, zone, sites }
    function draw(view) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const size = canvas.clientWidth;
        if (!size) return;
        if (canvas.width !== Math.round(size * dpr)) canvas.width = canvas.height = Math.round(size * dpr);
        const W = canvas.width, R = W / 2, s = R / RANGE;
        const cos = Math.cos(view.yaw), sin = Math.sin(view.yaw);
        // World point -> radar pixels (rotated so the view direction points up).
        const toRadar = (x, z) => {
            const dx = x - view.x, dz = z - view.z;
            return [R + (dx * cos - dz * sin) * s, R + (dx * sin + dz * cos) * s];
        };
        const clampEdge = (p, m = 6) => {
            const dx = p[0] - R, dy = p[1] - R, d = Math.hypot(dx, dy), max = R - m;
            return d > max ? [R + dx / d * max, R + dy / d * max, true] : [p[0], p[1], false];
        };

        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, W, W);
        g.save();
        g.beginPath();
        g.arc(R, R, R - 1, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = 'rgba(20, 22, 24, 0.55)';
        g.fillRect(0, 0, W, W);

        if (bg) {
            g.save();
            g.translate(R, R);
            g.rotate(view.yaw);
            g.scale(s, s);
            g.translate(-view.x, -view.z);
            g.imageSmoothingEnabled = true;
            g.drawImage(bg.img, bg.x0, bg.z0, bg.x1 - bg.x0, bg.z1 - bg.z0);
            g.restore();
        }

        // Battle royale zone: the current circle and where it shrinks to.
        if (view.zone && !view.zone.off) {
            const zn = view.zone;
            g.lineWidth = 2 * dpr;
            for (const [x, z, r, col] of [[zn.x, zn.z, zn.r, '#4aa8ff'], [zn.tx, zn.tz, zn.tr, '#ffffff']]) {
                if (r <= 0.05) continue;
                const [cx, cy] = toRadar(x, z);
                g.strokeStyle = col;
                g.beginPath();
                g.arc(cx, cy, r * s, 0, Math.PI * 2);
                g.stroke();
            }
        }

        // Bombsite letters, kept upright.
        g.font = `700 ${Math.round(13 * dpr)}px Oswald, Arial Narrow, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const site of view.sites || []) {
            const [x, y, edge] = clampEdge(toRadar(site.x, site.z), 10 * dpr);
            g.globalAlpha = edge ? 0.6 : 1;
            g.lineWidth = 3 * dpr;
            g.strokeStyle = '#111';
            g.strokeText(site.name, x, y);
            g.fillStyle = site.color;
            g.fillText(site.name, x, y);
            g.globalAlpha = 1;
        }

        if (view.bomb) {
            const [x, y] = clampEdge(toRadar(view.bomb.x, view.bomb.z));
            const r = 4 * dpr;
            g.fillStyle = view.bomb.planted ? '#ff4030' : '#ffb020';
            g.strokeStyle = '#111';
            g.lineWidth = 1.5 * dpr;
            g.fillRect(x - r, y - r, r * 2, r * 2);
            g.strokeRect(x - r, y - r, r * 2, r * 2);
        }

        // Players: a dot with a tick toward where they face; ^ / v when well above or below you.
        for (const p of view.players) {
            if (p.kind === 'me') continue;
            const [x, y, edge] = clampEdge(toRadar(p.x, p.z));
            const r = (edge ? 3 : 4.5) * dpr;
            g.fillStyle = p.color;
            g.strokeStyle = '#111';
            g.lineWidth = 1.5 * dpr;
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
            g.stroke();
            if (!edge) {
                const a = p.yaw - view.yaw;
                g.beginPath();
                g.moveTo(x, y);
                g.lineTo(x - Math.sin(a) * r * 2.1, y - Math.cos(a) * r * 2.1);
                g.stroke();
                const dy = p.y - view.y;
                if (Math.abs(dy) > 2) {
                    g.fillStyle = '#fff';
                    g.font = `700 ${Math.round(9 * dpr)}px sans-serif`;
                    g.fillText(dy > 0 ? '▲' : '▼', x, y - r * 2.2);
                    g.font = `700 ${Math.round(13 * dpr)}px Oswald, Arial Narrow, sans-serif`;
                }
            }
        }

        // You: an arrow in the middle, always pointing up.
        const a = 7 * dpr;
        g.fillStyle = '#fff';
        g.strokeStyle = '#111';
        g.lineWidth = 1.5 * dpr;
        g.beginPath();
        g.moveTo(R, R - a);
        g.lineTo(R + a * 0.7, R + a * 0.7);
        g.lineTo(R, R + a * 0.3);
        g.lineTo(R - a * 0.7, R + a * 0.7);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();

        g.lineWidth = 3 * dpr;
        g.strokeStyle = '#111';
        g.beginPath();
        g.arc(R, R, R - 1.5 * dpr, 0, Math.PI * 2);
        g.stroke();
    }

    return { setMap, draw };
}
