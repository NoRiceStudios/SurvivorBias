# Playtest round 1 (build 06e6101)

Two simulated players each played two full single-player campaigns through
`scripts/play.ts`, without access to the source code, and judged the UI from
screenshots of the real game.

| | Marta (strategy veteran) | Jonas (narrative player) |
|---|---|---|
| Fun | 6 | 7 |
| Weight of decisions | 4 | 7 |
| Balancing | 2 | 4 |
| UI | 7 | 7 |
| Complexity | 5 (right breadth, shallow effect) | 6 (about right, uneven) |
| Campaigns | Seasoned: victory, week 23 · Wald: victory, week 8 | Green: defeat, week 27 · Seasoned: victory, week 14 |

Full reports: [marta-report.md](marta-report.md), [jonas-report.md](jonas-report.md). Their journals are in the same folder.

## Fixed after round 1

- **Radio and report text:**
  - Last words match the aircraft type.
  - Aircraft that abort with mechanical trouble leave the fight.
  - Bomber leads make the bombing calls.
  - Weather appears in the radio log and on Form 541.
  - Squadron remarks fit the job flown.
  - Close support reports "enemy positions hit".
  - The garbled "Turn survivors" note is fixed, and notes are de-duplicated.
  - Crews who were attacked never report "none seen".
- **Names:** new squadrons get unused names. Leaders in a wing never share a first name or surname. Missing captains are named. Squadron leaders can be lost, with a change-of-command notice; the new leader may have a different character.
- **Orders:**
  - No duplicates.
  - No deadlines after the theater ends.
  - Kill quotas scale with the wing's reported rate.
  - Strike orders on sites we now hold are rescinded.
  - Orders from the previous theater are cleared.
  - Kill quotas are worded "in the next N weeks".
- **Validation:** recon flights, raids and feints with zero ready aircraft are rejected.
- **Intel:** a discredited claim replaces the crews' estimate with the Ministry's photograph.
- **Armor feedback:** the ground crew note when a plate stopped a hit that would have been fatal. Fitting plate costs supplies; removing it is free.
- **Balance:**
  - At most one sector falls per week.
  - Controllers learn repeated feints, and the Army masses flak against repeated close support.
  - The AI patrols and sweeps its front when hit there.
  - Fuel and munitions are rationed, with depot caps.
  - Replacement aircrew arrive only while short.
  - The factory is faster.
  - Ministry reinforcements arrive between theaters.
  - Difficulty scales the AI's resources.
  - Secondary objectives taken by capture pay half.
- **UI:**
  - Labelled top-bar resources, with the confidence value and pressure figure.
  - An Adjutant's notes panel: fatigue, morale, idle crews, idle engineers or works, fuel shortfall, low confidence, storms.
  - Pressure threshold explained.
  - Fatigue and morale explained.
  - Compact target list on operations.
  - Hangar fits on one screen.
  - The bottom bar says "Our operation".
  - Claims chart has values.
  - The debrief top bar shows the debrief's own week.
  - High Command's reply shows the returns actually submitted.

Measured with `scripts/strategies.ts` (30 games per cell): the "close support + feint every week" recipe now wins 0–17% (previously 15–30%), while a mixed AI-level player wins 57% on Green, 37% on Seasoned and 23% on Wald.

## Design decisions after round 1

- **Lethality:** randomised per campaign and per aircraft type. Implemented.
- **Strategic bombing:** left as it is.
- **Theater pacing:** kept as it is (at most one sector per week).
- **Teaching:** squadron leaders' requests. Implemented.

## Round 2

Build `92661a0`. Reports: [Marta](round2-marta-report.md), [Jonas](round2-jonas-report.md).

| | Fun | Weight of decisions | Balancing | UI | Complexity |
|---|---|---|---|---|---|
| Marta (round 1 → 2) | 6 → 7 | 4 → 6 | 2 → 4 | 7 → 8 | 5 → 6 |
| Jonas (round 1 → 2) | 7 → 7 | 7 → 7 | 4 → 4 | 7 → 8 | 6 → 7 |

### Fixed after round 2 (small changes)

- **Names and leaders:**
  - The squadron leader flies callsign 1. When he is lost he is listed by name among the Missing, and his replacement never shares his name.
  - Crew names come from a large pool, seeded per campaign, instead of being tied to the serial number.
- **Requests:**
  - Recon pilots make none.
  - A leader waits four weeks before repeating a request.
  - Numbers stay stable while you answer them.
  - A stand-down lasts exactly one week.
- **Orders and HQ:**
  - Strike orders allow at least two weeks.
  - Kill quotas follow the median of recent returns.
  - "Enemy fighter strength is broken" only follows a run of big claims.
- **Theaters:**
  - The head start is 8 instead of 15. It is stated in the theater orders, and the Army liaison's figure starts from it, so the display no longer shows "+0".
  - No sector falls in a week the capturing side flew nothing.
  - A theater-decided summary shows our losses, claims and sectors taken (in the game and the text interface).
- **Debrief:**
  - The Army liaison gives a qualitative ledger of what moved the front.
  - The Form 541 says when losses were to flak or return fire rather than "none seen".
  - The archive counts aircraft written off on landing as losses.
  - Pluralisation is fixed ("1 hole", "a single enemy aircraft").
- **Plans:**
  - A strike with no bombers is refused.
  - The adjutant lists squadrons with no task.
- **UI:**
  - The radio screen shows the operation's week.
  - Mission cards sit beside the site list, so the assignments are visible without scrolling.
  - "AHEAD" now reads "TO COME".
  - Theaters are numbered in the record.
- **Weather and teaching:**
  - Forecasts are right about 75% of the time and never confuse clear with storms.
  - A campaign-start memo warns that what held for one type or one war may not hold for the next.

### Measured after the fixes

Measured with `scripts/strategies.ts` (30 games per cell; win rate on Green, Seasoned and Wald, then average weeks per theater):

| Strategy | Win rate | Weeks per theater |
|---|---|---|
| Round-2 recipe: support + escort + front patrol, every week, no rotation | 10% / 7% / 7% | 5–9 |
| Round-1 recipe: support + feint | 7% / 0% / 0% | — |
| Mixed AI-level player | 60% / 47% / 30% | 7.4–8.9 |

The testers' fast wins came from playing the combination well (rotation, armor, rest), not from the combination alone.

### Open questions for the designer (big changes)

- Should the strategic layer (works, fuel, heavy bombers) feed the front more directly?
- Should winning on advantage require at least one captured sector?
- Should fuel, munitions and training be restructured?
- Should theaters be longer?
