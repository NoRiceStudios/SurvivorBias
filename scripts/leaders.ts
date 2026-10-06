/**
 * How often squadron leaders are lost, and what reputations they earn.
 * Usage: npx tsx scripts/leaders.ts [games]
 */
import { aiPlan, endTurnSingle, startCampaign, validatePlan } from '../src/core';

const games = Number(process.argv[2] ?? 20);
let changes = 0, weeks = 0, sqWeeks = 0, missingCOs = 0;
const traits: Record<string, number> = {};
for (let g = 0; g < games; g++) {
  const s = startCampaign({ seed: `leaders-${g}`, aiInsight: 0.45 });
  const seen = new Set<string>();
  while (!s.outcome) {
    const before = s.sides[0].squadrons.map((q) => [q.id, q.leader.name] as const);
    const p = aiPlan(s, 0);
    if (!validatePlan(s.sides[0], p, s).ok) { p.raid = null; p.feint = null; }
    endTurnSingle(s, p);
    weeks++;
    missingCOs += (s.sides[0].roll ?? []).filter((e) => e.week === s.turn - 1 && /^(Flt Lt|Sqn Ldr|Wg Cdr) /.test(e.name)).length;
    sqWeeks += s.sides[0].squadrons.filter((q) => q.kind !== 'recon').length;
    for (const [id, name] of before) {
      const q = s.sides[0].squadrons.find((x) => x.id === id);
      if (q && q.leader.name !== name && !(s.sides[0].usedNames ?? []).includes(q.leader.name)) changes++;
    }
    for (const q of s.sides[0].squadrons) if (q.leader.trait && !seen.has(q.leader.name)) { seen.add(q.leader.name); traits[q.leader.trait] = (traits[q.leader.trait] ?? 0) + 1; }
  }
}
console.log(`COs missing per 10 weeks: ${((missingCOs / weeks) * 10).toFixed(2)}`);
console.log(`CO changes per 10 weeks: ${((changes / weeks) * 10).toFixed(2)} · per squadron-10-weeks ${((changes / sqWeeks) * 10).toFixed(2)} · traits ${JSON.stringify(traits)}`);
