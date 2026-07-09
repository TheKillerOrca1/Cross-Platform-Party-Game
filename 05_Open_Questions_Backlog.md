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
- [ ] **Mobile: real name for the gesture-dash mechanic** — "momentum pad" / "inertia pad" are placeholders only, neither is final
- [ ] **Mobile: wall-swoop chain limit** — chainable 2–3 times? Pending balance testing
- [ ] **Mobile: firing input** — the design session specified movement/aim only; how firing is triggered (button? something better?) is undecided. The prototype uses a placeholder fire button
- [ ] **Mobile: control comfort settings** — joystick size/sensitivity and gesture-zone sensitivity as accessibility/comfort options. Planned, not needed for the first playable pass
- [ ] **Mobile: first real-device playtest** — ⚠️ the entire dual-stick + gesture scheme has NOT been felt on an actual phone yet; the browser build exists to make this possible. All gesture tuning numbers are provisional until this happens
- [ ] **How much selectable character/playstyle variety exists within each platform identity?** The old "two selectable playstyles per platform" frame was retired July 9, 2026; what replaces it (characters? loadouts? nothing at first?) is open
- [ ] Balance testing: with difficulty tied to character choice rather than platform, does this hold up in actual play, or does one platform still end up feeling stronger?

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
- [ ] Real name for Mobile's gesture-dash mechanic (also listed under Platform Playstyles — placeholders: "momentum pad" / "inertia pad")

---

## Resolved / Superseded Log

### July 9, 2026 — movement & combat session
- ✅ **VR "reload" mechanic feel** → RESOLVED: mana-cell reload ritual (eject via wand-hand button → fresh cell from side pouch → slap in → channel/charge motion). Mana is a normal ammo-like resource — explicitly NOT the earlier-rejected fatigue-meter idea. Pattern extends to all magic items (each gets a unique ritual).
- ✅ **VR melee vs. ranged as selectable playstyles** → reframed: VR has one Physical Presence identity with joystick locomotion, fling-climb, and the two-handed wand; melee weapon-kit specifics moved to the running idea list above rather than being a separate selectable mode.
- ❌ **"Can Mobile's minions attack?"** → SUPERSEDED: the Squad Leader / commander-minion concept (and Swappable Squad) was dropped entirely in favor of direct dual-stick character control. The question no longer applies.
- ❌ **Mobile multi-mode control experiment** (Squad / Solo FPS / Solo TPS / Swarm Command prototype modes) → RESOLVED: standard dual virtual sticks + gesture zone won. Indirect unit-commanding felt less intense/immersive than the other three platforms.
- ❌ **Console "Fluid Support" archetype (and its two TBD support playstyle options)** → SUPERSEDED: Console's identity is now **Parkour Combat** (Apex-not-Titanfall movement feel). Character/loadout specifics deferred (open item above).
