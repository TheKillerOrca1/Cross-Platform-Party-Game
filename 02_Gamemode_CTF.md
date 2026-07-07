# Gamemode: "One-Way Relic Capture" (CTF Variant)

This is the **first and primary gamemode** for launch. The name "Capture the Flag" is used internally for clarity, but the in-fiction object is NOT a literal flag (see Art Direction doc — it's a cosmetic "Relic" that can be reskinned).

## Core Structure
- **One-way CTF**: One team attacks, one team defends (not simultaneous dual-flag capture)
- **Teams**: Player-chosen by default each round; random shuffle available as an optional toggle
- **Round length**: ~6 minutes (tunable; range being considered is 5–8 minutes)
- **Format**: Best-of-3 captures determines the winner, OR defenders win via a unique "momentum" condition (see below) — **not** a simple survive-the-clock win

## Roles

### Attackers
- Goal: retrieve the Relic from the Defenders' base and carry it to an extraction point
- **Attackers choose their own spawn location/method** at the start of a round (exact mechanic TBD — could be a choice of entry points, or a deploy-anywhere-in-a-zone mechanic)

### Defenders
- Goal: prevent the Relic from being extracted
- **Defenders can go anywhere on the map** to hunt attackers, with one exception: **they cannot enter the Attacker spawn/safe zone**
- This makes defense active and mobile rather than a turtle-in-base strategy

## Relic (Flag) Mechanics
- **Drops on carrier's death** — stays where the carrier died
- **Can be passed** between teammates (not just picked up off the ground — active passing is a mechanic)
- **No auto-return timer** — the Relic does not reset itself after sitting still; it must be physically returned or left in play
- **Defenders can also pick up and relocate the Relic** — this lets defenders actively bait attackers by moving it to a more defensible position, rather than passively guarding a fixed point
- **Holding the Relic disables attacking** — the carrier cannot use offensive abilities while holding it, creating risk/reward around who carries it and forcing coordination (escorts) for safe transport

## Extraction Points
- **Multiple possible extraction points, varying by map** — different maps can offer different numbers/placements of extraction zones
- This ties map design directly to platform balance — e.g., a map with a distant extraction point might favor Console's mobility-based support kit, while a tight, close-quarters map might favor VR Melee or PC Assassin bursts

## Win Conditions
Two paths to victory, running in parallel:

1. **Attackers win** by successfully extracting the Relic **3 times** (Best-of-3 captures)
2. **Defenders win** via an **"Attacker Momentum" meter** instead of a simple survival clock:
   - The meter fills based on attacker failures: failed capture attempts, attacker deaths, relic drops that get re-secured by defenders, etc.
   - If the meter fully drains/depletes (framing TBD — likely represents attacker "momentum" running out), Defenders win that round
   - This keeps **both sides actively playing toward a win condition** rather than Defenders simply running out a passive clock

*(Exact meter mechanics, fill/drain rates, and visual presentation are TBD — flagged for playtesting and iteration.)*

## Design Intent
- Balanced viability for both solo skill expression and team coordination — flag carries should be possible solo if a player is skilled, but teams that coordinate escorts/support should have a clear advantage
- Defense should feel active and mobile, not a passive turtle strategy
- Every platform should be able to carry/capture the Relic in some capacity — no platform is locked out of the core objective

## Open Design Questions (Carried to Backlog)
- Exact attacker spawn/entry mechanic (choose from fixed points? deploy anywhere in a zone?)
- Exact fill/drain mechanics and visual feedback for the Attacker Momentum meter
- Passing mechanic details (targeted throw? auto-pass to nearest ally? cooldown?)
- Whether extraction points are visible to defenders at all times, or discovered/revealed dynamically
