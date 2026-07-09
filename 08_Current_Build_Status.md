# Current Build Status — Playable Prototype

*Last updated: July 9, 2026 (camera pitch + crosshair-accurate aiming + ADS; jump/sprint/climb; Drift Deck refinements; faster projectiles). This documents what is actually implemented and testable in the repo's game code right now — see `03_Technical_Roadmap.md` for where it's headed.*

## How to Run
```
npm start          # game server on http://localhost:3000
```
- Same Wi-Fi devices: `http://<PC-LAN-IP>:3000`
- Internet (friends): run `ngrok http 3000` and share the URL (ngrok is installed + authed on the dev PC; free-tier URLs change each time ngrok restarts, and visitors click through one "Visit Site" warning page)
- Editing `public/*` doesn't disrupt connected players (refresh picks it up); editing `server/index.js` requires a server restart, which disconnects everyone

## The Seven Playable Modes
All join from the same screen and share one match. Everyone picks a **team** (Red / Blue / Auto-balance) — teams spawn on opposite sides of the map, teammates can't hurt each other.

**📱 Mobile (dual-stick + Drift Deck) is the current mobile design direction** (per the July 9, 2026 session in `01_Platform_Playstyles.md`); the four older mobile modes are superseded experiments, kept joinable for side-by-side comparison.

| Mode | Camera | Controls | Extras |
|---|---|---|---|
| 🖱️ PC | First-person **(locked)** | WASD move, mouselook (+ look up/down), **click fire, hold RMB = ADS**, Space jump, Shift sprint, Esc menu | Crosshair |
| 🎮 Console | 1st/3rd toggle (default 3rd) | Left stick move, right stick aim (rate-based, yaw+pitch), RT/A fire, **LT = ADS**, Y = toggle perspective | Crosshair, "no controller" help text |
| 📱 **Mobile** | 1st/3rd toggle (default 3rd) | **Left stick move, right stick aim (hold = ADS, release = fire), draw in the Drift Deck to dash** (see below); on-screen 👁 button toggles perspective | Drift Deck, both sticks shown at rest, no minions |
| 📱 Squad *(old)* | Top-down (pulled back) | Left stick move, **right stick aim → release to fire** (Brawl-Stars style) | Ground aim reticle, 2 minions |
| 📱 Solo FPS *(old)* | First-person | Left stick move, **right stick push-to-turn → release to fire** (EXPERIMENTAL) | Crosshair, 2 minions |
| 📱 Solo TPS *(old)* | Third-person chase | Same as Solo FPS | Crosshair, 2 minions |
| 📱 Swarm Command *(old)* | Free top-down (pan/pinch-zoom) | **Tap = send swarm there**, drag = pan, pinch = zoom | 6 minions, no personal avatar |

**Reverting the experimental mobile turn-stick:** flip `MOBILE_TURN_SCHEME` to `'drag-look'` at the top of `public/client.js` — the old drag-to-look + tap-to-fire scheme is fully intact behind that flag.

