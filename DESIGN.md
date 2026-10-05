# Survivor Bias — Game Design Document

> *"The armor doesn't go where the bullet holes are. It goes where the bullet holes aren't."*
> — after Abraham Wald, Statistical Research Group, 1943

## 1. Pitch

You command an air wing in a fictional WWII-style war against an enemy you never
see clearly. You manage the aircraft, the squadrons that fly them, the training
facilities that supply new airmen, and the factory that builds and refits the
fleet. You send sorties out, and you only learn what happened from the ones who
come back.

Every report comes from a survivor, and every survivor is an unreliable narrator.
The damage you see is real, but it is only the damage that was survivable. The
game never points this out. Whether you notice is up to you.

## 2. Design pillars

1. **Survivorship is the trap.** The game does not lie to you, but it only shows
   you a biased sample. Players who learn to reason about what is *missing* win.
2. **Information has a price.** Certainty can be bought with gun cameras, recon
   flights and cross-checked debriefs. It is never free and never complete.
3. **Symmetric fog.** The enemy, whether AI or another human, works from the same
   distorted information pipeline you do. It adapts, but it adapts to what it
   *thinks* you are doing.
4. **Grim, with dry paperwork.** Losses are treated seriously. High Command's
   memos, forms and quotas carry Catch-22-style bureaucratic absurdity.

## 3. Decisions locked in

| Topic | Decision |
|---|---|
| Setting | Fictional WWII-style war (propeller aircraft, invented nations and theatre) |
| Battle presentation | Fragmentary radio log plus map-table plots; the battle is never shown directly |
| Art | Pixel art (sprites drawn in code or as small PNGs), dossier-flavoured UI |
| Tech | TypeScript; game logic as a pure, headless-testable core; Electron shell packaged as a Windows `.exe` |
| Campaign | Fixed campaign with several endings, about 3–5 hours; save/load between sessions |
| Multiplayer | Single player vs AI, **plus** PvP by hotseat (hidden screens) and LAN/direct IP; simultaneous planning, then the battle resolves |
| Crew model | Squadron-level abstraction; notable individuals (aces, problem cases, squadron leaders) surface by name |
| Economy | Four resources: **Supplies**, **Fuel**, **Munitions**, **Replacements** |
| Aircraft | Per-zone armor placement, modular loadouts, several aircraft types, factory R&D tree |
| Enemy | Adaptive and escalating, but imperfect: it reacts to *its own* unreliable intel |
| Information distortion | Crew personality biases, trauma/memory distortion, verification tools, unreliable High Command |
| Lose states | Front line collapses; relieved of command; fleet wiped out; crew mutiny / morale collapse |
| Truth reveal | "Archives declassified" at the end of the war: what was reported vs what happened, per sortie |
| Mission orders | Strategic bombing; air superiority / intercepts |
| Audio | Procedural sound effects generated in code (typewriter, static, engine drone, stamps); no music for v1 |

## 4. The turn loop

Each turn is one **sortie cycle**, roughly a few days of in-game time.

1. **Requisition & upgrade.** Spend resources on squadrons (training, rest,
   replacements), aircraft (armor, loadouts, repairs), the factory (throughput,
   quality control, R&D) and training facilities (capacity, curriculum).
2. **Doctrine.** Set behaviour for each squadron (see §7).
3. **Assignment.** Pick the mission from High Command's current orders, then
   commit squadrons and airframes. Some planes stay home for defence and others
   go into the hangar for repair.
4. **The battle (hidden).** The simulation resolves the full truth. The player
   gets only a fragmentary radio log: broken calls, map plots, and silences.
5. **Debrief.** The survivors land. You get:
   - the airframes that came back, with **accurate** damage overlays (the survivor sample);
   - squadron reports on claims, enemy strength and types, and what was seen, **distorted** by each squadron's bias and trauma;
   - an updated war-theatre estimate (front line, enemy production), also distorted.
6. **High Command.** New orders, supply deliveries and memos. How much you get
   depends on **Command Trust**, which is based on the results you *reported*,
   and not on what actually happened.
