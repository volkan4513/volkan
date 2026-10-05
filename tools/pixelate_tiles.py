"""Bakes the pixel-art version of the puzzle's vehicle sprite sheet.

    python tools/pixelate_tiles.py

Same recipe as the Pixel Art panel of the effect studio (projects/03):
average each block of pixels, then snap every block to a small colour
palette. On top of that, alpha is made hard-edged and each sprite gets a
1px dark outline, like hand-made pixel art. 80px sheet cells become 16px,
which page2.html scales up with image-rendering: pixelated.

Reads  images_to_use/tiles_texture.webp + tiles.json (sprite rects)
Writes images_to_use/tiles_texture_pixel.png
"""
import json
import os
import random

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'images_to_use', 'tiles_texture.webp')
OUT = os.path.join(ROOT, 'images_to_use', 'tiles_texture_pixel.png')
SHEET_CELL = 80
BLOCK = 5          # 80px cells -> 16px
COLORS = 28        # palette size
OUTLINE = (24, 20, 28)


def block_average(img):
    w, h = img.width // BLOCK, img.height // BLOCK
    px = img.load()
    out = []
    for by in range(h):
        row = []
        for bx in range(w):
            r = g = b = a = 0
            for y in range(by * BLOCK, (by + 1) * BLOCK):
                for x in range(bx * BLOCK, (bx + 1) * BLOCK):
                    pr, pg, pb, pa = px[x, y]
                    r += pr * pa; g += pg * pa; b += pb * pa; a += pa
            n = BLOCK * BLOCK
            if a:
                row.append((r / a, g / a, b / a, a / n))
            else:
                row.append((0, 0, 0, 0))
        out.append(row)
    return out


def kmeans(points, k, iters=12, seed=1):
    rng = random.Random(seed)
    centers = rng.sample(points, k)
    for _ in range(iters):
        sums = [[0, 0, 0, 0] for _ in centers]
        for p in points:
            i = min(range(k), key=lambda j: sum((p[t] - centers[j][t]) ** 2 for t in range(3)))
            s = sums[i]
            s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3] += 1
        centers = [(s[0] / s[3], s[1] / s[3], s[2] / s[3]) if s[3] else c
                   for s, c in zip(sums, centers)]
    return [tuple(int(round(v)) for v in c) for c in centers]


def main():
    img = Image.open(SRC).convert('RGBA')
    sprites = json.load(open(os.path.join(ROOT, 'tiles.json')))['sprites']
    blocks = block_average(img)
    h, w = len(blocks), len(blocks[0])

    opaque = [b[:3] for row in blocks for b in row if b[3] >= 0.5]
    palette = kmeans(opaque, COLORS)

    def nearest(c):
        return min(palette, key=lambda p: sum((c[t] - p[t]) ** 2 for t in range(3)))

    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    opx = out.load()
    solid = [[blocks[y][x][3] >= 0.7 for x in range(w)] for y in range(h)]

    # shave 1px spurs (pixels with at most one solid neighbour)
    for _ in range(2):
        spurs = [(x, y) for y in range(h) for x in range(w) if solid[y][x] and sum(
            1 for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1))
            if 0 <= nx < w and 0 <= ny < h and solid[ny][nx]) <= 1]
        for x, y in spurs:
            solid[y][x] = False

    # drop specks (faint watermark residue in the source): inside each
    # sprite's rect keep only the largest connected blob - the vehicle
    cell = SHEET_CELL // BLOCK
    keep = [[False] * w for _ in range(h)]
    for spr in sprites:
        x0, y0 = spr['sheetCol'] * cell, spr['sheetRow'] * cell
        x1, y1 = min(w, x0 + spr['cellsWide'] * cell), min(h, y0 + spr['cellsTall'] * cell)
        seen, best = set(), []
        for sy in range(y0, y1):
            for sx in range(x0, x1):
                if not solid[sy][sx] or (sx, sy) in seen:
                    continue
                stack, blob = [(sx, sy)], []
                seen.add((sx, sy))
                while stack:
                    x, y = stack.pop()
                    blob.append((x, y))
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if x0 <= nx < x1 and y0 <= ny < y1 and solid[ny][nx] and (nx, ny) not in seen:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
                if len(blob) > len(best):
                    best = blob
        for x, y in best:
            keep[y][x] = True
    solid = keep
    for y in range(h):
        for x in range(w):
            if solid[y][x]:
                opx[x, y] = nearest(blocks[y][x][:3]) + (255,)

    # 1px outline inside each sprite's own rect, so it never bleeds into a
    # neighbouring sprite on the sheet
    for s in sprites:
        x0, y0 = s['sheetCol'] * cell, s['sheetRow'] * cell
        x1, y1 = x0 + s['cellsWide'] * cell, y0 + s['cellsTall'] * cell
        for y in range(y0, min(y1, h)):
            for x in range(x0, min(x1, w)):
                if solid[y][x]:
                    continue
                if any(x0 <= x + dx < x1 and y0 <= y + dy < y1 and solid[y + dy][x + dx]
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    opx[x, y] = OUTLINE + (255,)

    out.save(OUT, optimize=True)
    print('wrote %s  %dx%d  %d bytes' % (OUT, w, h, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