### 📱 Mobile Drift Deck (how it works in this build)
Recorded-then-executed: draw a shape in the see-through **Drift Deck** (tucked beside the right/aim stick), release, and the dash plays back as one motion — the camera direction used to resolve the shape is **locked at the moment the gesture started**, so you can draw, release, and go right back to aiming while the dash flies. The Deck reads like a bird's-eye view: screen-up = the way you were facing at gesture start.
- **Mostly-vertical stroke going up** → jump-dash: forward leap arc (distance scales with stroke length). Even a wiggly stroke counts as forward.
- **Mostly-vertical stroke going down** → slide-dash: forward ground slide that **ducks you low** (squashed capsule + shorter, networked hitbox, so it slips under standing-height shots). Deliberately NOT backward — a downward S is still a forward slide.
- **Stroke that arcs out to a side** → free-form swoop: the traced shape (smoothed into a loose flowing spline) IS the flight path; swooping a curve around to a side and ending low is how you dash **backward**.
- **Sharp out-and-back "V"** → wall-swoop: if a wall lies within ~3.5u in the "out" direction, you get a push-off impulse along the "back" direction; chainable up to 3 before needing to touch ground (~first pass, unbalanced).
- The full dash path renders as a glowing world-space line during the dash, so you can compare "what I drew" vs "where I went".
- Dashes respect collision (walls block/deflect mid-flight; the whole arena is hard-clamped so a dash can't clip the border) and are height-networked — other players see your capsule arc through the air.

## Core Systems Now In
- **Aiming (all crosshair modes)**: shots travel in full 3D along the exact camera-center crosshair ray, so **what you aim at is what gets hit** — this fixed the old bug where shots landed below the reticle (they used to fly horizontally from the chest while the camera looked from a different height). You can **look up/down** (pitch) on PC/Console/Mobile.
- **Aim-down-sights (ADS)**: hold RMB (PC) / left trigger (Console) / the aim stick (Mobile) to zoom in, steady the look, and remove hip-fire spread — a real, visible accuracy gain. On Mobile the same hold also primes fire-on-release.
- **Perspective toggle**: Console and Mobile switch between first- and third-person (default **third**, so you can watch your own movement); PC is locked first-person this session.
- **Vertical movement**: gravity, jumping (PC: Space), standing on top of cover boxes, and **climbing/mantling** — walk into a wall/ledge within reach and you scale it. PC also has **sprint** (Shift) and a **pause menu** (Esc opens the ☰ menu).
- **Health & death**: 100 HP, server-authoritative. Player shots deal 10, minion zaps deal 2. Dying sends you back to the mode screen with a 3s countdown; respawning is a fresh connection at full health (side effect: new color from your team's palette).
- **Minions (the 4 legacy mobile modes only — the current Mobile mode has none)**: fully networked — visible to and shootable by everyone (20 HP, respawn near owner after 6s). They auto-target the nearest enemy player *or enemy minion* you're facing (Squad/FPS/TPS: within a ±40° cone, 18u range) or nearest to the swarm's center (Swarm). Ranged zap attack (6u range, 1/sec) — they fire while moving. Facing reticles show what each one is doing. Minions die with their owner.
- **Combat feel**: fast bolt-shaped projectiles (speed **48**, range **55** — bumped this session for a snappier "real gun" feel) that **pierce** players/minions (one damage tick per target) and stop only on walls/max range/ground. Height-aware now: you can arc a shot over low cover, and shots stop on a box only at its actual height. Red screen-edge **hit-marker** when your shot or your minions' zaps land.
- **Map**: 70×70 with a walled border and 10 original cover boxes **plus 9 tinted TEST blocks** (a staircase, a tall climbable wall, a raised platform, a facing-wall corridor, a low vault block) added to exercise parkour + climbing — temporary scratch terrain, not final map design. Movement slides along cover; you can stand on box tops. Spawn areas kept clear; no enclosed traps.
- **Health UI**: own HP as a **top-center** bar; everyone else gets a floating billboard bar (green → red when nearly dead).
- **In-game testing menu (☰, top-right; Esc on PC)**: switch between all modes without reloading, sensitivity slider (25–200%, affects mouse/touch/gamepad-aim), and a server-enforced "Test mode (can't die)" toggle.
- **Mobile landscape lock**: portrait devices get a rotate prompt overlay (CSS-based; `screen.orientation.lock` attempted where supported).
- **Character visual**: capsules now carry a little procedural gun showing facing.

## Known Simplifications / Deferred
- ⚠️ **Tuning is still first-pass** — the Drift Deck had one on-device playtest and got retuned (bigger throw, snappier cooldown, moved beside the aim stick), but dash feel, ADS zoom, sprint/jump/climb numbers, and projectile speed all still want thumbs-on-glass iteration.
- Mobile firing is now release-the-aim-stick (the separate fire button was removed). Whether that's the final firing input is still open in the backlog.
- Climb is a forgiving auto-mantle: walk into any ledge within reach (≤2.8u) and you scale it. It can trigger when you'd rather not (bumping a box while moving into it). Fine for testing; may want a dedicated input later.
- Wall-swoop is a deliberate first pass: nearby-wall check + impulse; chain limit (3) unbalanced.
- Third-person aim is approximate on the vertical axis (the orbit camera can't tilt as far as first-person without clipping the floor), but shots still follow the on-screen crosshair exactly, so accuracy holds.
- Hit detection is client-side (shooter-authoritative) — fine for friend playtests, not cheat-resistant. Projectiles are point-sampled per frame; at the new higher speed a grazing shot can occasionally skip a target (direct hits always register).
- Minions don't collide with obstacles (they glide through cover); their zap tracer beam is only drawn on the owner's screen.
- Respawn = new socket id → your color shifts within your team palette.
- Multi-squad Swarm control (2 independently commanded squads of 5) — future direction, single tap-to-move-all for now.
- CTF / objectives (`02_Gamemode_CTF.md`) — not started.
- VR — not started.
- Console robustness pass is best-effort: diagnostics logging, grace-period warning, alternate fire button. The reported phone-Bluetooth pairing failure is likely OS-level pairing, not game code.

## Balance Numbers (all first-pass, tune freely in `public/client.js` constants)
Player: 100 HP / 10 dmg. Minion: 20 HP / 2 dmg, 6u range, 1 zap/sec, 6s respawn. Squad size: 2 (support modes) / 6 (Swarm). Fire cooldown 250ms. Move speed 4 u/s (× 1.7 sprint on PC). Projectiles: 48 u/s, 55u range.

Vertical: gravity 20 u/s², jump 8 u/s (~1.6u apex), climb reach ≤2.8u (border walls at 3u stay unclimbable, so you can't scale out of the arena).

Drift Deck dashes: ~22 u/s along the path, 4–20u length (full-Deck-height stroke ≈ 13u), jump arc 2.4u high, free-form hop 1.0u, wall-swoop 4.5u at 1.4u high (3-chain max), cooldown 80ms. Slide-dash squashes the capsule to 0.5× height. All in the `MOBILE MODE (dual-stick + DRIFT DECK)` constants block.
