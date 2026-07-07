# Local Dev Setup Guide (Windows) — Getting Claude Code Running

## Installing Git (Required for Claude Code)
Status: Done — Adam installed Git successfully via `winget install --id Git.Git -e --source winget`.

Easiest method for future reference — avoids picking between download options entirely:
1. Open PowerShell (search for it in the Start menu)
2. Run: `winget install --id Git.Git -e --source winget`
3. Restart your terminal / Claude Code after it finishes

If winget isn't available (fallback — manual download):
1. Check your system type first: Settings > System > About > look for "System type"
2. If it says "x64-based processor" (true for the vast majority of PCs) — download Git for Windows / x64 Setup
3. If it says "ARM-based processor" (rare) — download the ARM64 version
4. Ignore the "portable / thumbdrive" editions — not needed for a normal setup

## Claude Code: First-Time Folder Setup
The first time you send a prompt, Claude Code will ask you to choose a working folder on your computer — this is normal and expected, not an error. Create a new empty folder (e.g. `Documents/CrossPlatformGameDemo`), select it, and proceed. This is where all the project's code (and, per the new system, these design docs) will live going forward.

## The Long-Term Knowledge System (Current Approach)
See `README.md` in this same folder for the full setup. Short version: this whole folder is meant to become a GitHub repository. Claude Code reads/writes these files directly and instantly (no sync needed — it's just reading real files on disk). The claude.ai Project connects to the same repo via Claude's official GitHub integration, refreshed with one click ("Sync now") whenever something changes — no manual re-uploading of individual files.

## Correction Log (kept for transparency)
- Earlier guidance suggested Claude could edit Google Docs directly and automatically via a Drive API-style write. This was inaccurate — the available Google Drive tools can only create new files, not edit existing ones in place.
- A Claude-in-Chrome browser-automation approach was considered as a workaround, but the GitHub-repo approach (this doc + README.md) is the actual clean, reusable, low-friction long-term system, and is what's now in use.
