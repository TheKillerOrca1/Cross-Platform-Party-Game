# Technical Roadmap

## Goal
Move from concept/prototype toward an actual playable, real (eventually shippable) cross-platform game supporting VR, PC, Mobile, and Console simultaneously in the same match.

## Why This Is a Hard Technical Problem
Building a genuinely cross-platform, real-time multiplayer game with **4 fundamentally different control paradigms** (touch, full 3D physical VR, mouse+keyboard, gamepad) in one synchronized match is a significant engineering undertaking. Key challenges:
- Real-time networking across very different device capabilities and latency profiles
- VR requires full 3D physics and headset/controller tracking; other platforms don't
- Each platform needs its own input handling and UI, but all must interact in one authoritative shared game state
- Console and mobile platforms typically require platform-specific certification/store requirements for a real commercial release

## Recommended Engine
**Unity** is the most realistic choice for this project specifically because:
- Native, mature support for VR (via XR Interaction Toolkit / OpenXR), mobile, PC, and console from a single codebase
- Strong cross-platform networking solutions built for exactly this kind of asymmetric multiplayer (e.g., Netcode for GameObjects, Photon Fusion, Mirror)
- Large ecosystem of asymmetric/cross-platform multiplayer reference projects and documentation
- (Unreal Engine is a viable alternative if higher-fidelity visuals become a priority later, but Unity's cross-platform/VR tooling is generally more streamlined for a project at this stage)

## Suggested Development Phases

### Phase 1: Prototype (Validate the Core Loop)
- Build a **simplified, non-cross-platform prototype first** — e.g., all players on PC/web with placeholder controls simulating each platform's playstyle
- Goal: validate that the CTF gamemode, momentum-meter win condition, and platform asymmetry *feel* fun and balanced before investing in full VR/mobile/console builds
- Tools: Unity (recommended) or a lightweight web-based prototype (Phaser/React + WebSockets) purely for rapid iteration and playtesting with friends

### Phase 2: Platform-by-Platform Expansion
- Add one real platform target at a time, starting with the two that are technically simplest to validate (typically PC + Mobile), then VR, then Console
- Build shared authoritative game server logic (likely dedicated server or host-authoritative model) so all platforms sync to one source of truth

### Phase 3: Full Cross-Platform Integration
- Bring all 4 platforms into the same live match
- Extensive playtesting focused specifically on cross-platform balance (per the Platform Playstyles doc)

### Phase 4: Spectator Mode (Future Scope)
- A web-only spectator view, designed to be cast to a TV, showing the match from a "broadcast" camera angle — good for social hype and future streaming/marketing potential

## Networking Considerations
- Real-time action across VR/PC/Console/Mobile will need low-latency client-server networking (not peer-to-peer) for fairness and to handle VR's physical movement precision
- Dedicated server or cloud-hosted authoritative server recommended over purely local/LAN hosting once moving beyond prototyping, to support console/mobile store certification requirements later

## Practical Next Step for Adam
Given the current stage (concept fully fleshed out, no code yet):
1. Use this document set as the foundation to bring into whichever AI/dev tool is used for actual implementation (Claude Code, Unity + Claude, etc.)
2. Start with the **Phase 1 simplified prototype** to playtest the core CTF loop and platform-asymmetry feel with friends before committing to full VR/console builds
3. Revisit this roadmap once the prototype validates the fun factor — real platform-specific development (VR SDKs, console certification, etc.) is a much bigger lift and should come after the core loop is proven fun

## Playtesting Approach (Near-Term)
- Simplified prototype can run locally (e.g., one computer as host/server, friends' devices connecting over local WiFi via browser or a build)
- Focus early playtests on: is the platform asymmetry *fun and fair*? Does the momentum-meter win condition feel good? Is 6 minutes the right round length?
