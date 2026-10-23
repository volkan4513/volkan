"""Builds projects/07/wd/win/icons.webp: the desktop icons cut out of
references/win_icon_sheet.jpg (a 32 x 15 grid of 60 px cells on dark grey).

    python tools/make_win_icons.py

The sheet has no transparency, so the grey around each icon is removed:
pixels joined to the cell border that are close to the background colour
become transparent, and the icon's edge pixels get a soft alpha with the
grey taken back out of their colour. The icons are written side by side
in one strip; wd/win/icons.js maps names to positions (keep NAMES in sync).
"""
import os
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'references', 'win_icon_sheet.jpg')
OUT = os.path.join(ROOT, 'projects', '07', 'wd', 'win', 'icons.webp')
ROW_Y = [2, 62, 122, 184, 242, 302, 362, 422, 482, 542, 602, 662, 722, 782, 842]
SIZE = 56          # cut from the middle of each 60 px cell
BG = (51, 51, 51)  # the sheet's cell colour

# name -> (row, column) on the sheet
NAMES = {
    'explorer': (1, 24), 'browser': (4, 1), 'notepad': (14, 1), 'paint': (8, 31), 'photos': (1, 14),
    'calculator': (3, 0), 'clock': (8, 6), 'settings': (2, 12), 'widgets': (1, 2), 'info': (3, 1),
    'home': (4, 0), 'pc': (1, 25), 'recycle': (1, 27), 'desktop': (1, 23), 'documents': (12, 28),
    'downloads': (4, 7), 'music': (2, 26), 'folder': (7, 3), 'file': (7, 4), 'text': (14, 0),
    'code': (7, 8), 'newfolder': (7, 13), 'newfile': (7, 14), 'upload': (7, 16), 'download': (3, 14),
    'rename': (0, 10), 'delete': (0, 26), 'restore': (9, 15), 'broom': (12, 12), 'view': (1, 3),
    'search': (0, 13), 'back': (1, 19), 'forward': (1, 20), 'up': (1, 21), 'refresh': (0, 25),
    'house': (9, 14), 'undo': (0, 31), 'redo': (9, 16), 'lock': (3, 15), 'star': (2, 3),
    'link': (12, 21), 'mail': (4, 12), 'gear-folder': (2, 14), 'tree': (1, 18), 'zoom-in': (8, 11),
    'zoom-out': (8, 12), 'open': (7, 16), 'save': (12, 16), 'print': (0, 11), 'help': (2, 27),
}


def cut(sheet, r, c):
    x0 = c * 60 + 2 + (58 - SIZE) // 2
    y0 = ROW_Y[r] + (58 - SIZE) // 2
    cell = sheet.crop((x0, y0, x0 + SIZE, y0 + SIZE)).convert('RGB')
    px = cell.load()
    dist = lambda p: ((p[0] - BG[0]) ** 2 + (p[1] - BG[1]) ** 2 + (p[2] - BG[2]) ** 2) ** 0.5
    # background = grey pixels reachable from the border
    bg = [[False] * SIZE for _ in range(SIZE)]
    q = deque((x, y) for x in range(SIZE) for y in (0, SIZE - 1)) + deque((x, y) for y in range(SIZE) for x in (0, SIZE - 1))
    while q:
        x, y = q.popleft()
        p = px[x, y]
        near_edge = min(x, y, SIZE - 1 - x, SIZE - 1 - y) < 3
        grey_line = near_edge and max(p) - min(p) < 14   # the sheet's grid lines
        if bg[y][x] or (dist(p) > 22 and not grey_line):
            continue
        bg[y][x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < SIZE and 0 <= ny < SIZE and not bg[ny][nx]:
                q.append((nx, ny))
    out = Image.new('RGBA', (SIZE, SIZE))
    op = out.load()
    for y in range(SIZE):
        for x in range(SIZE):
            p = px[x, y]
            if bg[y][x]:
                op[x, y] = (0, 0, 0, 0)
                continue
            edge = any(0 <= x + dx < SIZE and 0 <= y + dy < SIZE and bg[y + dy][x + dx] for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            a = min(1.0, dist(p) / 70) if edge else 1.0
            if a <= 0.02:
                op[x, y] = (0, 0, 0, 0)
                continue
            # take the grey back out of half-transparent edge pixels
            col = tuple(max(0, min(255, round((p[i] - BG[i] * (1 - a)) / a))) for i in range(3))
            op[x, y] = col + (round(a * 255),)
    return out


def main():
    sheet = Image.open(SRC)
    strip = Image.new('RGBA', (SIZE * len(NAMES), SIZE))
    for i, (name, (r, c)) in enumerate(NAMES.items()):
        strip.paste(cut(sheet, r, c), (i * SIZE, 0))
    strip.save(OUT, 'WEBP', lossless=True, quality=100, method=6)
    print(f'{len(NAMES)} icons -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')
    print('order:', ' '.join(NAMES))


if __name__ == '__main__':
    main()
