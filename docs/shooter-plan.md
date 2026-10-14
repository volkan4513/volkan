# 4v4 Low-Poly Shooter — Low-Poly Strike (projects/08)

Status: **built.** All 6 build phases are done. Section 8 lists what is tested and what is not, and section 9 lists the known issues.
Goal: a CS-1.x-style 4v4 shooter that runs entirely on GitHub Pages, in the browser, on desktop and mobile (landscape), with no backend of our own.

---

## 1. Requirements

### Functional
- 8 players max: 4 per team, plus bots to fill empty slots (host option, on by default).
- Three modes, chosen in the menu:
  1. **Team Deathmatch (TDM)**: 3 s respawn with a 1.5 s spawn shield, kill limit and time limit (host picks; defaults 20 kills / 600 s). Infinite reserve ammo.
  2. **Bomb Plant/Defuse**: attackers plant at site A or B, defenders defuse. No respawn within a round, buy phase with money, first to 4, 6 or 8 rounds wins (default 6), halftime side swap.
  3. **Free Area (bots)**: solo practice, no network, bot count and difficulty selectable.
- Two connection methods, chosen by the user in the lobby:
  - **A. Room code**: PeerJS cloud signaling, 5-character code.
  - **B. Manual handshake**: copy/paste (or QR) offer and answer codes, no signaling service.
- One player's browser tab is the **host/server**. The other 7 connect to it.
- Desktop controls: pointer lock, WASD, mouse, Space jump, **C crouch**, Shift walk, 1-3 weapons, Q last weapon, R reload, B buy, Tab scoreboard, E plant/defuse.
- Mobile: **landscape only**. In portrait a full-screen "Rotate your phone" overlay blocks play. Touch controls appear the first time a finger touches the screen.
- Look: stylized low-poly, matching the portfolio (palette, fonts, thick outlines, hard shadows).

### Non-functional
- Game payload is about **1.1 MB** (Three.js 656 KB, PeerJS 92 KB, QR 56 KB, thumbnail 52 KB, the rest is our code and data). The budget was 5 MB.
- 60 fps target on mid-range phones: merged static geometry, no real-time shadows, pixel ratio capped at 1.5, and a low-quality toggle (pixel ratio 0.7).
- Every static file is cached by the existing service worker. Only dynamic state travels over the network.
- Free Area works offline.

---

## 2. Architecture

```
            Option A: PeerJS cloud signaling (room code)
 Joiner ───────────────► signaling service ◄─────────────── Host
   │                     (handshake only)                     │
   └────────────── WebRTC DataChannels (JSON) ────────────────┘
            Option B: copy/paste or QR (no service)

 Host tab   = authoritative simulation (sim.js) + bots (bots.js) + its own player
 Client tab = input sender + prediction + interpolation + renderer
```

- **Star topology**: host with up to 7 links.
- **Host is authoritative**: movement, hitscan, health, rounds, bomb, economy.
- If the host leaves, the match ends ("Host left" screen). No host migration.
- Both signaling methods end in the same `Link` object (`net.js`), so `sim.js` and `game.js` don't know which was used.

### Channels per peer
| Channel | Mode | Carries |
|---|---|---|
| `fast` | unordered, `maxRetransmits: 0` | inputs (client to host, about 30 Hz), snapshots (host to client, 20 Hz) |
| `rel` | ordered, reliable | hello/welcome, lobby, roster, start, events, buy, team switch, heartbeat, bye |

The joiner opens `fast` once `rel` is up. If `fast` never opens, everything falls back to `rel`, which only costs latency.

