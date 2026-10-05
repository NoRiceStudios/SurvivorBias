# Survivor Bias, round 2 playtest (Jonas Berg)

*Build `92661a0` (per-type lethality, leader requests). Green campaign (seed jonas3), then Seasoned (seed jonas4). The journal and screenshots stay in the session scratchpad.*

## 1. Ratings

**Fun: 7/10 [round 1: 7].** The evening loop is better now. The dead have names, the leaders talk to me, and the Ledger made me wince. The wars are too short and too easy, though. Seasoned was over in **9 weeks**, and one theater was won during a week when nobody flew. It's still 7, for different reasons: more heart, less tension.

**Weight of decisions: 7/10 [7].** Emotionally it's heavier. "Fg Off Walter Thorne and 4 crew" and "Next-of-kin telegrams will be sent in due course" landed hard. Turning down Hale's "That's where we keep getting hit, sir" felt like a real choice. Strategically it's lighter: close support won every theater, so my choices rarely changed the outcome. I never touched the returns policy because nothing pushed me towards it.

**Balancing: 4/10 [4].** It went from too punishing to too easy. Green was a victory in 16 weeks with 27 lost, against a defeat with 58 lost last time. Seasoned was a victory in 9 weeks with 12 lost. Theaters broke in 3, 3, 2 and 2 weeks. I ended with 282–324 supplies and fuel at its 320 cap. Kill quotas are still out of reach ("Destroy no fewer than 22 enemy aircraft in the next 2 weeks").

**UI: 8/10 [7].** I can see real fixes:
- a labelled top bar and "Our operation / Our defence" in the bottom bar;
- the plate cost written in the hangar, and the fatigue explanation;
- request cards with Approve/Decline buttons and the effect spelled out;
- the Ledger.

What still hurts is that a squadron silently drops out of a strike and the screen never tells me.

**Complexity: 7/10, about right [6].** Leader requests now teach doctrine and tactics through people ("Their tail gunners are murdering us coming in from astern"). That's exactly what I asked for. Feints, patrol sectors, quality control and the training syllabus are still never taught, and I never used them.

## 2. Campaign results

| | C1 green (jonas3) | C2 seasoned (jonas4) |
|---|---|---|
| Outcome | **VICTORY**, week 16 | **VICTORY**, week 9 |
| Narrow Sea | Won decisively, 10 weeks | Won decisively, 5 weeks |
| Kessel Basin | Won decisively, 3 weeks | Won decisively, 2 weeks |
| Northern Approaches | Won decisively, 3 weeks | Won decisively, 2 weeks |
| Own aircraft lost | 27 | 12 |
| Claimed / reported / actually destroyed | 93 / 93 / **31** | 39 / 39 / **10** |

**Did I get the idea this time?** Yes, and earlier than last time.
- **Damage:** I came in with round-1 memory. The game also kept reinforcing it, and I declined every "more plate on the outer wings/fuselage" request from C1 week 5 on.
- **Lines that reinforced it:**
  - "4 bombers did not return. Their damage was not recorded."
  - On the intel screen: "Only crews who survive an attack can describe it."
  - "Intelligence Section: estimates of enemy fighters range from 0 to 28."
- **Claims:** The C1 Ledger made this click. In week 2 we claimed 14 and actually got 2; in week 6, 19 claimed against 5.
- **The real surprise:** in C2's Declassified screen, the Kestrel's deadliest zone was the **engines (30%)** and the cockpit only 20%. In C1 the cockpit was 35%. I had armoured the cockpit from last war's lesson, which is survivorship bias of another kind. That's clever, but nothing during the war said the profile could change.

## 3. Changes since the last build

**Fixed**
- Fatigue warnings: the adjutant says "(9/10) is exhausted", and leaders ask for stand-downs.
- Missing crews are now named.
- The leader's loss appears in the News box.
- Weather now shows in the radio log and the Form 541s.
- The top bar has labels.
- The refit cost is shown.
- Orders are "rescinded… site now in our hands", and leftover orders from the previous theater are gone.
- "Plan: no operation with none" is fixed.
- The debrief top bar now reads "Week N debrief".
- Fighters no longer say "bomb doors".

**Improved**
- Reinforcements between theaters ("6 replacement aircraft with crews").
- The pressure threshold is shown ("about ±24"), but sectors fell at a displayed +0, +8 and +10, so the number still doesn't predict anything.

