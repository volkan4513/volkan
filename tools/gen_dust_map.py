"""Generates projects/08/map2.json: a Dust2-style map for Low-Poly Strike.

    python tools/gen_dust_map.py

The layout is a grid of 2 m cells carved out of solid buildings. Collision stays axis-aligned
boxes (cells merged into rectangles); arches, trims, windows and doors go into "deco", which
the game draws but never collides with.

Grid legend
    @ outer wall 8 m      # building 6.5 m      % low building 4.2 m (plaster)
    . sand floor          , cobblestone floor   T roofed tunnel (cobble, ceiling at 3.4 m)
    1 platform 1.2 m      2 platform 2.4 m      a stairs 0 -> 1.2     b stairs 1.2 -> 2.4
    A archway through the wall it sits in (lintel above, arch drawn under it)
"""
import json, math, os

W, H, CELL = 56, 64, 2.0
X0, Z0 = -56.0, 64.0            # west edge of column 0, north edge of row 0 (z points north, CT side)
BUILD = {'@': (8.0, 'wall'), '#': (6.5, 'wall'), '%': (4.2, 'plaster')}
LEVEL = {'.': 0.0, ',': 0.0, 'T': 0.0, 'A': 0.0, '1': 1.2, '2': 2.4}
STAIR = {'a': (0.0, 1.2), 'b': (1.2, 2.4)}
TUNNEL_CEIL, ROOF = 3.4, 4.6
ARCH_SPRING = 2.4               # arch curves start here; the lintel (collision) sits at the crown

g = [['#'] * W for _ in range(H)]


def fill(c0, r0, c1, r1, ch):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            g[r][c] = ch


# ---------- layout (columns west -> east, rows north -> south) ----------
fill(1, 1, 19, 8, '%')          # low block north of B
fill(10, 30, 23, 39, '%')       # low block between B tunnels and mid
fill(30, 36, 39, 45, '%')       # low block between mid and outside long

fill(20, 1, 34, 8, '.')         # CT spawn
fill(37, 1, 54, 15, '.')        # A site
fill(34, 9, 36, 15, '.')        # A site, catwalk landing
fill(35, 3, 36, 6, '.')         # CT spawn <-> A
fill(48, 1, 54, 5, '1')         # A platform ("goose")
fill(50, 6, 52, 6, 'a')
fill(40, 8, 44, 12, ',')        # cobble square on A

fill(44, 16, 50, 35, '.')       # long A
fill(46, 16, 48, 35, ',')
fill(46, 36, 48, 36, 'A')       # long doors
fill(40, 37, 53, 47, '.')       # outside long
fill(31, 46, 41, 50, '.')       # T ramp to outside long
fill(30, 51, 33, 51, '.')

fill(14, 52, 33, 62, '.')       # T spawn
fill(18, 54, 28, 60, ',')

fill(24, 23, 29, 51, '.')       # mid
fill(25, 23, 28, 51, ',')
fill(26, 22, 27, 22, 'A')       # mid doors
fill(22, 9, 31, 21, '.')        # CT mid
fill(30, 26, 30, 28, 'a')       # catwalk (short A)
fill(31, 26, 32, 28, '1')
fill(33, 26, 33, 28, 'b')
fill(34, 18, 37, 28, '2')
fill(34, 17, 37, 17, 'b')
fill(34, 16, 37, 16, 'a')

fill(6, 53, 13, 57, 'T')        # upper tunnels
fill(6, 36, 9, 52, 'T')         # lower tunnels
fill(6, 30, 9, 35, 'T')         # B tunnel exit
fill(10, 40, 23, 42, 'T')       # lower tunnels -> mid

fill(1, 9, 18, 29, '.')         # B site
fill(8, 18, 14, 24, ',')
fill(1, 9, 6, 14, '1')          # B back platform
fill(3, 15, 4, 15, 'a')
fill(20, 11, 21, 13, '.')       # B doors corridor
fill(19, 11, 19, 13, 'A')       # B doors

for r in range(H):
    for c in range(W):
        if r in (0, H - 1) or c in (0, W - 1):
            g[r][c] = '@'


def cell_x(c): return X0 + c * CELL
def cell_z(r): return Z0 - r * CELL          # north edge of row r
def at(c, r): return g[r][c] if 0 <= c < W and 0 <= r < H else '@'
def walk(ch): return ch in LEVEL or ch in STAIR
def r2(v): return round(v, 3)


