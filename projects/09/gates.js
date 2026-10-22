// Start/finish line and gantry for the imported maps.
// Unlit materials, so it reads the same on lit and unlit maps. Added to the map group after the
// collision was built, so it has no walls: you can drive through the posts.
import * as THREE from './lib/three.module.min.js';

function checker(cols, rows) {
    const c = document.createElement('canvas');
    c.width = 16 * cols;
    c.height = 16 * rows;
    const g = c.getContext('2d');
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        g.fillRect(x * 16, y * 16, 16, 16);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;   // filtering and anisotropy come from textures.js
}

// s: distance along the track. width: road width in metres. A sprint's gate is its finish.
// gantry: false leaves out the posts and banner (a map that already has one there).
export function buildGate(track, map, s, width, finish, gantry = true) {
    const p = track.at(s), cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    // local (x across to the left of travel, z along) -> ground height under it
    const ground = (lx, lz) => map.groundAt(p.x + lx * cos + lz * sin, p.z - lx * sin + lz * cos, p.y, 3) ?? p.y;
    const gate = new THREE.Group();
    gate.name = finish ? 'gate:finish' : 'gate:start';
    gate.position.set(p.x, 0, p.z);
    gate.rotation.y = p.yaw;

    // the line follows the ground across the road, so a camber or a crest doesn't bury it
    const cols = Math.max(8, Math.round(width / 1.75)), nx = Math.ceil(width), nz = 3, depth = 1.75;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const lx = (i / nx - 0.5) * width, lz = (j / nz - 0.5) * depth;
        pos.push(lx, ground(lx, lz) + 0.12, lz);
        uv.push(i / nx, j / nz);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    gate.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: checker(cols, 2), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    })));
    if (!gantry) return gate;

    const gl = ground(width / 2 + 2, 0), gr = ground(-width / 2 - 2, 0), top = Math.max(gl, gr) + 6.2;
    const post = new THREE.MeshBasicMaterial({ color: '#2b2f36' });
    for (const [side, g] of [[1, gl], [-1, gr]]) {
        const h = top + 0.7 - g;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, h, 0.6), post);
        m.position.set(side * (width / 2 + 2), g + h / 2, 0);
        gate.add(m);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width + 4.6, 1.4, 0.5), finish
        ? new THREE.MeshBasicMaterial({ map: checker(Math.round((width + 4.6) / 0.7), 2) })
        : new THREE.MeshBasicMaterial({ color: '#ffdf00' }));
    bar.position.y = top;
    gate.add(bar);
    return gate;
}
