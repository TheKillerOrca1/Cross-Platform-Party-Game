# Demo Build Plan & Claude Code Prompts

## Goal
A rough, ugly-but-playable browser-based demo of the core CTF loop, testable with friends across PC, phone, and VR (Quest browser), with a stretch goal of also working on console web browsers (Xbox/PlayStation/Switch). Looks do not matter yet — feel and playstyle asymmetry do.

## Why Browser-Based
- Adam has zero engine experience (Unity/Unreal) — starting there first would mean learning a whole editor before writing a single line of gameplay logic
- Actual console development (Xbox/PlayStation/Switch native builds) requires official dev kits and certification — not accessible for a hobby project regardless of skill level
- Nearly every device already has a browser, including Quest (via WebXR) and console browsers — so a browser-based demo means friends just click a link, no installs, no app store approval
- This does NOT block a future "real" Unity game — this is purely to prove the core loop is fun before investing in a bigger build (see 03_Technical_Roadmap.md)

## Recommended Tech Stack
- **Three.js or Babylon.js** — 3D rendering in the browser (Babylon.js has slightly more built-in WebXR tooling, may be the easier pick)
- **WebXR** — lets the VR player use a Quest headset directly in the browser, no native app needed
- **Node.js + Socket.io** — real-time multiplayer server, keeps all players in sync
- **Deployment**: can run locally on Adam's PC for a first LAN playtest with friends physically present, or deployed to a free/cheap host (e.g., Vercel, Render, Glitch) later for remote friends

## Demo Scope (First Build)
One playstyle per platform — simplest version of each, not the full spec:

- **Mobile**: Squad Leader (Option A) — one strong unit + a couple of simple minions, controlled via tap/drag
- **VR**: Melee (Option A) — physical movement, grab/swing weapon, faster movement speed
- **PC**: A simple placeholder Assassin/Damage kit — mouse-aimed attack, one basic ability (exact final PC sub-variant is still TBD per 05_Open_Questions_Backlog.md — use a simple placeholder now, refine later)
- **Console**: A simple placeholder Fluid Support kit — joystick movement, one basic ally-buff ability (exact final Console sub-variant also still TBD — placeholder for now)
- **Gamemode**: One-Way Relic Capture (see 02_Gamemode_CTF.md) — one simple map, one extraction point (skip multiple extraction points/momentum meter complexity for v1; can be a simple timer-based round first, add the Momentum Meter once the core feel is validated)
- **Art**: Primitive shapes/placeholder blocks are fine — a colored capsule per platform archetype, a simple flat plane map. Do not invest in real art yet.

## Suggested Build Order
1. Get a basic multiplayer server running (players can join, see each other move) — no gameplay yet
2. Add PC movement + basic attack
3. Add Mobile touch controls (Squad Leader)
4. Add VR WebXR movement + melee
5. Add Console gamepad support + basic support ability
6. Add the Relic: pickup, drop-on-death, single extraction point, simple round timer win condition
7. Playtest with friends, take notes, come back to refine

## Prompt to Use in Claude Code (Step 1)

```
I'm building a rough browser-based multiplayer game prototype to playtest with friends. I have zero game development experience, so please explain things as you go and keep the code organized and well-commented.

Project: A cross-platform asymmetric multiplayer game. Players join from different devices (PC browser, phone browser, VR via Quest browser using WebXR, and console browsers) and each device type has a different simple playstyle, all playing together in one real-time match.

Tech stack: Node.js + Socket.io for the multiplayer server, Babylon.js for 3D rendering and WebXR support. Keep everything in a single repo I can run locally first.

Please start with Step 1 only: a bare-bones multiplayer server and client where multiple browser tabs can connect, each gets a simple colored capsule avatar, and I can see all connected players moving around a flat plane in real time using basic keyboard movement (WASD) as a placeholder for now. No gameplay mechanics yet — just prove that multiple devices can connect and see each other move smoothly.

Once that's working, I'll come back with the next step (adding platform-specific controls).
```

## Notes for Future Prompts
After Step 1 works, come back with a follow-up prompt for each build-order step above. Building it one step at a time — and confirming each step actually works before adding the next — will be much easier to debug as a beginner than asking for everything at once.

## Model Guidance
Use the default model (Sonnet 5 / Opus 4.8, whichever your plan defaults to) for step-by-step build tasks like this. Reserve Fable 5 for later, once wiring all 4 platforms + full gamemode logic together becomes one large, interconnected task — Fable uses your usage limits roughly 2x faster than Opus, so it's not worth it for small, well-scoped steps.
