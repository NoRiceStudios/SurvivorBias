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
