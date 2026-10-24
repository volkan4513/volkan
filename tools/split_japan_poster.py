"""Split the Japan poster reference into rough layers (best-effort cutouts)."""
import cv2, numpy as np, os
SRC = 'references/107768da3720c2340ea9de2546f00432.jpg'
OUT = 'references/layers'
os.makedirs(OUT, exist_ok=True)
im = cv2.imread(SRC)
H, W = im.shape[:2]

def grab(rect, iters=6, seed=None):
    x0, y0, x1, y1 = rect
    m = np.full((H, W), cv2.GC_BGD, np.uint8)
    m[y0:y1, x0:x1] = cv2.GC_PR_BGD
    pad = 8
    m[y0+pad:y1-pad, x0+pad:x1-pad] = cv2.GC_PR_FGD
    if seed is not None:
        m[seed > 0] = cv2.GC_FGD
    b = np.zeros((1, 65)); f = np.zeros((1, 65))
    cv2.grabCut(im, m, None, b, f, iters, cv2.GC_INIT_WITH_MASK)
    return ((m == 1) | (m == 3)).astype(np.uint8) * 255

def save(name, mask, rect=None, feather=1):
    mask = cv2.GaussianBlur(mask, (0, 0), feather) if feather else mask
    rgba = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = mask
    if rect:
        x0, y0, x1, y1 = rect
        rgba = rgba[y0:y1, x0:x1]
    cv2.imwrite(f'{OUT}/{name}.png', rgba)

def circle(c, r):
    m = np.zeros((H, W), np.uint8); cv2.circle(m, c, r, 255, -1); return m

masks = {}
# car (seed: body centre is certainly foreground)
seed = np.zeros((H, W), np.uint8); cv2.rectangle(seed, (260, 790), (620, 900), 255, -1)
masks['car'] = (grab((180, 752, 725, 958), seed=seed), (180, 752, 725, 958))
# pole
seed = np.zeros((H, W), np.uint8); cv2.line(seed, (222, 360), (222, 820), 255, 6)
masks['powerpole'] = (grab((180, 340, 275, 840), seed=seed), (180, 340, 275, 840))
# house
seed = np.zeros((H, W), np.uint8); cv2.rectangle(seed, (380, 670), (560, 745), 255, -1)
masks['house'] = (grab((335, 612, 645, 765), seed=seed), (335, 612, 645, 765))
# trees
masks['trees_right'] = (grab((565, 640, 722, 800)), (565, 640, 722, 800))
masks['trees_left'] = (grab((165, 690, 375, 835)), (165, 690, 375, 835))
# suns / stamp
masks['sun_big'] = (circle((240, 320), 120), (115, 195, 365, 445))
masks['sun_small'] = (circle((127, 678), 56), (68, 620, 187, 737))
stamp = np.zeros((H, W), np.uint8); stamp[770:872, 68:168] = 255
masks['stamp'] = (stamp, (68, 770, 168, 872))

for n, (m, r) in masks.items():
    save(n, m, r)

# text: bright cream glyphs (JAPAN + kana) on the dark/orange poster
hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
bright = ((hsv[..., 2] > 200) & (hsv[..., 1] < 90)).astype(np.uint8) * 255
txt = np.zeros_like(bright); txt[55:600, 60:420] = bright[55:600, 60:420]
txt[:, 380:] = 0
txt_k = np.zeros_like(bright); txt_k[60:590, 235:420] = bright[60:590, 235:420]
txt = cv2.bitwise_or(np.where(np.arange(W)[None, :] < 195, txt, 0).astype(np.uint8), txt_k)
save('text_japan_kana', txt, feather=0)
# frame + coordinate line
frame = np.zeros((H, W), np.uint8)
for (x0, y0, x1, y1) in [(36, 38, 700, 1066)]:
    cv2.rectangle(frame, (x0, y0), (x1, y1), 255, 6)
fb = cv2.bitwise_and(frame, ((hsv[..., 2] > 150) & (hsv[..., 1] < 140)).astype(np.uint8) * 255)
save('frame', fb, feather=0)
cap = np.zeros((H, W), np.uint8); cap[1000:1030, 70:670] = bright[1000:1030, 70:670]
save('caption', cap, feather=0)

# clean plate: inpaint everything removed so sky/mountain can be extracted
rm = np.zeros((H, W), np.uint8)
for n, (m, r) in masks.items():
    rm = cv2.bitwise_or(rm, m)
rm = cv2.bitwise_or(rm, cv2.bitwise_or(txt, cv2.bitwise_or(fb, cap)))
rm = cv2.dilate(rm, np.ones((7, 7), np.uint8))
plate = cv2.inpaint(im, rm, 9, cv2.INPAINT_TELEA)
cv2.imwrite(f'{OUT}/background_plate.png', plate)
cv2.imwrite(f'{OUT}/sky_crop.png', plate[45:420, 45:690])
cv2.imwrite(f'{OUT}/mountain_crop.png', plate[400:700, 0:W])
print('done')
