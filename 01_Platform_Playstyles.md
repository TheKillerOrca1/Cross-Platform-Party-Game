# Platform Playstyles

Each platform is a genuinely different way to play the same match — built on what its hardware is uniquely good at, not one control scheme with different buttons. All four platforms play **simultaneously in one shared space**, with no platform-segregated roles. Each platform should feel **powerful in its own way**, not ranked against the others. Difficulty/skill ceiling comes from *character/playstyle choice and skill expression*, not from which device you own.

> **Framing update (July 9, 2026 movement & combat session):** this doc previously framed each platform as a choice between "two selectable playstyles." That session replaced the frame with **one core movement/combat identity per platform**. How much selectable character/loadout variety exists *within* each identity is deliberately deferred (see Backlog) — the identities below are the locked layer.

## Signature Mobility Flourish

Every platform gets exactly **one signature movement flourish** that belongs to it alone:

| Platform | Signature Flourish |
|----------|--------------------|
| 🎮 Console | Slide / wall-run / vault — chainable parkour flow |
| 🥽 VR | Fling-climb — grab a wall, throw yourself upward |
| 📱 Mobile | Swipe-traced dash — draw the path, then fly it |
| 🖱️ PC | **Still open** — see PC section below |

Some *conceptual* overlap between platforms is fine (the platforms are inherently different enough), but each mechanic itself stays unique to its platform — e.g., VR deliberately does **not** get wall-running, because that is Console's signature move.

---

## 🎮 Console — "Parkour Combat"

**Core identity:** flowing, chainable parkour movement with run-and-gun combat. The analog stick's smooth continuous input becomes momentum-driven traversal that feels great in the hands and is expressive without being punishing.

### Movement
- **Reference point: Apex Legends' movement feel — explicitly NOT Titanfall 2's.** Titanfall 2's movement skill ceiling was too punishing for casual players and hurt its longevity; we want flow and expression *without that cliff*. Apex's more forgiving take on the same lineage is the target.
- **Core verbs: slide, wall-run, vault** — all chainable into each other (slide out of a wall-run, vault out of a slide, etc.).
- **Momentum degrades gradually** when movement stops, rather than hard-resetting. Dropping the chain costs you speed slowly — forgiving flow, not a fragile combo meter.

### Combat
- **Combat is possible while moving — run-and-gun is the intended fun.**
- **Accuracy is reduced while sliding, wall-running, or mid-vault** compared to standing still. This is a deliberate mobility/precision trade-off: moving fast keeps you alive and repositions you, planting your feet rewards precision. (Note the likely contrast with PC, which may keep full accuracy during traversal — see PC section.)

### Dependencies & Deferred
- **Hard dependency on map design**: parkour combat only works if the map provides rails, vaultable terrain, and runnable walls. Flagged for the upcoming dedicated map design session (see Cross-Platform & Map section below).
- **Character/loadout specifics are explicitly deferred** — this session locked the movement/combat identity only.

---

## 🥽 VR — "Physical Presence"

**Core identity:** full 3D embodiment — dodging, aiming, and physical gestures feel like your actual body acting in the world, not a joystick abstraction. Physicality is spent on *moments*, not sustained strain.

### Locomotion
- **Joystick-based locomotion confirmed** — not room-scale-only, not teleport.
- **Fatigue-reduction design principle:** normal combat should **rarely require raising both arms overhead**. Occasional raised-arm moments are fine (and can even be dramatic highlights), but they must not be the constant default. This is grounded in gorilla-arm-syndrome research: sustained arm elevation is the primary driver of VR arm fatigue.

### Fling-Climb (VR's signature flourish)
- Climbing is reimagined as a **"fling"**: grab a wall at around **chest height**, **throw your arms downward and release** to launch yourself upward/forward.
- Replaces repeated hand-over-hand climbing — one explosive, satisfying gesture instead of sustained exertion. **Deliberately easier than climbing an equivalent real wall by hand.**
- VR is **deliberately NOT getting wall-running** — that's Console's signature move. Fling-climb is VR's own distinct flourish.

