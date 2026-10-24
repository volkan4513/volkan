"""Builds the layers and car frames for projects/10 (the Fuji poster scene)
from the Gemini images in new_page_images/.

    python tools/make_japan_layers.py

All source scenes are 1684 x 2528 and already lined up with base.jpg, so the
layer positions written to projects/10/scene.json are in that space ("poster
units"); the page scales them to the screen. Images are exported at EXPORT
scale as WebP.

  sky     - plate sky with the mountain painted out and the red sun baked in
  land    - plate with the sky cut away (Fuji, hills, field)
  ground  - the bottom of the plate again, faded in, so the road moves with the car
  houses, bushesL/R, pole - cut off their white backgrounds (bushes shrunk)
  text    - text.jpg turned into a transparent overlay (fixed, behind the car)
  car/NN  - the S14 turntable. Built from new_page_images/car_sheet.png
            (the earlier, already relit frames in a 5-column grid: 80 views
            of one continuous turn, then 3 cross-fades that are dropped).
            The five rear views in "extra angles and shadows/002.png" fill
            the gap behind the car, colour-matched to their neighbours.
            Every frame gets a contact shadow made from its own outline, in
            the style of the shadows in "extra angles and shadows/00.png".
  car_sheet_new.png/.webp (in new_page_images/) - the new frames as one grid
"""
import json
import os

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'new_page_images')
OUT = os.path.join(ROOT, 'projects', '10')
IMG = os.path.join(OUT, 'images')
W, H = 1684, 2528
EXPORT = 0.8            # images are saved at this fraction of poster units
WATERMARK = (1566, 2407)  # Gemini sparkle on the full scenes

SOURCES = {
    'plate': 'Gemini_Generated_Image_gfwwrhgfwwrhgfww.png',
    'houses': 'Gemini_Generated_Image_qaz29iqaz29iqaz2.png',
    'bushes': 'Gemini_Generated_Image_xzeri2xzeri2xzer.png',
    'pole': 'Gemini_Generated_Image_rcz8korcz8korcz8.png',
    'base': 'base.jpg',
    'text': 'text.jpg',       # white title / frame / stamp on black, 2:3
}

CAR_SHEET = 'car_sheet.png'      # source frames, 5 columns, 905 x 277 cells, 8 px gaps
CAR_CELL, CAR_GAP, CAR_COLS = (905, 277), 8, 5
CAR_REAL = 80                    # the first 80 cells are the real turn; the poster view is the last
REAR_VIEWS = os.path.join('extra angles and shadows', '002.png')  # 5 rear views on black, left to right
SHADOW_PAD = 18                  # cell px added under each frame for its shadow
CAR_Q = 72
CAR_EXPORT = 0.62                # the sheet's cells are at this fraction of poster units
CAR_BOTTOM = 2190                # where the tyres touch the road in the reference poster
CAR_CENTER_X = 1042
CAR_WIDTH = 1078                 # poster-view width of the car, in poster units
BUSH_SPLIT = 1180       # x where the left bushes end and the right tree starts
BUSH_SCALE = 0.68

session = new_session('isnet-general-use')


def load(key, mode='RGB'):
    return np.array(Image.open(os.path.join(SRC, SOURCES[key])).convert(mode))


def rembg_mask(rgb):
    m = remove(Image.fromarray(rgb), session=session, only_mask=True)
    return np.array(m).astype(np.float32) / 255


def unwhite(rgb, a):
    """Take the white background back out of semi-transparent edge pixels."""
    a3 = np.maximum(a, 1e-3)[..., None]
    c = (rgb.astype(np.float32) - (1 - a[..., None]) * 255) / a3
    return np.clip(c, 0, 255)