7. Repeat until the war ends or you lose.

In PvP both players do steps 1–3 at the same time, the simulation resolves both
sides' sorties against each other, and each player gets their own distorted debrief.

## 5. Two layers of state

The model is split cleanly in two, and this split runs through the whole codebase:

- **Truth state.** What actually exists and happened: real enemy strength, every
  hit on every aircraft (including the ones that went down), real kills, and the
  real front line.
- **Perceived state (one per side).** What a commander believes, built only from
  reports that went through the distortion pipeline (§8).

The UI only ever reads perceived state. The AI opponent only ever reads *its*
perceived state. Truth state is shown in exactly one place: the declassified
archive at the end.

## 6. Systems

### 6.1 Aircraft

**Types (v1):**
- **Fighter.** Escort or intercept. Fast, light armor budget.
- **Medium bomber.** Balanced. Defensive turrets.
- **Heavy bomber.** Big payload, many turrets, large armor budget, slow.
- **Recon.** Unarmed photo plane, used as a verification tool (§9).

**Hit zones** (on each type's pixel silhouette): nose/cockpit, engines (per
engine), wing roots, outer wings, fuel tanks, fuselage, tail/control surfaces,
and turret positions.

Each zone has a hidden **lethality**: how likely a hit there is to bring the
plane down. Engines, cockpit and fuel tanks are high; outer wings and fuselage
are low. **The player is never told these values.** That is the Wald puzzle:
returning planes are covered in fuselage and wing hits *because* hits there are
survivable.

**Armor placement.** Each airframe has a weight budget. Armor painted onto a zone
lowers the lethality of hits there but costs speed, range and payload.

**Loadouts:** engine variant, guns, turret configuration, fuel tanks
(self-sealing option), bomb load.

**Per-airframe history:** sorties flown, repairs, accumulated fatigue (hidden
structural wear), and the factory batch it came from.

### 6.2 Squadrons (crew)

The crew is modelled at squadron level:
- **Stats:** Skill (gunnery, navigation, evasion), Experience, Morale, Fatigue, Cohesion.
- **Character:** each squadron has a leader with a named personality that sets
  its **reporting bias** (§8.1). When the leader changes, the bias changes.
- **Notables:** aces, cowards, a suspiciously lucky crew, a veteran with shell
  shock. These appear by name in debriefs and events but are not micromanaged.
- **Losses:** when strength falls, the squadron needs Replacements, which lowers
  its average experience. If it falls too low it is disbanded.

### 6.3 Training facilities

- **Capacity:** how many Replacements per turn turn into trained airmen.
- **Curriculum focus:** gunnery, navigation, evasion, or **reporting
  discipline**. That last option is unusual: it lowers future bias, but at the
  cost of combat skill.
- **Quality vs speed:** you choose between rushed graduates now and better ones later.

### 6.4 Factory

- **Throughput:** airframes per turn, by type.
- **Quality control:** low QC is cheaper and faster but adds hidden defects.
  Those turn up as unexplained losses, which crews blame on the enemy.
- **Refit capacity:** how many airframes can have armor or loadouts changed each turn.
- **R&D tree:** new engines, self-sealing tanks, armor alloys, new airframes,
  production techniques, gun cameras, and better radios (which make the radio log
  more complete).

### 6.5 Economy

| Resource | Used for | Comes from |
|---|---|---|
| **Supplies** | Upgrades, R&D, repairs, construction | High Command deliveries (scaled by trust) |
| **Fuel** | Each sortie, scaled by aircraft type and range | High Command; can be cut by enemy bombing |
| **Munitions** | Bomb loads, ammunition | High Command; local production upgrade |
| **Replacements** | New airmen into training | High Command; scarce |

### 6.6 The war theatre

A map table with a front line made of sectors. Your bombing lowers the enemy's
production and supply, and theirs lowers yours. Air superiority affects how well
the ground war goes. The front moves every turn, based on the *true* balance of
air power and industry. What you are shown is the *reported* front.

## 7. Doctrine (behaviour settings per squadron)

