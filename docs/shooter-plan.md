# 4v4 Low-Poly Shooter — Plan (projects/08)

Status: **planning only, no code written yet.**
Goal: a CS-1.x-style 4v4 shooter that runs entirely on GitHub Pages, in the browser, on desktop and mobile (landscape), with no backend of our own.

---

## 1. Requirements

### Functional
- 8 players max: 4 per team, plus bots to fill empty slots (host option).
- Three modes, chosen in the menu:
  1. **Team Deathmatch (TDM)**: respawns, kill limit and time limit.
  2. **Bomb Plant/Defuse**: attackers plant at site A or B, defenders defuse. No respawn within a round, buy phase with money, first to N rounds wins.
  3. **Free Area (bots)**: solo practice, no network, bot count and difficulty selectable.
- Two connection methods, chosen by the user in the lobby:
  - **A. Room code**: free public signaling service, 5-character code.
  - **B. Manual handshake**: copy/paste (or QR) offer and answer codes, no third party.
- One player's browser tab is the **host/server**. The other 7 connect to it.
- Desktop controls: pointer lock, WASD, mouse, 1-3 weapons, R reload, B buy, Tab scoreboard, E plant/defuse.
- Mobile: **landscape only**. In portrait show a full-screen "Rotate your phone" overlay and block play. Touch controls appear only when touch is detected.
- Look: stylized low-poly, matching the portfolio (palette, fonts, thick outlines, hard shadows).

### Non-functional
- Total game payload **under about 5 MB** (the site is already about 720 MB, and the GitHub Pages soft limit is about 1 GB). No big models, procedural or box geometry only.
- 60 fps target on mid-range phones: merged static geometry, no real-time shadows, capped pixel ratio, low-quality toggle.
- Everything static (map, weapons, assets, Three.js) is cached by the existing service worker. Only dynamic state travels over the network.
- Works offline for Free Area mode.

---

## 2. Architecture

```
            Option A: public signaling (room code)
 Joiner ───────────────► signaling service ◄─────────────── Host
   │                     (handshake only)                     │
   └────────────── WebRTC DataChannels (JSON) ────────────────┘
            Option B: copy/paste or QR (no service)

 Host tab  = authoritative simulation (sim.js) + bots (bots.js) + its own player
 Client tab = input sender + prediction + interpolation + renderer
```

- **Star topology**: host with 7 links, not a 28-link mesh.
- **Host is authoritative**: movement validation, hitscan, health, rounds, bomb, economy.
- If the host leaves, the match ends (no host migration in v1).
- Both signaling methods end in the same `RTCPeerConnection`, so `sim.js` and `game.js` don't know which was used.

### Channels per peer
| Channel | Mode | Carries |
|---|---|---|
| `fast` | unordered, `maxRetransmits: 0` | inputs (client to host), snapshots (host to client) |
| `rel` | ordered, reliable | hit/kill events, round state, buy, chat, bomb events |

### Message format (compact JSON, arrays instead of objects where possible)
```jsonc
// client → host, ~30 Hz
{"t":"in","seq":812,"mv":[0,1],"yaw":1.57,"pitch":-0.1,"fire":1,"jump":0}

// host → clients, ~20 Hz
{"t":"s","tick":4021,"p":[[id,x,y,z,yaw,pitch,hp,weapon,flags],...],"bomb":[x,y,z,state,t]}

// reliable events
{"t":"hit","by":3,"tgt":6,"dmg":27,"hs":1}
{"t":"kill","by":3,"tgt":6,"w":"rifle"}
{"t":"round","n":4,"phase":"buy","t":15,"score":[2,1]}
{"t":"buy","id":3,"item":"rifle"}
```
Round numbers to 2 decimals. Expected load is about 8 KB/s per client, and the host uploads about 50 KB/s.

### Feel
- Client-side prediction for the local player, reconciled by `seq`.
- Remote players interpolated about 100 ms in the past.
- Hitscan on the host. Optional lag compensation: keep about 200 ms of position history and rewind to the shooter's fire time.
- Tracers, muzzle flash and hit markers are local effects driven by events.

---

## 3. Connection methods

### A. Room code (public signaling)
1. Host clicks **Host, Room code**. The app registers a peer id and shows a 5-character code.
2. Joiner enters the code. Signaling exchanges offer/answer/ICE. DataChannels open.
3. Library: PeerJS cloud (or Trystero over public Nostr/MQTT relays). Pin the version and self-host the script if licensing allows, since the signaling service itself stays third-party.
4. STUN: free public servers. TURN is not included, so strict NATs may fail, and the UI must say so clearly.

### B. Manual handshake (serverless)
1. Host clicks **Add player** and gets an offer code (JSON then `CompressionStream` deflate then base64url), with a copy button and a QR code.
2. Joiner pastes or scans it and gets an answer code back.
3. Host pastes the answer. The slot turns green.
4. Repeat for each player (up to 7). The lobby shows 7 slots: empty, waiting, connected, ready, with ping.
5. Use `iceGatheringState === 'complete'` (non-trickle ICE) so a code is a single blob. Add a gathering timeout of about 4 s.
6. QR scanning uses `BarcodeDetector` where available. Paste is the fallback.

### Failure handling (both)
- Heartbeat every 2 s. After 6 s with no packet the player is marked disconnected, then replaced by a bot or removed.
- "Host left" screen returns everyone to the menu.
- Show the connection error and suggest the other method.

