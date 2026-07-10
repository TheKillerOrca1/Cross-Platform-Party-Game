# Open Questions & Backlog

A running list of unresolved design questions and future-scope ideas, organized by category. Use this doc to track what still needs deciding. Items resolved by a design session move to the Resolved log at the bottom (with their outcome) so decisions aren't silently lost.

## Platform Playstyles — Movement & Combat
*(Identities locked July 9, 2026 — see `01_Platform_Playstyles.md`. These are the follow-ups.)*

- [ ] **PC movement kit** — everything is tentative, pending more discussion once the other platforms can be felt in-build:
  - Reference point is The Finals (sprint, slide, ledge mantle/climb, aim precision maintained during movement tech)
  - Likely contrast with Console: PC keeps *full accuracy during traversal*, earning mobility through skillful routing rather than raw speed — attractive, not confirmed
  - Wall jump under consideration (requires a second, facing wall — NOT a wall-run, NOT infinite same-wall returns like Mobile's wall-swoop)
  - Grapple under consideration
  - PC's **signature mobility flourish** is unchosen — the other three platforms each have one
- [ ] **Console: character/loadout specifics** — explicitly deferred; only the Parkour Combat movement/combat identity is locked
- [ ] **PC: character/loadout specifics** — the Precision & Damage archetype's concrete kit(s) remain TBD
- [ ] **VR weapon-kit idea list** (running list — deliberately NOT resolved yet):
  - Sword handling: dual-wield vs. greatsword?
  - Throw-and-recall weapons?
  - Deflecting projectiles with melee?
- [ ] **VR: per-item reload/priming rituals** — the pattern (unique tactile gesture per magic item type) is locked; the individual gestures for each future item are TBD
- [ ] **Mobile: wall-swoop chain limit** — chainable 2–3 times? Pending balance testing
- [ ] **Mobile: firing input** — the build now fires on **releasing the aim stick** (the ADS aim-and-release pattern; the separate fire button was removed). Confirm this is the final firing input on-device, or whether a dedicated fire control feels better
- [ ] **Mobile: control comfort settings** — joystick size/sensitivity and Drift Deck sensitivity as accessibility/comfort options. Planned, not yet built
- [ ] **Mobile: continued on-device tuning** — the first phone playtest happened and drove a round of changes (bigger dash throw, snappier cooldown, Drift Deck moved beside the aim stick, sticks shown at rest, health bar to top-center). Dash feel and all the new tuning numbers still want more thumbs-on-glass iteration
- [ ] **First- vs third-person perspective** — now an ACTIVE experiment in the build: Console and Mobile can toggle between first- and third-person and **default to third** (so players can watch their own slide/dash/climb animations), while **PC is locked first-person**. Open question: is default-third right for Console/Mobile long-term, should PC stay locked, and does VR (untouched) need its own stance?
- [ ] **ADS (aim-down-sights) — newly implemented as a universal mechanic** (hold to zoom + steady + remove hip-fire spread: RMB on PC, left trigger on Console, hold-the-aim-stick on Mobile). Open: exact zoom amount, spread values, whether every platform/weapon should have it, and how it interacts with VR's two-handed wand later
- [ ] **PC jump / sprint / climb are in the prototype** as general movement (Space/Shift + auto-mantle). These are placeholder feel, not the decided PC kit — fold into the PC-movement-kit decision above
- [ ] **How much selectable character/playstyle variety exists within each platform identity?** The old "two selectable playstyles per platform" frame was retired July 9, 2026; what replaces it (characters? loadouts? nothing at first?) is open
- [ ] Balance testing: with difficulty tied to character choice rather than platform, does this hold up in actual play, or does one platform still end up feeling stronger?
- [ ] Wall-tag proportions for Console run-face vs PC wall-jump-pair, informed by the new map's N-S wall lanes

## Map & Level Design ⚠️ next major design thread
- [ ] **Dedicated map design session — not yet started.** Now a hard dependency for three platforms simultaneously, on one shared map:
  - Console needs rails, vaultable terrain, and runnable walls (parkour combat dies on a flat map)
  - VR needs fling-climbable walls
  - Mobile needs wall surfaces worth swooping off
  - All of it must coexist in the same shared spaces and stay readable at a glance on every platform (see Art Direction doc)
- [ ] Movement-affordance visual language (which surfaces are runnable/climbable/swoopable) — pending the same session

## Gamemode (CTF)
- [ ] Exact attacker spawn/entry mechanic — fixed choice of entry points, or deploy-anywhere-in-a-zone?
- [ ] Exact fill/drain mechanics for the "Attacker Momentum" meter (defender win condition) — what specifically fills it, how fast, and how is it displayed to players?
- [ ] Relic passing mechanic details — targeted throw? auto-pass to nearest ally? cooldown or range limit?
- [ ] Are extraction points always visible to defenders, or dynamically revealed/hidden?
- [ ] Confirm final round length: 5, 6, or 8 minutes? (6 min is current lean, needs playtesting)
- [ ] Relic-as-ball throw/kick mechanic — distance, cooldown, mid-flight interception rules (see 02_Gamemode_CTF.md)

## Art Direction
- [ ] Finalize specific color palette (hex references)
- [ ] Brainstorm and shortlist actual Relic skin concepts (potato, cursed sandwich, rubber chicken, etc.)
- [ ] Concept art pass for one representative character per platform archetype
- [ ] World/environment/map biome art direction — not yet discussed at all
- [ ] Fantasy weapon visual language ("gun-like handling, magical object" — VR's two-handed wand first)

## Future Platforms (Post-Launch Scope)
- [ ] **Web-only Spectator Mode** — a castable-to-TV broadcast view of ongoing matches, good for social hype/future streaming potential. Locked as a good idea, but explicitly deferred until core 4 platforms are playable.
- [ ] **Nintendo Switch 2** as a potential future 5th platform — deferred until the core game is proven fun
- [ ] Possible future differentiation within existing platform categories (e.g., tablet vs. phone, or different console brands) — explicitly deferred for now, core 4 platforms treated as unified categories at launch

## Future Gamemodes (Beyond Launch CTF)
- [ ] Free-for-all (FFA) mode
- [ ] "Boss vs. everyone" mode (one player as a powerful boss, rest as attackers)
- [ ] Co-op mode (all players vs. AI/environmental challenge)
- Note: the "shifting allegiances, teams chosen each round" structure was specifically designed to support adding these modes later without reworking core systems

## Technical
- [ ] Confirm final engine choice after Phase 1 prototype validates the core loop (Unity recommended, see Technical Roadmap doc)
- [ ] Networking architecture decision (dedicated server vs. host-authoritative) once moving past local prototyping
- [ ] Console/mobile store certification research (needed before any real commercial console/mobile release)

## Naming
- [ ] Working title / game name not yet decided
- ✅ Mobile's gesture-dash mechanic is named the **"Drift Deck"** (short: **"DD"**) — resolved, in code + UI (superseded the "momentum pad" / "inertia pad" placeholders)

---

## Resolved / Superseded Log

### July 9, 2026 — movement & combat session
- ✅ **VR "reload" mechanic feel** → RESOLVED: mana-cell reload ritual (eject via wand-hand button → fresh cell from side pouch → slap in → channel/charge motion). Mana is a normal ammo-like resource — explicitly NOT the earlier-rejected fatigue-meter idea. Pattern extends to all magic items (each gets a unique ritual).
- ✅ **VR melee vs. ranged as selectable playstyles** → reframed: VR has one Physical Presence identity with joystick locomotion, fling-climb, and the two-handed wand; melee weapon-kit specifics moved to the running idea list above rather than being a separate selectable mode.
- ❌ **"Can Mobile's minions attack?"** → SUPERSEDED: the Squad Leader / commander-minion concept (and Swappable Squad) was dropped entirely in favor of direct dual-stick character control. The question no longer applies.
- ❌ **Mobile multi-mode control experiment** (Squad / Solo FPS / Solo TPS / Swarm Command prototype modes) → RESOLVED: standard dual virtual sticks + gesture zone won. Indirect unit-commanding felt less intense/immersive than the other three platforms.
- ❌ **Console "Fluid Support" archetype (and its two TBD support playstyle options)** → SUPERSEDED: Console's identity is now **Parkour Combat** (Apex-not-Titanfall movement feel). Character/loadout specifics deferred (open item above).

### July 9, 2026 — build session (camera/aim/ADS + core movement + Drift Deck refinement)
- ✅ **Mobile gesture-dash name** → RESOLVED: **Drift Deck** (DD). Renamed everywhere in code + UI.
- ✅ **Aim accuracy bug (shots landing below the crosshair)** → FIXED: shots now travel in full 3D along the exact camera-center crosshair ray, so "what you aim at is what you hit" on every platform. Root cause was firing horizontally from the chest while the camera looked from a different height/angle.
- ✅ **Look up/down (pitch)** → IMPLEMENTED on PC, Console, Mobile (VR untouched).
- ✅ **ADS (aim-down-sights)** → IMPLEMENTED as a universal hold-to-aim mechanic (RMB / left trigger / hold-aim-stick). Tuning still open (item above).
- ✅ **Drift Deck S-stroke misclassification** (a downward S read as a backward dash) → FIXED: a mostly-vertical stroke is always a forward jump/slide; only a stroke that arcs out to a side is a free-form/backward dash.
- ✅ **Mobile fire button** → REMOVED: firing is release-the-aim-stick now. (Whether that's final is still open, item above.)
- 🔬 **First/third-person perspective** → now an active default-third experiment for Console/Mobile, PC locked first (open item above).
- 🧪 Prototype-only additions this session (not design decisions): PC jump/sprint/Esc-menu, gravity + climbing/mantling for all walking modes, a hard arena clamp (dashes can't clip the border), death-menu scroll fix, faster/longer projectiles (48 u/s, 55u), and 9 tinted parkour/climb TEST blocks. All placeholder feel, to be revisited with the real PC kit + map session.
