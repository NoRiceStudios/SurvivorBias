# Playtest round 7

| | Fun | Weight of decisions | Balancing | UI | Complexity |
|---|---|---|---|---|---|
| Marta, rounds 1–7 | 6 / 7 / 7 / 7 / 7 / 8 / **7** | 4 / 6 / – / 6 / 7 / 8 / **7** | 2 / 4 / – / 3 / 4 / 5 / **4** | 7 / 8 / – / 8 / 8 / 8 / **8** | 5 / 6 / – / 6 / 6 / 7 / **7** |
| Jonas, rounds 1–7 | 7 / 7 / 7 / 8 / 8 / 7 / **8** | 7 / 7 / – / 8 / 8 / 8 / **8** | 4 / 4 / – / 5 / 5 / 4 / **4** | 7 / 8 / – / 8 / 8 / 7 / **7** | 6 / 7 / – / 7 / 7 / 7 / **7** |

## Marta (Wald, full war, 23 weeks, won all three theaters)

Strike-then-push still feels great, and the liaison's "they've got used to our close support" made her vary her missions. But the war was never in doubt: theater 3 fell in 3 weeks. Confidence sat at 100 from week 15 on, and supplies piled up (277 in week 21). Armour never mattered: she declined every plate request.

**Recommendations**
1. Cap fighter claims at the raid size the observers saw, and let confidence drift down when nothing changes on the ground. [small]
   - A glory-seeker on patrol claimed 13 against "a pair" of raiders.
2. Count photo reconnaissance toward strike orders, and judge a discredited claim by the target's condition when it was made. [small]
3. Make the enemy fight back as a strategist: it should cripple our works and counter-attack tired squadrons. [big]
4. Cap the pressure carried over after a sector falls at about 6, so a theater can't fall in 3 weeks. [small]
5. Make armour matter: losses heavy enough that ignoring the fatal zones costs you. [big]

**Bugs**
- The front band went stale at a theater switch.
- Photos were ignored for strike orders.
- "Every aircraft already has a crew" was misleading: it counted trainees at the school.
- A recon assignment outlived the aircraft.
- Close-support adaptation carried across theaters.
- An obituary quoted a successor who was himself missing.
- Obituaries tied deaths to unrelated requests.

## Jonas (Seasoned, 20 weeks: one stalemate, one victory)

The missing now come back, and the game remembers that they were mourned: a wake for Morgan, then the Red Cross card. Pryce walked back through the lines and Linley handed command back to him. "The best thing in the game so far."

**Recommendations**
1. Let the player choose the new CO from two flight commanders with visible traits, and make COs fly less often. [big]
2. Tie sayings to what happened, and give each saying a cooldown. [small]
   - Trevelyan said "We went in lower than anyone" seven times.
3. Explain the front at the threshold, and state the cost of a stalemate. [small]
4. A way back from "Shaken": a rest ordered by the medical officer, at a cost. [big]

**Bugs**
- The perimeter-walk scene was told three times with different names.
- A dead CO's saying was reused.
- Request quotes were shared between leaders.
- Possessives were broken on quoted squadron names.
- Unclear `crews` messages.
- A stale "missing; X in command" note after the CO came back.
- `patrol` without a defending squadron.
- The CO always went down first in defence.
- Six COs were lost in weeks 2–9, and "Shaken" was everywhere.
- Station life went silent in the heaviest weeks.
- No early warning when a type was bleeding.

## Fixed after this round

- **Leaders:**
  - COs keep a damaged aircraft in the air longer and press only one attack in defence. Losses of COs fell by about a quarter in measurement.
  - "Shaken" needs a squadron that has really been through the mill.
  - A lost CO's saying retires with him, and returns to him if he comes back.
  - A leader doesn't repeat any of his last three remarks. New remarks fit what happened (cloud, heavy losses, a clean sweep), and "we went in lower than anyone" only comes from a squadron that flies low.
  - Requests are worded differently by each leader and each time he asks.
- **Obituaries:**
  - An obituary is written when the letter goes out, so it never quotes a successor who is himself missing.
  - It names a decision only if that decision could have cost him his life: more risk granted, or less refused.
- **Station life:**
  - Reputation scenes have several wordings, and each is told once in a war.
  - Hard weeks have more scenes.
- **Squadron records:**
  - A returned CO's record says so.
  - A merge is noted in the squadron that took the crews in.
- **Strike orders and claims:**
  - Photographs count toward strike orders.
  - A strike nobody saw gets one extra week.
  - Claims are judged by the site's condition when they were made, not after enemy repairs.
- **Confidence:**
  - Defensive claims are credited only up to the number of enemy aircraft the observers counted.
  - Confidence above 75 wears off unless orders are met.
- **Pace:** the pressure carried past a fallen sector is capped at 6 (was 12).
- **New theater:** the front band and the enemy's habit of reading our close support reset.
- **Crews:**
  - The Ministry posts crews to idle aircraft even if trainees are on the way.
  - Its messages say how many crews were posted, and where.
- **Plans:**
  - Squadrons with no aircraft drop out of the carried plan.
  - The adjutant warns when a type is losing aircraft faster than they are ordered.
- **Last calls:** no two crews use the same last call in one week.
- **LAN:** the enemy wing's undelivered letters, roll of the missing and plans are no longer sent to the joining player.
- **Stalemates:** the verdict says why the theater ended in stalemate and that confidence falls.
- **CLI:**
  - `patrol` puts a squadron on defence by itself.
  - "Defending the airfields" replaces "in reserve".
  - The plan is shown once per chain.
  - Intel lists the works that count, with the Intelligence Section's cross-check.
