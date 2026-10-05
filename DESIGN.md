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
| Campaign | Three war theaters fought in sequence, each with sector-by-sector progression; several endings; about 3–5 hours; save/load between sessions |
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
plane down. **The player is never told these values.** *(Implemented.)* They are
**rolled per campaign and per aircraft type**, within plausible bounds:
cockpit, engines and fuel are usually deadly, and the outer wings and fuselage
always forgiving. Each type has its own character: the fighter's engine is in
the nose, and the heavy bomber has four engines. Sometimes a type gets a twist,
such as control cables run through the tail or an armoured seat fitted as
standard. The armor puzzle has to be solved from the evidence every war, for
every type, and the declassified archive reveals each type's profile at the
end. That is the Wald puzzle:
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
| **Supplies** | Upgrades, R&D, repairs, armor (4 per plate fitted; removal free) | High Command deliveries (scaled by trust and our works) |
| **Fuel** | Each sortie, scaled by aircraft type | Rationed: a full effort every week burns more than arrives. Depots hold at most 320. Bombing our fuel depots cuts it. |
| **Munitions** | Bomb loads, ammunition | Rationed. Depots hold at most 260. |
| **Replacements** | New airmen into training | Posted only while the pool is under 8 |

Between theaters the Ministry partly makes good a depleted wing: about 30–70%
of the shortfall below 28 aircraft, depending on trust. Difficulty scales the
AI's resources (Green ×0.64, Seasoned ×0.82, Wald ×1.09), and the AI gets 15%
more with each theater.

### 6.6 War theaters

The war is fought across **three theaters in sequence**. Squadrons, research,
veterans and losses carry over from one theater to the next. *(Implemented.)*

| # | Theater | Season | Character |
|---|---|---|---|
| 1 | **The Narrow Sea** | Autumn | Coastal plains either side of a strait. Balanced sites, worsening weather, radar chains complete late. |
| 2 | **The Kessel Basin** | Winter | An industrial valley. Most sites are aircraft works, flak is heavy and storms hide bombing results. |
| 3 | **The Northern Approaches** | Spring | Open country before the capitals. The armies move, close support counts for 1.6× pressure, and losing it decisively ends the war. |

**The map.** Each theater is a strip of six sectors, three per side at the
start. Every sector holds named sites: airfields, aircraft works and fuel
depots. The frontline sector, second line and rear area each hold different
site types, so where things sit differs between theaters. A side's facility
condition (production, repair, fuel income) is the sum of the sites it holds.

**How progression works within a theater:**

- **The front moves sector by sector.** True pressure builds on the contested
  boundary each week from losses inflicted vs suffered, close-support damage,
  strategic damage and the industrial balance. Every 24 points of pressure
  captures the next sector, and its sites change hands at 30% condition.
  Captured airfields and works become yours. **At most one sector falls per
  week**, and leftover pressure is capped at ±12, so a theater can't collapse
  in a single turn.
- **Both sides learn.** Each side remembers the feints and close-support raids
  it has seen recently. Repeated feints draw fewer reserve fighters, and the
  Army masses anti-aircraft guns against repeated close support (more flak, less
  pressure per raid). The AI also patrols and sweeps its own front when it is
  being hit there, and how quickly it reacts depends on difficulty.
- **Range opens up as you advance.** Medium bombers reach two sectors deep and
  heavies reach three. Escorts reach two sectors deep, or three with drop tanks,
  and past that the bombers go on alone. Pushing the front forward brings the
  enemy's rear-area industry into range.
- **Stages.** Weeks 1, 4 and 8 open a new stage with symmetric environmental
  changes, for example "Autumn gales" (worse weather), "Box barrages" (more flak)
  and "Spring offensive" (close support counts for more).
- **Weather** is rolled each week. Cloud and storms cut accuracy and detection
  and leave bombing results "unobserved". Each commander gets a Met Office
  forecast that is right about 75% of the time. When it is wrong it is off by one
  step (clear↔overcast↔storms), never clear for storms.
- **Secondary objective** per side and theater: wreck a named enemy site. It
  counts as achieved when *you believe* the site is below 25%. If the belief came
  only from crews' reports, the reward is paid as a "claim", and High Command may
  later photograph the site working normally and withdraw it, with a trust
  penalty. A recon photograph or capturing the sector confirms it.
- **HQ orders** follow the theater: strikes on specific named sites, kill
  quotas, sortie quotas, and "advance" orders that are judged on the Army's own
  map and cannot be talked up. Strike orders always allow at least two weeks.
  Kill quotas follow the median of the wing's recent returns, so one inflated
  week doesn't set an impossible target. HQ only calls enemy fighter strength
  "broken" after a run of big claims.
- **No capture without air cover.** A sector cannot fall in a week in which the
  side that would take it flew no operation, feint or defensive patrol. The
  pressure waits just short of the threshold.
