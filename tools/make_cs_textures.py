"""Builds the CS 1.6 style textures and sky for projects/08 from Poly Haven CC0 assets.

    python tools/make_cs_textures.py <download_dir>

Downloads the source photos into <download_dir> (skipped when already there), then writes
128 px, 256-colour textures and a 2048x1024 sky into projects/08/textures/.
"""
import json, os, sys, urllib.request
from PIL import Image, ImageDraw, ImageStat

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'projects', '08', 'textures')
S = 128
TEXTURES = ['large_sandstone_blocks_01', 'sandstone_blocks_08', 'dirt_floor', 'cobblestone_floor_01', 'sandstone_cracks',
            'metal_plate', 'wood_planks', 'green_metal_rust', 'weathered_planks']
SKY = 'kloofendal_48d_partly_cloudy_puresky'


def fetch(name, kind):
    path = os.path.join(SRC, name, 'sky.jpg' if kind == 'sky' else 'diff.jpg')
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    files = json.load(urllib.request.urlopen(f'https://api.polyhaven.com/files/{name}'))
    url = files['tonemapped']['url'] if kind == 'sky' else files['Diffuse']['1k']['jpg']['url']
    urllib.request.urlretrieve(url, path)


def load(name, size=S):
    return Image.open(os.path.join(SRC, name, 'diff.jpg')).convert('RGB').resize((size, size), Image.LANCZOS)


def grade(im, target, contrast):
    """Moves the average colour to target and scales the variation around it."""
    mean = ImageStat.Stat(im).mean
    lut = []
    for c in range(3):
        lut += [max(0, min(255, round((v - mean[c]) * contrast + target[c]))) for v in range(256)]
    return im.point(lut)


def save(im, name):
    # 8-bit palette like the original WAD textures.
    im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, name + '.png'), optimize=True)


def main():
    for t in TEXTURES:
        fetch(t, 'tex')
    fetch(SKY, 'sky')
    os.makedirs(OUT, exist_ok=True)

    save(grade(load('large_sandstone_blocks_01'), (196, 168, 118), 0.75), 'wall')
    save(grade(load('sandstone_blocks_08'), (188, 160, 114), 1.5), 'stone')
    save(grade(load('dirt_floor'), (194, 148, 96), 1.25), 'sand')
    save(grade(load('cobblestone_floor_01'), (152, 128, 96), 1.1), 'cobble')
    save(grade(load('sandstone_cracks'), (206, 172, 122), 1.1), 'plaster')
    save(grade(load('metal_plate'), (112, 112, 104), 1.1), 'metal')

    # Wooden crate: planks inside a darker frame with a diagonal brace.
    wood = grade(load('wood_planks').rotate(90), (138, 98, 56), 1.1)
    dark = grade(load('wood_planks'), (86, 58, 30), 0.9)
    mask = Image.new('L', (S, S), 0)
    g = ImageDraw.Draw(mask)
    g.rectangle([0, 0, S - 1, S - 1], outline=255, width=12)
    g.line([(10, 10), (S - 11, S - 11)], fill=255, width=12)
    crate = Image.composite(dark, wood, mask)
    ImageDraw.Draw(crate).rectangle([0, 0, S - 1, S - 1], outline=(52, 34, 18), width=2)
    save(crate, 'crate')

    # Green military crate: painted metal, rim, two ribs and a hazard stripe band at the bottom.
    green = grade(load('green_metal_rust'), (98, 116, 74), 1.3)
    d = ImageDraw.Draw(green)
    d.rectangle([0, 0, S - 1, S - 1], outline=(52, 64, 40), width=6)
    for y in (40, 70):
        d.rectangle([6, y, S - 7, y + 3], fill=(70, 86, 52))
    band = Image.new('RGB', (S, 18), (226, 186, 30))
    bd = ImageDraw.Draw(band)
    for x in range(-18, S + 18, 18):
        bd.polygon([(x, 18), (x + 9, 18), (x + 27, 0), (x + 18, 0)], fill=(28, 26, 22))
    green.paste(band, (0, S - 26))
    d.rectangle([0, S - 27, S - 1, S - 27], fill=(40, 48, 30))
    d.rectangle([0, 0, S - 1, S - 1], outline=(40, 48, 30), width=2)
    save(green, 'gcrate')

    # Double wooden door: vertical weathered planks, two iron bands with studs, a centre seam.
    door = grade(load('weathered_planks'), (112, 76, 44), 1.15)
    d = ImageDraw.Draw(door)
    for y in (26, 98):
        d.rectangle([0, y, S - 1, y + 7], fill=(46, 40, 36))
        for x in range(8, S, 16):
            d.rectangle([x, y + 2, x + 2, y + 4], fill=(120, 112, 100))
    d.rectangle([S // 2 - 1, 0, S // 2, S - 1], fill=(34, 22, 12))
    d.rectangle([0, 0, S - 1, S - 1], outline=(34, 22, 12), width=3)
    save(door, 'door')

    # Sky: the cloud half of the panorama, warmed a little; below the horizon fades to the haze colour.
    sky = Image.open(os.path.join(SRC, SKY, 'sky.jpg')).convert('RGB').resize((2048, 1024), Image.LANCZOS)
    sky = grade(sky, tuple(v * 0.96 + w * 0.04 for v, w in zip(ImageStat.Stat(sky).mean, (255, 210, 150))), 1.0)
    haze = tuple(round(v) for v in ImageStat.Stat(sky.crop((0, 500, 2048, 512))).mean)
    px = sky.load()
    for y in range(512, 1024):
        k = min(1, (y - 512) / 24)
        for x in range(2048):
            p = px[x, y]
            px[x, y] = tuple(round(p[c] * (1 - k) + haze[c] * k) for c in range(3))
    sky.save(os.path.join(OUT, 'sky.jpg'), quality=82, optimize=True)
    print('haze colour #%02x%02x%02x' % haze)


main()