**Still broken**
- No feedback that armour ever saved anyone.
- Contradictory 541s: "Ferrymen returned 6/8 · enemy fighters none seen" (C2 week 9).
- Kill quotas can't be met.
- Theater victory is still one line in the News box.
- After the war the brief still shows "theater week 4/10" and a new order "by week 17".
- The radio screen header shows next week and only part of the log.

**Worse**
- Pacing: theaters now last 2–3 weeks.
- Names are worse than before (see problem 2).

## 4. Top problems now

1. **Bug: leader-loss notices don't match the Missing list.**
   - "Flt Lt Clive Lisle… is missing", but the list shows "Fg Off Hugh Lisle" (C1 week 2).
   - Penrose (C1 week 5), Ashworth (C1 week 15) and Carrow (C2 week 9) are never listed among the dead.
   - Callsign "1" isn't the commander: "Saint 1 has gone in", then Wexford still files the report.
2. **Bug: the name pool is tiny and tied to aircraft serials.**
   - Four Fenwicks died under Wg Cdr Leonard Fenwick.
   - "Walter Thorne" died in C1 week 1, C1 week 15 and C2 week 9.
   - MV-507 is always Edmund Brackley.
   - The same men die in every campaign.
3. **Bug/UX: assignments silently persist or drop.**
   - After a no-operation week the strike flew without the Ploughmen (C1 week 4, two Harrows lost).
   - "A week's stand-down" lasts indefinitely.
   - "strike Brandmoor Fuel Depot with S1 (6)" with **no bombers** was accepted with "Orders are valid." The result was 0% damage, a failed order and a dead pilot (C1 week 8).
4. **Pacing and balance:**
   - The Narrow Sea was won while every squadron rested ("0 of 0 aircraft returned").
   - Seasoned is shorter than green.
   - Resources pile up.
5. **Some orders are issued and due in the same week**, e.g. "by week 2 [DUE THIS WEEK]" (C1 week 12 and week 14, C2 week 2), often in storms.
6. **Still not taught in-game:** whether the hit pattern changes between wars, plus feints, patrols and QC.
7. **Small text bugs:**
   - "formation of about 1 aircraft"
   - "1 bombers did not return"
   - `approve R1; approve R2` fails with "No request R2" because the list renumbers after the first approval.
   - "AHEAD" on future theaters reads as "we're winning".
8. **Repetition:** Hale asked to "bomb from higher up" four times, and "press our attacks home" came up five times.

## 5. Suggestions

1. Make leader death the death of a named aircraft in the Missing list, give leaders callsign 1, and draw crew names from a large pool independent of the serial. [small tweak]
2. Warn before launch: "No bombers assigned", "Bombers unescorted" and "S2 is idle". Make stand-downs last one week. [small tweak]
3. Set a minimum theater length or add an enemy counter-offensive. Don't let a sector fall in a week when nobody flew. [big change]
4. Add a theater-won interlude: a short Ledger for the theater, losses and names. [small tweak]
5. Armour feedback in the hangar or debrief, e.g. "Plate in the engine of AA-840 stopped a cannon shell". [small tweak]
6. Scale kill quotas to wing strength, and give at least one week's lead time on every order. [small tweak]
7. Hint mid-war that "this war's" weak points differ, e.g. an intelligence or fitter note when last calls cluster on one zone. [small tweak]
8. Make fuel and munitions matter, or merge them. [big change]
9. Vary each leader's requests, and stop repeats for a few weeks after a decline. [small tweak]

## 6. Best and worst moments

**Best**
- C1 week 5: Hale asked for fuselage plate, "That's where we keep getting hit, sir." I said no and felt clever and guilty at the same time.
- C1 Ledger: "Week 6: claimed 19, actually destroyed 5."
- C2 Declassified: engines at 30%. My hard-won lesson was itself biased.
- Missing tab: seven names and "Next-of-kin telegrams will be sent in due course."

**Worst**
- C1 week 8: bombers left on "rest", fighters sent to bomb a fuel depot, and "Orders are valid."
- C2 week 5: winning the Narrow Sea while everyone slept.
- Burying "Walter Thorne" for the third time.
- The Ploughmen's fourth commander lost, again missing from the list of the dead.