def rects(match):
    """Greedy merge of cells where match(ch) into rectangles (c0, r0, c1, r1)."""
    used = [[False] * W for _ in range(H)]
    out = []
    for r in range(H):
        for c in range(W):
            if used[r][c] or not match(g[r][c], c, r):
                continue
            c1 = c
            while c1 + 1 < W and not used[r][c1 + 1] and match(g[r][c1 + 1], c1 + 1, r) and g[r][c1 + 1] == g[r][c]:
                c1 += 1
            r1 = r
            while r1 + 1 < H and all(not used[r1 + 1][k] and match(g[r1 + 1][k], k, r1 + 1) and g[r1 + 1][k] == g[r][c] for k in range(c, c1 + 1)):
                r1 += 1
            for rr in range(r, r1 + 1):
                for k in range(c, c1 + 1):
                    used[rr][k] = True
            out.append((c, r, c1, r1))
    return out


def footprint(c0, r0, c1, r1):
    return cell_x(c0), cell_z(r1 + 1), cell_x(c1 + 1), cell_z(r0)     # x0, z0, x1, z1


boxes, deco = [], []
boxes.append([X0, -1, -Z0, -X0, 0, Z0, 'sand'])                       # ground (top at 0)


def box(x0, y0, z0, x1, y1, z1, kind, render_only=False):
    b = [r2(x0), r2(y0), r2(z0), r2(x1), r2(y1), r2(z1), kind]
    (deco.append(['box'] + b) if render_only else boxes.append(b))


# Buildings, platforms, cobble and tunnels.
for ch, (h, kind) in BUILD.items():
    for c0, r0, c1, r1 in rects(lambda x, c, r, ch=ch: x == ch):
        x0, z0, x1, z1 = footprint(c0, r0, c1, r1)
        box(x0, 0, z0, x1, h, z1, kind)
for c0, r0, c1, r1 in rects(lambda x, c, r: x in '12'):
    x0, z0, x1, z1 = footprint(c0, r0, c1, r1)
    box(x0, 0, z0, x1, LEVEL[g[r0][c0]], z1, 'stone')
for c0, r0, c1, r1 in rects(lambda x, c, r: x in ',T'):
    x0, z0, x1, z1 = footprint(c0, r0, c1, r1)
    box(x0, -0.2, z0, x1, 0.03, z1, 'cobble')
    if g[r0][c0] == 'T':
        box(x0, TUNNEL_CEIL, z0, x1, ROOF, z1, 'wall')


# Stairs: four 0.3 m steps per cell, rising toward the higher neighbour.
def stair_dir(c, r):
    hi = STAIR[g[r][c]][1]
    for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = at(c + dc, r + dr)
        entry = LEVEL[n] if n in LEVEL else STAIR[n][0] if n in STAIR else None    # height where you step onto it
        if entry is not None and abs(entry - hi) < 1e-6:
            return dc, dr
    raise ValueError(f'stairs at {c},{r} lead nowhere')


for c0, r0, c1, r1 in rects(lambda x, c, r: x in STAIR):
    dc, dr = stair_dir(c0, r0)
    lo, hi = STAIR[g[r0][c0]]
    x0, z0, x1, z1 = footprint(c0, r0, c1, r1)
    for i in range(4):
        a, b = i / 4, (i + 1) / 4
        top = lo + (i + 1) * (hi - lo) / 4
        if dc:      # rising toward +x (east) or -x
            sx0, sx1 = (x0 + (x1 - x0) * a, x0 + (x1 - x0) * b) if dc > 0 else (x1 - (x1 - x0) * b, x1 - (x1 - x0) * a)
            box(sx0, 0, z0, sx1, top, z1, 'stone')
        else:       # dr > 0 is south (-z)
            sz0, sz1 = (z1 - (z1 - z0) * b, z1 - (z1 - z0) * a) if dr > 0 else (z0 + (z1 - z0) * a, z0 + (z1 - z0) * b)
            box(x0, 0, sz0, x1, top, sz1, 'stone')

# Archways: lintel above the crown, the curved part as deco.
for c0, r0, c1, r1 in rects(lambda x, c, r: x == 'A'):
    x0, z0, x1, z1 = footprint(c0, r0, c1, r1)
    along_x = at(c0 - 1, r0) in BUILD          # wall continues west/east: the opening spans x
    w = (x1 - x0) if along_x else (z1 - z0)
    sides = [at(c0 - 1, r0), at(c1 + 1, r0)] if along_x else [at(c0, r0 - 1), at(c0, r1 + 1)]
    top = max(BUILD[s][0] for s in sides if s in BUILD)
    rise = min(w / 2, 1.6)
    crown = ARCH_SPRING + rise
    box(x0, crown, z0, x1, top, z1, 'wall')
    deco.append(['arch', r2((x0 + x1) / 2), 0, r2((z0 + z1) / 2), 'x' if along_x else 'z',
                 r2(w), r2((z1 - z0) if along_x else (x1 - x0)), r2(crown), r2(rise), 'wall'])