### Ranged Combat — The Wand & Mana Reload
- The wand is reimagined as a **two-handed, gun-like fantasy weapon** — thicker and visually substantial, aimed with both hands (which also keeps arms low and braced, serving the fatigue principle).
- **Ammunition is "mana"**, with a tactile reload ritual:
  1. **Eject** the depleted mana cell via a button on the wand-hand
  2. **Retrieve** a fresh cell from a side pouch
  3. **Slap it in**
  4. A **second physical motion to channel/charge** the weapon before it's ready to fire
- **This reload-ritual pattern generalizes:** every magic item type should have its own unique priming/reload gesture — not just the wand. The ritual *is* part of each weapon's identity.
- **Important distinction:** mana-reload is **NOT** the earlier-rejected "fatigue meter" idea. Mana is a normal gameplay resource (like ammunition) — it has nothing to do with simulating physical tiredness.

### Melee & Weapon Kit — Open
- Sword handling and other weapon-kit specifics are **explicitly NOT decided**: dual-wield vs. greatsword, throw-and-recall, deflecting projectiles, etc. These live as a running idea list in the Backlog — do not treat any of them as settled.

---

## 🖱️ PC — "Precision & Damage" (Assassin/Damage Archetype)

**Core identity:** high-precision mouse aim and full-keyboard input versatility, expressed as burst damage and skillful positioning. *(Identity unchanged this session; a movement reference point was added, below.)*

