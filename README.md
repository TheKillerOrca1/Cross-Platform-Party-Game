# README — Long-Term Knowledge System (Reusable for Any Project)

## The Problem This Solves
Google Docs sync into a Claude Project can be *read* live, but Claude cannot *edit* them directly — every update means manual copy/paste or fragile browser automation. That's annoying, wastes tokens re-explaining context, and doesn't scale to other projects. This system replaces that with something Claude can actually read AND write cleanly, and that works the same way for every future project you start.

## The System, in One Sentence
**Each project is a GitHub repository of markdown files. Claude Code edits those files directly and instantly (it's just reading/writing real files on your disk). The claude.ai Project connects to the same repo via Claude's official GitHub integration, refreshed with a single click whenever something changes.**

## Why This Is Actually Better Than Google Docs
- **Claude Code has zero friction with it** — no APIs, no sync, no browser automation. It's just files on disk. When Claude Code updates a doc, it's done — no extra step, ever.
- **Claude.ai Projects has a real, supported GitHub integration** — not a workaround. You click "Sync now" after a work session and the Project sees everything current. This is much lower-friction than deleting and re-uploading individual Google Docs.
- **It's the same pattern for every future project** — any new idea you have, you start a repo the same way, and you already know the whole workflow.
- **Version history for free** — git tracks every change, so nothing is ever truly lost, and you can see exactly what changed and when.
- **It naturally merges with your actual codebase later** — the design docs and the game code can live in the same repo, so Claude Code building the game always has the full design context sitting right next to the code it's writing.

## One-Time Setup

### 1. Create a GitHub account (if you don't have one)
Go to github.com and sign up — it's free.

### 2. Create a new repository
- Click "New repository"
- Name it something like `cross-platform-party-game`
- Keep it Private (you can always make it public later)
- Do NOT initialize with a README (we already have one)

### 3. Get the files onto your computer and into the repo
The files in this folder (all the `.md` documents) should be placed into a local folder — the same one you already created for Claude Code (e.g. `Documents/CrossPlatformGameDemo`), or a dedicated subfolder like `Documents/CrossPlatformGameDemo/design-docs`.

From there, in a terminal in that folder:
```
git init
git add .
git commit -m "Initial design docs"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/cross-platform-party-game.git
git push -u origin main
```
(Claude Code can run all of this for you directly if you paste this section to it and ask.)

### 4. Connect the repo to your Claude Project
1. Open your Project in claude.ai
2. Go to Project Knowledge → click "+"
3. Select **GitHub** (not Google Drive)
4. Authenticate with GitHub if prompted
5. Paste your repo URL or select it from the list
6. Choose which files/folders to include (all the `.md` docs)

### 5. Ongoing workflow
- When a design doc needs updating, do it via Claude Code (which edits the real file instantly), or edit it yourself
- Commit and push the change: `git add . && git commit -m "update notes" && git push`
- In the claude.ai Project, click the **Sync** icon to pull in the latest version
- That's it — no more re-uploading individual files one at a time

## The Document Set (current contents)
1. `00_Game_Overview.md` — Vision, pillars, tone, reference points
2. `01_Platform_Playstyles.md` — What each platform plays like and why
3. `02_Gamemode_CTF.md` — Full ruleset for the launch gamemode
4. `03_Technical_Roadmap.md` — Engine choice, dev phases, build plan
5. `04_Art_Direction_and_Assets.md` — Visual style, tone, the Relic-skin concept
6. `05_Open_Questions_Backlog.md` — Everything still undecided, by category
7. `06_Demo_Build_Plan_and_Prompts.md` — The plan and Claude Code prompt for the friend-testable demo
8. `07_Local_Dev_Setup_Guide.md` — Windows/Git/Claude Code setup notes

## Suggested Custom Instructions (paste into the Project's settings)
```
This project contains the design docs for a cross-platform asymmetric multiplayer party game (working title TBD). Core concept: Mobile, VR, PC, and Console players each play a genuinely different but balanced role in the same match, leveraging each platform's unique hardware strengths (touchscreen, 3D physical presence, mouse precision, joystick fluidity).

These docs are synced from a GitHub repository and are the current source of truth for the project — but they are a living design. When something is resolved or changed, it should be updated in the actual repo files (via Claude Code or manually), committed, pushed, and then re-synced into this Project.

Check 05_Open_Questions_Backlog.md before assuming something is undecided — it may already be answered elsewhere. Keep the tone consistent: intense/competitive gameplay with a wholesome, silly-fantasy presentation — not a purely goofy party game, not a serious/dark game either.
```

## Using This System for Future Projects
This exact pattern — a GitHub repo of markdown docs, synced into a Project, edited directly by Claude Code — works for anything: another game idea, the drone photography business planning, a school project, whatever comes next. Same five setup steps every time, same ongoing workflow. Once this one is running smoothly, it's copy-paste for the next idea.