# ---------- trims, windows and doors on every exposed wall face ----------
def hsh(*v):
    return int(abs(math.sin(sum(k * (i + 1) * 12.9898 for i, k in enumerate(v))) * 43758.5453)) % 1000


SIDES = {'n': (0, -1, 0, 1), 's': (0, 1, 0, -1), 'w': (-1, 0, -1, 0), 'e': (1, 0, 1, 0)}   # dc, dr, nx, nz
faces = {}
for r in range(H):
    for c in range(W):
        ch = g[r][c]
        if ch not in BUILD and ch not in '12':
            continue
        h = BUILD[ch][0] if ch in BUILD else LEVEL[ch]
        for side, (dc, dr, nx, nz) in SIDES.items():
            n = at(c + dc, r + dr)
            if not walk(n) or n in 'TA' or n in STAIR:
                continue
            f = LEVEL[n]
            if f >= h:
                continue
            line = c if side in 'we' else r
            pos = r if side in 'we' else c
            faces.setdefault((side, line, h, f, ch in BUILD), []).append(pos)

for (side, line, h, f, building), cells in faces.items():
    dc, dr, nx, nz = SIDES[side]
    cells.sort()
    runs, start = [], cells[0]
    for a, b in zip(cells, cells[1:] + [None]):
        if b != a + 1:
            runs.append((start, a))
            start = b
    for p0, p1 in runs:
        # Face plane and run extent along it.
        if side in 'ns':
            fz = cell_z(line) if side == 'n' else cell_z(line + 1)
            a0, a1 = cell_x(p0), cell_x(p1 + 1)
            strip = lambda o, y0, y1: box(a0 - (o if building else 0), y0, min(fz, fz + nz * o), a1 + (o if building else 0), y1, max(fz, fz + nz * o), 'stone', True)
            point = lambda t: (a0 + (a1 - a0) * t, fz)
        else:
            fx = cell_x(line + 1) if side == 'e' else cell_x(line)
            a0, a1 = cell_z(p1 + 1), cell_z(p0)
            strip = lambda o, y0, y1: box(min(fx, fx + nx * o), y0, a0 - (o if building else 0), max(fx, fx + nx * o), y1, a1 + (o if building else 0), 'stone', True)
            point = lambda t: (fx, a0 + (a1 - a0) * t)
        length = a1 - a0
        if not building:                    # platform edge: a thin stone lip
            strip(0.08, h - 0.18, h + 0.02)
            continue
        strip(0.16, h - 0.4, h + 0.06)       # cornice
        strip(0.06, f, f + 0.45)             # plinth
        if h - f < 6:
            continue
        door_t = None
        if f == 0 and length >= 8 and hsh(line, p0, h) % 3 == 0:
            door_t = 0.5
            x, z = point(door_t)
            deco.append(['door', r2(x), f, r2(z), nx, nz, 2.4, 3.2])
        n = int((length - 2) // 5)
        for i in range(n):
            t = (i + 0.5) / n
            if door_t is not None and abs(t - door_t) * length < 2.5:
                continue
            if hsh(line, p0, i) % 5 == 0:
                continue
            x, z = point(t)
            deco.append(['window', r2(x), r2(f + 3.3), r2(z), nx, nz, 1.2, 1.9])

# ---------- crates ----------
CRATES = [
    (-3.0, -6.0, 2.4, 2.4, 1.2, 'gcrate'),                   # mid "xbox"
    (30, 44, 2.4, 2.4, 2.4, 'gcrate'), (32.4, 44, 2.4, 2.4, 1.2, 'crate'),
    (24, 54, 2.4, 2.4, 1.2, 'crate'), (36, 36, 2.4, 2.4, 1.2, 'crate'), (40, 26, 2.4, 2.4, 2.4, 'crate'),
    (-36, 24, 2.4, 2.4, 2.4, 'crate'), (-33.6, 24, 2.4, 2.4, 1.2, 'gcrate'), (-28, 34, 2.4, 2.4, 1.2, 'gcrate'),
    (-24, 12, 2.4, 2.4, 2.4, 'gcrate'), (-46, 22, 2.4, 2.4, 1.2, 'crate'),
    (-40, 36, 2.4, 2.4, 1.2, 'crate'), (-30, 14, 2.4, 2.4, 2.4, 'gcrate'), (-27.6, 14, 2.4, 2.4, 1.2, 'crate'),
    (-52, 8, 2.4, 2.4, 1.2, 'crate'), (-22, 40, 2.4, 2.4, 1.2, 'gcrate'),
    (48, 40, 2.4, 2.4, 2.4, 'crate'), (20, 34, 2.4, 2.4, 1.2, 'gcrate'),
    (40, -4, 2.4, 2.4, 1.2, 'crate'), (34, 10, 2.4, 2.4, 2.4, 'gcrate'),
    (30, -28, 2.4, 2.4, 1.2, 'crate'), (46, -26, 2.4, 2.4, 2.4, 'gcrate'),
    (-4, 50, 2.4, 2.4, 1.2, 'crate'), (-10, 30, 2.4, 2.4, 1.2, 'crate'),
    (-10, -52, 2.4, 2.4, 1.2, 'gcrate'), (4, -48, 2.4, 2.4, 2.4, 'crate'), (6.4, -48, 2.4, 2.4, 1.2, 'gcrate'),
]
PLAT_CRATES = [(44, 56, 'gcrate', 1.2), (-48, 40, 'crate', 1.2)]     # on the A and B platforms


def cell_of(x, z):
    return int((x - X0) // CELL), int((Z0 - z) // CELL)


for x, z, w, d, h, kind in CRATES:
    for px in (x + 0.01, x + w - 0.01):
        for pz in (z + 0.01, z + d - 0.01):
            c, r = cell_of(px, pz)
            assert g[r][c] in '.,', f'crate at {x},{z} sits on {g[r][c]!r}'
    box(x, 0, z, x + w, h, z + d, kind)
for x, z, kind, y in PLAT_CRATES:
    c, r = cell_of(x + 1.2, z + 1.2)
    assert g[r][c] == '1', f'platform crate at {x},{z}'
    box(x, y, z, x + 2.4, y + 1.2, z + 2.4, kind)

# ---------- waypoints for bots: a 3-cell lattice plus every stair and archway ----------
crate_boxes = [b for b in boxes if b[6] in ('crate', 'gcrate')]
waypoints = []
for r in range(H):
    for c in range(W):
        ch = g[r][c]
        if not walk(ch):
            continue
        if not (ch in STAIR or ch == 'A' or (c % 3 == 1 and r % 3 == 1)):
            continue
        x, z = cell_x(c) + 1, cell_z(r) - 1
        if any(b[0] - 0.5 < x < b[3] + 0.5 and b[2] - 0.5 < z < b[5] + 0.5 for b in crate_boxes):
            continue
        y = sum(STAIR[ch]) / 2 if ch in STAIR else LEVEL[ch]
        waypoints.append([r2(x), r2(z), y])

PI = 3.1416
spawns = {
    't': [[-12, -56, PI], [-8, -58, PI], [-4, -56, PI], [0, -58, PI], [4, -56, PI], [-6, -61, PI], [2, -61, PI], [-10, -61, PI]],
    'ct': [[-8, 56, 0], [-4, 58, 0], [0, 56, 0], [4, 58, 0], [8, 56, 0], [-6, 60, 0], [2, 60, 0], [6, 60, 0]],
}
for team, pts in spawns.items():
    for x, z, _ in pts:
        c, r = cell_of(x, z)
        assert g[r][c] in '.,', f'{team} spawn {x},{z} on {g[r][c]!r}'

out = {
    'name': 'Dust', 'style': 'cs', 'sky': 'textures/sky.jpg', 'fog': [70, 260],
    'palette': {'red': '#ff6050', 'blue': '#00a5ff', 'ink': '#111111', 'sky': '#9ea0ab',
                'sand': '#c8965e', 'wall': '#c4a876', 'stone': '#bca072', 'plaster': '#ceac7a'},
    'boxes': boxes, 'deco': deco, 'spawns': spawns,
    'sites': {'A': [22, 36, 38, 52], 'B': [-42, 16, -24, 32]},
    'waypoints': waypoints,
}
path = os.path.join(os.path.dirname(__file__), '..', 'projects', '08', 'map2.json')
with open(path, 'w', encoding='utf-8') as fh:
    json.dump(out, fh, separators=(',', ':'))
    fh.write('\n')
print('\n'.join(''.join(row) for row in g))
print(f'{len(boxes)} boxes, {len(deco)} deco, {len(waypoints)} waypoints')