def save(arr, name, opaque=False, q=80, scale=EXPORT):
    path = os.path.join(IMG, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.fromarray(arr.astype(np.uint8))
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    if opaque:
        im = im.convert('RGB')
    im.save(path, 'WEBP', quality=q, method=6, alpha_quality=85)
    return os.path.getsize(path)


def crop_rgba(rgb, a, pad=4):
    ys, xs = np.nonzero(a > 0.02)
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgb.shape[1])
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgb.shape[0])
    rgba = np.dstack([rgb, a * 255])[y0:y1, x0:x1]
    return rgba, (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def flood_matte(rgb, thresh=238):
    """Alpha for art on flat white: background is the near-white joined to the
    border, plus any pure-white pocket (gaps between branches) bigger than a
    snow highlight. Pixels at its edge get a soft alpha by how un-white they are."""
    mn = rgb.min(2).astype(np.float32)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((mn >= thresh).astype(np.uint8))
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    big = np.nonzero(stats[:, cv2.CC_STAT_AREA] >= 80)[0]
    holes = [i for i in big if i > 0 and mn[lab == i].mean() >= 246]
    bg = np.isin(lab, np.concatenate([edge[edge > 0], holes]))
    a = np.where(bg, np.clip((thresh + 4 - mn) / 40, 0, 1), 1).astype(np.float32)
    return cv2.GaussianBlur(a, (0, 0), 0.7)


def bleed(rgb, a):
    """Edge pixels take the colour of the solid art next to them (no white halo)."""
    solid = (a > 0.97).astype(np.float32)
    c = rgb.astype(np.float32)
    out = c.copy()
    todo = solid < 1
    for sigma in (3, 10, 30):
        w = cv2.GaussianBlur(solid, (0, 0), sigma)[..., None]
        fill = cv2.GaussianBlur(c * solid[..., None], (0, 0), sigma) / np.maximum(w, 1e-4)
        ok = todo & (w[..., 0] > 0.02)
        out[ok] = fill[ok]
        todo &= ~ok
    return out


def soften(a, erode=2, sigma=1.2, fade_bottom=0):
    """Pull cut-out edges in a little and feather them so no light fringe is
    left; optionally fade the art out over its lowest rows."""
    k = np.ones((2 * erode + 1, 2 * erode + 1), np.uint8)
    e = cv2.GaussianBlur(cv2.erode(a, k), (0, 0), sigma)
    a = np.minimum(a, e)
    if fade_bottom:
        rows = np.nonzero(a.max(1) > 0.05)[0]
        y1 = rows.max()
        ramp = np.clip((y1 - np.arange(a.shape[0])) / fade_bottom, 0, 1)
        a = a * (ramp * ramp * (3 - 2 * ramp))[:, None]
    return a


def keep_largest(a):
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 0.08).astype(np.uint8))
    if n <= 2:
        return a
    big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    keep = cv2.dilate((lab == big).astype(np.uint8), np.ones((9, 9), np.uint8))
    return a * keep