### Message format (compact JSON, arrays instead of objects)
```jsonc
// client → host on fast: the last few unacked inputs ride in every packet,
// so a lost packet costs nothing. [seq, mx, mz, bits, yaw, pitch, slot]
// bits = jump|crouch|walk|fire|reload|use
{"t":"in","c":[[812,0,1,9,1.571,-0.1,1], ...]}

// host → each client on fast, 20 Hz
{"t":"s","k":4021,"tm":67.017,"sc":[2,1],
 "p":[[id,x,y,z,yaw,pitch,hp,slot,flags,kills,deaths], ...],   // flags = alive|crouch|reload|shield|ground
 "rd":[phase,n,timeLeft,attIsCt],                                // bomb mode only
 "bm":[state,x,y,z,site,fuseLeft,carrier,defuseFrac],            // bomb mode only, when a bomb exists
 ...}  // plus a per-client block: ack seq, own position/velocity, timers, money, ammo

// host → clients on rel
{"t":"ev","e":[{"t":"shot",...},{"t":"hit",...},{"t":"kill",...},{"t":"round",...},
               {"t":"plant",...},{"t":"defuse",...},{"t":"explode",...},{"t":"spawn",...},{"t":"over",...}]}
{"t":"lobby",...} {"t":"roster","r":[...]} {"t":"start","you":3,"rules":{...},"r":[...]}

// client → host on rel
{"t":"hello","name":"..."} {"t":"buy","item":"rifle"} {"t":"team"} {"t":"bye"}
```
Positions are rounded to 2 decimals (3 for the client's own state and angles).

### Feel
- Client-side prediction for the local player, reconciled by input `seq`.
- Remote players interpolated 100 ms in the past. A jump over 6 m (respawn) snaps instead of sliding.
- Hitscan on the host. **No lag compensation** (see section 9).
- Tracers, muzzle flash and hit markers are local effects driven by events.

### Host input queue
One client input per host tick (60 Hz). Short gaps repeat the last input. A long gap (tab hidden, link stalled) stops movement and fire. Bursts over 8 queued inputs are trimmed to the newest 3.

---

## 3. Connection methods

### A. Room code (PeerJS)
1. Host clicks **Host, Room code**. The app registers the peer id `lpstrike-<CODE>` and shows the 5-character code (no I, L, O, 0, 1).
2. Joiner enters the code. PeerJS exchanges offer/answer/ICE. DataChannels open.
3. Library: **PeerJS 1.5.4 (MIT)**, local copy `peerjs.min.js`, loaded on demand. The signaling server is PeerJS cloud (third-party), which also hands out its own free TURN servers, so strict NATs have a fallback.
4. If signaling does not answer within 10 s, the UI says so.

### B. Manual handshake (serverless)
1. Host clicks **Add player** (`manualOffer`) and gets an offer code: JSON, then `CompressionStream('deflate-raw')`, then base64url (prefix `z`; prefix `p` = plain JSON when `CompressionStream` is missing). Copy button and QR code (`qrcode.js`).
2. Joiner pastes or scans it (`manualAnswer`) and gets an answer code back.
3. Host pastes the answer. The slot connects.
4. Repeat for each player (up to 7).
5. Non-trickle ICE: wait for gathering to finish, with a 4 s timeout, so a code is one blob. STUN: Google public servers only, no TURN.
6. QR scanning uses `BarcodeDetector` with the camera where available. Paste is the fallback.

### Failure handling (both)
- Heartbeat every 2 s. After 6 s with no packet the link closes. A lost client is replaced by a bot (when bot fill is on) or removed.
- "Host left" screen returns everyone to the menu.
- Errors are shown and suggest the other method.

### Test knobs
`?lag=120` delays everything this tab sends by 120 ms. `?loss=5` drops 5% of `fast` packets. DevTools throttling does not affect WebRTC, so use these.

### Debug hook
`window.__lps` exposes `role`, `world`, `me`, `lobby`, `peers`, and a settable `fire` (used by headless tests, where pointer lock does not work).

---

## 4. Game logic

### Shared rules (`sim.js`, no DOM, runs on host and in Free Area)
- Fixed tick 60 Hz, snapshots at 20 Hz.
- Player: box collider vs axis-aligned boxes from `map.json`, gravity, jump, step-up, crouch (C), walk (Shift).
- Weapons from `weapons.json`: damage, headshot multiplier, pellets, fire rate, auto, magazine, reserve, reload time, spread, move spread, range, price, slot.
  | Weapon | Slot | Price | Damage | Notes |
  |---|---|---|---|---|
  | Pistol | 2 | free | 26 | semi-auto, 12 rounds |
  | Rifle | 1 | $2700 | 34 | auto, 30 rounds |
  | Shotgun | 1 | $1200 | 14 × 9 pellets | 7 rounds, range 25 m |
- Hitscan: ray vs player boxes (head hit = multiplier) and map boxes (walls block).
- Key exports: `stepWorld`, `startRound`, `buyItem`, `actKind`, `effectiveInput`, `castRay`.

### Teams
- Squads keep their colour for the whole match. `world.att` says which squad attacks. Halftime flips `world.att`; it does not recolour anyone.

### TDM
- Spawn at team spawn points, respawn after 3 s with a 1.5 s spawn shield.
- Ends at kill limit or time limit. Scoreboard shows kills, deaths and ping.

### Bomb mode
- Phases: `buy (15 s)` → `live (105 s)` → `end (5 s)`. **Players are frozen during the buy phase** (`effectiveInput`).
- Attackers get the bomb and plant it inside a site zone by holding E for 3 s. The fuse is 40 s. Defenders defuse by holding E for 5 s within 2.2 m. A dropped bomb can be picked up.
- Round ends on: all of a team dead, bomb exploded, bomb defused, or time out (defenders win).
- Money (`ECON`): start $1600, win $3000, loss $1400 + $500 per extra loss in a row (up to 4), kill $300, plant $300, defuse $300, cap $9000. Buy menu (B, or the touch Buy button) only in the buy phase.
- First to N rounds (4, 6 or 8) wins. Halftime after N − 1 rounds: sides swap, money and loss streaks reset.

### Bots (`bots.js`, host only, or local in Free Area)
- Waypoint graph from `map.json` with A* paths, line-of-sight checks, reaction delay and aim error scaled by difficulty.
- TDM: roam, engage, retreat when low HP.
- Bomb: attackers path to a site, plant and guard. Defenders hold sites and defuse. Bots auto-buy.
- Bots are sent in snapshots like any other player.

### Mobile and rotation
- Orientation check on `resize` and `orientationchange`. Portrait shows the overlay and pauses.
- `screen.orientation.lock('landscape')` after entering fullscreen (unsupported on iOS Safari, so the overlay stays the fallback).
- Wake Lock API keeps the screen on during a match.
- Touch layout: left virtual joystick (move), right-side drag (look), buttons for fire, jump, crouch (toggle), reload, switch, scoreboard (toggle), pause, Buy and Use (plant/defuse).

---

## 5. Files

```
projects/08/
  index.html           menu, lobby, HUD, buy menu, rotate overlay, styles
  game.js              main loop, renderer, input (kb/mouse + touch), HUD, lobby, host/client glue
  net.js               WebRTC links, room code (PeerJS) + manual handshake, wire format, input queue, interpolation
  sim.js               authoritative rules: movement, hitscan, rounds, bomb, economy
  bots.js              bot AI
  models.js            low-poly player and weapon models
  map.json             boxes, spawns, bomb sites, waypoints
  weapons.json         weapon table
  three.module.min.js  pinned local copy of Three.js (no CDN)
  peerjs.min.js        PeerJS 1.5.4, local copy
  qrcode.js            QR code generator for manual handshake codes
  images/0.webp        card thumbnail
```

---

## 6. Changes outside projects/08

| File | Change |
|---|---|
| `site.json` | One new `projects` entry (`href: "projects/08/index.html"`, `thumb: "projects/08/images/0.webp"`, colour red, sticker "Play it!"). |
| `tools/build_offline_manifest.py` | `CORE` gets `projects/08/index.html`, `projects/08/*.js`, `projects/08/*.json`, `projects/08/images/0.webp`. `expand()` raises if a pattern matches nothing. |
| `sw-manifest.js` | **Regenerated only** with `python tools/build_offline_manifest.py`. Never hand-edit. |
| `projects/08/index.html` | Includes `../../pixel-transition.js` and `../../site-nav.js` (with `data-home="../../index.html"`) like the other project pages. |

## 7. What NOT to change

- `index.html`, `page2.html`, `builder.html`, `offline.html`: the card list is data-driven from `site.json`.
- `sw.js`: the manifest drives caching.
- `ambient.js`, `daily.js`, `miniplayer.js`, `collage-fun.js`, `offline.js`, `pixel-transition.js`, `site-nav.js`: reuse as is.
- Existing `projects/01` to `07`, `images_to_use/`, `popup_random_images/`, `functions_to_work.json`, `tiles.json`.
- `.nojekyll`: keep it, or Pages will process files with Jekyll.

---

## 8. Build order and testing

All six phases are done:
1. Free Area core: renderer, map, movement, controls (desktop and touch), rotate overlay.
2. Weapons, hitscan, bots, HUD.
3. `net.js` option A, host sim, TDM over the network, prediction and interpolation.
4. Option B: compressed codes, QR, lobby slot UI.
5. Bomb mode: economy, buy menu, plant/defuse, rounds, halftime.
6. Polish: quality toggle, settings persistence, offline cache entries, site card, thumbnail.

### How to test locally
- Dev server from the repo root: `python -m http.server 8765 --bind 127.0.0.1`. Stop it by port (`Get-NetTCPConnection -LocalPort 8765`, then `Stop-Process` that PID). Never kill every `python.exe`.
- Headless Chrome over CDP from a Node 22 script (global `WebSocket`). Flags: `--headless=new --remote-debugging-port=9333 --use-angle=swiftshader --enable-unsafe-swiftshader`.
- Open pages with `Target.createTarget` and `newWindow: true`, because a hidden page is throttled.
- Pointer lock does not work headless. Drive keys with `Input.dispatchKeyEvent` and fire with `__lps.fire = true`.

### Tested
- Room-code host + client, including with `?lag` and `?loss`.
- Manual handshake with QR.
- A bomb round with plant and defuse over the network.
- A bots-only bomb match in Node.

### Not tested yet
- Real phone on mobile data.
- QR camera scan.
- Touch Use and Buy buttons.
- Networked halftime.
- Full networked bomb match with bots.
- Offline cold load from the cache.

## 9. Known limits and issues

- The host input queue trims to 3 when more than 8 inputs pile up, so lag spikes can drop client inputs.
- A hidden host tab gets bursty inputs (the browser throttles timers). Host from a visible PC tab.
- No lag compensation on hitscan: high-ping clients must lead targets.
- Manual handshake has STUN only, so strict NATs can fail. The room-code path has PeerJS's TURN.
- PeerJS cloud signaling is third-party and can go down. Manual handshake is the fallback.
- A cheating host is possible because the host is authoritative. Fine for friends-only play.
- No host migration.
- iOS Safari ignores the orientation lock, so the rotate overlay is required.
