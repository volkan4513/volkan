# Task list: new main-page panels, project 10 and project 12

Last updated: 2026-11-12. Read this first in the next session.

## RULES (read before doing anything)
- **Never run git commands in this project** (no commit, add, status, diff, mv, push...). The user handles version control. Use plain file moves and edits instead.
- After adding or moving files, run `python tools/build_offline_manifest.py` (never hand-edit `sw-manifest.js`).

## PENDING (the only open items, 2026-11-12)
1. **User reads the info pages** for wording; text was written from code reading, so spot-check claims. Keep them updated when a project changes.
2. **Real-phone testing**, none done yet: info pages and button placement, QR join on 08/09 (scanning needs `BarcodeDetector`: Android Chrome or macOS, not iPhone), page 12 touch/mouse feel, cold offline load with the `projects/06/` paths, saving a level in the builder.
3. (closed 2026-11-12: page 12 digits and the .glb re-export are not needed)
Everything else below that is still unticked is stale: it was done, see the "Update" sections.

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
- [x] (later removed, the code no longer has it) "Free rotate" toggle: it was `?free=1` and drag-any-direction. Current code spins around the vertical axis only and eases back to the poster angle after 6 s
- [x] Cavity filter (Blender-style): post-process on view-space normals, ridges lighter / creases darker. Toggle button, on by default. URL tuning: `?cav=0&cavr=1.5&ridge=0.55&valley=0.9`
- [x] English "COMPUTER" reading down on the right of the katakana
- [x] Key labels on the keycaps (decals), toggle button, off by default. URL: `?labels=1`
- URL extras: `?zoom=2.4` (`?free=1` no longer exists)
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

## Page 10 (Fuji poster): COMPLETE (2026-11-10)
The user confirmed page 10 is fully done. No further adjustments or model changes pending.

## Not done / open questions
- Wording for the placeholder panel
- Exact panel gap and height ratio (assume the poster ratio, 2:3, unless told otherwise)

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

## Update 2026-11-10
- [x] Page 10 marked complete
- [x] Page 12 number layer: tap the 3D CTRL key (or press Alt on a real keyboard) to toggle. Q-P become 1-0, other keys become symbols, keycap labels redraw (orange), screen shows NUM. Physical digits already worked
- [x] Page 12 terminal: HELP 1-3 pages, TIME, UPTIME, VER, MEM, WHOAMI, HISTORY (and Up/Down arrows), CALC, RAND, ROLL, FLIP, LS, CAT, JOKE, FORTUNE, BANNER, GUESS game, XYZZY, colors white/cyan
- [x] Offline manifest: added `projects/10/shot.webp`, `projects/12/` (index, lib, old_computer.glb, shot.webp) to CORE; regenerated `sw-manifest.js`
- [x] `site.json`: added "Computer A-83" card (slug `computer`) and its detail entry
- Not tested in a real browser yet (no run done this session)

## Update 2026-11-12
- [x] QR join for projects 08 and 09: `qrcode.js` + `joinqr.js` (host lobby shows a QR of `?join=CODE`, join screen has a Scan QR button where `BarcodeDetector` exists, `?join=` auto-joins). Not tested in a browser or on a phone yet
- [x] Removed the "Computer A-83" card from the "more stuff" list in `site.json` (page 12 stays as the main-page panel; its `details` entry is kept, like Fuji)
- [x] Parking Puzzle moved into `projects/06/`: `page2.html` -> `projects/06/index.html`, `builder.html` -> `projects/06/builder.html`, `tiles.json` -> `projects/06/tiles.json`. Shared files stay at the root (`daily.js`, `images_to_use/`). Old `page2.html` is now a redirect stub. Links updated in `index.html`, `site.json`, `offline.html`, projects 05 and 07, the Python tools and the offline manifest. Verified in headless Chrome 2026-11-12: puzzle (plain, `?daily`, `?level=5`), builder, the `page2.html?daily` redirect and the main page's daily-board canvas all load with no failed requests or script errors
- Doc drift fixed 2026-11-12: `docs/shooter-plan.md` deleted (outdated, replaced by `projects/08/info.html`); the "Free rotate" mismatch in this file was corrected.

