"""Pre-bakes the images index.html renders, so the page decodes far less.

Run from the repo root after changing functions_to_work.json or any layer:

    python tools/optimize_images.py

What it does:
  * Every full-canvas layer (1096x2233, mostly transparent) is cropped to the
    bounding box of its visible pixels. A full layer decodes to ~10 MB of RAM;
    most crops are a few hundred KB.
  * Runs of consecutive non-interactive layers (base*, *text*, *noselect*) are
    flattened into a single image, since they are never hovered or clicked.
  * The background sprite-sheet atlases are trimmed to just the frames that
    index.html actually plays (see BG_SEQUENCES below - keep in sync).

Outputs images_to_use/optimized/*.webp + manifest.json. index.html falls back
to the original full-size layers if the manifest is missing or stale.
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'images_to_use')
OUT_DIR = os.path.join(SRC_DIR, 'optimized')
PAD = 2  # px of transparent margin kept around each crop

# (atlas path, frame width, first frame, last frame) - mirrors BG_LEFT/BG_RIGHT
BG_SEQUENCES = [
    ('bg_sequence_01/bg_sequence_01_merged.webp', 393, 0, 9),
    ('bg_sequence_02/bg_sequence_02_merged.webp', 450, 1, 6),
]


def no_highlight(name):
    # must match noHighlight() in index.html
    n = name.lower()
    return n.startswith('base') or 'text' in n or 'noselect' in n


def save_webp(img, path):
    """Saves whichever of lossless / high-quality lossy is smaller."""
    img.save(path, 'WEBP', lossless=True, method=6)
    lossless_size = os.path.getsize(path)
    tmp = path + '.tmp'
    img.save(tmp, 'WEBP', quality=90, alpha_quality=100, method=6)
    if os.path.getsize(tmp) < lossless_size * 0.8:
        os.replace(tmp, path)
    else:
        os.remove(tmp)


def crop_box(img):
    if img.mode != 'RGBA':
        return (0, 0) + img.size
    box = img.getchannel('A').getbbox()
    if not box:
        return None
    l, t, r, b = box
    return (max(0, l - PAD), max(0, t - PAD),
            min(img.width, r + PAD), min(img.height, b + PAD))


def main():
    config = json.load(open(os.path.join(ROOT, 'functions_to_work.json')))[0]
    filenames = config['image_filenames']
    positioned = set(config.get('images_to_pos', {}))
    interactive = set()
    for key in ('names_to_link', 'open_random_popup', 'scroll_down', 'random_image_click'):
        interactive |= set(config.get(key, {}))

    os.makedirs(OUT_DIR, exist_ok=True)
    for f in os.listdir(OUT_DIR):
        os.remove(os.path.join(OUT_DIR, f))

    # bottom-to-top, the order layers are appended to the DOM
    order = list(reversed(filenames))
    design_size = None
    groups = []  # each: list of names flattened together, or a single name
    for name in order:
        passive = no_highlight(name) and name not in interactive and name not in positioned
        if passive and groups and groups[-1]['passive']:
            groups[-1]['names'].append(name)
        else:
            groups.append({'passive': passive, 'names': [name]})

    layers = []
    for gi, group in enumerate(groups):
        names = group['names']
        if names[0] in positioned:
            # glasses etc. are sized/positioned by images_to_pos - use as is
            layers.append({'name': names[0], 'src': 'images_to_use/%s.webp' % names[0],
                           'positioned': True})
            continue

        if len(names) == 1:
            out_name = names[0]
            img = Image.open(os.path.join(SRC_DIR, names[0] + '.webp')).convert('RGBA')
        else:
            out_name = 'flat%d_noselect' % gi
            img = None
            for n in names:
                layer = Image.open(os.path.join(SRC_DIR, n + '.webp')).convert('RGBA')
                img = layer if img is None else Image.alpha_composite(img, layer)

        if design_size is None:
            design_size = img.size
        elif img.size != tuple(design_size):
            raise SystemExit('%s is %s, expected %s' % (out_name, img.size, design_size))

        box = crop_box(img)
        if not box:
            continue
        cropped = img.crop(box)
        if cropped.getchannel('A').getextrema() == (255, 255):
            cropped = cropped.convert('RGB')
        save_webp(cropped, os.path.join(OUT_DIR, out_name + '.webp'))
        layers.append({
            'name': out_name,
            'src': 'images_to_use/optimized/%s.webp' % out_name,
            'x': box[0], 'y': box[1], 'w': box[2] - box[0], 'h': box[3] - box[1],
        })
        print('%-36s %4dx%-4d  (%s)' % (out_name, box[2] - box[0], box[3] - box[1],
                                        ', '.join(names)))

    manifest = {
        'source_filenames': filenames,
        'design_w': design_size[0],
        'design_h': design_size[1],
        'layers': layers,
    }
    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)

    for rel, frame_w, start, end in BG_SEQUENCES:
        atlas = Image.open(os.path.join(SRC_DIR, rel))
        trimmed = atlas.crop((start * frame_w, 0, (end + 1) * frame_w, atlas.height))
        out = os.path.join(SRC_DIR, rel.replace('_merged.webp', '_used.webp'))
        trimmed.convert('RGB').save(out, 'WEBP', quality=90, method=6)
        print('%-36s %dx%d frames %d-%d' % (os.path.basename(out), trimmed.width,
                                            trimmed.height, start, end))


if __name__ == '__main__':
    main()
