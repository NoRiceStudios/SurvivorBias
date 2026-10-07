# Survivor Bias

A pixel-art strategy game about commanding a WWII-style air wing, using only the reports of the crews who come back.

You armor, train, build and send your squadrons out. You never see the battle itself. You hear a broken radio log, then debrief the survivors. Every report is filtered through a squadron leader's personality and shock. The damage you see on returning aircraft is real, but planes that were shot down never show you theirs. When the war ends, the archives are declassified and you find out what really happened.

The war is fought across three theaters: the Narrow Sea, the Kessel Basin and the Northern Approaches. Each is a strip of sectors holding named airfields, works and depots. You win a theater by pushing the front forward sector by sector. Strikes, close support and air superiority all build pressure, deeper targets come into range as you advance, and every theater has its own weather, stages and secondary objective. Missions are sector-based and the same for both sides, so they work identically against the AI and against another player. See [DESIGN.md](DESIGN.md), especially §6.6 War theaters and §10.3 How missions work in multiplayer.

![Title](docs/screenshots/title.png)
![Debrief](docs/screenshots/debrief.png)
![Declassified](docs/screenshots/declassified.png)

## Playing

- **Windows:** run `npm run package:win`, then unzip `release/SurvivorBias-win32-x64.zip` and run `SurvivorBias.exe`. Saves are stored in `%APPDATA%/survivor-bias/saves`.
- **From source:** run `npm install`, then `npm start` (Electron).
- **Modes:** single player against an AI commander (three difficulty levels, set by how well the enemy understands survivorship bias), or two named commanders in hotseat mode. In hotseat, each commander plans behind a closed folder (Esc hides the screen) and the week is fought once both orders are sealed. After sealing, each commander sees an overview of their orders and can go back to amend them until the week is fought. **LAN / Direct IP:** one player hosts (Aldmere) and the other joins with the host's address and port (default 41414; forward it on the router to play over the internet). Both plan at the same time; the host's game is the authoritative one and the joining player only ever receives what their own side may know.

## Development

| Command | What it does |
|---|---|
| `npm test` | Core simulation tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run build` | Bundle renderer and Electron main (esbuild) into `dist/` |
| `npm run package:win` | Portable Windows x64 build in `release/` |
| `node scripts/screenshots.mjs` | Drive the real UI in Chromium and screenshot every screen (after `npm run build`) |
| `npm run balance -- 40` | Play 40 headless campaigns and print outcome statistics |
| `xvfb-run -a node scripts/electron-smoke.mjs` | Launch the Electron app headlessly and check that saving works |
| `node scripts/tutorial-smoke.mjs` | Walk through the whole tutorial in Chromium, doing what each step asks |
| `node scripts/hotseat-smoke.mjs` | Play a two-commander hotseat campaign through the real UI: names, feints, Esc cover, sealed orders across save/load, theater changes, end diaries |
| `xvfb-run -a node scripts/lan-smoke.mjs` | Two desktop instances play over TCP: redaction, command replay, several weeks, disconnect and rejoin |
| `npm run balance -- 40 --mirror` | AI against AI with symmetric rules: theater results and length |
| `npm run balance -- 20 --faction=arsenal` | The scripted player leading one of the air forces |

### Layout

The HQ has four tabs: **War Room** (map, orders, in-tray with High Command's weekly offers), **Squadrons** (roster and dossiers: doctrine, armor over the evidence, field modifications, aircraft), **Works** (factory, school, Supply Office and stores, development, one above the other) and **Intelligence**.

Each commander leads one of three air forces (The Arsenal, The Old Cadre, Friends at Court), each with its own strengths and weaknesses. Every week High Command offers three proposals, routine, uncommon or rare, and the commander may accept one; the more High Command trusts you, the rarer the offers. See [DESIGN.md](DESIGN.md) §6.1, §6.5 and §6.5.1. A readiness bar at the foot lists what still needs attention; F1 opens the Field Manual.


- `src/core/`: pure, deterministic game logic with no DOM. Covers the seeded battle sim, the distortion pipeline that turns truth into reports, the economy, High Command, the AI commander and save/load.
- `src/ui/`: renderer in plain TypeScript and DOM. Aircraft sprites are rasterised procedurally from shapes tagged with hit zones, so every bullet hole lands on the part of the airframe it actually hit. Sound effects are procedural WebAudio.
- `src/electron/`: window, save-file IPC and preload bridge.

The UI only ever reads a side's *perceived* state. Truth is shown only in the end-of-war archive.
