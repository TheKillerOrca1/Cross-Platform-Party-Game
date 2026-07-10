# Cross-Platform Party Game — Claude Code Memory

Keep this file short. It loads on every single turn — don't paste design history here, link to it.

## Source of truth
Design docs live in `design-docs/` (synced from GitHub `TheKillerOrca1/Cross-Platform-Party-Game`).
Read the relevant doc before implementing anything platform-specific — don't guess at mechanics
that are already decided. If a request conflicts with a doc, flag it before building.

## Stack
Node.js + Socket.io (server) + Babylon.js (client). Server is authoritative for game state.
Run: `npm start` → http://localhost:3000

## Conventions
- Keep server as source of truth for anything that affects fairness (health, hits, position-critical logic)
- Comment code for a beginner audience — explain *why*, not just *what*
- One platform / one mechanic per prompt where possible — don't bundle unrelated fixes

## Workflow discipline (token + quality)
- `/clear` between unrelated tasks
- For any request bigger than a one-file fix: plan mode first, confirm the plan, then execute
- Prefer pointing at a specific file/line over "the controls feel off"

## After implementing a feature or fix
Always run the verification pass described in `QA_LOOP.md` before reporting back "done."
Do not tell the user to playtest until that pass has completed and produced a report.
