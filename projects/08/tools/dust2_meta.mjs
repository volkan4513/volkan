// Hand-placed data for de_dust2 (map3.json), in world metres. build_dust2.mjs adds heights,
// collision boxes and waypoints. Top view: -z is north (CT side), +x is east (A side).
export const META = {
    name: 'Dust II',
    model: { src: 'extra_map/de_dust2_-_cs_map.glb', scale: 1.875, offset: [8, -1885.2, -2282] },
    credit: {
        title: 'de_dust2 - CS map',
        author: 'vrchris',
        url: 'https://sketchfab.com/3d-models/de-dust2-cs-map-056008d59eb849a29c0ab6884c0c3d87',
        license: 'CC BY 4.0',
        licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
    sky: 'textures/sky.jpg',
    fog: [80, 280],
    palette: { red: '#ff6050', blue: '#00a5ff', ink: '#111111', sky: '#9ea0ab', sand: '#c8965e', wall: '#c4a876', stone: '#bca072', plaster: '#ceac7a' },
    bounds: [-50, -62, 50, 60],
    // [x0, z0, x1, z1]
    sites: {
        A: [30, -38, 43, -26],
        B: [-40, -46, -26, -32],
    },
    // [x, z, yaw]
    spawns: {
        t: [[-38, 48, 3.1416], [-35, 48, 3.1416], [-32, 48, 3.1416], [-29, 48, 3.1416], [-38, 51, 3.1416], [-35, 51, 3.1416], [-32, 51, 3.1416], [-29, 51, 3.1416]],
        ct: [[-16, -34, 0], [-13, -34, 0], [-10, -34, 0], [-7, -34, 0], [-16, -31, 0], [-13, -31, 0], [-10, -31, 0], [-7, -31, 0]],
    },
    // Callouts shown on the HUD: name and [x0, z0, x1, z1], optional [yMin, yMax]. First match wins.
    areas: [
        { name: 'B Doors', r: [-27, -33, -23, -22] },
        { name: 'B Site', r: [-45, -50, -25, -27] },
        { name: 'B Back Plat', r: [-56, -67, -39, -50] },
        { name: 'B Platform', r: [-56, -50, -45, -27] },
        { name: 'B Tunnels', r: [-48, -27, -38, -9] },
        { name: 'Upper Tunnels', r: [-48, -9, -22, 3] },
        { name: 'Lower Tunnels', r: [-22, -11, -6, -3] },
        { name: 'Outside Tunnels', r: [-48, 3, -28, 14] },
        { name: 'T Spawn', r: [-50, 14, -6, 60] },
        { name: 'T Spawn', r: [-6, 40, 8, 60] },
        { name: 'CT Spawn', r: [-23, -50, 2, -18] },
        { name: 'Mid Doors', r: [-6, -18, 2, -9] },
        { name: 'Catwalk', r: [1.8, -14, 6, 16] },
        { name: 'Catwalk', r: [6, -15, 20, -6] },
        { name: 'CT to A', r: [2, -40, 16, -18] },
        { name: 'Goose', r: [43, -50, 54, -40] },
        { name: 'A Site', r: [16, -50, 43, -22] },
        { name: 'A Ramp', r: [43, -40, 54, -16] },
        { name: 'Long A', r: [38, -16, 54, 8] },
        { name: 'Pit', r: [40, 8, 54, 20] },
        { name: 'Long Doors', r: [20, 8, 28, 21] },
        { name: 'Long Corner', r: [28, -4, 40, 20] },
        { name: 'Mid', r: [-6, -9, 2, 12] },
        { name: 'Xbox', r: [-6, 12, 6, 18] },
        { name: 'Top Mid', r: [-6, 18, 2, 40] },
        { name: 'Outside Long', r: [2, 4, 28, 42] },
    ],
    // Invisible walls, [x0, y0, z0, x1, y1, z1].
    clips: [],
};
