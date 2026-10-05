/**
 * Headless balance runner: plays many campaigns with a scripted player against
 * the AI and prints outcome statistics.  Usage: npm run balance -- [games]
 */
import { aiPlan, endTurnSingle, reachableSites, startCampaign, validatePlan, type GameState, type TurnPlan } from '../src/core';

function scriptedPlan(state: GameState): TurnPlan {
  const side = state.sides[0];
  const fighters = side.squadrons.filter((s) => s.kind === 'fighter');
  const bombers = side.squadrons.filter((s) => s.kind === 'medium' || s.kind === 'heavy');
  const sites = reachableSites(state, 0, 'medium');
  const site = sites[state.turn % Math.max(1, sites.length)];
  const support = state.turn % 2 === 0 || !site;
  const plan: TurnPlan = {
    raid: support
      ? { target: 'support', squadronIds: [...bombers.map((s) => s.id), ...fighters.slice(1, 2).map((s) => s.id)] }
      : { target: site.type, siteId: site.id, squadronIds: [...bombers.map((s) => s.id), ...fighters.slice(1, 2).map((s) => s.id)] },
    defense: fighters.slice(0, 1).map((s) => s.id),
    cover: {},
    recon: null,
    feint: null,
    embellish: 0,
  };
  let g = 0;
  while (!validatePlan(side, plan, state).ok && g++ < 10) {
    if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else plan.raid = null;
  }
  return plan;
}

const games = Number(process.argv[2] ?? 40);
// --mirror: the AI commands both sides (tests the symmetric rules).
const mirror = process.argv.includes('--mirror');
const outcomes: Record<string, number> = {};
const theaterStats: Record<string, number> = {};
const weeks: number[] = [];
const count: number[] = [];
let turns = 0;
const verbose = games === 1;
for (let g = 0; g < games; g++) {
  const s = startCampaign({ seed: `bal${g}` });
  while (!s.outcome) {
    endTurnSingle(s, mirror ? aiPlan(s, 0) : scriptedPlan(s));
    if (verbose) {
      const e = s.archive[s.archive.length - 1];
      const planes = s.sides.map((x) => x.squadrons.reduce((a, q) => a + q.airframes.length, 0));
      const crews = s.sides.map((x) => x.squadrons.reduce((a, q) => a + q.crews, 0));
      console.log(`T${e.turn} th=${e.theater} held0=${e.sectors0} front=${e.front} lost=${e.trueLosses} claimed=${e.claimed} fac0=${JSON.stringify(e.facilities[0])} fac1=${JSON.stringify(e.facilities[1])} planes=${planes} crews=${crews} trust=${s.sides.map((x) => x.trust)} sup=${s.sides.map((x) => x.resources.supplies)} stores=${s.sides.map((x) => x.resources.stores)}`);
    }
  }
  for (const r of s.theaterResults) {
    const k = `${r.name}:${r.winner === 0 ? 'won' : r.winner === 1 ? 'lost' : 'draw'}${r.decisive ? '!' : ''}`;
    theaterStats[k] = (theaterStats[k] ?? 0) + 1;
    weeks[r.index] = (weeks[r.index] ?? 0) + r.weeks;
    count[r.index] = (count[r.index] ?? 0) + 1;
  }
  const k = `${s.outcome![0]}`;
  outcomes[k] = (outcomes[k] ?? 0) + 1;
  turns += s.archive.length;
}
console.log('player outcomes:', outcomes, 'avg turns:', (turns / games).toFixed(1));
console.log('theaters:', theaterStats);
console.log('avg weeks per theater:', weeks.map((w, i) => (w / count[i]).toFixed(1)).join(' / '));
