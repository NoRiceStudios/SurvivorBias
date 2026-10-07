/**
 * Stores economy probe: the AI commands both sides and we record, for our wing,
 * how full the depots are against what a full effort would use.
 * Usage: npx tsx scripts/stores-balance.ts [games]
 */
import { aiPlan, endTurnSingle, startCampaign, planCost, AIRCRAFT, STORES_CAP } from '../src/core';
import { flyable } from '../src/core/sim';
const games = Number(process.argv[2] ?? 30);
let maxE = 0, live = 0, weeks = 0, atCap = 0, short = 0, sumStores = 0, sumFull = 0, sumUsed = 0, sumTrust = 0;
const byPhase: Record<string, { n: number; stores: number; full: number; used: number }> = {};
for (let g = 0; g < games; g++) {
  const s = startCampaign({ seed: `st${g}` });
  while (!s.outcome && s.turn < 60) {
    const side = s.sides[0];
    const eco = (side.research.includes('fuelEconomy') ? 0.1 : 0) + (side.research.includes('pooledStores') ? 0.1 : 0);
    const full = Math.round(side.squadrons.reduce((a, q) => a + flyable(q).length * AIRCRAFT[q.kind].storesCost, 0) * (1 - eco));
    const plan = aiPlan(s, 0);
    const used = planCost(side, plan).stores;
    const st = side.resources.stores;
    weeks++; sumStores += st; sumFull += full; sumUsed += used; sumTrust += side.trust;
    if (st >= STORES_CAP - 10) atCap++;
    if (plan.raid?.maxEffort) maxE++;
    if (side.training.liveFire) live++;
    if (st < full) short++;
    const ph = s.turn < 8 ? 'w1-7' : s.turn < 16 ? 'w8-15' : 'w16+';
    const p = (byPhase[ph] ??= { n: 0, stores: 0, full: 0, used: 0 });
    p.n++; p.stores += st; p.full += full; p.used += used;
    endTurnSingle(s, plan);
  }
}
console.log({ weeks, avgStores: (sumStores / weeks).toFixed(0), avgFullEffort: (sumFull / weeks).toFixed(0), avgUsed: (sumUsed / weeks).toFixed(0), avgTrust: (sumTrust / weeks).toFixed(0), pctNearCap: ((100 * atCap) / weeks).toFixed(0) + '%', pctCantFlyFull: ((100 * short) / weeks).toFixed(0) + '%', maxEffortWeeks: ((100 * maxE) / weeks).toFixed(0) + '%', liveFireWeeks: ((100 * live) / weeks).toFixed(0) + '%' });
for (const [k, p] of Object.entries(byPhase)) console.log(k, 'stores', (p.stores / p.n).toFixed(0), 'full', (p.full / p.n).toFixed(0), 'used', (p.used / p.n).toFixed(0));
