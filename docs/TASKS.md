# Task list: new main-page panels, project 10 and project 12

Last updated: 2026-11-09. Read this first in the next session.

## Goal
Under the **BMW M3 GTR** banner on `index.html`, add 3 vertical panels side by side:
1. Project 10 (Fuji poster), added later, once its 3D model is fixed or added
2. Project 12 (Computer A-83 poster)
3. Placeholder: black area with some text, a third page will come later

Pages should run **directly inside the main page**. Panel size is fixed and derived from the width of the BMW M3 GTR panel. The draft screenshot is the layout reference: three equal panels filling the BMW panel's width, with a gap between them.

## Done
- [x] Project 12 standalone page: `projects/12/index.html`
  - [x] Poster artwork in SVG: red circle, black half-ring, red square, "A-83", katakana, cream paper, grain
  - [x] `old_computer.glb` loaded, only the `HEAD` node kept (the rest of the file is leftover props)
  - [x] Camera yaw/elevation/FOV tuned to the reference `references/fc72806ce82611278680b59bd4888ed9.jpg`
  - [x] Soft shadow, drag/arrow-key rotation, eases back to the poster angle
  - [x] `lib/` copied from project 10 (three.module.min.js, GLTFLoader.js, ...)
  - [x] URL tuning: `?yaw=-26&elev=21&fov=18&h=565&cx=343&cy=590&debug=1`
- [x] Verified with headless Chrome screenshots

## Done: page 12 round 2 (2026-11-09)
- [x] Normals rebuilt at load with `toCreasedNormals` (35 deg crease)
- [x] Full 360 drag rotation (no limit), taps under 6px do not rotate
- [x] Retro terminal on the screen (emissive CanvasTexture, planar UVs): help, about, projects, date, color, echo, clear, hello, reboot
- [x] 40 keys are clickable: raycast, travel + orange glow, labelled QWERTY by row position (ESC row, CTRL row, SHIFT row, SPACE)
- [x] Real keyboard types into the terminal and moves the matching 3D key
- Not tested in a real browser yet: touch/mouse feel, key hit accuracy (only headless screenshots)

## Done: page 12 round 3 (2026-11-09)
- [x] Zoom: mouse wheel, two-finger pinch, and +/- buttons (0.7x to 4.5x, zooms about the model centre); reset button
- [x] "Free rotate" toggle (top right, off by default): off = spin around the vertical axis only; on = drag any direction (arrow up/down also tilt). Orientation is a quaternion, eases back to the poster angle after 6 s
- [x] Cavity filter (Blender-style): post-process on view-space normals, ridges lighter / creases darker. Toggle button, on by default. URL tuning: `?cav=0&cavr=1.5&ridge=0.55&valley=0.9`
- [x] English "COMPUTER" reading down on the right of the katakana
- [x] Key labels on the keycaps (decals), toggle button, off by default. URL: `?labels=1`
- URL extras: `?free=1`, `?zoom=2.4`
- Not tested with a real mouse/touch yet (headless screenshots only)

## To do: page 12
- [ ] Digits are not on the 3D keys (only 40 keys); physical keyboard can type them
- [x] (done) Fix model normals. Shading looks wrong (smudgy base, sliver under the right side of the base from the bottom plate)
  - Recompute normals on the `HEAD` meshes at load (creased normals so box edges stay sharp)
  - Check for back-face or inverted-face problems, since the material is single-sided
- [x] (done) Free 360° rotation by drag. Keep the ease-back-to-poster-angle behaviour, always take the shortest way round
- [x] (done) New screen material plus an on-screen interface
  - The `SCREEN` node is mesh 63. Replace its material with an emissive `CanvasTexture`
  - Draw the UI (boot text / mini terminal / desktop) on a 2D canvas, redraw when something changes
  - Clicking the screen: raycast, read the hit `uv`, map to canvas x/y, hit-test buttons
- [x] (done) Interactive keys
  - The keys are separate meshes: nodes `KEYBOARD.000` to `KEYBOARD.039` inside the `KEYBOARD` group (40 keys)
  - Raycast on pointer down: the key moves down about 1.5 mm and lights up, then springs back
  - Map each key mesh to a character by its position (rows at z = -0.015, 0, +0.015, +0.031), QWERTY layout
  - Pressed keys show on the screen (typed text plus a "last key" readout)
  - Also mirror real keyboard presses on the model
  - Disambiguate drag-to-rotate from a key click: only treat it as a key press if the pointer barely moved