- **Aggression:** press the attack ↔ preserve the aircraft.
- **Formation tightness:** tight boxes share defensive fire but are vulnerable to flak ↔ loose.
- **Break-off threshold:** how much damage or loss before a squadron aborts.
- **Target priority:** primary target, targets of opportunity, enemy fighters.
- **Wingman policy:** stay with damaged aircraft ↔ leave them behind.
- **Altitude band:** high (safer from flak, less accurate) ↔ low.

Doctrine also feeds what the enemy *perceives* about you. A very predictable
doctrine is easier to counter.

## 8. The distortion pipeline

Every report travels **truth → observation → memory → report → aggregation → you**.
Distortion can enter at each stage.

### 8.1 Personality biases (systematic, learnable)

| Archetype | Kill claims | Enemy strength | Damage dealt | Other |
|---|---|---|---|---|
| Braggart | ×1.5–3 | Under | Over | Never reports own mistakes |
| Pessimist | Under | ×1.5–2 | Under | Reports phantom enemy types |
| Glory-hunter | Over | Over (to look brave) | Over | Asks for dangerous missions |
| By-the-book | Accurate | Accurate | Accurate | Vague; many "unknown" entries |
| Timid | Under | Over | Under | Exaggerates flak |

Because these biases are *consistent*, players can learn to correct for them.
That reward for careful observation is a core skill of the game.

### 8.2 Trauma & memory (situational, noisy)

- Heavy damage, wingmen lost, or long exposure all increase report variance.
- Panic causes double-counting (two squadrons claim the same kill) and misidentified types.
- Fatigue degrades how reliable reports are over consecutive sorties.

### 8.3 Structural blind spots (the namesake)

- Planes that went down **report nothing**. Their damage pattern is never seen.
- What happened to a squadron that was wiped out is known only from other
  squadrons' (biased) observations.
- An enemy tactic that kills reliably gets **under-reported**, because the planes
  it hits don't come back.

### 8.4 High Command (unreliable from above)

