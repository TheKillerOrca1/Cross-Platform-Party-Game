# Prompt for Claude Cowork — Repo Setup

## Before running this prompt
1. Create a free GitHub account at github.com (if you don't have one)
2. Create a new empty repository (e.g. named `cross-platform-party-game`) — do NOT initialize it with a README, keep it empty
3. Copy the repo's URL (looks like `https://github.com/YOUR-USERNAME/cross-platform-party-game.git`)
4. Make sure the 9 design doc `.md` files (00 through 07, plus README.md) are saved somewhere Cowork can access, like your Downloads folder

## The Prompt (paste into Cowork)

```
I have a set of markdown design documents I want turned into a local git repository and pushed to an existing (currently empty) GitHub repo.

Please:
1. Create a new folder at Documents/CrossPlatformGameDemo/design-docs (create the parent folder too if it doesn't exist)
2. Move all the .md files I have in [tell Cowork where they currently are, e.g. "my Downloads folder"] into that new folder
3. Initialize a git repository in that folder
4. Add and commit all the files with the message "Initial design docs"
5. Set the remote origin to: [PASTE YOUR GITHUB REPO URL HERE]
6. Push to the main branch

Let me know if you hit any authentication prompts for GitHub — I'll handle logging in myself when needed.
```

## After Cowork finishes
Go to your claude.ai Project → Project Knowledge → "+" → GitHub → authenticate if prompted → paste your repo URL → select the files. From then on, "Sync now" pulls in whatever's newest.
