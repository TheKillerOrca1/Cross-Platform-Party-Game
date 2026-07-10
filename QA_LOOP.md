# The Build → Verify → Report Loop

Purpose: catch mechanical/functional bugs with a second, independent pass BEFORE asking Adam to
playtest — so his time and feel-judgment are spent on things only a human can evaluate.

## Step 1 — Implement
Build the requested feature/fix as normal in the main session.

## Step 2 — Spawn an independent QA subagent
Do not let the same context that wrote the code also grade the code. Use the qa-tester subagent
(see .claude/agents/qa-tester.md).

## Step 3 — Separate the report into two buckets
**✅ Verified mechanically** — things the QA pass confirmed work (brief list, no padding)

**🎮 Needs Adam's playtest — with specific questions, not "let me know what you think":**
- Bad: "Try it out and see how it feels"
- Good: "Hold Shift with no other input for 5+ seconds while walking — does the crouch feel
  smooth the whole time, or jittery at any specific point?"

## Step 4 — Wait
Do not proceed to the next feature until Adam has answered Step 3's questions, unless he's
explicitly said to keep building ahead of playtesting.

## What this loop does NOT replace
Fun, feel, and balance are not verifiable claims. This removes mechanical bugs from Adam's
playtest sessions — it does not replace the playtest.
