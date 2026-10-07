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
| Economy | Three resources: **Supplies**, **Stores** (fuel and munitions), **Replacements** |
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

   The debrief has two sheets. *The Returns* shows the week in big figures,
   the damage board (holes stamped onto the type's plot over the faint holes
   of earlier weeks, beside "no record" ghosts of the aircraft that did not
   return and their last words) and the telegrams. *Reports & Front* holds
   the Form 541s, each with the adjutant's note on how its leader reports,
   and the front gauge swinging from last week's figure.
6. **High Command.** Filing the reports brings High Command's answer as one
   full-screen letter: the directives first ("You are to…"), the signal on
   your returns, then the week's memos, with the change in confidence stamped. How much you
   get depends on **Command Trust**, which is based on the results you
   *reported*, and not on what actually happened.
7. Repeat until the war ends or you lose.

### Art direction: the ops room desk

Every screen is an object on the commander's desk in a blacked-out operations
room: the HQ is an open manila folder with index tabs, the theater map lies on
baize under a brass edge, orders are typed on a clipboard, armor and damage
are drawn on blueprints (Wald's diagram), the R/T log is a teleprinter strip,
and High Command writes on letterhead. A lamp lights the desk: warm in the
evening while planning, near dark in the radio room, cool at dawn for the
debrief. Three type voices have fixed jobs: stencil (Silkscreen) for titles,
stamps and the one primary action; typewriter (VT323) for documents, data and
every control; handwriting (Pixelify) only for people speaking or annotating.
Aircraft fly only on the title screen; after that the war is paper.

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
lowers the lethality of hits there but costs speed, range and payload. Zones
rolled as deadly (14% or more) are made 30% deadlier still, and each plate cuts
a hit's lethality to 45% (34% with light alloy) but blunts general wear only
a little. In measurement (`scripts/armor.ts`), plating the truly deadly zones
loses about 12 bombers per 100 sorties; plating the holes loses about 18, and
no plate about 20. The hangar shows, next to the holes on returned aircraft,
how many last calls of crews who didn't come back named each zone: the only
word from the aircraft nobody sees.

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
- **Crews follow aircraft:** airmen are posted, and pupils taken in, only for
  aircraft the wing has or has on order. Crewless squadrons (such as a new recon
  flight) get graduates first.
- **The school on screen** is a pixel-art airfield that grows with each level:
  more huts, hangars, a classroom block, a tower and a headquarters. The
  syllabus shows (gunnery butts, a blackboard, a looping trainer), and pupils
  parade in ranks.

### 6.4 Factory

- **Throughput:** airframes per turn, by type.
- **Quality control:** low QC is cheaper and faster but adds hidden defects.
  Those turn up as unexplained losses, which crews blame on the enemy.
- **Refit capacity:** how many airframes can have armor or loadouts changed each turn.
- **R&D tree** *(implemented, 35 developments)*: six branches of mostly
  small, tiered steps. Their numeric effects add up (`core/tech.ts`).
  - **Gunnery:** manuals → gyro sight → cannon; power turrets → twin tail
    turret; gun cameras.
  - **Engines & airframes:** tuning → uprated engines; drop tanks; four-engine
    airframe → Mk II.
  - **Protection:** self-sealing tanks → face-hardened plate → light alloy
    plate; extinguishers; escape hatches → air-sea rescue (lost crews come
    home).
  - **Bombing:** bombsight Mk II → stabilised sight; target markers (less
    weather penalty); heavy-case bombs.
  - **Signals & intelligence:** VHF radios; radar → radar chain; photo recon →
    long-focus cameras; intelligence section.
  - **Industry & logistics:** jigs → moving line → shadow factories; repair
    gangs → field workshops; fuel economy → pooled stores; synthetic trainers.
- **The works on screen** grow with the factory level (sheds, chimneys,
  assembly hall, crane, rail siding). They show the build queue on the line,
  the QC policy (sparks or inspectors) and bomb damage (craters, fires).

### 6.5 Economy

| Resource | Used for | Comes from |
|---|---|---|
| **Supplies** | Upgrades, R&D, repairs, armor (4 per plate fitted; removal free) | High Command deliveries (scaled by trust and our works), plus a flat +15 each from the Requisition Office and War Economy Board developments; wrecks on our side of the line (written off on landing, or defenders shot down over our country) return 35% of their build cost as salvage |
| **Stores** (fuel and munitions, merged after playtest round 2) | Each sortie: fighter 3, medium 5, heavy 8, recon 2; flak batteries 20 | Rationed. Deliveries are about 80% of a full effort, so the wing must stand squadrons down from time to time. Depots hold at most 240. Bombing our fuel depots cuts deliveries. A "Fit to stores" button trims a plan that is too big. |
| **Replacements** | New airmen into training. Trained aircrew can also be asked of the Ministry for supplies (dearer the less it trusts you), but only for aircraft without crews. A squadron down to one or two aircraft can be merged into another of its type. | Posted, and taken into the school, only for aircraft the wing has or has on order. Crews follow aircraft, so none sit idle. |

**What bombing does** (one rule set, `effects.ts`, for both sides):
- **Airfields:** cratered runways keep part of each operation on the ground,
  up to half at 0%. Patrols scramble from dispersal strips and are not affected.
- **Fuel depots:** cut stores deliveries, down to 30%.
- **Aircraft works:** cut production, down to 40%, and weaken flak.

Wrecked works also push the front, week after week. The Intelligence tab shows
the effect on our works as known fact and on the enemy's as an estimate built
from our own beliefs about their sites. In hotseat and LAN each commander sees
only that view, so no hidden information leaks.

Between theaters the Ministry partly makes good a depleted wing, in proportion
to its confidence: up to 70% of the shortfall below 28 aircraft, and nothing
below a confidence of 30. Our own losses can't be talked down: more than two
aircraft lost in a week costs confidence. Difficulty scales the
AI's resources (Green ×0.51, Seasoned ×0.74, Wald ×1.08), and the AI gets 15%
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
  week**, and leftover pressure is capped at ±6, so the next sector has to be
  fought for and a theater can't collapse in two or three turns. No single
  week moves the front by more than 18, all causes together, and air fighting
  alone (losses on both sides) moves it by at most 8 plus chance.
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
  penalty. A recon photograph confirms it. A claim is judged by the site's
  condition when it was made, so enemy repairs since then do not discredit it.
  If the Army takes the sector, its engineers report what they find: a site
  already wrecked (25% or less), or wrecked when claimed and rebuilt since,
  confirms the objective; an intact one earns the wing no credit ("taken
  intact"), and an intact one that was claimed is discredited.
- **HQ orders** follow the theater: strikes on specific named sites, kill
  quotas, sortie quotas, and "advance" orders that are judged on the Army's own
  map and cannot be talked up. Strike orders always allow at least two weeks.
  Kill quotas follow the median of the wing's recent returns, so one inflated
  week doesn't set an impossible target. HQ only calls enemy fighter strength
  "broken" after a run of big claims. A photograph of a strike order's
  target counts toward the order (measured from the target's believed
  condition when the order was set). A strike whose results nobody saw gets
  one extra week for photographs. Group Intelligence credits our defending
  fighters with no more kills than the observers counted enemy aircraft over
  our side. Confidence above 75 wears off by 2 a week unless an order is met,
  and claims impress HQ half as much above 80.
- **The strategic duel.**
  - **Intentions:** the AI fixes its next target a week ahead, and the
    Y-Service warns of it. The warning is right 55–90% of the time, depending
    on radar, the radar chain and the intelligence section. Against a human
    enemy the analysts guess from habit. The warning shows on the briefing and
    on Operations, so patrols have a job.
  - **Emergency repairs:** 40 supplies patch every site of one type we hold by
    20%, once a week per type.
  - **Tipping points:** below 50% a type of works is CRIPPLED. Crippled
    airfields ground more of each operation and halve fighter cover; crippled
    depots and works lose a further 30%.
  - **Bombs, not captures, wreck works:**
    - The condition of a type of works is the average of the home sites still
      held, so losing ground doesn't wreck what lies behind it.
    - Bomb damage to works is multiplied by 2.5, so about three good raids
      cripple a type.
    - The immediate pressure from a strike is modest; the lasting effect does
      the work.
    - Crippled sites barely mend on their own; only paid repairs bring them
      back quickly.
    - A side whose airfields or fuel depots are crippled gets much less out
      of close support.
  - **Intelligence Section:** puts the true front within a band of about six points
  (on the briefing); without it, only the liaison's words and optimistic figure.
- **Swing cap:** no single raid can move the front by more than 15 points in
    a week.
- **Front warnings:** the Army warns a week ahead when either side's line is
  about to give way.
- **No capture without air cover.** A sector cannot fall in a week in which the
  side that would take it flew no operation, feint or defensive patrol. The
  pressure waits just short of the threshold.
- **Army liaison ledger.** Each debrief explains in words, not numbers, what
  moved the front: the air fighting (losses on both sides, with the fortunes of
  war folded in), close support, bombing of works, the state of works, depots
  and airfields on both sides, and
  enemy reinforcements. It is deliberately qualitative, so it can't be used to
  work out true kills.
- **The theater ends** when one side gains two sectors (decisive), or after 10
  weeks. A timeout goes to whoever holds the advantage *and has taken at least
  one sector*; otherwise it is a stalemate.

**Between theaters:** the winner gets a 4-point pressure head start in the next
theater (stated in the theater orders, and the Army liaison's estimate starts
from it), +15 trust and 100 supplies, and the loser loses 12 trust. Aircraft in
repair are made serviceable during the move and squadrons are rested. A
redeployment briefing shows the result, the new map and the new objective.

What you see of a theater is mostly true: sector ownership and your own sites.
The **condition of enemy sites** and the **pressure on the front** are beliefs,
built from crews' reports and an optimistic Army liaison.

### 6.7 Nations *(implemented)*

Each side fights for one of three nations, chosen before the war (the AI's
too, in single player). The nations push towards different ways of fighting
and counter each other in a loose circle: the radar net catches the mass
raids, the mass wears down the elite, and the elite's armor rides through the
radar net. All rules live in `core/factions.ts`; most strengths are innate
research effects added in `tech()`, so the simulation reads them like any
development.

| Nation | Strengths | Weaknesses |
|---|---|---|
| **Aldmere**, the radar net | Ground radar and photo recon from week 1, +12% interception, recon caught less often, +10% of lost crews home; reports stray a third less from the truth | Bomb load −10%; escorts turn back a sector sooner; confidence rises only 80% as fast |
| **The Directorate**, the elite | +1 armor plate per type (+2 heavy), armored seat (cockpit lethality ×0.7); +5% hits; gyro sight and cannon at half price; crews learn 1.5× as fast | Stores −35% and depots of 150; aircraft +25% dearer, works −15%; replacements −30%; confidence swings 1.5× both ways |
| **The League of Varn**, mass and supply | Works +30%, aircraft −20%, heavy bomber from week 1; 25 supplies a week of lend-lease whatever the trust; replacements +40%; a third fighter squadron | Twice the hidden defects; −1 plate per type and tanks that burn (fuel lethality ×1.2); weaker training and flak; more showmen and glory-seekers as leaders |

A war without nations (saves from before version 6, the tutorial, or "Nations:
off" on the title screen) is the classic one: Aldmere against the Directorate
with symmetric rules. Both sides must be different nations. Measured with
`npm run balance -- 200 --matrix` (the AI on both sides, equal resources):
every pairing ends between 48% and 57% of decisive theaters.

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

## 8.6 Squadron leaders as characters *(implemented)*

- **Reputation:** after five operations in command a leader earns a
  reputation, coloured by what his squadron went through:
  - **Ace:** his squadron shoots 10% better.
  - **Lucky:** rarely lost, and usually gets out when he is.
  - **Steady:** losses shake his squadron's morale less.
  - **Sharp-eyed:** his reports exaggerate half as much.
  - **Shaken:** his squadron tires faster and his reports wander.
- **Missing, then news:** the leader flies callsign 1. When his aircraft is lost
  he is only *missing*. Two to three weeks later comes one of three outcomes:
  - he is presumed killed, and the obituary follows;
  - the Red Cross reports him a prisoner;
  - rarely, he gets back through the lines and resumes command.

  Only men seen to bale out can turn up again, so the radio and the outcome
  agree.
- **Record:** each leader keeps a record of his requests and how they were
  answered, his close calls and his heavy losses.
- **Obituary:** built from human details rather than a list:
  - his last call;
  - something he used to say;
  - the request he pressed hardest and what you answered ("He asked three
    times to press his attacks home; you agreed once.");
  - a word from his successor.
- **Faces:** every leader has a unique pixel portrait, built from his name.
- **Succession:** when a CO is lost, two flight commanders could take over. Both
  have a visible character, and about half already have a name in the wing.
  The senior one takes command, but the commander may appoint the other in the
  week that follows. After a merge, the absorbed squadron's CO can be appointed
  the same way.
- **Deputies:** the man passed over, stood down or handing back command
  stays on as senior flight commander and is first in line next time. The two
  candidates always differ in character.
- **Medical rest:** the medical officer can take a "Shaken" CO off operations
  for two weeks, once per man. His deputy leads meanwhile. It costs a little
  squadron morale and 2 confidence. He comes back "Steady" 60% of the time;
  otherwise he is still shaken.
- **Exposure:** a CO keeps a damaged aircraft flying longer and presses only
  one attack in defence, so COs are lost about 1.7 times per 10 weeks across
  a four-squadron wing.
  It is shown on the squadron card and in the general's dispatch, in sepia
  with a mourning band when he is dead.
- **Prisoners of war:** parachutes are counted on every loss. Two to four weeks
  later the Red Cross reports some missing men, leaders included, as prisoners.
- **Names:** no name is reused within a war.

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
- **Strategist** *(implemented)*: the higher the difficulty, the more often it
  plays the duel on purpose:
  - **Counter-offensive:** when our squadrons are worn out (average fatigue
    from 5/10, or from 3.5/10 while we keep flying close support), it throws
    its bombers and up to three escort squadrons at our front.
  - **Crippling campaign:** it picks the type of our works nearest the
    front that is closest to the crippling line and strikes those sites week
    after week.

  The Y-Service names either plan when it reads the enemy correctly. An AI
  keeps to the target it fixed a week ahead whenever it can still fly it.
  The strategist plays on Green 15%, Seasoned 45% and Wald 90% of its
  insight.

### 10.2 PvP

Each human player is the other's "unknown force". Both plan at the same time
and commit. The simulation resolves both sides together, and each player gets
their own distorted debrief.

- **Hotseat** *(implemented)*: one PC, two named commanders. A sealed-folder
  handover screen appears before every planning, radio, debrief and
  redeployment phase, naming the commander it is for. Esc (or "Close folder")
  hides the screen at any time. The first commander's sealed orders are saved
  with the game, so a save made between the two planning phases resumes with
  the second commander. Sealing shows each commander an overview of their
  orders (tasks, doctrine, the route on the map, this week's changes); they can
  go back and amend them until the folder is passed on (or, for the second
  commander, until the week is fought). After the war, a **Both War Diaries** view puts each
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
  - **Amending sealed orders:** while waiting, either commander sees an
    overview of their sealed orders and can take them back (`unseal`) until
    the other has sealed too. A seal carries only the commands made since the
    previous seal, so nothing the host has already replayed is applied twice.
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
sees the map from their own side. The rules of the war are the same for
both; what differs is each side's nation (§6.7), which both players know.
In a classic war the two sides are mirror images and differ only in names
and paint.

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
- **High Command in person:** in weeks with orders, praise or blame, or news of
  the wing's own men, the general (or the Directorate's officer) reads the
  memos in an animated pop-up with a pixel-art portrait and typed text. At the
  end of a theater he reads the verdict, the cost and the roll of the missing.
- **Station life:** a scene or two a week from the wing's own airfield, more in
  a quiet week:
  - a squadron's evening off;
  - letters for the missing;
  - newcomers, with names;
  - leaders with a reputation;
  - the ground crews.

  Scenes are built per side in the core, so in hotseat and LAN each commander
  reads only their own.
- **Radio:** every call has several wordings, depending on weather, aircraft
  type and the leader's character, plus wounded calls and background chatter.
  Without VHF sets the wing listens on old HF equipment: many calls are lost or
  broken by static. Tower and ground reports come by telephone.
- **Tutorial:** a guided Green campaign. The adjutant walks through orders,
  resources, mission choice, the radio log, the damage plot, Form 541s, the
  missing, the front and armor, pointing at each element.
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