## Update 2026-11-12 (later)
- [x] Info button no longer overlaps anything. `info-link.js` options on its script tag: `data-slot="css selector"` (inline in the page's own header: used on 04 `.search-row`, 06 `header.hud`, 11 `header span`), `data-pos` / `data-pos-narrow` (fixed corner: 07 Glass Cursor is `br` on desktop, `tl` on phones), `data-pos="none"` (07 Widget Desktop: no button, its Help panel links to `info.html` instead). Default stays top right (01, 02, 03, 05, 10, 12). Checked with an overlap script in headless Chrome at 1280 and 390 wide: no overlaps
- [x] Info pages expanded with more detail (about 93 KB to 184 KB total): startup config, controls, saved state, constants from the code, file roles, failure modes, where to change things. Corrections found while reading: 04 has 7 songs (not 8), 03 ASCII ramp starts with a space, 12 idle zoom-out only happens in the embedded panel, 10 `scene.json` has unused `depth`/`car.poster`/85 car frames. 03 edge case noted: after an upload the image may not redraw until a slider moves
- [x] Offline manifest verified: `projects/10/shot.webp`, `projects/12/*` and `projects/*/info.html` are in CORE; regenerated (version 5cfd0c8466)

## Task: "How it works" info pages for every project
STATUS 2026-11-12: first version of all 12 pages is written and loads cleanly in headless Chrome (no failed requests or script errors, no sideways scrolling at 764px). Still to do: read them once yourself for wording, check them on a real phone, and update them whenever a project changes. Page text was written from code reading and research notes, so spot-check claims you rely on.
Done (all the boxes below in this section are complete even where unticked): `projects/NN/info.html` for 01-12 (07 covers both Widget Desktop and Glass Cursor), shared `info.css`, `info-link.js` (a blue 'HOW IT WORKS' button, placement per page as described above, hidden for `?embed=1` and `?shot=1`) on 01-07, 10, 11, 12, a 'How it works' link in the 08 and 09 menus, and the pages added to `tools/build_offline_manifest.py` (manifest regenerated).

Goal: each project gets its own info page (NOT in `site.json`), written as author notes so new ideas can be built later, plus a short visitor intro.

Layout
- [ ] `projects/NN/info.html` for 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12 (06 now exists)
- [ ] Shared `info.css` at the root; plain static HTML, no framework
- [ ] A small "How it works" button on each project page linking to its info page; hidden when `embed=1` (pages 10 and 12)
- [ ] Add the info pages and `info.css` to `tools/build_offline_manifest.py`, then regenerate `sw-manifest.js`

Sections on every page
1. What it is  2. Tools and files  3. How it loads (modules, lazy load, heavy files, offline)  4. Every control, trigger and URL option  5. How it works (logic, diagrams)  6. How it differs from the other projects  7. Main quality

Project 06 (Parking Puzzle) must cover
- [ ] Rules, controls, par and stars, timer, daily puzzle, localStorage keys (`parking-puzzle-progress`, `parking-daily`)
- [ ] Builder walkthrough: add level, grid size, place cars, win tile, copy/paste, Save downloads `tiles.json`, replace `projects/06/tiles.json`
- [ ] Making a new level end to end: builder, Save, `python tools/gen_levels.py` (par + solvability, `--add N` to generate), then `projects/06/index.html?level=N`
- [ ] Sprite editor: open it, select cells (Shift/Ctrl-click for a rectangle), set native direction, Save Sprite, 6x12 sheet at 80px cells, `python tools/pixelate_tiles.py` to rebuild the 16px sheet the game reads
- [ ] Warnings: the builder does not compute par or check solvability or exactly one horizontal win car; deleting a sprite shifts later `spriteIndex` values; progress is keyed by level name, which renumbering changes

Project 08 / 09 must cover
- [ ] PeerJS room-code flow (ids `lpstrike-` / `pxracer-`), `rel` + `fast` channels, heartbeat, QR join, `?lag` / `?loss`
- [ ] 08: host-authoritative, prediction, lag compensation, three modes, bots, maps, Node map tools. 09: each player drives their own car, host does bots and ranking, tracks and checkpoints
- [x] `docs/shooter-plan.md` deleted 2026-11-12

Other pages: use the per-project notes gathered on 2026-11-12 (controls, key logic, standout quality). Page 11's AI library is cross-origin and not available offline on a first load. Pages 01, 02, 12 do not load `offline.js` themselves.

## Update 2026-11-12 (page 12 controls)
- [x] Page 12: "Key labels" button removed; labels now switch on when the screen is tapped to power on (and stay on). New "Numbers" button toggles the number layer like the Alt key, so it works on phones. Boot text shows "ALT KEY = NUMBERS / LETTERS" and the bottom hint mentions Alt / the Numbers button
- [x] Page 12: all buttons (Cavity, Numbers, zoom, reset) are hidden in the main-page panel (`embed=1`) and only show on the full page. Info page 12 updated. Headless Chrome: no script errors, button hidden in embed, Numbers toggles. Not tried on a real phone
- Decision: the `old_computer.glb` re-export is NOT needed; the Alt-key number layer is the final answer for digits (both optional items closed)

## Update 2026-11-12 (project 03 rewrite)
- [x] `projects/03/index.html` rewritten. Fixed: upload not redrawing, drag-leave wiping the Original picture, scanline slider at 1 going black, ASCII top row clipped / fixed 6px font, invisible ASCII slider thumb in Firefox, wrong page title (now "Retro Image Effects Studio")
- [x] Drawing: real canvases on the page (no `toDataURL` per slider tick), `devicePixelRatio` up to 2, one redraw per frame, debounced resize, downloads at the picture's own resolution (max 4096px, opaque PNG)
- [x] New: each of the three effect panels can show Scanline, CRT, ASCII (plain or colour, Copy text), Pixel Art (median-cut palette or Game Boy / CGA / PICO-8 / 1-bit, Bayer or Floyd-Steinberg dither) or Halftone. Expand a panel (Esc closes), Reset, slider value readouts, webcam input (Stop keeps a snapshot), paste from clipboard, four samples (default, `projects/10/shot.webp`, `projects/12/shot.webp`, a sunset drawn in code)
- [x] Layout: controls sit under each picture; phones get one scrolling column, short windows two columns. Info button moved into the top bar (`data-slot=".bar"`)
- [x] `projects/03/info.html` rewritten to match; offline manifest regenerated
- Tested in headless Chrome at 1280 wide: page loads with no script errors; CRT, Halftone (plain and colour), colour ASCII, Game Boy + Bayer, 1-bit and PICO-8 + Floyd-Steinberg, sample switching and Expand all draw correctly. NOT tested: real phone, Firefox/Safari, webcam, upload/drop/paste, Download and Copy text clicks (headless cannot do these)
- `site.json` card text for 03 still says "Scanline, ASCII and pixel-art effects, live." (left as is)

## Update 2026-11-12 (project 03, second pass)
- [x] Webcam confirmed working by the user
- [x] Fit mode in the top bar: fill (crop) or whole image (letterboxed; downloads are then uncropped)
- [x] Compare checkbox per effect panel: original left / effect right of a draggable divider
- [x] Settings remembered in `localStorage` key `retro-fx-studio`; "Copy link" builds `#fit=..&img=..&p1=..&p2=..&p3=..&cmp=...` (applied on open, then removed from the address bar)
- [x] "Save all" = one 2x2 PNG (`retro-effects.png`); "Share" button per panel where the browser can share image files
- [x] Pixel Art controls are a 2x2 grid
- [x] Card thumbnails `projects/03/images/0.webp` (pixel art), `1.webp` (colour ASCII), `2.webp` (CRT) re-rendered from the default F1 picture with the new effects, 1265x411 as before
- [x] Info page 03 updated, offline manifest regenerated
- Tested in headless Chrome: a settings link applies (fit, sample, effects, sliders, compare) and is removed from the address; settings survive a reload; Reset clears effects and Compare; whole-image fit and the compare divider draw correctly; about 500px wide layout wraps without overlap. NOT tested: dragging the divider by hand, Save all / Download / Share / Copy link clicks, real phone, Firefox/Safari
- Open question: `images/f1_pitstop.jpg` (now also on the main-page card) shows a real F1 team car with sponsor logos; rights not checked