- **Army liaison ledger.** Each debrief explains in words, not numbers, what
  moved the front: the air fighting (losses on both sides, with the fortunes of
  war folded in), close support, bombing of works, factory and fuel output, and
  enemy reinforcements. It is deliberately qualitative, so it can't be used to
  work out true kills.
- **The theater ends** when one side gains two sectors (decisive), or after 10
  weeks. A timeout goes to whoever holds the advantage, otherwise it is a
  deadlock.

**Between theaters:** the winner gets an 8-point pressure head start in the next
theater (stated in the theater orders, and the Army liaison's estimate starts
from it), +15 trust and 100 supplies, and the loser loses 12 trust. Aircraft in
repair are made serviceable during the move and squadrons are rested. A
redeployment briefing shows the result, the new map and the new objective.

What you see of a theater is mostly true: sector ownership and your own sites.
The **condition of enemy sites** and the **pressure on the front** are beliefs,
built from crews' reports and an optimistic Army liaison.

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

## 8.5 Squadron leaders' requests *(implemented)*

Each week, up to two leaders may bring a request, in character and prompted by
what their squadron just went through:

- a tighter box after losing stragglers
- bombing from higher up after heavy flak
- authority to turn back sooner
- pressing attacks home
- head-on attacks against tail gunners
- a week's stand-down when exhausted
- stricter factory inspection after mechanical aborts
- gunnery or reporting at the training school
- more plate "where we keep getting hit"

Approving applies the change in one click and lifts the squadron's morale a
little; declining costs a little morale. This is how the game teaches doctrine,
tactics, QC and training. Advice depends on the leader's character, and the
plate request is the survivorship trap in person.

Recon pilots make no requests. A leader who has raised something waits at
least four weeks before raising it again. A stand-down lasts one week: the
following week the squadron goes back to the raid or patrol it was taken off.
Requests keep their numbers (R1, R2) while the commander answers them. The
squadron leader flies as callsign 1, and when he is lost he appears by name in
the Missing list. Crew names come from a large pool and differ from campaign to
campaign.

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

- **Hotseat** *(implemented)*: one PC, two named commanders. A sealed-folder
  handover screen appears before every planning, radio, debrief and
  redeployment phase, naming the commander it is for. Esc (or "Close folder")
  hides the screen at any time. The first commander's sealed orders are saved
  with the game, so a save made between the two planning phases resumes with
  the second commander. After the war, a **Both War Diaries** view puts each
  side's claims, its returns to High Command and the truth side by side, week
  by week.
- **LAN / direct IP** *(implemented)*: one player hosts and commands Aldmere;
  the other joins by address and port and commands the Directorate. Both plan
  **at the same time**, and the week is fought when both have sealed their
  orders.
  - **Transport:** the Electron main process runs plain TCP with
    newline-delimited JSON (default port 41414), one opponent per game.
  - **The host is authoritative.** It runs the simulation and sends the joining
    player only `redactFor(state, 1)`: their own side in full, enemy sites at
    their believed condition, and the reported front instead of the true one.
    It contains none of the opponent's squadrons, reports, plans or resources,
    no hidden lethality, no RNG state, and no truth archive. The full state is
    shared only once the war is over.
  - **Commands, not state.** Every management change (armor, doctrine, tactics,
    production, research, training, QC, leader requests) is a serialisable
    `Command`. The joining player's commands travel with their sealed orders,
    and the host replays them under the same rules, so it never has to trust
    the joiner's copy of the game. If a replay fails, the joiner gets a fresh
    state and plans again.
  - **Resilience:** the host autosaves to its own slot. A joining player who
    drops out (even after sealing) rejoins and continues; their sealed orders
    are safe with the host. Loading a LAN save reopens the port.
  - **Testing:** `scripts/lan-smoke.mjs` runs two desktop instances against each
    other over TCP: it checks redaction, command replay, several weeks of play,
    and a disconnect and rejoin.

### 10.3 How missions work in multiplayer

The mission system is designed for two humans first, and the AI plays by
exactly the same rules. The design goal is a **guessing game with incomplete
information on both sides**, never a race to react first.

**1. Sealed, simultaneous orders.** Both commanders plan, then seal their
orders. Nobody reacts to the other's moves within a week. Both raids fly on the
same day, so every fighter squadron has to be committed in advance: escorting
your own raid, patrolling, held in reserve, or resting. Fighters sent as escorts
are not home to defend.

**2. Every mission has a counter, and every counter has a cost.**

