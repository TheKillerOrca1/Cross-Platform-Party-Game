# Map Design: Overtaken Castle

Working reference doc for the CTF launch map. Captures the design decisions from the map-design session — theme, layout, scale, and platform-traversal features. Pairs with 01_Platform_Playstyles.md, 02_Gamemode_CTF.md, and 04_Art_Direction_and_Assets.md.

## Theme

**A ruined castle, overtaken by nature, with a wizard's tower as its keep.** Chosen over a village setting because it better fits the "Brawl Stars meets Overwatch" competitive-not-cutesy art direction, gives every platform's traversal ability a natural home (broken walls for Console/PC, window-height variety for VR, open+cover mix for Mobile), and lets the map read as a place that existed *before* the match — wild hillside and forest giving way to farmland, then fortification, as you move from attacker spawn toward the castle.

## Overall Layout & Scale

Three zones stacked north (attacker) to south (defender), plus a forecourt buffer before the castle:

1. **Attacker Home Area** (fortified) — spawns + extraction
2. **Contested Midfield** — the bulk of the map; hills, ruins, canals, wheat field, utility buildings
3. **Forecourt** — an obstacle screen directly outside the castle gate
4. **Defender Stronghold** — castle keep + main wizard tower

**Scale:** ~130m wide, ~174m from spawn to castle (grid reference: 5m per cell).

**Movement speed reference (straight-line spawn→castle):**
- Walk: 4 m/s (matches the current prototype's `MOVE_SPEED` constant in `client.js`) → ~44s
- Sprint: ~7 m/s (**estimate — not yet implemented/tuned in-engine**) → ~25s
- Actual routing around obstacles/hills will run longer than this in practice; re-measure once real pathing exists.

## Zone 1: Attacker Home Area (Fortified)

- **3 spawn points** — Left, Mid, Right — spread wide so Left/Right genuinely diverge before reaching the wall (supports split-spawn flanking).
- **Single extraction point**, centered, just south of the spawns. The Relic must be carried all the way back here — not extracted near the castle — so the full map length is part of every successful run.
- **Old Stable** built into the inside of the perimeter wall — cover/regroup space before pushing out.
- **Fortified perimeter wall**, ~3m thick, ~8m tall, following a shallow curve that bulges toward the midfield. A **bastion tower** is integrated directly into the wall (the wall physically joins into it, not just adjacent).
- **4 ways through the wall**: Breach 1, the Large Rundown Main Gate (biggest opening, center), Breach 2, Breach 3. All platforms can also climb/vault the wall itself anywhere — the wall is texture and flavor, not a hard block.

## Zone 2: Contested Midfield

**Terrain (not flat):**
- **East hill** (~8m high point, 2m contour interval) — hosts the east grapple tower. Elevated enough to see over the wheat field.
- **West hill** (~8m high point) — hosts the west grapple tower *and* the watchtower together (military structures share the high ground).
- Both hills use natural, irregular contour rings (not perfect circles) plus a soft directional hillshade, so they read as real terrain rather than a dropped-in asset.

**Cover & landmarks:**
- **Large central tree** — the single biggest cover feature, anchoring the map's middle.
- **Chapel ruins**, **Well + courtyard** — independent, thematic landmarks.
- **Agrarian/utility cluster** — Granary, Kennels, and Blacksmith/armory grouped together near the keep on flat ground (functional buildings belong near each other and near the castle they'd serve).
- Ruin walls at varied lengths/rotations throughout, two of which are curved/crumbled rather than straight. A couple carry real-dimension callouts (e.g. "~19m long, ~2.5m thick, ~7m tall") as a grounding reference.

**Traversal features:**
- **Original canal** — deep, overgrown, winds through the center. Run the banks or jump across.
- **Second canal** — east flank, parallel-ish to the first, gives the east side its own water feature.
- **10 north–south oriented wall segments**, spread across the whole route (west flank x2, east flank x2, past the main gate, west-center, north of the central tree, near the defender-side forecourt, and one in each bottom corner flanking the castle). These are the Console wall-run lanes — oriented so running them actually carries a player toward or away from the objective, unlike the many east–west blocking walls, which don't.

**Wheat Field (concealment terrain):**
- Southwest flank, large and organically shaped (overgrown edges, not a rectangle) — the "farmland" link in the wild→cultivated→fortified progression.
- Includes a **broken windmill** (tilted, one snapped blade) and **hay bales**.
- **Mechanically distinct from obstacle cover**: it conceals (breaks direct sightlines) but does *not* block area-of-effect abilities, and it does *not* block the elevated sightline from the east hill/tower looking down into it. Two explicit counters, not a free hiding spot.

## Zone 3: Forecourt

A deliberate obstacle screen directly outside the castle gate, so reaching the Relic is never a straight run once you're through the midfield: angled rubble walls, a toppled statue, fallen columns, rubble piles.

## Zone 4: Defender Stronghold

- Bailey wall with a breached gate, keep body, **main wizard tower** (6 floors — grander than an earlier 3-floor draft), windows staggered at varying heights across floors 2–4 for the VR window-swing route, plus 2 minor flanking towers.
- **Training yard** sits just outside, near the forecourt (knights training right by the keep, not floating mid-map).
- Relic spawns in the main tower's base.
- Defenders may roam anywhere on the map **except** the Attacker Home Area.

## Reference Blueprint

See the attached `map_blueprint_v11.svg` (or paste it into an `assets/` subfolder here) for the full annotated top-down layout — includes the 5m grid, contour lines, and the movement-speed panel.

## Open Questions / Next Passes

- [ ] Wall-tag proportions (Console run-face vs. PC wall-jump-pair dimensions) — flagged repeatedly during map design, still needs a dedicated pass
- [ ] Round length re-tuning — the ~6min lean in 02_Gamemode_CTF.md predates this larger map; re-measure once real movement/pathing exists
- [ ] Sprint speed (currently a 7 m/s placeholder) needs actual in-engine tuning
- [ ] Fine-grained spacing/collision cleanup between foliage, walls, and buildings is best done in-engine with real collision, not further iteration on a flat SVG
- [ ] Relic-as-ball mechanic (see 02_Gamemode_CTF.md addition) needs its own dedicated mechanical pass — throw/kick distance, cooldown, mid-flight interception rules
