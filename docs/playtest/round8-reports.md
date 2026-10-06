# Playtest round 8

| | Fun | Weight of decisions | Balancing | UI | Complexity |
|---|---|---|---|---|---|
| Marta, rounds 1–8 | 6 / 7 / 7 / 7 / 7 / 8 / 7 / **8** | 4 / 6 / – / 6 / 7 / 8 / 7 / **8** | 2 / 4 / – / 3 / 4 / 5 / 4 / **5** | 7 / 8 / – / 8 / 8 / 8 / 8 / **8** | 5 / 6 / – / 6 / 6 / 7 / 7 / **7** |
| Jonas, rounds 1–8 | 7 / 7 / 7 / 8 / 8 / 7 / 8 / **8** | 7 / 7 / – / 8 / 8 / 8 / 8 / **8** | 4 / 4 / – / 5 / 5 / 4 / 4 / **5** | 7 / 8 / – / 8 / 8 / 7 / 7 / **7** | 6 / 7 / – / 7 / 7 / 7 / 7 / **7** |

## Marta (Wald, full war: victory in 22 weeks)

Theater 1 was finally a fight. In week 8 the Y-Service named an enemy counter-offensive, and it came: she lost 4 of 8 bombers and the front fell back to about even.

She also failed the armour test, as intended. She left the engines bare because survivors showed engine holes, and engines turned out to be 41% lethal (9 of about 17 Harrow losses).

Photographs met a strike order that the crews' reports could not, and the defensive credit cap held: 9 claimed, 3 credited, 0 true.

Theaters 2 and 3 slid back to easy:
- The enemy had no bombers left, yet the Y-Service kept warning of them.
- A single support week could take a sector.
- Confidence sat at 100 and stores piled up.

**Recommendations**
1. Let the enemy rebuild a bomber force each theater. [big]
2. With no enemy bombers, the Y-Service should say "no bomber force in range". [small]
3. Cap a single week's support so it cannot cross a whole sector. [small]
4. Make high confidence worth spending, with harder orders at 100. [small]
5. Count the last calls of crews who didn't return, by zone, in the debrief. [small]

**Bugs**
- Y-Service warnings about a bomber force that doesn't exist.
- A fighter leader asked to "press home" in bomber words.
- Command chains are not atomic: a build was paid for although the launch was refused.
- The close-support habituation warning appears in the theater's last week.
- Orders were marked failed in the week a theater or the war ended.
- Taking a sector forfeits the secondary objective without warning.
- "Stayed behind" text on two-aircraft sorties.
- The bleeding warning ignored a delivery.
- A Showman offered in place of a Showman.

## Jonas (Seasoned, 22 weeks)

Ivor Thorne's arc was his best story yet: senior flight commander in week 1, "Lucky" in week 9, missing in week 13, back through the lines in week 16, and in week 17 the men touched his sleeve. Trevelyan's and Northcote's obituaries tied deaths to his choices "and that hurts in the right way". Appointments felt like real choices, and Shaken was rare.

**Recommendations**
1. Filter remarks, requests and radio lines by squadron type, and remove duplicates within a week. [small]
2. Make flight commanders persist: the passed-over or demoted man stays as deputy and is first in line next time. [small]
3. Guarantee scenes in weeks with heavy losses, plus a "cursed chair" scene. [small]
4. A Roll of Honour screen per squadron, with payoffs. [big]
5. Warn when a squadron can send only one aircraft. [small]

**Bugs**
- A returned CO signed a raid he didn't fly.
- The passed-over man vanished.
- Fighter leaders talked like bombers.
- "Best day's shooting" with 0 claims.
- A tighter-box request when the losses came from flak.
- An approval was lost in a same-week merge.
- The notebook scene mentioned photographs the wing didn't have.
- Kit was packed "in case" in the same debrief that reported a prisoner.
- An order showed "due this week" during its grace week.
- The stalemate verdict ignored the peak pressure.

## Fixed after this round

- **Words that fit:**
  - Remarks, requests and radio calls fit the squadron's type: no "bombed through cloud" from fighter leaders, and no gunners in a fighter.
  - No two leaders say the same thing in one week.
  - "Best day's shooting" needs claims.
  - A tighter-box request needs fighters to have been seen.
  - A small sortie says why the CO stayed down.
- **Leaders:**
  - A returned CO takes over after the week's reports, so the man who led the raid signs them.
  - The man passed over, stood down or handing back command stays as deputy and is first in line next time. The two candidates differ in character.
- **Station life:**
  - A week in which a CO is lost or three crews go missing always has one or two scenes.
  - A squadron that has lost three COs gets its own scene.
  - No "kit packed in case" for a man reported a prisoner.
  - The notebook scene no longer needs photographs.
- **Last calls in the hangar:** next to the holes on returned aircraft, the hangar counts the last calls of the missing by zone.
- **Front:**
  - No week moves the front by more than 18, so one support week can't take a sector.
  - Air fighting alone moves it by at most 8.
- **Y-Service:** says "no bomber force in range" when the enemy has none.
- **Confidence:** at 90 or more, High Command sets harder strike and kill orders.
- **Theater end:**
  - Orders lapse with the campaign instead of failing.
  - No habituation warning in a theater's last week.
  - The stalemate verdict considers the peak pressure.
- **Briefing:**
  - The secondary objective says that a sector taken intact earns nothing.
  - An order in its grace week says so.
  - The opening stage no longer promises light losses.
- **CLI:**
  - A chain is all or nothing (unless a week was flown).
  - Warns about squadrons that can send only one or two aircraft.
