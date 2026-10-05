# Survivor Bias — Playtest report (Jonas Berg)

*Persona: 27, primary-school teacher; plays narrative indie games (This War of Mine, Papers, Please, Frostpunk, Into the Breach) in short evening sessions; not a wargamer; learns by doing. Played build `06e6101` through `scripts/play.ts` and judged the UI from screenshots of the real game. The journal is in `jonas-journal.md`.*

## 1. Ratings

**Fun: 7/10.** The weekly loop works: set orders, read the radio log, open the debrief. I wanted "one more week" the way I do in This War of Mine. Campaign 1 turned into a hopeless grind from about week 21 (11 aircraft left, 126 idle aircrew). Campaign 2 ended with no build-up at all: the last theater was won in one turn.

**Weight of decisions: 7/10.** The returns policy really is a moral choice. I lied once, got a commendation, then got caught. Armour placement became a real question once I understood it. Losses hit hard ("NO REPORT — 0/3 returned"), but the crews have no names ("crew of 1"). Squadron leaders die without any mention and are replaced by someone with a recycled name, so the grief has nowhere to go.

**Balancing: 4/10.** On green, following the ground crew's advice led to defeat with 58 aircraft lost. Seasoned, played with hindsight, was a victory in 14 weeks with 18 lost. The factory makes about one aircraft a week while I lost 3–6, so early losses snowball and can't be recovered. Fuel (1,596) and munitions (1,009) piled up and never mattered. Kill quotas could not be met with the wing I had.

**UI: 7/10.** The screens are beautiful and look like paperwork. The hangar's "Armor layout / Damage survey" pair (s10, s16) and the Declassified screen (s27) are excellent. Some things confused me: top-bar resource icons have no labels, the confidence bar is unreadable (it looks empty at 100/100 in s37), and the bottom bar "Kesselspitze Airfield: 17 aircraft · Defence: 6 fighters" reads like enemy strength. Nothing warns about fatigue, and the cost of moving armour isn't shown until it's spent.

**Complexity: 6/10, about right overall, but uneven.** It's too complex in the places the game never teaches: doctrine sliders, interceptor tactics, quality control, feints and patrol sectors. I never touched most of them. It's too simple, or too opaque, in how front pressure becomes a captured sector: +13 took a sector, +32 took nothing.

## 2. Campaign results

| | C1 green (seed jonas1) | C2 seasoned (seed jonas2) |
|---|---|---|
| Outcome | **DEFEAT**, "The Front Has Collapsed", week 27 | **VICTORY**, week 14 |
| Narrow Sea | Won on advantage, 10 weeks (+1 sector) | Won decisively, 8 weeks |
| Kessel Basin | Won on advantage, 10 weeks | Won decisively, 5 weeks |
| Northern Approaches | Lost decisively, 7 weeks | Won decisively, **1 week** |
| Own aircraft lost | 58 | 18 |
| Claimed / reported / actually destroyed | 81 / 81 / **34** | 56 / 61 / **27** |

**Did Jonas get the survivorship-bias idea?** Partly in C1 week 4. Three radio calls said "We're burning, the tanks are going—" while the Chief Fitter kept asking for plate on the outer wings, and the title-screen quote made the connection. So I moved armour to fuel and engines. But I followed the last radio calls, not the empty zones. The nose (0% of holes) and cockpit (2%) stayed thin, and the Declassified screen showed the cockpit is the deadliest zone at 32%. It fully clicked on that screen. The claims side clicked in C1 week 9, when Air Ministry said enemy fighters were "assessed as broken" in the same week 14 of them jumped us. It clicked again in C2 week 7 with the formal inquiry.

## 3. Top problems (most severe first)

1. **Bug: new squadrons reuse existing names.** In C1 week 25 the heavy-bomber squadron was formed as No. 15 "Vespers", the same as my fighter squadron. The debrief then has two "No. 15 Vespers" rows and the radio has two "Vesper 1"s. In C2 week 14 the recon squadron was formed as No. 61 "Long Odds", the same as a Harrow squadron. Leader names repeat too: "Wg Cdr Leonard Hale" next to "Flt Lt Leonard Hale", plus Desmond Hale and Roland Pryce.
2. **Death spiral / production.** The factory makes 4.5–6 points a week while the enemy keeps bombing it. By C1 week 27 I had 126 replacement aircrew and nothing for them to fly.
3. **Wrong radio lines.**
   - Single-engine Kestrels radio "Both engines gone, we're losing height—" and "Number two is burning, can't feather it" (C1 weeks 15 and 27).
   - Fighter leaders say "Bomb doors open / Bombs gone" (C1 weeks 7 and 24).
   - A leader who aborted keeps reporting: "Vesper 1: Rough running… aborting", then "Vesper 1: Vesper 3 is going down" (C2 week 14).
