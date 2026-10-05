# Survivor Bias playtest, round 2 (Marta Kowalczyk)

*Build `92661a0` (per-type lethality, leader requests). Wald campaign (seed marta3), then Seasoned (seed marta4). The journal and screenshots stay in the session scratchpad.*

## 1. Ratings

**Fun: 7/10** [round 1: 6]. The Narrow Sea is a real fight now on both difficulties. The radio-to-armor loop gave me my best moment of either round. The feint finally costs something. Theaters 2 and 3 still fold in 2–5 weeks, so each war loses its tension after week 10.

**Weight of decisions: 6/10** [4]. Several decisions now matter: armor layout, fatigue rotation, the defence patrol, honest returns (inflating them now gets punished) and the feint as a sacrifice. One combination still decides the war, though. Strategic strikes, secondary objectives and the heavy bomber were all irrelevant again.

**Balancing: 4/10** [2]. Wald costs real blood now: 43 aircraft and 24 weeks, where round 1 took 8 weeks. But theaters 2 and 3 fell in their first week in all four cases, starting from a displayed "+0". On Seasoned, the Kessel Basin, "the most heavily defended ground of the war", fell in 2 weeks. Fuel hit its 320 cap by week 11 and was never touched.

**UI: 8/10** [7]. Most of what I asked for is fixed:
- the claims chart has numbers
- the hangar's armor rows fit on screen
- fatigue and morale are explained
- factory output is shown

Remaining problems: squadron assignments still start at the bottom edge, there are season and week mismatches, and "1 holes".

**Complexity: 6/10, about right** [5]. Fatigue, the ±24 sector threshold and confidence are explained now. Two things are still wrong. Fuel, munitions and training are busywork: 8–13 aircrew sat idle with no aircraft all war. And the pressure model gives no breakdown of where a week's change came from.

## 2. Campaign results

| | C1: Wald, `marta3` | C2: Seasoned, `marta4` |
|---|---|---|
| Outcome | VICTORY, week 24 | VICTORY, week 17 |
| Narrow Sea | Won on advantage, 10 weeks (+23, **0 sectors taken**) | Won on advantage, 10 weeks (0 sectors taken) |
| Kessel Basin | Won decisively, 10 weeks | Won decisively, **2 weeks** |
| Northern Approaches | Won decisively, 4 weeks | Won decisively, 5 weeks |
| Own losses | 43 | 32 |
| Claimed by crews / reported to HQ / actually destroyed | 113 / 124 / **43** | 110 / 110 / **32** |

In both wars, enemy aircraft actually destroyed exactly equals my own losses. The weekly rows differ, so it may be chance, but please check it.

## 3. What changed since the last build

- **Close support plus a feint: partly fixed.**
  - Wald W1 with the old combination gave +13 pressure and no capture.
  - The feint is now a real sacrifice. In C2 W16 it drew about 17 fighters and lost 3 Kestrels, while my heavies saw none.
  - However, a new dominant strategy has replaced it (see §4).
- **Strategic bombing tied to the front: still broken.**
  - Strikes lowered pressure. C2 W6: 21% damage on the oil terminal, and pressure went from −3 to −11.
  - Secondary objectives still complete by capture, now stated openly: "achieved by the Army taking it… Awarded: 60 supplies."
- **Per-campaign lethality: improved.**
  - Top killers were Harrow wing roots at 29% in C1, and Harrow fuel tanks at 27% plus Kestrel cockpit, engines and fuel at 29% in C2.
  - But outer wings and fuselage were 1–2% in every war and on every type. In C2 I re-armored blind in W1 and was right.
- **Missing numbers: mostly fixed.**
  - The sector threshold (±24, one a week) is shown.
  - Confidence says "deliveries grow with it".
  - Fatigue's effect is stated.
  - Removing a plate is free and the cost per plate is shown.
- **Radio lines on the wrong aircraft type: fixed.** A Harrow says "Nose is shot out, bombardier's dead"; a Kestrel says "No elevators, I'm spinning".
- **Inflated returns: fixed.**
  - In C1 W14, creative returns turned 4 claims into 7 and filled a kill quota.
  - In W18 came "A formal inquiry has been opened": confidence fell from 98 to 78, plus a reprimand.
- **Kill quotas: overcorrected.** They now scale with claims, so a 26-claim week produced "Destroy no fewer than 35… (by week 15)".
- **Same-week orders: still broken.** C2 W3: "Inflict at least 18% damage… by week 3 [DUE THIS WEEK]". The same happened in W6.
- **Fuel, munitions and training: unchanged.**
- **The debrief and radio top bars still show the next week:** "week 6/10" after a war that ended in theater week 5.