---

## 4. Game logic

### Shared rules (in `sim.js`, runs on host and in Free Area locally)
- Fixed tick 60 Hz internally, snapshots sent at 20 Hz.
- Player: capsule collider vs axis-aligned boxes from `map.json`, gravity, jump, crouch (optional).
- Weapons from `weapons.json`: damage, fire rate, magazine, reload time, spread, range, price, headshot multiplier. v1: pistol, rifle, shotgun.
- Hitscan: ray vs player capsules (head hit = multiplier) and map boxes (walls block).

### TDM
- Spawn at team spawn points, respawn after about 3 s with brief invulnerability.
- Ends at kill limit or time limit. Scoreboard shows kills, deaths and ping.

### Bomb mode
- Phases: `buy (15 s)` → `live (about 105 s)` → `end (5 s)`.
- Attackers get the bomb and plant it inside a site zone by holding E for about 3 s. The bomb timer is about 40 s. Defenders defuse by holding E for about 5 s.
- Round ends on: all of a team dead, bomb exploded, bomb defused, or time out (defenders win).
- Money: round win/loss, kills and plant/defuse bonuses, with a cap. The buy menu is only usable in the buy phase near spawn.
- First to N rounds (for example 8) wins, with sides swapped at halftime.

### Bots (`bots.js`, host only, or local in Free Area)
- Waypoint graph in `map.json`, line-of-sight checks, reaction delay and aim error scaled by difficulty.
- TDM: roam, engage, retreat when low HP.
- Bomb: attackers path to a site, plant and guard. Defenders hold sites and defuse.
- Bots are sent in snapshots like any other player.

### Mobile and rotation
- Orientation check on `resize` and `orientationchange`. Portrait shows the overlay and pauses the loop.
- Try `screen.orientation.lock('landscape')` after entering fullscreen (unsupported on iOS Safari, so the overlay remains the fallback).
- Touch layout: left virtual joystick (move), right-side drag (look), buttons for fire, jump, reload, switch, buy, plant/defuse. Multi-touch safe, with sensitivity and size settings saved.

---

## 5. File plan

```
projects/08/
  index.html       menu, lobby, HUD, rotate overlay, styles
  game.js          main loop, renderer (Three.js), input (kb/mouse + touch), HUD
  net.js           WebRTC, signaling A + B, snapshots, heartbeat
  sim.js           authoritative rules: movement, hitscan, rounds, bomb, economy
  bots.js          bot AI
  map.json         boxes, spawns, bomb sites, waypoints
  weapons.json     weapon table
  three.min.js     pinned local copy (no CDN)
  images/0.webp    card thumbnail (matches other projects)
```

---

## 6. What to CHANGE

| File | Change |
|---|---|
| `projects/08/*` | **New**, the whole game. |
| `site.json` | Add one object to `projects` (title, subtitle, tags, desc, `thumb`, `href: "projects/08/index.html"`, `color`, `sticker`). Same shape as the existing entries. |
| `tools/build_offline_manifest.py` | Add the game's light files to `CORE` (`projects/08/*.html`, `*.js`, `*.json`, `images/*`). Do not add `projects/08/*` blindly if anything big is ever added. Note: `expand()` raises if a pattern matches nothing, so create the files first. |
| `sw-manifest.js` | **Regenerate only** with `python tools/build_offline_manifest.py`. Never hand-edit (the header says so). |
| `projects/08/index.html` | Include `../../pixel-transition.js` and `../../site-nav.js` (with `data-home="../../index.html"`) like the other project pages. |

## 7. What NOT to change

- `index.html`, `page2.html`, `builder.html`, `offline.html`: the portfolio pages stay as they are. The card list is data-driven from `site.json`.
- `sw.js`: no logic changes needed, since the manifest already drives caching.
- `ambient.js`, `daily.js`, `miniplayer.js`, `collage-fun.js`, `offline.js`, `pixel-transition.js`, `site-nav.js`: reuse as is.
- Existing `projects/01` to `07`, `images_to_use/`, `popup_random_images/`, `functions_to_work.json`, `tiles.json`.
- `.nojekyll`: keep it, or Pages will process files with Jekyll.
- No new heavy assets: stay far under the size budget.

---

## 8. Build order and testing

1. **Free Area core**: renderer, map, movement, controls (desktop and touch), rotate overlay.
2. Weapons, hitscan, bots, HUD. Offline Free Area is now playable.
3. `net.js` with **option A**, host sim, TDM over the network, prediction and interpolation.
4. **Option B**: compressed codes, QR, lobby slot UI.
5. **Bomb mode**: economy, buy menu, plant/defuse, rounds, halftime.
6. Polish: quality toggle, settings persistence, offline cache entries, site card, thumbnail.

Testing I can do locally: several browser tabs on one machine, and DevTools mobile emulation for touch and landscape. Testing that needs you: real phones, real networks across NATs, and the public signaling service's uptime.

## 9. Known limits and risks

- Strict or corporate NATs need TURN, which is not included. Show a clear error.
- The public signaling service (option A) is third-party and can go down. Option B is the fallback.
- A cheating host is possible because the host is authoritative. This is acceptable for friends-only play.
- Mobile browsers throttle background tabs, so hosting from a phone is fragile. Recommend a PC host and use the Wake Lock API.
- No host migration in v1.
- iOS Safari ignores the orientation lock, so the rotate overlay is required.
