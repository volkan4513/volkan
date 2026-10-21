// Texture quality, applied at runtime to everything a model or map brings in:
//   size cap    redraws the image into a smaller canvas (halving step by step, so detail averages
//               instead of aliasing) and re-uploads. Saves GPU memory; the download stays the same.
//   filter      'smooth' = linear + mipmaps + anisotropy, 'pixel' = nearest-neighbour
//   anisotropy  keeps textures sharp on surfaces seen at a grazing angle (roads, walls)
import * as THREE from './lib/three.module.min.js';

// 'auto' picks by device; 'full' is the file's own size.
export const TEXTURE_STEPS = ['auto', 'full', 512, 256, 128, 64];

export const resolveCap = (step) =>
    step === 'auto' ? (matchMedia('(pointer: coarse)').matches ? 512 : 0) : step === 'full' ? 0 : step;

const originals = new WeakMap();   // texture -> its full-size image
const shrunk = new WeakMap();      // texture -> { max, image } from the last cap, so reloads reuse it
const tracked = new Set();         // WeakRefs to every texture seen, for the memory estimate

function texturesOf(root) {
    const out = new Set();
    root.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const key of ['map', 'emissiveMap', 'alphaMap']) if (m[key] && m[key].image) out.add(m[key]);
        }
    });
    return out;
}

function shrink(image, max) {
    const w = image.width, h = image.height, k = max / Math.max(w, h);
    let src = image, sw = w, sh = h;
    const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
    do {
        const nw = Math.max(tw, sw >> 1), nh = Math.max(th, sh >> 1);
        const c = document.createElement('canvas');
        c.width = nw;
        c.height = nh;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, nw, nh);
        src = c;
        sw = nw;
        sh = nh;
    } while (sw > tw || sh > th);
    return src;
}

// opts: { max (0 = no cap), smooth, anisotropy }
export function applyTextures(root, { max = 0, smooth = true, anisotropy = 1 }) {
    const mag = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    const min = smooth ? THREE.LinearMipmapLinearFilter : THREE.NearestMipmapNearestFilter;
    const aniso = smooth ? anisotropy : 1;
    for (const t of texturesOf(root)) {
        if (!originals.has(t)) {
            originals.set(t, t.image);
            tracked.add(new WeakRef(t));
        }
        const full = originals.get(t);
        let want = full;
        if (max && Math.max(full.width, full.height) > max) {
            const last = shrunk.get(t);
            want = last && last.max === max ? last.image : shrink(full, max);
            shrunk.set(t, { max, image: want });
        }
        let dirty = false;
        if (t.image !== want) {
            // three.js allocates the GPU texture at its first size and later uploads only fill it,
            // so a size change has to drop the old GPU copy or it keeps most of the full image
            if (t.image.width !== want.width || t.image.height !== want.height) t.dispose();
            t.image = want;
            dirty = true;
        }
        if (t.magFilter !== mag || t.minFilter !== min || t.anisotropy !== aniso) {
            t.magFilter = mag;
            t.minFilter = min;
            t.anisotropy = aniso;
            dirty = true;
        }
        if (dirty) t.needsUpdate = true;
    }
}

// Rough GPU memory of every texture seen so far, in MB (RGBA + a third for mipmaps).
export function textureMemoryMB() {
    let bytes = 0;
    for (const ref of tracked) {
        const t = ref.deref();
        if (!t) { tracked.delete(ref); continue; }
        bytes += t.image.width * t.image.height * 4 * 4 / 3;
    }
    return bytes / 1048576;
}