## 4. Top problems now

1. **New dominant strategy: close support with escort, plus one fighter squadron on defence patrol over the front.**
   - C2 W8, defence alone: −7 to +4 with zero losses.
   - W9, the full combination: +4 to +23 with zero losses.
   - W11 and W12: one sector taken each week, and the Kessel Basin was won.
   - **Every** new theater fell in week 1 from a displayed "+0" (C1 W11 and W21, C2 W11 and W13). "Theater record: … ahead" looks like a hidden head start.
2. **The strategic layer is still decorative.**
   - In C1 I researched the heavy and the war ended before it ever flew.
   - In C2 I stalled the front for two weeks to fly them. Two Colossus bombers did 3% to Nordheim Tank Farm, and pressure fell from +16 to −5.
   - The Narrow Sea counted as a VICTORY both times with zero sectors taken.
3. **Pressure changes are opaque.**
   - C2 W15: a sweep with 0 claims and 1 aircraft lost moved pressure from +6 to +16.
   - C1 W15: a full rest week moved it from +5 to −4.
   - I can't learn from numbers I can't break down.
4. **Bugs:**
   - Squadron leaders go "missing" but never appear in the Missing list: Ridley (C1 W1), Hale (W2), Sallow (W12), Carrow (W18), Garside (C2 W17).
   - Names collide: a missing "Flt Sgt Giles Fenwick" was replaced as commander by "Flt Lt Giles Fenwick" (C1 W5).
   - The theater tab says Kessel Basin "Autumn" while the header says Winter.
   - A recon squadron leader asked to "press our attacks home".
   - A defending squadron reported "enemy fighters none seen" after engaging a "Large bomber formation" and losing an aircraft (C2 W3).
   - HQ called enemy fighter strength "broken" after I submitted 0 kills (C2 W1).
   - Ledger shows 5 losses in C1 W5, but 7 Harrows were gone (two "WRITTEN OFF ON LANDING").
   - Requests renumber after each approve or decline, so `decline R1; decline R2` misfires.
5. **Economy:**
   - Fuel stayed capped at 320 from week 11 onward.
   - Munitions hit 260.
   - The 5 pts/week works left a dozen crews idle.
6. **Weather:** the forecast says "usually right", but Clear turned into storms or solid cloud in C1 W2, W9 and W20, and in C2 W1.

## 5. Suggestions

1. **[small tweak]** Add a pressure ledger to the debrief, for example: "+11 close support, +5 enemy losses, −9 enemy raid".
2. **[big change]** Show or remove the hidden head start. Make defence patrols and close support give diminishing returns when repeated, so that a capture doesn't carry leftover pressure into the next week.
3. **[big change]** Make secondary objectives require verified damage. Make damaged works and fuel visibly reduce enemy raids and fighter numbers in Intel. Make at least one theater impossible to win without deep strikes.
4. **[small tweak]** Randomise the "safe" zones too, so outer wings or fuselage are sometimes lethal on some type. That stops knowledge carrying over between wars.
5. **[small tweak]** Base quotas on a rolling average, never issue orders due the same week, and list missing leaders in the Missing roster.
6. **[small tweak]** Cut fuel and munitions or make them bite. Tie training intake to factory output.
7. **[small tweak]** Win on advantage only after at least one sector is taken. Otherwise call it a "stalemate".
8. **[small tweak]** UI: move the assignments table up, fix the season tabs and the next-week top bar, and fix "1 holes".

## 6. Best and worst moments

**Best:**
- **C1 W5–8.** Radio calls such as "The wing's folding— it's coming off at the root—" made me move the plates to the wing roots. In W8 the ground crew said: "The wing roots plate on SF-915 is dented deep. Without it she'd not have come home." That is Wald's lesson, earned through play.
- **C1 W18.** My creative returns caught up with me as a formal inquiry and Form 1180 "in triplicate".
- **C2 W16.** The feint drew the whole enemy reaction onto 7 Kestrels. A real choice about whom to sacrifice.

**Worst:**
- **C2 W12.** The "most heavily defended ground of the war" fell in two weeks to the same combination as everywhere else.
- **C2 W16.** Two heavies, 3% damage, 21 points of pressure lost. The game punished me for trying its strategic layer.
- **Both end screens.** VICTORY over a Narrow Sea where I never took a single sector.