| Mission | What it does | How the opponent counters it | The counter's cost |
|---|---|---|---|
| **Strike** a named site | Lowers enemy production, repair or fuel. Slow pressure on the front. | Fighters **patrolling that sector** (95% chance to meet the raid) or the **reserve** (55%, +25% with radar). Flak. | A patrol in the wrong sector almost never arrives (5%, or 30% from the next sector). |
| **Close support** | Pushes the front directly, the main lever on theater progress. | Patrols over your own frontline sector. Low-level raids take heavy flak. | Patrolling the front leaves the rear exposed. |
| **Fighter sweep** | Kills fighters and wins air superiority, which is pressure in its own right. It also **screens the front**: enemy close-support raids and sweeps over the front run into it. | Meet it in strength, or deny the fight by keeping fighters elsewhere. | Fighters on sweeps are not escorting or defending. |
| **Feint** (any non-recon squadron, one or two sectors deep, not the real raid's sector) | Flies first. Each reserve squadron has a 50% chance (25% with radar) of being sent after it, and patrols over that sector always engage it. Drawn squadrons miss the real raid. | Radar, or patrols instead of a reserve. Observers report "a formation that turned away without bombing", which is a clue for next week. | The feinting squadron is at risk and not escorting, and the fuel is burned for no damage. |
| **Defend** (patrol or reserve) | Intercepts raids. | Strike where they aren't. Go deep where the patrols don't reach. | Deep targets lose their escort beyond range 2. |
| **Recon** a site | The truth about one site. Confirms objectives and exposes your own crews' exaggerations. | Patrols over that sector catch it 60% of the time (12% otherwise). | A recon aircraft and a week's fuel. |

The key choice is **patrol vs reserve**. A patrol concentrates and gambles on one
sector; the reserve hedges at lower odds. Against a human, both sides try to read
the other's habits: which sectors you patrol, which site types you hit, and
whether you hit the frontline or reach deep.

**3. Fog on both sides, and it's asymmetric.** Each player sees only their own
perceived state:

- **Seen truthfully:** sector ownership (the Army's map), your own sites'
  condition, your own losses and the damage on your own returning aircraft.
- **Seen through crews:** enemy site condition, enemy fighter strength, how the
  enemy attacks, and what your raid achieved.
- **Seen through ground observers:** the size of the enemy raid on you, which
  observers inflate, and flak claims.
- **Never seen:** the opponent's plan, their reports, their returns policy or
  their High Command's opinion of them. These are revealed only in the
  end-of-war archive, which in multiplayer shows **both** sides' claims next to
  the truth.

Each player's *beliefs* about the other are distorted, so patterns are learnable
but never certain. A player who seems to be ignoring your aircraft works may
simply believe it is already destroyed.

**4. Separate High Commands.** Each player has their own orders and trust. Both
commanders can be "winning" in their own returns at the same time. Being relieved
of command loses the war for that player, so embellishment is a real risk in
PvP, not just flavour.

**5. Fairness.** In PvP there is no AI escalation bonus. Theater stage effects
(weather, flak, radar, close-support weight) apply to both sides. Each player
sees the map from their own side. The Aldmere and Directorate sides are mirror
images in rules, and differ only in names and paint.

**6. Turn protocol (shared by hotseat and LAN; implemented).** Each turn has five steps:

1. Both clients get the public theater state (sector ownership, weather
   forecast) plus their own private state.
2. Each player submits a `TurnPlan`. The host validates it against the rules
   (range, roles, fuel), exactly as `validatePlan` does for hotseat.
3. The host resolves the turn deterministically from the seeded RNG.
4. Each client receives only its own radio log, debrief and updated state.
5. The host autosaves. A dropped player rejoins from the host's save.

**7. One day, one aircraft.** A day resolves as: feints, then the main raids
(with sweeps screening the front, and both sweeps meeting each other if both
sides sweep), then recon, then landing. Every aircraft has a single state for
the whole day. A reserve fighter shot up chasing a feint is still damaged if it
meets the main raid, and an aircraft is never counted twice.

**8. Ideas for later:**

- A **"spoofing"** research that sends fake radio traffic to inflate the enemy's
  estimate of your strength.
- **Agents' reports:** a low-reliability tip-off about which sector the enemy is
  planning to hit, worth acting on only sometimes.
- **Turn timer** for LAN games, and **asymmetric scenarios** (one side starts a
  sector ahead but with a low-trust High Command).

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

- **Length:** three theaters of up to 10 weeks each. A decisive breakthrough ends
  a theater early (about 7 weeks on average in AI-vs-AI balance runs).
- **Escalation:** the single-player AI gets more supplies and becomes more
  aggressive with each theater. New R&D tiers (heavy bombers, drop tanks)
  matter more as targets get deeper.
- **Endings** depend on the theater results, Command Trust, and how many of
  your people survived:
  - *Victory:* win more theaters than you lose, or break through decisively in
    the last one.
  - *Pyrrhic victory:* you won, but almost no one who started the war is left.
  - *Stalemate / armistice*
  - *Relieved of command* (trust reaches zero)
  - *Collapse* (your front breaks in the final theater)
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