4. **Contradictory Form 541s with no explanation.** "Enemy fighters: none seen · Attacks came mostly: from astern" (C2 week 4, s30). Several squadrons report "~0" fighters in the same week they lost aircraft to fighters.
5. **Fatigue was never surfaced.** Every squadron hit 9–10/10 by C1 week 5 and nothing told me. I found it by accident.
6. **No armour feedback.** I never learned whether a plate saved anyone. Re-armouring at the start of C2 silently cost 120 of my 160 supplies.
7. **Standing orders.**
   - Kill quotas are impossible for the size of the wing.
   - C1 week 19: "…Kesselstadt in our hands, by week 21", but that theater ended in week 20.
   - C1 week 25: the same order appears twice ("by week 26" and "by week 27").
   - Orders left over from the previous theater show up in Correspondence (C1 week 11, C2 weeks 9 and 14).
   - C1 week 4: "Destroy 12 by week 4" was issued when I already had 13 claimed, then marked NOT fulfilled.
8. **Pacing.** In C2 the final theater was won in a single turn. Winning a theater in C1 was one line of text and then straight on. There's no moment to feel it.
9. **Smaller UI and text issues.**
   - "Turn survivors of the No. 73 'Saints' are badly shaken" is a typo, printed 2–3 times (s24).
   - "Plan: no operation with none."
   - After a "no operation" week the bombers stay unassigned ("Close Support with none").
   - During the debrief the top bar already shows next week (s06, s37).
   - The radio screenshot shows a line cut off mid-typing ("18 of 20 aircraft ba", s05).
10. **Weather forecasts never visibly matter.** In C2 week 12 the forecast was "Storms" and the radio said "Sky is clear."
11. **State left over after the war.** After the collapse, the briefing still showed "theater week 8/10", a new order "by week 29" and "pressure in our favour (+2)".

## 4. Concrete suggestions (highest impact first)

1. Fix squadron and leader name generation so names are unique. [small tweak]
2. Give the dead names. List crew names under Missing, add one line when a squadron leader is lost, and maybe a next-of-kin letter. [small tweak]
3. Make recovery possible: a reinforcement draft between theaters, a way to turn surplus aircrew and fuel into production, and gentler attrition on green. [big change]
4. Have an adjutant warn about fatigue ≥7, morale ≤2 and orders that can't be met, and suggest resting. [small tweak]
5. Show armour working. In the debrief, say something like "Plate in the cockpit of AA-840 stopped a cannon shell". Show the refit cost before confirming. [small tweak]
6. Show a pressure threshold on the front line ("+40 needed to take Hafenburg"). [small tweak]
7. Fix standing orders: scale quotas to wing strength, no deadlines past the end of the theater, remove duplicates, clear old-theater orders. [small tweak]
8. Make radio death lines depend on aircraft type and role. Pass the lead to a bomber or surviving aircraft. [small tweak]
9. Set a minimum length for each theater, or add a final enemy counter-offensive, so a theater can't end after one turn. Add a short "theater won" debrief screen. [big change]
10. Label the top-bar icons, add tooltips, and give the confidence bar real contrast. [small tweak]
11. Mention the weather in the radio log and the Form 541s. [small tweak]
12. Teach doctrine, tactics and QC through leader remarks ("Hale asks to fly a tighter box"). [big change]

## 5. Best and worst moments

**Best**
- **C1 week 3:** "The Army reports Kesselspitze taken." I'd switched to Close Support on a hunch, and it worked.
- **C1 week 11:** "No. 9 'Ploughmen': NO REPORT — 0/3 returned." I stared at it.
- **C1 Declassified (s27):** "What you saw: 452 holes… What you never saw: 243 holes… The 25 hits that brought them down." The best screen in the game. It made losing worth it.
- **C2 week 7:** "A formal inquiry has been opened… Form 1180 (Explanation of Discrepancy) is to be submitted in triplicate." Funny and shaming.
- **Intelligence Section:** "At least one squadron is badly wrong."

**Worst**
- **C1 weeks 21–27:** watching 3–4 aircraft fly into 41 enemy fighters while 126 crews sat idle, then the collapse.
- **C1 week 25:** two squadrons called "Vespers". It broke the spell completely.
- **C1 week 11:** Wg Cdr Lisle simply disappeared. Next week a "Flt Lt Roland Pryce" led the Ploughmen with the same "Showman" trait.
- **C2 week 14:** the whole Northern Approaches theater lasted one click.
