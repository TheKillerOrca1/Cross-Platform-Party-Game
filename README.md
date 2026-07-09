# Cross-Platform Party Game

A prototype for a cross-platform asymmetric multiplayer party game: PC, console, and mobile players join the same match and each get a genuinely different but balanced role, built around what their device does best (mouse precision, joystick fluidity, touchscreen taps).

## The Seven Playable Modes
Everyone joins from the same screen, picks a team (Red / Blue / Auto-balance), and plays together in one match:

- 🖱️ **PC** — first-person, WASD + mouselook (look up/down, hold RMB to aim, Space jump, Shift sprint)
- 🎮 **Console** — dual-stick, rate-based aim, aim-down-sights on the trigger; toggles first/third person (default third)
- 📱 **Mobile** — dual virtual sticks + the see-through **Drift Deck**: draw a shape by the aim stick, release, and dash along it; hold-aim-to-ADS, release-to-fire (**the current mobile design direction** — see `01_Platform_Playstyles.md`)
- 📱 **Squad** *(old experiment)* — top-down, Brawl-Stars-style aim-and-release, commands 2 minions
- 📱 **Solo FPS** *(old experiment)* — first-person, push-to-turn joystick controls, commands 2 minions
- 📱 **Solo TPS** *(old experiment)* — third-person chase version of Solo FPS
- 📱 **Swarm Command** *(old experiment)* — free top-down pan/zoom, tap-to-move a swarm of 6 minions (no personal avatar)

## Running It Locally
```
npm start          # game server on http://localhost:3000
```
- Devices on the same Wi-Fi can join at `http://<PC-LAN-IP>:3000`
- To let remote friends play, expose the server with `ngrok http 3000` and share the ngrok URL

## More Details
For the full rundown of what's implemented — controls, camera behavior, minion AI, balance numbers, and known simplifications — see [`08_Current_Build_Status.md`](08_Current_Build_Status.md).

Design docs (vision, gamemode rules, art direction, roadmap) live in the numbered `0X_*.md` files at the repo root.
