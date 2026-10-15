// Minimal GLB reader for the map build tools (Node only, no dependencies).
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readGlb(path) {
    const d = fs.readFileSync(path);
    if (d.toString('latin1', 0, 4) !== 'glTF') throw new Error('not a GLB file: ' + path);
    const jl = d.readUInt32LE(12);
    const json = JSON.parse(d.subarray(20, 20 + jl).toString());
    const bo = 20 + jl;
    const bin = d.subarray(bo + 8, bo + 8 + d.readUInt32LE(bo));
    return { json, bin };
}

const COMP = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export function accessor({ json, bin }, i) {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType], n = NUM[a.type], size = T.BYTES_PER_ELEMENT;
    const off = bin.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0);
    const stride = v.byteStride || n * size;
    const out = new T(a.count * n);
    const src = new DataView(bin.buffer);
    const get = { 4: (p) => (T === Float32Array ? src.getFloat32(p, true) : src.getUint32(p, true)), 2: (p) => src.getUint16(p, true), 1: (p) => src.getUint8(p) }[size];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = get(off + k * stride + c * size);
    return out;
}

// 4x4 column-major matrices, as glTF stores them.
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
        tx, ty, tz, 1,
    ];
}

// Every triangle primitive with its scene-space positions: [{ material, pos: Float32Array, uv, idx }]
export function scenePrimitives(g) {
    const out = [];
    const walk = (ni, parent) => {
        const n = g.json.nodes[ni], m = mul(parent, nodeMatrix(n));
        if (n.mesh !== undefined) {
            for (const p of g.json.meshes[n.mesh].primitives) {
                if ((p.mode ?? 4) !== 4) continue;
                const local = accessor(g, p.attributes.POSITION), pos = new Float32Array(local.length);
                for (let i = 0; i < local.length; i += 3) {
                    const x = local[i], y = local[i + 1], z = local[i + 2];
                    pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
                    pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                    pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
                }
                out.push({
                    material: p.material, pos,
                    uv: p.attributes.TEXCOORD_0 !== undefined ? accessor(g, p.attributes.TEXCOORD_0) : null,
                    idx: p.indices !== undefined ? accessor(g, p.indices) : null,
                });
            }
        }
        for (const c of n.children || []) walk(c, m);
    };
    for (const r of g.json.scenes[g.json.scene || 0].nodes) walk(r, I4);
    return out;
}

// Decodes an embedded PNG to RGBA (8-bit grey / RGB / RGBA / palette, any bit depth up to 8, no interlace).
export function decodePng(buf) {
    let p = 8, w, h, depth, type, pal = null, trns = null;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
        if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
        else if (t === 'PLTE') pal = d;
        else if (t === 'tRNS') trns = d;
        else if (t === 'IDAT') idat.push(d);
        p += 12 + len;
    }
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8);
    const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
            let v = line[x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[y * stride + x] = v;
        }
    }
    const out = new Uint8Array(w * h * 4), max = (1 << depth) - 1;
    const sample = (y, i) => depth === 8 ? px[y * stride + i] : (px[y * stride + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & max;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (type === 3) { const k = sample(y, x); out.set([pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2], trns && k < trns.length ? trns[k] : 255], o); }
        else if (type === 0) { const v = Math.round((sample(y, x) * 255) / max); out.set([v, v, v, 255], o); }
        else if (type === 4) out.set([px[y * stride + x * 2], px[y * stride + x * 2], px[y * stride + x * 2], px[y * stride + x * 2 + 1]], o);
        else for (let c = 0; c < 4; c++) out[o + c] = c < ch ? px[y * stride + x * ch + c] : 255;
    }
    return { w, h, rgba: out };
}

// Material index -> decoded base colour texture (or null).
export function materialTextures(g) {
    return g.json.materials.map((m) => {
        const ti = m.pbrMetallicRoughness?.baseColorTexture?.index;
        if (ti === undefined) return null;
        const im = g.json.images[g.json.textures[ti].source], v = g.json.bufferViews[im.bufferView];
        return decodePng(g.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
    });
}

export function writePng(path, w, h, rgb) {
    const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    fs.writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
