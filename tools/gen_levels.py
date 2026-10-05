"""Solves / generates levels for the parking puzzle (page2.html, tiles.json).

    python tools/gen_levels.py            # verify every level, (re)write its "par"
    python tools/gen_levels.py --add 10   # also append 10 new generated levels

A level is solved when the win tile (horizontal, exits right) reaches the right
edge. "par" is the minimum number of moves, where sliding one vehicle any
distance counts as one move - the same way page2.html counts moves.
Generated levels are hill-climbed until their par hits a target, so each new
level is a little harder than the previous one.
"""
import argparse
import json
import os
import random
import time
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES = os.path.join(ROOT, 'tiles.json')

# sprite indices in tiles.json "sprites", grouped by (length, direction)
SPRITES = {
    (2, 'horizontal'): list(range(1, 9)),
    (3, 'horizontal'): list(range(9, 13)),
    (2, 'vertical'): list(range(16, 20)),
    (3, 'vertical'): list(range(20, 23)),
}
WIN_SPRITE = 0
COLORS = ['#998c4d', '#808080', '#8292e3', '#969dc0', '#ffffff', '#c18c44', '#4d9999', '#5577aa']


def solve(cols, rows, vehicles):
    """vehicles: list of (horizontal, fixed, length, pos); index 0 is the win
    tile. Returns min moves to solve, or None if unsolvable."""
    fixed = [v[1] for v in vehicles]
    meta = [(v[0], v[2]) for v in vehicles]
    start = tuple(v[3] for v in vehicles)
    goal = cols - meta[0][1]

    def grid(state):
        g = [[False] * cols for _ in range(rows)]
        for (h, ln), f, p in zip(meta, fixed, state):
            for k in range(ln):
                if h:
                    g[f][p + k] = True
                else:
                    g[p + k][f] = True
        return g

    seen = {start: 0}
    q = deque([start])
    while q:
        s = q.popleft()
        d = seen[s]
        if s[0] == goal:
            return d
        g = grid(s)
        for i, ((h, ln), f) in enumerate(zip(meta, fixed)):
            p = s[i]
            for step in (-1, 1):
                np_ = p
                while True:
                    nxt = np_ + step
                    cell = nxt if step < 0 else nxt + ln - 1
                    limit = cols if h else rows
                    if cell < 0 or cell >= limit:
                        break
                    if (g[f][cell] if h else g[cell][f]):
                        break
                    np_ = nxt
                    ns = s[:i] + (np_,) + s[i + 1:]
                    if ns not in seen:
                        seen[ns] = d + 1
                        q.append(ns)
    return None


def level_to_vehicles(level):
    tiles = level['tiles']
    win = next(t for t in tiles if t.get('isWinTile'))
    out = []
    for t in [win] + [t for t in tiles if t is not win]:
        h = t['direction'] == 'horizontal'
        out.append((h, t['row'] if h else t['col'], t['width'] if h else t['height'],
                    t['col'] if h else t['row']))
    return out


def occupied(cols, rows, vehicles):
    g = [[False] * cols for _ in range(rows)]
    for h, f, ln, p in vehicles:
        for k in range(ln):
            r, c = (f, p + k) if h else (p + k, f)
            if not (0 <= r < rows and 0 <= c < cols) or g[r][c]:
                return None
            g[r][c] = True
    return g


def random_vehicle(cols, rows, rng, exit_row):
    h = rng.random() < 0.5
    ln = 3 if rng.random() < 0.25 else 2
    if h:
        row = rng.randrange(rows)
        if row == exit_row:  # keep horizontal blockers off the exit row
            return None
        return (True, row, ln, rng.randrange(cols - ln + 1))
    return (False, rng.randrange(cols), ln, rng.randrange(rows - ln + 1))