- Intel memos mix accurate data with stale reports and propaganda.
- Orders sometimes rest on wrong strategic beliefs (for example "Enemy fighter
  strength is broken. Proceed unescorted.").
- Command Trust rises with *reported* success, so **inflating your own reports**
  upward is a real temptation. Getting caught (contradicted by recon, or
  exposed by a failed offensive) wrecks trust.

## 9. Verification tools

| Tool | Cost | Effect |
|---|---|---|
| Gun cameras (R&D) | Supplies, weight | Confirms a share of kill claims |
| Recon flights | Fuel, a recon plane at risk | Accurate snapshot of a target's damage or the enemy airfield |
| Cross-check debriefs | Admin time (fewer upgrades this turn) | Flags contradictions between squadrons |
| Intelligence officer (upgrade) | Supplies | Shows confidence ranges on report figures |
| Better radios (R&D) | Supplies | A fuller radio log; you learn *where* planes were lost |
| Wreck recovery (event) | Varies | Rare: inspect a downed plane on friendly ground and see the lethal hit |

## 10. The enemy

### 10.1 Single player: the AI commander

The AI runs **the same loop with the same distortion pipeline**. It has its own
perceived picture of you, its own biased squadrons, and its own High Command.

- **Adaptive:** it counters what it *believes* your doctrine and armor layout
  are. If its pilots report "they've armored the tails", it shifts to head-on attacks.
- **Escalating:** a campaign schedule brings in new enemy types (heavy fighters,
  radar-directed flak, night fighters) and production increases.
- **Imperfect:** because its picture is distorted, it can over-react, chase a
  phantom, or ignore a real weakness. Players can exploit this by being
  deliberately unpredictable.

### 10.2 PvP

Each human player is the other's "unknown force". Both plan at the same time
and commit. The simulation resolves both sides together, and each player gets
their own distorted debrief.

- **Hotseat:** one PC, with a "pass the controls" screen between planning phases.
- **LAN / direct IP:** one player hosts and the other connects. The host runs the
  authoritative simulation and sends each client only their perceived state, so
  the opponent's real state can never be read from memory or network traffic.

## 11. Battle simulation

The battle is a deterministic, seeded simulation running at an abstract tick level:

- Phases: **outbound → interception → target → egress → return**.
- Each tick resolves engagements between groups of flights. Every hit is rolled
  with a hit zone, weighted by attack angle, which in turn follows enemy tactics.
- Every hit is recorded in truth state, including hits on planes that are lost.
- The **radio log** is generated from what radio-equipped survivors could have
  heard or said, at the time it happened, with gaps and static. Silence carries
  information.

Since the simulation is deterministic and seeded, it can be fully unit-tested,
replayed, and verified identically on both machines in PvP.

## 12. Campaign structure & endings

- **Length:** about 30 sortie cycles in three acts (Early War, Attrition, Decision).
- **Acts:** each act brings new enemy capabilities, new R&D tiers, and a change in
  High Command's demands.
- **Endings** depend on the true front line, Command Trust, and how many of your
  people survived:
  - *Victory:* the enemy's industry breaks.
  - *Pyrrhic victory:* you won, but almost no one who started the war is left.
  - *Stalemate / armistice*
  - *Relieved of command* (trust reaches zero)
  - *Collapse* (the front line reaches your airfield)
  - *Mutiny* (morale collapses)
  - *Grounded* (no fleet left to fly)
- **Declassified archive:** after any ending, the truth opens up, sortie by sortie:
  reported vs actual kills, the real enemy strength over time, and the **damage
  map of every aircraft that didn't come back**, next to the survivor map you
  were working from.

## 13. Tone & presentation

- **Visuals:** pixel art. Aircraft silhouettes in a top-down/side blueprint
  style, with damage overlay pixels. Map-table sectors, squadron insignia, and
  typewriter-font report screens on paper-textured panels.
- **Writing:** spare and grim when it comes to loss. Memos and forms
  (*"Form 27-B: Request for Additional Armor, denied pending Form 27-A"*) carry
  the dry humor.
- **Audio (v1):** procedural sound effects only, generated with WebAudio:
  typewriter keys, rubber stamps, radio static and squelch, distant engine drone,
  the hangar ambience.

## 14. Technical architecture

```
survivorbias/
  packages/core/     # Pure TypeScript game logic, no DOM: state, sim, distortion, AI, save format
  packages/ui/       # Renderer (canvas pixel art + DOM UI), reads only perceived state
  packages/net/      # Hotseat + LAN/direct-IP sync (WebSocket, host-authoritative)
  app/               # Electron main process, packaging for Windows
  tests/             # Unit tests (core) + Playwright UI tests driving the real renderer
```

- **Determinism:** a seeded PRNG drives all randomness, and the sim is tested
  with golden-file replays.
- **Saves:** JSON (versioned schema) in the user's app-data folder. Multiple
  slots and autosave every turn.
- **Testing in the cloud:** the core is tested with Vitest. The UI is driven by
  Playwright in Chromium, with screenshot checks. The Windows build is made with
  electron-builder/packager, targeting `win32-x64` as a portable `.exe` / zip.
- **Balance tooling:** a headless CLI runs thousands of AI-vs-AI campaigns to
  check that the Wald insight actually matters (armoring the lethal zones should
  measurably raise survival) and that no single doctrine dominates.

## 15. Proposed build milestones

1. **M1 — Core sim slice:** truth state, one aircraft type, hit zones, a seeded
   battle sim, the survivor-only damage overlay, and a basic bias pipeline.
   Headless tests.
2. **M2 — Playable loop:** the full turn loop against a simple AI, the four
   resources, doctrine, a debrief screen, save/load. A first Windows build.
3. **M3 — Depth:** all aircraft types, loadouts, R&D, factory QC, training
   curriculum, verification tools, High Command trust and memos.
4. **M4 — Adaptive AI & campaign:** perceived-state AI, escalation schedule,
   three acts, endings, the declassified archive.
5. **M5 — PvP:** hotseat, then LAN/direct IP.
6. **M6 — Polish:** pixel art pass, procedural audio, balance runs, tutorial memos.
