# Current Build Status — Playable Prototype

*Last updated: July 9, 2026 (mobile dual-stick + gesture-dash controls added). This documents what is actually implemented and testable in the repo's game code right now — see `03_Technical_Roadmap.md` for where it's headed.*

## How to Run
```
npm start          # game server on http://localhost:3000
```
- Same Wi-Fi devices: `http://<PC-LAN-IP>:3000`
- Internet (friends): run `ngrok http 3000` and share the URL (ngrok is installed + authed on the dev PC; free-tier URLs change each time ngrok restarts, and visitors click through one "Visit Site" warning page)
- Editing `public/*` doesn't disrupt connected players (refresh picks it up); editing `server/index.js` requires a server restart, which disconnects everyone

## The Seven Playable Modes
All join from the same screen and share one match. Everyone picks a **team** (Red / Blue / Auto-balance) — teams spawn on opposite sides of the map, teammates can't hurt each other.

**📱 Mobile (dual-stick + gesture pad) is the current mobile design direction** (per the July 9, 2026 session in `01_Platform_Playstyles.md`); the four older mobile modes are superseded experiments, kept joinable for side-by-side comparison.

| Mode | Camera | Controls | Extras |
|---|---|---|---|
| 🖱️ PC | First-person | WASD + mouselook, click to fire | Crosshair |
| 🎮 Console | Third-person chase (Fortnite-style, follows aim) | Left stick move, right stick aim (smoothed), RT or A to fire | Crosshair, "no controller" help text |
| 📱 **Mobile** | Third-person chase | **Left stick move, right stick aim/turn, 🔥 button to fire (placeholder), draw shapes in the gesture pad to dash** (see below) | See-through dash pad, crosshair, no minions |
| 📱 Squad *(old)* | Top-down (pulled back) | Left stick move, **right stick aim → release to fire** (Brawl-Stars style) | Ground aim reticle, 2 minions |
| 📱 Solo FPS *(old)* | First-person | Left stick move, **right stick push-to-turn → release to fire** (EXPERIMENTAL) | Crosshair, 2 minions |
| 📱 Solo TPS *(old)* | Third-person chase | Same as Solo FPS | Crosshair, 2 minions |
| 📱 Swarm Command *(old)* | Free top-down (pan/pinch-zoom) | **Tap = send swarm there**, drag = pan, pinch = zoom | 6 minions, no personal avatar |

**Reverting the experimental mobile turn-stick:** flip `MOBILE_TURN_SCHEME` to `'drag-look'` at the top of `public/client.js` — the old drag-to-look + tap-to-fire scheme is fully intact behind that flag.

### 📱 Mobile gesture-dash (how it works in this build)
Recorded-then-executed: draw a shape in the transparent pad above the sticks, release, and the dash plays back as one motion — camera direction for resolving the shape is **locked at the moment the gesture started**, so you can draw, release, and go right back to aiming while the dash flies. The pad reads like a bird's-eye view: screen-up = the way you were facing at gesture start.
- **Straight up-stroke (start low)** → jump-dash: forward leap arc (distance scales with stroke length)
- **Straight down-stroke (start high)** → slide-dash: forward ground slide (deliberately NOT backward — per design)
- **Any curved stroke** → free-form swoop: the traced shape (smoothed) IS the flight path; curling around a side and ending at the bottom is how you dash backward
- **Sharp out-and-back "V"** → wall-swoop: if a wall lies within ~3.5u in the "out" direction, you get a push-off impulse along the "back" direction; chainable up to 3 before needing to touch ground (~first pass, unbalanced)
- The full dash path renders as a glowing world-space line during the dash (+0.6s), so you can compare "what I drew" vs "where I went"
- Dashes respect collision (walls block/deflect mid-flight) and are height-networked — other players see your capsule arc through the air (the `move` packet now carries `y`)

## Core Systems Now In
- **Health & death**: 100 HP, server-authoritative. Player shots deal 10, minion zaps deal 2. Dying sends you back to the mode screen with a 3s countdown; respawning is a fresh connection at full health (side effect: new color from your team's palette).
- **Minions (all 4 mobile modes)**: fully networked — visible to and shootable by everyone (20 HP, respawn near owner after 6s). They auto-target the nearest enemy player *or enemy minion* you're facing (Squad/FPS/TPS: within a ±40° cone, 18u range) or nearest to the swarm's center (Swarm). Ranged zap attack (6u range, 1/sec) — they fire while moving. Facing reticles show what each one is doing. Minions die with their owner.
- **Combat feel**: fast bolt-shaped projectiles (speed 25) that **pierce** players/minions (one damage tick per target) and stop only on walls/max range — this also fixed the old "shot stops on my screen but flies through on yours" desync. Red screen-edge **hit-marker** on your screen whenever your shot or your minions' zaps land.
- **Map**: 70×70 with a walled border (no more walking into the void) and 10 collision cover boxes (movement slides along them; projectiles stop on them). Spawn areas kept clear; no enclosed traps.
- **Health UI**: own HP as a bottom-left bar; everyone else gets a floating billboard bar (green → red when nearly dead).
- **In-game testing menu (☰, top-right)**: switch between all six modes without reloading, sensitivity slider (25–200%, affects mouse/touch/turn-stick/gamepad-aim), and a server-enforced "Test mode (can't die)" toggle.
- **Mobile landscape lock**: portrait devices get a rotate prompt overlay (CSS-based; `screen.orientation.lock` attempted where supported).
- **Character visual**: capsules now carry a little procedural gun showing facing.

## Known Simplifications / Deferred
- ⚠️ **The whole mobile gesture scheme is untested on a real phone** — every tuning number (pad size, stroke thresholds, dash speeds/heights) is a first guess pending thumbs-on-glass testing. That playtest is the next step and the reason this build exists.
- Mobile's fire button is a placeholder — the design session locked movement/aim but not the firing input (open in the backlog).
- Mobile aim stick is yaw-only (no pitch) — flat map, level projectiles; revisit when maps get verticality.
- Wall-swoop is a deliberate first pass: nearby-wall check + impulse; chain limit (3) unbalanced.
- Hit detection is client-side (shooter-authoritative) — fine for friend playtests, not cheat-resistant.
- Minions don't collide with obstacles (they glide through cover); their zap tracer beam is only drawn on the owner's screen.
- Respawn = new socket id → your color shifts within your team palette.
- Multi-squad Swarm control (2 independently commanded squads of 5) — future direction, single tap-to-move-all for now.
- CTF / objectives (`02_Gamemode_CTF.md`) — not started.
- VR — not started.
- Console robustness pass is best-effort: diagnostics logging, grace-period warning, alternate fire button. The reported phone-Bluetooth pairing failure is likely OS-level pairing, not game code.

## Balance Numbers (all first-pass, tune freely in `public/client.js` constants)
Player: 100 HP / 10 dmg. Minion: 20 HP / 2 dmg, 6u range, 1 zap/sec, 6s respawn. Squad size: 2 (support modes) / 6 (Swarm). Fire cooldown 250ms. Move speed 4 u/s.

Mobile dashes: ~14 u/s along the path, 3–13u length (full pad-height stroke ≈ 8u), jump arc 2.2u high, free-form hop 1.0u, wall-swoop 4.5u at 1.4u high, 3-chain max. All in the `MOBILE MODE (dual-stick + gesture pad)` constants block.
