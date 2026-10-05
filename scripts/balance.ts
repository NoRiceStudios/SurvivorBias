/**
 * Headless balance runner: plays many campaigns with a scripted player against
 * the AI and prints outcome statistics.  Usage: npm run balance -- [games]
 */
import { endTurnSingle, startCampaign, validatePlan, type GameState, type TurnPlan } from '../src/core';

function scriptedPlan(state: GameState): TurnPlan {
  const side = state.sides[0];
  const fighters = side.squadrons.filter((s) => s.kind === 'fighter');
  const bombers = side.squadrons.filter((s) => s.kind === 'medium' || s.kind === 'heavy');
  const plan: TurnPlan = {
    raid: { target: (['industry', 'airfield', 'fuel'] as const)[state.turn % 3], squadronIds: [...bombers.map((s) => s.id), ...fighters.slice(1, 2).map((s) => s.id)] },
    defense: fighters.slice(0, 1).map((s) => s.id),
    recon: null,
    embellish: 0,
  };
  let g = 0;
  while (!validatePlan(side, plan).ok && g++ < 10) {
    if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else plan.raid = null;
  }
  return plan;
}

const games = Number(process.argv[2] ?? 40);
const outcomes: Record<string, number> = {};
let turns = 0;
const verbose = games === 1;
for (let g = 0; g < games; g++) {
  const s = startCampaign({ seed: `bal${g}` });
  while (!s.outcome) {
    endTurnSingle(s, scriptedPlan(s));
    if (verbose) {
      const e = s.archive[s.archive.length - 1];
      const planes = s.sides.map((x) => x.squadrons.reduce((a, q) => a + q.airframes.length, 0));
      const crews = s.sides.map((x) => x.squadrons.reduce((a, q) => a + q.crews, 0));
      console.log(`T${e.turn} front=${e.front} lost=${e.trueLosses} claimed=${e.claimed} fac0=${JSON.stringify(e.facilities[0])} fac1=${JSON.stringify(e.facilities[1])} planes=${planes} crews=${crews} trust=${s.sides.map((x) => x.trust)} sup=${s.sides.map((x) => x.resources.supplies)} fuel=${s.sides.map((x) => x.resources.fuel)}`);
    }
  }
  const k = `${s.outcome![0]}`;
  outcomes[k] = (outcomes[k] ?? 0) + 1;
  turns += s.archive.length;
}
console.log('player outcomes:', outcomes, 'avg turns:', (turns / games).toFixed(1));
