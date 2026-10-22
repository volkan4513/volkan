// Everything beyond the edge of a map: a gradient sky, ground out to the horizon, and a ring of
// distant scenery (a skyline, mountains or mesas) so the gaps between a map's buildings and the
// cut-off at its edge never show empty sky. It moves with the camera, like a skybox, so it never
// gets closer; the ring sits just inside the camera's far plane, where the map itself has faded
// into the haze. Unlit, with its own colours: hazier the further layer.
import * as THREE from './lib/three.module.min.js';

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export function createBackdrop(scene, camera) {
    const root = new THREE.Group();   // unit radius; scaled to the camera's far plane
    root.renderOrder = -10;
    scene.add(root);
    let sky = null, ground = null, layers = [], groundY = 0, built = null;

    function clear() {
        for (const o of [sky, ground, ...layers]) if (o) { root.remove(o); o.geometry.dispose(); o.material.dispose(); }
        sky = ground = null;
        layers = [];
    }

    // a ring around the camera, as a strip: height(theta) in fractions of the radius
    function ridge(color, radius, heightAt, steps = 160, base = -0.12) {
        const pos = [], idx = [];
        for (let i = 0; i <= steps; i++) {
            const a = (i / steps) * Math.PI * 2, x = Math.sin(a) * radius, z = Math.cos(a) * radius;
            pos.push(x, base, z, x, heightAt(a), z);
            if (i < steps) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false, depthWrite: true }));
        m.frustumCulled = false;
        return m;
    }

    // skyline: boxes of random height side by side around the ring, as one strip with steps
    function skyline(color, radius, seed, minH, maxH) {
        const r = rng(seed), steps = 220, heights = [];
        let h = minH;
        for (let i = 0; i < steps; i++) { if (i % 3 === 0 || r() < 0.2) h = minH + r() ** 1.6 * (maxH - minH); heights.push(h); }
        const pos = [], idx = [];
        // each building is a flat face with a flat top: two quads' worth of vertices, a step between neighbours
        for (let i = 0; i < steps; i++) {
            const a0 = (i / steps) * Math.PI * 2, a1 = ((i + 1) / steps) * Math.PI * 2, hh = heights[i], o = pos.length / 3;
            for (const a of [a0, a1]) pos.push(Math.sin(a) * radius, -0.12, Math.cos(a) * radius, Math.sin(a) * radius, hh, Math.cos(a) * radius);
            idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false }));
        m.frustumCulled = false;
        return m;
    }

    // map: the loaded map; style: { kind, top, ground, far, near }; groundHeight: lowest point of the map
    function set(map, style, groundHeight) {
        clear();
        built = style;
        groundY = groundHeight - 1.5;
        const horizon = new THREE.Color(map.sky), top = new THREE.Color(style.top || map.sky);

        // sky: a dome, blue overhead, the haze colour at the horizon (so it meets the fog)
        const sg = new THREE.SphereGeometry(1, 32, 16), col = [];
        const p = sg.attributes.position, c = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
            const t = Math.min(1, Math.max(0, p.getY(i)));
            c.copy(horizon).lerp(top, t ** 0.55);
            col.push(c.r, c.g, c.b);
        }
        sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        sky = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
        sky.renderOrder = -10;
        sky.frustumCulled = false;
        root.add(sky);

        // ground: out to the horizon in the ground colour; the fog turns it into haze with distance
        ground = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: style.ground || '#777', fog: true }));
        ground.rotation.x = -Math.PI / 2;
        ground.frustumCulled = false;
        root.add(ground);

        // scenery: the farther the layer, the closer to the haze colour
        const mix = (hex, k) => new THREE.Color(hex).lerp(horizon, k);
        const kind = style.kind;
        if (kind === 'city') {
            layers.push(skyline(mix(style.far || '#8497ab', 0.45), 0.97, 11, 0.07, 0.34));
            layers.push(skyline(mix(style.near || '#6b7d90', 0.3), 0.93, 29, 0.05, 0.24));
        } else if (kind === 'mesa') {
            const step = (h, q) => Math.round(h / q) * q;
            const wob = (a, s) => Math.sin(a * 3 + s) * 0.5 + Math.sin(a * 7 + s * 2) * 0.3 + Math.sin(a * 13 + s * 3) * 0.2;
            layers.push(ridge(mix(style.far || '#c79a6c', 0.5), 0.97, (a) => Math.max(0.03, step(0.09 + 0.07 * wob(a, 1), 0.035)), 200));
            layers.push(ridge(mix(style.near || '#b0764a', 0.3), 0.93, (a) => Math.max(0.025, step(0.06 + 0.06 * wob(a, 4), 0.03)), 200));
        } else {   // mountains
            const wob = (a, s) => Math.sin(a * 2 + s) * 0.5 + Math.sin(a * 5 + s * 2) * 0.3 + Math.sin(a * 11 + s * 3) * 0.2 + Math.sin(a * 23 + s) * 0.08;
            layers.push(ridge(mix(style.far || '#8fa0b0', 0.5), 0.97, (a) => Math.max(0.03, 0.14 + 0.1 * wob(a, 2)), 240));
            layers.push(ridge(mix(style.near || '#6f8290', 0.3), 0.93, (a) => Math.max(0.025, 0.08 + 0.07 * wob(a, 7)), 240));
        }
        for (const l of layers) root.add(l);
    }

    // call every frame before rendering
    function update() {
        if (!built) return;
        const r = camera.far * 0.92;
        root.position.set(camera.position.x, camera.position.y, camera.position.z);
        root.scale.setScalar(r);
        // the ground stays at its own height, only following the camera across
        if (ground) {
            ground.position.set(0, (groundY - camera.position.y) / r, 0);
        }
    }

    return { set, update, clear };
}
