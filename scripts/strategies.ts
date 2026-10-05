/**
 * Pits scripted player strategies against the AI at each difficulty and
 * reports outcomes, so dominant strategies show up as numbers.
 * Usage: npx tsx scripts/strategies.ts [games]
 */
import { aiPlan, emptyPlan, endTurnSingle, flyable, frontSector, sectorAtDepth, SECTORS, startCampaign, validatePlan, type GameState, type TurnPlan } from '../src/core';

type Strategy = (s: GameState) => TurnPlan;

/** Marta's exploit: close support every week plus a fighter feint; one fighter squadron in reserve. */
const supportFeint: Strategy = (s) => {
  const side = s.sides[0];
  const t = s.theater;
  const f = side.squadrons.filter((q) => q.kind === 'fighter' && flyable(q).length > 0);
  const b = side.squadrons.filter((q) => (q.kind === 'medium' || q.kind === 'heavy') && flyable(q).length > 0);
  const p = emptyPlan();
  p.raid = { target: 'support', squadronIds: b.map((q) => q.id) };
  if (f[0]) p.defense = [f[0].id];
  const main = frontSector(t, 0);
  const sector = [1, 2].map((d) => sectorAtDepth(t.held0, 1, d)).find((x) => x !== main && x >= 0 && x < SECTORS);
  if (f[1] && sector !== undefined) p.feint = { squadronIds: [f[1].id], sector };
  for (const q of side.squadrons) if (q.kind !== 'recon' && q.kind !== 'fighter' && side.resources.supplies > 140) break;
  return p;
};

/** Marta's full recipe: Wald armor (cockpit, fuel, engines), tight boxes, then support + feint. */
const waldSupportFeint: Strategy = (s) => {
  const side = s.sides[0];
  if (s.turn === 1) {
    for (const q of side.squadrons) {
      if (q.kind === 'medium' || q.kind === 'heavy') {
        for (const z of Object.keys(q.armor) as (keyof typeof q.armor)[]) q.armor[z] = 0;
        q.armor.cockpit = 2; q.armor.fuel = 2; q.armor.engines = 2;
        q.doctrine.formation = 0.9;
      } else if (q.kind === 'fighter') {
        for (const z of Object.keys(q.armor) as (keyof typeof q.armor)[]) q.armor[z] = 0;
        q.armor.cockpit = 1; q.armor.fuel = 1; q.armor.engines = 1;
      }
    }
    side.resources.supplies -= 80;
  }
  return supportFeint(s);
};

const strategies: Record<string, Strategy> = {
  'support+feint': supportFeint,
  'wald+sup+feint': waldSupportFeint,
  'AI-as-player': (s) => aiPlan(s, 0),
};

function trim(s: GameState, p: TurnPlan) {
  let g = 0;
  while (!validatePlan(s.sides[0], p, s).ok && g++ < 10) {
    if (p.feint) p.feint = null;
    else if (p.raid && p.raid.squadronIds.length > 1) p.raid.squadronIds.pop();
    else p.raid = null;
  }
  return p;
}

const games = Number(process.argv[2] ?? 30);
for (const [name, strat] of Object.entries(strategies)) {
  for (const [diff, insight] of [['green', 0.15], ['seasoned', 0.45], ['wald', 0.9]] as const) {
    let wins = 0, weeks = 0, lostBombers = 0, lostAll = 0;
    for (let g = 0; g < games; g++) {
      const s = startCampaign({ seed: `strat-${name}-${diff}-${g}`, aiInsight: insight });
      while (!s.outcome) endTurnSingle(s, trim(s, strat(s)));
      if (s.outcome![0] === 'victory' || s.outcome![0] === 'pyrrhic') wins++;
      weeks += s.archive.length;
      lostBombers += s.archive.reduce((a, e) => a + e.lostHits[0].filter((h) => h.lethal && (h.kind === 'medium' || h.kind === 'heavy')).length, 0);
      lostAll += s.archive.reduce((a, e) => a + e.trueLosses[0], 0);
    }
    console.log(`${name.padEnd(14)} ${diff.padEnd(9)} win ${Math.round((wins / games) * 100)}% · avg weeks ${(weeks / games).toFixed(1)} · bombers lost ${(lostBombers / games).toFixed(1)} · all aircraft lost ${(lostAll / games).toFixed(1)}`);
  }
}