- [ ] Optional: re-export the GLB with only the computer (smaller file, no hidden junk)

## To do: main page
- [ ] Inspect `index.html` / `site.json` and find the BMW M3 GTR panel width
- [ ] Add 3 fixed-size vertical panels under it (page 10, page 12, placeholder)
- [ ] Embed the pages directly. Plan: iframes first (each page already scales to its container), or mount as modules later
- [ ] Placeholder panel: black area with text (wording still to decide)
- [ ] Keep the Fuji Poster card for now. Remove or replace it once page 10 is done and in the panel
- [ ] Update `site.json` (add a project 12 card/thumb)
- [ ] Update `sw-manifest.js` / `offline.js` / `tools/build_offline_manifest.py` so the new pages and `old_computer.glb` work offline

## Page 10 status (2026-11-09)
- [x] New car model in `projects/10/models/car.glb` (BODY, REAR_WHEELS, FL, FR, textures embedded)
- [x] Car camera is now perspective (was orthographic, no FOV). 1 unit at the wheels stays 1 poster unit at any FOV
- [x] Coast-after-release removed (it still swings home to the hero view after 6 s idle)
- [x] Hero view confirmed and hard-coded: fov 8, yaw 126, elev 4.5 (`TUNE` in `projects/10/index.html`); tuning panel removed
- [x] Car bigger (CAR_LEN 1650, canvas 1900x680) and moved up 92 units in `scene.json` to match the reference
- [x] Tab-switch rubber band fixed (snaps home on return if idle)
- [x] White repaint tried and reverted (looked off). The user will supply a new body texture; swap it into `models/car.glb`
- Headless Chrome never finishes the loading screen on page 10 (text.webp decode); real browsers are fine

## To do: page 10 (Fuji poster)
- [ ] The user has things to adjust. Ask what before starting
- [ ] Later: fix or add its 3D model (`projects/10/models/car.glb`)

## Not done / open questions
- Wording for the placeholder panel
- Exact panel gap and height ratio (assume the poster ratio, 2:3, unless told otherwise)
- Page 10 adjustments (unspecified)

## Notes
- Poster units: project 12 = 800 x 1200, project 10 = 1684 x 2528. Both scale to fit their container.
- Pages must be served over HTTP (modules and GLB don't load from `file://`).
- Headless screenshot testing: `chrome --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=30000 --screenshot=out.png URL`. It is flaky if the GLB loads too slowly, so retry or raise the budget.

## Update 2026-11-09 (later)
- [x] Page 10: bloom removed, sun light raised (3.3). Page 12: screen is dark until tapped, keys do nothing until then
- [x] Main page: `#panels` under the BMW card holds page 10 and page 12 as iframes (`?embed=1`) plus a black "COMING SOON" panel. Sized from the card width in `layoutPanels()` in `index.html`. `site-nav.js` hides the HOME button when `embed=1`; page 10 uses `touch-action: pan-y` when embedded
- [ ] Not done: pause the pages' render loops when off-screen, `site.json` card for page 12, offline manifest (`tools/build_offline_manifest.py`) for the new pages and `old_computer.glb`

## Update 2026-11-09 (performance)
- [x] Phones (<=768px): the two panels show `projects/10/shot.webp` and `projects/12/shot.webp` with a pulsing TAP TO PLAY; the iframe is only created on tap. Files are prefetched at idle (skipped on data saver / 2g). Desktop starts the iframes straight away
- [x] Pause: pages 10 and 12 stop their render loop when the tab is hidden or the panel is scrolled out of view, and wake on return. Page 12's terminal cursor stops blinking after 20 s without a touch
- [x] `?shot=1` hides hints and buttons for taking clean thumbnails (page 12: `projects/12/index.html?embed=1&shot=1`; page 10 needs the main-page route in headless Chrome, its standalone load never finishes there)
- [ ] Add `projects/10`, `projects/12` and the two `shot.webp` files to the offline manifest
