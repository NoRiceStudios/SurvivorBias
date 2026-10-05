# Survivor Bias — Playtest report (Marta Kowalczyk)

*Persona: 38, operations analyst; strategy veteran (XCOM 2 Legend, Battle Brothers, HoI IV, Highfleet, FTL). Optimiser, exploit-hunter, knows the Wald story. Played build `06e6101` through `scripts/play.ts` and judged the UI from screenshots of the real game. The journal is in `marta-journal.md`.*

## 1. Ratings

**Fun: 6/10.** The first ten weeks of campaign 1 were tense and interesting. Bombers vanished with "Nothing heard", my crews' claims came back to me as HQ propaganda ("Enemy fighter strength is assessed as broken"), and VHF radios finally let the dead talk. After I found close support plus a feint, the game became one button press a week. Campaign 2 on Wald was over before it got interesting.

**Weight of decisions: 4/10.** One decision, close support plus a feint, decides the war. Armor, doctrine, flak, training and strategic targets hardly mattered. In campaign 2 I lost zero bombers, so the armor puzzle never even came into play. I researched the heavy bomber in both campaigns and never flew one.

**Balancing: 2/10.** Wald, the hardest difficulty, took 8 weeks and cost me 8 aircraft. Seasoned took 23 weeks and 37 aircraft, because I spent ten weeks learning. Captures snowball: in C2 W4 two sectors fell in one week and in W8 three did. Fuel and munitions never constrained anything (C1 W23: fuel 1,099, munitions 722). Kill-quota orders were nearly impossible to meet.

**UI: 7/10.** The art is gorgeous and the paper aesthetic works. The Form 541 cards (s07), the missing-aircraft list (s08) and the three-plane Declassified plot (s17) are excellent. The problems: numbers are hidden where I need them (confidence bar has no value, claims chart has no axis), and key controls sit below the fold.

**Complexity: 5/10. About right in breadth, too shallow in effect, and opaque in places.** There are plenty of systems, but fatigue, morale, doctrine sliders, confidence and front pressure never tell me what they do. Training, fuel and munitions are busywork. The front-line model, the one thing that actually matters, is too simple.

## 2. Campaign results

| | C1: Seasoned, `marta1` | C2: Wald, `marta2` |
|---|---|---|
| Outcome | VICTORY, week 23 | VICTORY, week 8 |
| Narrow Sea | Won on advantage, 10 weeks (+1 of 2 sectors) | Won decisively, 2 weeks |
| Kessel Basin | Won decisively, 9 weeks | Won decisively, 2 weeks |
| Northern Approaches | Won decisively, 4 weeks | Won decisively, 4 weeks |
| Own losses | 37 aircraft | 8 aircraft (0 bombers) |
| Claimed by crews / reported to HQ / actually destroyed | 105 / 113 / **41** | 26 / 27 / **15** |

## 3. Top problems (by severity)

1. **Dominant strategy: close support plus a feint.**
   - C2 W1 on Wald: 28/28 aircraft back, the feint reported "Sky is clear. No fighters yet.", and Kesselspitze fell.
   - C2 W8: Nordwall, Grauburg and Nordheim all fell in one week.
   - The enemy never adapts to the same feint repeated every week.
   - Strikes on industry or fuel have no visible effect. In C2 W6–7 front pressure actually dropped from +25 to +14 while I was striking.
   - Secondary objectives complete by capture: "Secondary objective achieved and confirmed: Kesselstadt Assembly Plant" (C1 W19, C2 W4). I never bombed it.
2. **The central reveal can be skipped and memorised.**
   - With no bomber losses, Declassified reads "0 holes on aircraft that did not return… The 0 hits that brought them down" (s22).
   - The lethality table (cockpit 32%, fuel 26%, engines 24%, outer wings 0%) was identical across seeds and difficulties, so after one war the armor puzzle is solved.