def mutate(cols, rows, vehicles, rng, exit_row):
    v = list(vehicles)
    op = rng.random()
    if op < 0.45 or len(v) < 4:
        nv = random_vehicle(cols, rows, rng, exit_row)
        if nv:
            v.append(nv)
    elif op < 0.65 and len(v) > 2:
        v.pop(rng.randrange(1, len(v)))
    else:
        i = rng.randrange(1, len(v))
        nv = random_vehicle(cols, rows, rng, exit_row)
        if nv:
            v[i] = nv
    return v if occupied(cols, rows, v) else None


def generate(cols, rows, target, rng, seeds, max_vehicles=14, budget_s=75):
    """Hill-climbs from an existing puzzle of the same grid size (much faster
    than starting from an empty lot) until par reaches the target or the
    time budget runs out. Returns the hardest puzzle found."""
    deadline = time.time() + budget_s
    best, best_par = None, -1
    while time.time() < deadline:
        cur = list(rng.choice(seeds))
        exit_row = cur[0][1]
        cur_par = solve(cols, rows, cur) or 0
        stale = 0
        while time.time() < deadline and stale < 600:
            cand = mutate(cols, rows, cur, rng, exit_row)
            if not cand or len(cand) > max_vehicles:
                continue
            par = solve(cols, rows, cand)
            if par is None:
                continue
            stale += 1
            # accept improvements, and sideways moves now and then
            if par > cur_par or (par == cur_par and rng.random() < 0.3):
                if par > cur_par:
                    stale = 0
                cur, cur_par = cand, par
                if cur_par > best_par:
                    best, best_par = cur, cur_par
                if best_par >= target:
                    return best, best_par
    return best, best_par


def vehicles_to_tiles(vehicles, rng):
    tiles = []
    for i, (h, f, ln, p) in enumerate(vehicles):
        t = {
            'id': 'gen%d' % i,
            'color': '#ff0000' if i == 0 else rng.choice(COLORS),
            'row': f if h else p,
            'col': p if h else f,
            'width': ln if h else 1,
            'height': 1 if h else ln,
            'direction': 'horizontal' if h else 'vertical',
        }
        if i == 0:
            t.update(isWinTile=True, winDirection='right', spriteIndex=WIN_SPRITE)
        else:
            t['spriteIndex'] = rng.choice(SPRITES[(ln, t['direction'])])
        tiles.append(t)
    return tiles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--add', type=int, default=0, help='number of levels to generate')
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    with open(TILES) as f:
        config = json.load(f)
    levels = config['levels']

    for lv in levels:
        par = solve(lv['gridCols'], lv['gridRows'], level_to_vehicles(lv))
        if par is None:
            print('%-10s UNSOLVABLE' % lv['name'])
            lv.pop('par', None)
        else:
            lv['par'] = par
            print('%-10s %dx%d  par %d' % (lv['name'], lv['gridCols'], lv['gridRows'], par))

    rng = random.Random(args.seed)
    # (cols, rows) of each new level, cycling; targets climb from the
    # existing levels' difficulty
    sizes = [(6, 6), (6, 7), (6, 6), (7, 7)]
    base_par = max((lv.get('par', 0) for lv in levels), default=8)
    for k in range(args.add):
        n = len(levels) + 1
        cols, rows = sizes[k % len(sizes)]
        seeds = [level_to_vehicles(lv) for lv in levels
                 if lv.get('par') and (lv['gridCols'], lv['gridRows']) == (cols, rows)]
        if not seeds:
            seeds = [[(True, 2, 2, 0)]]
        target = base_par + k
        vehicles, par = generate(cols, rows, target, rng, seeds)
        levels.append({'name': 'level%d' % n, 'gridCols': cols, 'gridRows': rows,
                       'par': par, 'tiles': vehicles_to_tiles(vehicles, rng)})
        print('%-10s %dx%d  par %d (target %d)  generated' % ('level%d' % n, cols, rows, par, target),
              flush=True)

    with open(TILES, 'w') as f:
        json.dump(config, f, indent=4)


if __name__ == '__main__':
    main()
