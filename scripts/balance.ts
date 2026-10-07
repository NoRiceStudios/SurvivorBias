/**
 * Headless balance runner: plays many campaigns with a scripted player against
 * the AI and prints outcome statistics.  Usage: npm run balance -- [games]
 */
import { aiPlan, autoChooseAllotment, CLASSIC_AI, endTurnSingle, NATION_IDS, reachableSites, resolveTurn, startCampaign, validatePlan, type GameState, type NationId, type TurnPlan } from '../src/core';

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

const games = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 40);

// --profiles: what each nation's AI profile is worth. Side 0 plays its nation's profile, then the
// classic one, against a side 1 that always plays the classic profile.
if (process.argv.includes('--profiles')) {
  console.log('pairing                  side 0 share of decisive theaters: nation AI / classic AI');
  for (const a of NATION_IDS) for (const b of NATION_IDS) {
    if (a === b) continue;
    const share = (aware: boolean) => {
      let w = 0;
      let l = 0;
      for (let g = 0; g < games; g++) {
        const s = startCampaign({ seed: `mx${g}`, mode: 'hotseat', factions: [a, b] });
        while (!s.outcome) resolveTurn(s, [aware ? aiPlan(s, 0) : aiPlan(s, 0, CLASSIC_AI), aiPlan(s, 1, CLASSIC_AI)]);
        for (const r of s.theaterResults) if (r.winner === 0) w++; else if (r.winner === 1) l++;
      }
      return w / Math.max(1, w + l);
    };
    console.log(`${`${a} v ${b}`.padEnd(25)}${(share(true) * 100).toFixed(0)}% / ${(share(false) * 100).toFixed(0)}%`);
  }
  process.exit(0);
}

// --matrix: the AI commands both nations, with equal resources, in every pairing (and the classic war for reference).
if (process.argv.includes('--matrix')) {
  const pairs: ([NationId, NationId] | undefined)[] = [undefined];
  for (const a of NATION_IDS) for (const b of NATION_IDS) if (a !== b) pairs.push([a, b]);
  console.log('pairing                  side 0 wins / draws / side 1 wins   (theaters)   avg weeks');
  for (const f of pairs) {
    const res = [0, 0, 0];
    let wk = 0;
    for (let g = 0; g < games; g++) {
      const s = startCampaign({ seed: `mx${g}`, mode: 'hotseat', factions: f });
      while (!s.outcome) resolveTurn(s, [aiPlan(s, 0), aiPlan(s, 1)]);
      for (const r of s.theaterResults) res[r.winner === 0 ? 0 : r.winner === 1 ? 2 : 1]++;
      wk += s.archive.length;
    }
    const label = f ? `${f[0]} v ${f[1]}` : 'classic';
    console.log(`${label.padEnd(25)}${res.join(' / ').padEnd(40)}${(wk / games).toFixed(1)}`);
  }
  process.exit(0);
}
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
    // --no-allot: the scripted player ignores High Command's weekly offers (for comparison).
    if (!process.argv.includes('--no-allot')) autoChooseAllotment(s, s.sides[0]);
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