3. **Bugs:**
   - Fighter radio lines describe multi-crew bombers. A single-seat Kestrel says "Nose is shot out, bombardier's dead" (C2 W5), and Kestrel GC-322 says "Both engines gone" (C2 W8).
   - Aborted aircraft are later shot down over the target. C1 W6: Saint 4 reported "Hydraulics failed, returning to base" at T+008, then "Saint 4 is going down" at T+053. Same pattern for Nightjar 1 in C1 W17.
   - Recon was accepted with 0 aircraft: "Recon: S5 (0) photographing Kesselstadt Assembly Plant", followed by "Photo-reconnaissance aircraft failed to return" (C1 W12).
   - Impossible orders:
     - "Inflict at least 12% damage on the Kesselspitze Airfield by week 2" stayed open after we captured it, then came back "NOT fulfilled" (C2 W2).
     - Orders due "by week 11" and "by week 12" were issued in a 10-week theater (C1 W9–10).
     - Two kill quotas were due the same week (C1 W20).
     - "Mount at least 17 sorties next week" was tagged [DUE THIS WEEK].
     - "Destroy 13 by week 7" failed and was immediately reissued as "13 by week 8".
   - Garbled and duplicated note: "Turn survivors of the No. 73 "Saints" are badly shaken." (C1 W11).
   - Intel kept Kesselspitze Airfield at "11%" (s13) after the Air Ministry had photographed it "working normally" and withdrawn my claim.
   - A squadron on home defence "recommends the target be given to the heavies". Close-support reports give "bombing: est. 33% destroyed" with no site attached.
4. **Missing or confusing information:**
   - Front pressure has no visible threshold. +26 took a sector in the Narrow Sea; +33 took nothing in the Kessel Basin (C1 W12).
   - Fatigue reached 10/10 (C1 W8) with no stated effect.
   - Confidence resets to 60 each theater. What it buys, and what my optimistic returns and the "formal inquiry" cost me, is never shown.
   - "Creative" returns turned 1 claim into 2. That was the whole effect.
   - Kill quotas failed 6 of 7 times, because about 3 claims a week was the realistic maximum.
5. **Economy and tedium:**
   - Supplies are the only real resource. Training expansion was wasted: 101 unused replacement aircrew at the end.
   - Refitting armor costs 4 supplies per plate removed *and* per plate added, so re-laying out two bomber squadrons costs 80. The cost isn't previewed, and my research order bounced for lack of a single supply.
6. **UI:**
   - The confidence meter is unlabelled (s02).
   - The claims-per-week chart has no axis (s13).
   - On the operations screen the squadron assignments are below the fold (s03, s20). On the hangar screen the tail row is below the fold (s04, s15).
   - The debrief top bar already shows the next week: "Week 8 … week 5/10" (s24).

## 4. Suggestions (by impact)

1. **[big change]** Make close support costly and adaptive.
   - Losses should rise when you hit the same sector repeatedly.
   - A feint should lose effect when it is predictable.
   - Pressure should taper off.
   - Capturing sectors should not cascade.
2. **[big change]** Tie strategic bombing to the front, and show the link.
   - Damaged enemy works should mean fewer enemy fighters; damaged fuel should mean less enemy pressure.
   - Industry objectives should require verified damage, not capture.
3. **[big change]** Randomise the per-zone lethality every campaign within plausible bounds. On Wald, guarantee that deep missions are needed, so bombers actually die and the archive has something to say.
4. **[small tweak]** Show the numbers:
   - the pressure needed to take a sector
   - the confidence value and what it buys
   - what fatigue and morale do
   - the refit cost before I commit
   - a weekly supply ledger
5. **[small tweak]** Fix the radio and report bugs listed above. Also validate orders: no 0-aircraft recon, no orders against captured sites, no deadlines past the end of a theater.
6. **[small tweak]** Scale kill quotas to the wing's observed claim rate.
7. **[small tweak]** Give fuel and munitions a real cost, or merge them into supplies. Make training level matter, or cut it.
8. **[small tweak]** Label the confidence meter, add an axis to the claims chart, and keep the operations and hangar controls above the fold.

## 5. Best and worst moments

**Best:**
- C1 W13–14 after radios: the missing crews finally speak. "Fuel's pouring out of the wing, she's on fire—", "Main spar's gone, she's rolling over—". The survivors showed fuel tanks at 3% of holes, so I moved the plates to the fuel tanks. That's Wald, played out as a game.
- C1 W5: "Your claim to have destroyed it has been withdrawn." The lie caught up with me, and the objective was marked DISCREDITED.
- C1 end: the Declassified screen (s17) showing 382 holes seen against 125 never seen. Pure payoff.

**Worst:**
- C1 W3: 5 of 10 Harrows lost, four "Nothing heard", and no way to learn why. It hurt, which is fair, but there was no way to act on it yet.
- C2 W1: realising the hardest difficulty folds to one combination in week 1.
- C2 end: a VICTORY stamp after 8 weeks, and an empty Declassified screen.