### Movement — Reference Point Only (⚠️ still open, not locked)
- **Reference: The Finals' movement feel** — sprint, slide, ledge mantle/climb, and crucially: **aim/ADS precision maintained even while performing movement tech**.
- **Likely contrast with Console:** PC may keep *full accuracy during traversal*, earning its mobility through skillful routing rather than raw speed — where Console trades accuracy for speed. (This contrast is attractive but not confirmed.)
- **Wall jump under consideration** — explicitly NOT a wall-run (Console's), and NOT an infinite return-to-the-same-wall like Mobile's wall-swoop. A PC wall jump would require a **second, facing wall** to bounce between.
- **A grapple is under consideration.**
- **All of the above is tentative.** PC's movement kit — including its signature mobility flourish — stays open in the Backlog, pending more discussion once the other platforms can be *felt in-build*.

### Design Notes
- PC's advantage = precision + input versatility, expressed as damage/skill-expression rather than raw survivability.
- PC's existing prototype "mouse-aimed attack" is a **fantasy ranged weapon, not a gun** — see Universal Combat Rules below.

---

## 📱 Mobile — "Direct Control + Gesture Movement"

**Core identity:** full, manual, direct control of one character via dual virtual sticks, plus a unique gesture layer where the player *draws* their movement. The touchscreen's unique strength is expressed through free-form shape tracing — something no stick or mouse replicates.

> **Supersedes prior concepts:** this **entirely replaces** the earlier "Swarm Command" tap-to-direct-minions concept **and** the "Swappable Squad" option. Direct character control was chosen because indirect unit-commanding felt less intense/immersive than what the other three platforms deliver.

### Dual Virtual Sticks
- **Left stick: movement. Right stick: aim/camera.** Fully manual — no auto-aim-and-release schemes, no indirect command layer.

### The Gesture Zone
- A **dedicated gesture zone sits above the sticks** — visible but **see-through/transparent**, so it never blocks the player's view of the game world while still being visually locatable.
- The player **drags a free-form shape** in this zone to perform movement tech.

### Shape-Traced Dash (Mobile's signature flourish)
*(Placeholder name: "momentum pad" / "inertia pad" — neither is final; real name needed, see Backlog.)*

- **Where the drag STARTS determines the move type:**
  - Start **low**, drag **up** → **jump-dash**
  - Start **high**, drag **straight down** → **slide-dash (forward)**
  - **Tolerance is built in** for imprecise starting points — this must not feel like hitting a tiny button.
- **A pure downward swipe is NOT a backward dash — it is a forward slide.** To move backward, the player must **trace a curve**: start slightly up, swoop around to either the left or right side, and end at the bottom.
  - This is intentional: **simple straight inputs stay easy and safe; curved inputs unlock the fuller move set** (including backward movement). Skill expression comes from input fluency, which naturally separates casual and skilled play **without a difficulty toggle**.
- **The traced shape becomes the in-world path of the dash**, smoothed into a clean swooping arc — like a gust of magic wind carried the character through the drawn shape — rather than a literal jittery copy of the raw finger trace.
- **Recorded-then-executed, NOT live:** the full gesture is drawn, the finger releases, and *only then* does the dash play out as one motion.
  - The **camera orientation used to resolve the shape is locked to whatever the camera faced at the START of the gesture** — it is not updated if the camera moves mid-drag.
  - Why this matters: a player can trace a dash, release, and **immediately move their thumb back to the aim-stick to track a target while the dash animates**. Draw, release, fight.

### Wall-Swoop (separate gesture)
- **Swipe up-toward-a-nearby-wall, then away** → triggers a push-off **"swoop"** off that wall. A momentary push-off, **not a sustained run**.
- Potentially **chainable 2–3 times**, pending balance testing.
- Distinct from Console's wall-run (sustained) and VR's fling-climb (physical grab-and-throw).

### Status & Planned Work
- ⚠️ **The overall feel of this scheme has NOT been playtested on a real device yet.** The current browser build exists precisely to make that playtest possible — treat every tuning number as provisional until thumbs-on-glass testing happens.
- **Adjustable settings planned** (not needed for the first playable pass): joystick size/sensitivity and gesture-zone sensitivity, as accessibility/comfort options.

---

## Universal Combat Rules (All Platforms)

- **No platform uses literal firearms.** Every ranged weapon is a fantasy-reskinned equivalent — magic wands, staves, and the like. This includes PC's existing prototype "mouse-aimed attack," which should not be read as implying a literal gun. (See Art Direction doc for the weapon visual language.)
- **Every platform can carry/capture the Relic** — no platform is locked out of the core objective (see Gamemode doc).

---

## Cross-Platform & Map

- All four platforms play **simultaneously on one shared space** — there are no platform-segregated roles or platform-specific arenas.
- Each platform has (or will have) **one signature mobility flourish**: Console's slide/wall-run/vault chain, VR's fling-climb, Mobile's swipe-traced dash. PC's equivalent is still open.
- **Map/level design is now a hard dependency for Console, VR, and Mobile simultaneously, on one shared map**: runnable walls, rails, and vaultable terrain (Console) + fling-climbable walls (VR) + swoopable wall surfaces (Mobile) all have to coexist in the same spaces. This is the **next major design thread** — not yet started, and it deserves its own dedicated session.

---

## Platform Identity Summary Table

| Platform | Identity | Signature Mobility | Combat Feel |
|----------|----------|--------------------|-------------|
| 🎮 Console | Parkour Combat | Slide / wall-run / vault chain | Run-and-gun; accuracy reduced while in movement tech |
| 🥽 VR | Physical Presence | Fling-climb | Two-handed wand + tactile mana-reload rituals; melee kit TBD |
| 📱 Mobile | Direct Control + Gesture Movement | Swipe-traced dash (+ wall-swoop) | Fully manual dual-stick aim |
| 🖱️ PC | Precision & Damage | Open (wall jump / grapple under consideration) | High-precision aim; may keep full accuracy during traversal |

## Open Design Questions (Carried to Backlog)
- PC movement kit: The Finals-style reference, wall jump, grapple, full-accuracy-during-traversal contrast — all tentative; PC's signature flourish unchosen
- PC and Console character/loadout specifics (deferred this session)
- VR weapon-kit idea list: sword handling (dual-wield vs. greatsword), throw-and-recall, projectile deflection — running list, unresolved
- VR: per-item reload/priming ritual designs (pattern locked, individual gestures TBD)
- Mobile: real name for the gesture-dash mechanic ("momentum pad" / "inertia pad" are placeholders)
- Mobile: wall-swoop chain limit (2–3?) pending balance
- Mobile: firing input not specified by the design session (prototype uses a placeholder fire button)
- Mobile: joystick/gesture-zone size & sensitivity settings (planned, post-first-pass)
- Mobile: first real-device playtest of the whole scheme
- Map/level design session covering all three locked movement kits on one shared map
