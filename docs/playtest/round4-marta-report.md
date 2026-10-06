# Survivor Bias playtest, round 4 (Marta Kowalczyk)

*Build `158b5d7`. Two campaigns, 29 weeks in total:*
- *C1: Wald, seed `marta6`. Won in 14 weeks.*
- *C2: Seasoned, seed `marta7`. 15 weeks: Narrow Sea won, Kessel Basin at week 6 of 10.*

*In C2 I tried the strategic tools on purpose: deep strikes first, repairs, and patrols placed on the Y-Service warnings.*

## 1. Ratings

| | Rounds 1–3 | Round 4 |
|---|---|---|
| Fun | 6 / 7 / 7 | **7** |
| Weight of decisions | 4 / 6 / – | **6** |
| Balancing | 2 / 4 / – | **3** |
| UI | 7 / 8 / – | **8** |
| Complexity | 5 / 6 / – | **6** |

**Fun.**
- The C2 Narrow Sea was the tensest theater yet: −16 in W4, the sector taken in W10, the last week.
- Penrose's obituary (C2 W11) hit hard.
- C1 on Wald was a walkover, though: theaters of 4, 7 and 3 weeks, all decisive.

**Weight of decisions.**
- Real dilemmas now:
  - whether to trust the Y-Service;
  - whether to give a 10/10-fatigue squadron its stand-down;
  - when to pay for repairs.
- In C2 W6 the Y-Service said "quiet". I rested my patrol, 14 bombers hit the line, and the front fell from +16 to +2. That cost was earned.
- But close support still decides every theater, and deep strikes lose.

**Balancing.**
- Wald was easier than Seasoned: 27 aircraft lost over 14 weeks, against 20 lost in C2's first theater alone.
- Every new theater opens at +8.
- 8–9 free replacement aircraft arrive at each redeployment.
- Supplies pile up past 300.

**UI.**
- **Good:** the Y-Service strip, the leader badges, the squadron records.
- **Still wrong:**
  - squadron assignments start below the fold;
  - the general's pop-up covers the map every week;
  - the radio log text is clipped in `20-radio.png`.

**Complexity.**
- The 35 developments are mostly +5–15% steps: variety, but rarely a choice.
- Expanding the school is a trap: in C1 W9 my 90-supply expansion trained nobody.

## 2. What improved / what still bugs me

**Improved**
- **Leaders are characters now.** Their reputations, records and obituaries reference my own decisions. POW notices close the loop on counted chutes.
- **Y-Service warnings plus patrols** create a real defensive guessing game. About 5 of 9 warnings in C1 were right.
- **My round-3 points were fixed:**
  - Request numbers are stable.
  - Recon got a crew.
  - A capture no longer counts as wrecking a site.
  - Creative returns triggered an inquiry.
- **Strikes push the front now.** C2 W12 went from +7 to +20 in a strike week.

**Still bugs me**
- **Deep strikes cannot reach the tipping point, while capture does it for free.**
  - C2 W1–4: three strikes on Kesselspitze Airfield cost 11 aircraft, and their airfields were still estimated at ~90%.
  - In C1 the enemy's airfields became CRIPPLED only through captures.
  - Meanwhile ours read 117% and 138%.
- **The armor lesson is still solved before play starts.** Outer wings and fuselage were 1–2% on every type.
- **Front warnings are unreliable.** "One more good week could break it" came four weeks running at +20 to +26 with no break, and "Cracking" appeared while pressure was improving.
- **Kill quotas still scale with fantasy claims.** 23 claims led to "21 in 2 weeks".
- **Crews don't move between squadrons of the same type.**

## 3. What it takes to get to 9 or 10

1. **Make the strategic duel a real alternative to close support. [big]**
   - A capture should not halve the enemy's works.
   - About three good strikes should cripple a type, and that should visibly cut their close support and fighter numbers.
   - Make one theater costly to break through without crippling first.
2. **Make difficulty bite through attrition, not openings. [big]**
   - Drop the +8 start.
   - Tie reinforcements to confidence and losses.
   - Give supplies somewhere to go.
3. **Randomise the safe zones each war. [small]**
   - Sometimes the outer wings or the fuselage should be lethal on a type.
4. **Give credibility a track record. [small]**
   - Show the Y-Service hit rate.
   - Give one wavering warning per real threshold.
   - Add one word for the size of the weekly change.
5. **Base kill quotas on something real. [small]**

## 4. Bugs

1. "PHOTOGRAPHIC INTERPRETATION: undefined at 99% capacity" in a theater-ending week.
2. Single-seat fighters were "baled out… his crew is missing" or "rescued with his crew".
3. Rescues ignore what was seen and heard: "Pilot's dead…", then rescued; "blew up, 1 chute", then all 5 home.
4. Patrol losses are silent: no radio lines, "Last heard: nothing".
5. A close-support week had no close-support line in the liaison ledger.
6. Radio problems:
   - one chatter line was duplicated;
   - "Keep an eye on the bombers" on a pure sweep;
   - "Anyone seen Tinker 1?" while Tinker 1 was fine.
7. The "quiet" Y-Service memo still says "patrols over that sector would meet the raid".
8. "1 of the crew … are alive".
9. A recon leader's operations aren't counted.
10. Our own works read above 100%.
11. Failing commands are buried inside a `;` chain in the text interface.
12. A POW notice came one week after the loss.