# ---------------------------------------------------------------- plate
def build_plate(layers, sizes):
    plate = load('plate')
    wm = np.zeros(plate.shape[:2], np.uint8)
    cv2.circle(wm, WATERMARK, 60, 255, -1)
    plate = cv2.inpaint(plate, wm, 9, cv2.INPAINT_TELEA)

    # mountain / sky split: grabCut seeded with Fuji's outline
    poly = np.array([[0, 1315], [967, 933], [1684, 1290], [1684, H], [0, H]], np.int32)
    inside = np.zeros((H, W), np.uint8)
    cv2.fillPoly(inside, [poly], 1)
    k = np.ones((61, 61), np.uint8)
    gc = np.full((H, W), cv2.GC_PR_BGD, np.uint8)
    gc[inside == 1] = cv2.GC_PR_FGD
    gc[cv2.erode(inside, k) == 1] = cv2.GC_FGD
    gc[cv2.dilate(inside, np.ones((25, 25), np.uint8)) == 0] = cv2.GC_BGD
    s = 0.5
    small = cv2.resize(plate, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    gcs = cv2.resize(gc, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), gcs, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    fg = np.isin(gcs, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.float32)
    fg = cv2.resize(fg, (W, H), interpolation=cv2.INTER_LINEAR)
    land_a = np.clip((cv2.GaussianBlur(fg, (0, 0), 1.6) - 0.5) * 2.2 + 0.5, 0, 1)
    land_a[1700:] = 1

    # sky: fill each row behind the mountain from the sky on either side of it
    sky = plate.astype(np.float32).copy()
    is_sky = land_a < 0.05
    last = None
    for y in range(H):
        row = is_sky[y]
        xs = np.nonzero(row)[0]
        if len(xs) < 40:
            sky[y] = last
            continue
        left = xs[xs < W // 2]
        right = xs[xs >= W // 2]
        cl = sky[y, left[-30:]].mean(0) if len(left) else sky[y, right[:30]].mean(0)
        cr = sky[y, right[:30]].mean(0) if len(right) else cl
        t = np.linspace(0, 1, W)[:, None]
        fill = cl * (1 - t) + cr * t
        hole = ~row
        sky[y, hole] = fill[hole]
        last = sky[y].copy()
    hole = cv2.dilate((~is_sky).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    soft = cv2.GaussianBlur(sky, (0, 0), 6)
    sky[hole] = soft[hole]
    grain = np.random.default_rng(7).normal(0, 4.5, (H, W, 1)).astype(np.float32)
    sky[hole] += grain[hole]

    # red sun from base.jpg, behind the mountain
    base = load('base')
    sun_c = base[640:820, 470:650].reshape(-1, 3).mean(0)
    cx, cy, r = 559, 733, 281
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    sa = np.clip(r + 1.2 - d, 0, 1)[..., None]
    lum = cv2.GaussianBlur(plate.mean(2).astype(np.float32), (0, 0), 1)
    tex = (lum - cv2.GaussianBlur(lum, (0, 0), 12))[..., None] * 0.9
    sky = sky * (1 - sa) + (sun_c + tex) * sa
    sizes['sky'] = save(np.clip(sky, 0, 255), 'sky.webp', opaque=True, q=74)
    layers.append({'id': 'sky', 'src': 'images/sky.webp', 'x': 0, 'y': 0, 'w': W, 'h': H, 'depth': 0.08})

    rgba, box = crop_rgba(plate, land_a)
    sizes['land'] = save(rgba, 'land.webp', q=76)
    layers.append({'id': 'land', 'src': 'images/land.webp', 'x': box[0], 'y': box[1], 'w': box[2], 'h': box[3], 'depth': 0.22})

    # near ground strip, faded in above the car so the road moves with it
    gy = 1880
    ga = np.clip((np.arange(H - gy) - 0) / 220, 0, 1)
    ga = np.repeat(ga[:, None], W, 1)
    sizes['ground'] = save(np.dstack([plate[gy:], ga * 255]), 'ground.webp', q=74)
    layers.append({'id': 'ground', 'src': 'images/ground.webp', 'x': 0, 'y': gy, 'w': W, 'h': H - gy, 'depth': 0.85})
    return base


# ---------------------------------------------------------------- cut-outs
def build_cutouts(layers, sizes):
    rgb = load('houses')
    a = flood_matte(rgb)
    a[2300:, 1450:] = 0
    a = soften(a, 3, 1.5, fade_bottom=150)
    rgba, box = crop_rgba(bleed(rgb, a), a)
    sizes['houses'] = save(rgba, 'houses.webp')
    layers.append({'id': 'houses', 'src': 'images/houses.webp', 'x': box[0], 'y': box[1], 'w': box[2], 'h': box[3], 'depth': 0.4})

    # bushes: the source draws them too big, so the left cluster and the right
    # tree are cut apart and each shrunk toward its outer bottom corner
    rgb = load('bushes')
    a = flood_matte(rgb)
    a[2300:, 1450:] = 0
    a = soften(a, 3, 1.5, fade_bottom=120)
    col = bleed(rgb, a)
    for side, xs in (('L', slice(0, BUSH_SPLIT)), ('R', slice(BUSH_SPLIT, W))):
        part_a = np.zeros_like(a)
        part_a[:, xs] = a[:, xs]
        rgba, box = crop_rgba(col, part_a)
        w, h = round(box[2] * BUSH_SCALE), round(box[3] * BUSH_SCALE)
        im = Image.fromarray(rgba.astype(np.uint8)).resize((w, h), Image.LANCZOS)
        key = 'bushes' + side
        sizes[key] = save(np.array(im), key + '.webp')
        x = box[0] if side == 'L' else box[0] + box[2] - w
        layers.append({'id': key, 'src': f'images/{key}.webp', 'x': x, 'y': box[1] + box[3] - h, 'w': w, 'h': h,
                       'depth': 0.62})

    # pole: solid body from rembg, thin wires from how dark they are on white
    rgb = load('pole')
    lum = rgb.astype(np.float32) @ np.array([0.3, 0.59, 0.11], np.float32)
    wires = np.clip((246 - lum) / 170, 0, 1) ** 0.85
    wires[wires < 0.12] = 0
    a = np.maximum(rembg_mask(rgb), wires)
    a[2300:, 1450:] = 0
    # fade the wires out before the edges of their image so they don't end abruptly
    xs = np.arange(W, dtype=np.float32)
    edge = np.clip(np.minimum(xs - 0, W - 1 - xs) / 260, 0, 1)
    body = np.zeros((H, W), np.float32)
    body[:, 700:960] = 1
    a = a * np.maximum(edge[None, :], body)
    rgba, box = crop_rgba(unwhite(rgb, a), a)
    # base.jpg has the pole at half this size, its top at (516, 803)
    k = 0.5
    half = Image.fromarray(rgba.astype(np.uint8)).resize((round(box[2] * k), round(box[3] * k)), Image.LANCZOS)
    sizes['pole'] = save(np.array(half), 'pole.webp', q=80)
    top = (825, 320)
    x = 516 - (top[0] - box[0]) * k
    y = 803 - (top[1] - box[1]) * k
    layers.append({'id': 'pole', 'src': 'images/pole.webp', 'x': round(x), 'y': round(y),
                   'w': round(box[2] * k), 'h': round(box[3] * k), 'depth': 0.5,
                   # long lines off the pole as in the reference: [x1, y1, x2, y2, sag]
                   'wires': [[531, 1078, 1760, 892, 70], [531, 1124, 1760, 1150, 95],
                             [524, 1186, 1760, 1352, 60], [-80, 1050, 500, 1104, 22]]})


# ---------------------------------------------------------------- car
def solid_glass(a):
    """rembg leaves the windows half see-through. Inside the car's outline
    (each column from its roof down to its lowest solid pixel) any faint alpha
    becomes solid; real gaps, like under the rear wing, have none and stay open."""
    top = a > 0.3
    bot = a > 0.5
    has = bot.any(0)
    y0 = np.where(has, np.argmax(top, 0), a.shape[0])
    y1 = np.where(has, a.shape[0] - 1 - np.argmax(bot[::-1], 0), -1)
    rows = np.arange(a.shape[0])[:, None]
    inside = (rows >= y0[None]) & (rows <= y1[None])
    out = a.copy()
    out[inside & (a > 0.12)] = 1
    return out


def to_lab(rgb):
    return cv2.cvtColor(np.clip(rgb, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)


def rear_views():
    """The five cars in 002.png, left to right: from just past the poster view
    round the back to just before the first frame of the clip."""
    img = np.array(Image.open(os.path.join(SRC, REAR_VIEWS)).convert('RGB'))
    m = (img.max(2) > 24).astype(np.uint8)
    m[int(img.shape[0] * 0.85):, int(img.shape[1] * 0.85):] = 0  # Gemini sparkle
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, lab, st, cen = cv2.connectedComponentsWithStats(m)
    cars = sorted((st[i] for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 20000), key=lambda b: b[0])
    out = []
    for x, y, w, h, _ in cars:
        crop = img[max(y - 30, 0):y + h + 30, max(x - 30, 0):x + w + 30]
        a = soften(solid_glass(keep_largest(rembg_mask(crop))), 1, 0.8)
        out.append((bleed(crop, a), a))
    return out


def car_stats(c, a):
    lab = to_lab(c)[a > 0.6]
    ys, xs = np.nonzero(a > 0.5)
    return {'mean': lab.mean(0), 'std': lab.std(0) + 1e-3, 'h': np.ptp(ys), 'bottom': ys.max(),
            'cx': (xs.min() + xs.max()) / 2}


def match_colour(c, a, mean, std):
    lab = to_lab(c)
    m = a > 0.6
    cm, cs = lab[m].mean(0), lab[m].std(0) + 1e-3
    out = lab.copy()
    out[..., 0] = (lab[..., 0] - cm[0]) / cs[0] * std[0] + mean[0]
    for k in (1, 2):  # chroma: shift, and only mildly rescale
        out[..., k] = (lab[..., k] - cm[k]) * np.clip(std[k] / cs[k], 0.7, 1.3) + mean[k]
    return cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB).astype(np.float32)


def contact_shadow(a):
    """Shadow on the road from the car's outline: a soft band of shade under
    the body and a tight dark line where the tyres touch."""
    ys = np.nonzero(a.max(1) > 0.5)[0]
    top, bot = ys.min(), ys.max()
    h = bot - top
    band = a[bot - int(0.3 * h):bot + 1]
    flat = cv2.resize(band, (a.shape[1], max(2, int(0.12 * h))), interpolation=cv2.INTER_AREA)
    amb = np.zeros_like(a)
    y0 = bot + int(0.04 * h) - flat.shape[0]
    amb[y0:y0 + flat.shape[0]] = flat[:max(0, min(flat.shape[0], a.shape[0] - y0))]
    amb = cv2.GaussianBlur(amb, (0, 0), 0.035 * h) * 0.6
    foot = np.zeros_like(a)
    foot[bot - 5:bot + 1] = a[bot - 5:bot + 1] > 0.5
    foot = np.roll(foot, 3, axis=0)
    foot = cv2.GaussianBlur(cv2.dilate(foot, np.ones((3, 9), np.uint8)), (0, 0), 2.2) * 0.9
    return np.clip(np.maximum(amb, foot), 0, 0.85)


def sheet_cells():
    sheet = np.array(Image.open(os.path.join(SRC, CAR_SHEET)).convert('RGBA')).astype(np.float32)
    (cw, ch), out = CAR_CELL, []
    for i in range(CAR_REAL):
        r, c = divmod(i, CAR_COLS)
        x, y = c * (cw + CAR_GAP), r * (ch + CAR_GAP)
        cell = np.zeros((ch + SHADOW_PAD, cw, 4), np.float32)
        cell[:ch] = sheet[y:y + ch, x:x + cw]
        out.append((cell[..., :3], cell[..., 3] / 255))
    return out


def build_car(sizes):
    cuts = sheet_cells()
    canvas = cuts[0][1].shape

    # the rear views go after the poster view (last cell) and before the first,
    # sized, lit and placed between those two; the straight-on one sits on the
    # turning centre (the centre of the straight-on front view)
    stats = [car_stats(c, a) for c, a in cuts]
    third = len(cuts) // 3
    front = min(range(third, 2 * third), key=lambda i: (cuts[i][1] > 0.5).any(0).sum())
    pivot_x = stats[front]['cx']
    last, first = stats[-1], stats[0]
    rears = rear_views()
    # 002.png is drawn narrower than our turntable: a car is as wide at the
    # back as at the front, so stretch the rear views until the straight-on
    # rear has the straight-on front's proportions
    aspect = lambda a: np.ptp(np.nonzero(a > 0.5)[1]) / np.ptp(np.nonzero(a > 0.5)[0])
    widen = aspect(cuts[front][1]) / aspect(rears[len(rears) // 2][1])
    views = list(cuts)
    for k, (c, a) in enumerate(rears):
        t = (k + 1) / (len(rears) + 1)
        lerp = lambda u, v: u * (1 - t) + v * t
        if t <= 0.5:
            cx = last['cx'] + (pivot_x - last['cx']) * t / 0.5
        else:
            cx = pivot_x + (first['cx'] - pivot_x) * (t - 0.5) / 0.5
        c = match_colour(c, a, lerp(last['mean'], first['mean']), lerp(last['std'], first['std']))
        sc = lerp(last['h'], first['h']) / car_stats(c, a)['h']
        c = cv2.resize(c, None, fx=sc * widen, fy=sc, interpolation=cv2.INTER_AREA)
        a = np.clip(cv2.resize(a, None, fx=sc * widen, fy=sc, interpolation=cv2.INTER_AREA), 0, 1)
        own = car_stats(c, a)
        ox = int(round(cx - own['cx']))
        oy = int(round(lerp(last['bottom'], first['bottom']) - own['bottom']))
        cc = np.zeros(canvas + (3,), np.float32)
        ca = np.zeros(canvas, np.float32)
        ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        ty, tx = ys + oy, xs + ox
        ok = (ty >= 0) & (ty < canvas[0]) & (tx >= 0) & (tx < canvas[1])
        cc[ty[ok], tx[ok]] = c[ok]
        ca[ty[ok], tx[ok]] = a[ok]
        views.append((cc, ca))

    # place the cells so the poster view matches the reference poster
    pys, pxs = np.nonzero(cuts[-1][1] > 0.5)
    k = CAR_WIDTH / (pxs.max() - pxs.min())        # poster units per cell px
    w, h = round(canvas[1] * k), round(canvas[0] * k)
    left = CAR_CENTER_X - (pxs.min() + pxs.max()) / 2 * k
    top = CAR_BOTTOM - pys.max() * k

    frames = []
    shadow_col = np.array((16, 12, 14), np.float32)
    for i, (c, a) in enumerate(views):
        sa = contact_shadow(a) * (1 - a)
        out_a = a + sa
        out_c = (c * a[..., None] + shadow_col * sa[..., None]) / np.maximum(out_a, 1e-3)[..., None]
        rgba = np.dstack([out_c, np.clip(out_a, 0, 1) * 255])
        name = f'car/{i:02d}.webp'
        sizes[name] = save(np.clip(rgba, 0, 255), name, q=CAR_Q, scale=1)
        frames.append({'src': 'images/' + name, 'w': w, 'h': h})
    build_sheet(frames)
    return {'cx': round(left + w / 2), 'bottom': round(top + h), 'ground': CAR_BOTTOM,
            'poster': len(cuts) - 1, 'frames': frames}


def build_sheet(frames, cols=5, gap=8):
    """All car frames in one grid image (no overlaps), row by row."""
    ims = [Image.open(os.path.join(OUT, f['src'])).convert('RGBA') for f in frames]
    fw, fh = ims[0].size
    rows = -(-len(ims) // cols)
    sheet = Image.new('RGBA', (cols * fw + (cols - 1) * gap, rows * fh + (rows - 1) * gap), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        r, c = divmod(i, cols)
        sheet.paste(im, (c * (fw + gap), r * (fh + gap)))
    sheet.save(os.path.join(SRC, 'car_sheet_new.png'), optimize=True)
    sheet.save(os.path.join(SRC, 'car_sheet_new.webp'), 'WEBP', quality=80, method=6, alpha_quality=90)


def build_text(layers, sizes):
    g = load('text').astype(np.float32).mean(2)
    g[895:931, 556:614] = 0                    # Gemini sparkle above "-3°C"
    g = cv2.resize(g, (W, H), interpolation=cv2.INTER_CUBIC)
    a = np.clip((g - 70) / 120, 0, 1)          # re-sharpen the upscaled edges
    a = a * a * (3 - 2 * a)
    col = np.zeros((H, W, 3), np.float32) + (241, 232, 214)

    # as in the reference poster: the 富士山 stamp in red ...
    col[1735:2015, 135:400] = (150, 58, 44)
    yy, xx = np.mgrid[0:H, 0:W]
    rng = np.random.default_rng(3)
    mottle = cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 3) * 1.6
    stamp = np.zeros((H, W), bool)
    stamp[1735:2015, 135:400] = True
    a[stamp] *= np.clip(0.88 + mottle[stamp] * 0.25, 0.55, 1)

    # ... the small red circle above it ...
    d = np.sqrt((xx - 288) ** 2 + (yy - 1553) ** 2)
    ca = np.clip(128.5 - d, 0, 1) * np.clip(0.9 + mottle * 0.08, 0.7, 1)
    col = col * (1 - ca[..., None]) + np.array((160, 64, 45), np.float32) * ca[..., None]
    a = np.maximum(a, ca)

    # ... and faint seigaiha waves printed over the road, fading out upward
    R, ring = 52, 3
    wave = np.zeros((H, W), np.uint8)
    y = 1990
    row = 0
    while y < H + R:
        x0 = -R if row % 2 else 0
        for x in range(x0, W + 2 * R, 2 * R):
            cv2.circle(wave, (x, y), R, 0, -1, cv2.LINE_AA)
            for r in (R, R * 0.74, R * 0.48, R * 0.22):
                cv2.circle(wave, (x, y), int(r), 255, ring, cv2.LINE_AA)
        y += R // 2
        row += 1
    fade = np.clip((yy[:, 0] - 2030) / 330, 0, 1)
    wa = wave.astype(np.float32) / 255 * fade[:, None] * 0.2
    a = np.maximum(a, wa)

    rgba = np.dstack([col, a * 255])
    sizes['text'] = save(rgba, 'text.webp', q=74)
    layers.append({'id': 'text', 'src': 'images/text.webp', 'x': 0, 'y': 0, 'w': W, 'h': H, 'depth': 0, 'fixed': True})


def build_thumb(scene):
    """Site card (1500 x 850, like the other projects): the poster view, cropped
    around Fuji and the car."""
    canvas = Image.new('RGBA', (W, H))
    for l in scene['layers']:
        im = Image.open(os.path.join(OUT, l['src'])).convert('RGBA').resize((l['w'], l['h']), Image.LANCZOS)
        canvas.alpha_composite(im, (l['x'], l['y']))
    c = scene['car']
    f = c['frames'][c['poster']]
    im = Image.open(os.path.join(OUT, f['src'])).convert('RGBA').resize((f['w'], f['h']), Image.LANCZOS)
    canvas.alpha_composite(im, (round(c['cx'] - f['w'] / 2), c['bottom'] - f['h']))
    top = 1300
    thumb = canvas.crop((0, top, W, top + round(W * 850 / 1500))).convert('RGB').resize((1500, 850), Image.LANCZOS)
    thumb.save(os.path.join(IMG, '0.webp'), 'WEBP', quality=78, method=6)


def main():
    os.makedirs(IMG, exist_ok=True)
    layers, sizes = [], {}
    base = build_plate(layers, sizes)
    build_cutouts(layers, sizes)
    build_text(layers, sizes)
    car = build_car(sizes)
    order = ['sky', 'land', 'houses', 'pole', 'bushesL', 'bushesR', 'ground', 'text']
    layers.sort(key=lambda l: order.index(l['id']))
    scene = {
        'size': [W, H],
        'layers': layers,
        'car': car,
    }
    with open(os.path.join(OUT, 'scene.json'), 'w', encoding='utf-8') as f:
        json.dump(scene, f, indent=1)
    build_thumb(scene)
    total = sum(sizes.values())
    for k, v in sizes.items():
        print(f'{k:16s} {v / 1024:7.1f} KB')
    print(f'{"total":16s} {total / 1024:7.1f} KB')


if __name__ == '__main__':
    main()
