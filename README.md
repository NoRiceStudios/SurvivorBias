# Survivor Bias

A pixel-art strategy game about commanding a WWII-style air wing, using only the reports of the crews who come back.

You armor, train, build and send your squadrons out. You never see the battle itself. You hear a broken radio log, then debrief the survivors. Every report is filtered through a squadron leader's personality and shock. The damage you see on returning aircraft is real, but planes that were shot down never show you theirs. When the war ends, the archives are declassified and you find out what really happened.

See [DESIGN.md](DESIGN.md) for the full design.

![Title](docs/screenshots/title.png)
![Debrief](docs/screenshots/debrief.png)
![Declassified](docs/screenshots/declassified.png)

## Playing

- **Windows:** run `npm run package:win`, then unzip `release/SurvivorBias-win32-x64.zip` and run `SurvivorBias.exe`. Saves are stored in `%APPDATA%/survivor-bias/saves`.
- **From source:** run `npm install`, then `npm start` (Electron).
- **Modes:** single player against an AI commander (three difficulty levels, set by how well the enemy understands survivorship bias), or two commanders in hotseat mode.

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

### Layout

- `src/core/`: pure, deterministic game logic with no DOM. Covers the seeded battle sim, the distortion pipeline that turns truth into reports, the economy, High Command, the AI commander and save/load.
- `src/ui/`: renderer in plain TypeScript and DOM. Aircraft sprites are rasterised procedurally from shapes tagged with hit zones, so every bullet hole lands on the part of the airframe it actually hit. Sound effects are procedural WebAudio.
- `src/electron/`: window, save-file IPC and preload bridge.

The UI only ever reads a side's *perceived* state. Truth is shown only in the end-of-war archive.
