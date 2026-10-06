/**
 * How much it matters where the armour goes: the same campaigns flown with
 * plate on the truly deadly zones, on the zones with the most holes, or none.
 * Usage: npx tsx scripts/armor.ts [games]
 */
import { aiPlan, AIRCRAFT, APPROACH_ZONES, chooseArmor, endTurnSingle, MAX_ARMOR_PER_ZONE, startCampaign, validatePlan, ZONE_AREA, ZONES, type GameState, type Squadron, type ZoneId } from '../src/core';

type Policy = (s: GameState, q: Squadron) => Record<ZoneId, number>;

const greedy = (q: Squadron, weight: (z: ZoneId) => number) => {
  const out = Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<ZoneId, number>;
  for (let i = 0; i < AIRCRAFT[q.kind].armorBudget; i++) {
    const best = ZONES.filter((z) => out[z] < MAX_ARMOR_PER_ZONE).sort((a, b) => weight(b) / (out[b] + 1) - weight(a) / (out[a] + 1))[0];
    out[best]++;
  }
  return out;
};
const exposure = (z: ZoneId) => ZONE_AREA[z] * (APPROACH_ZONES.tail[z] + APPROACH_ZONES.headOn[z] + APPROACH_ZONES.beam[z] + APPROACH_ZONES.flak[z]);

const policies: Record<string, Policy> = {
  // The truth, which no commander has: plate where hits are both likely and deadly.
  'deadly zones': (s, q) => greedy(q, (z) => s.lethality[q.kind][z] * exposure(z)),
  // Survivorship bias: plate where the returning aircraft have holes.
  'the holes': (s, q) => chooseArmor({ ...s.sides[0], insight: 0 }, q),
  none: (_s, q) => Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<ZoneId, number>,
};

const games = Number(process.argv[2] ?? 20);
for (const [name, policy] of Object.entries(policies)) {
  let bombers = 0, all = 0, wins = 0, weeks = 0, sorties = 0;
  for (let g = 0; g < games; g++) {
    const s = startCampaign({ seed: `armor-${g}`, aiInsight: 0.45 });
    while (!s.outcome) {
      for (const q of s.sides[0].squadrons) if (q.kind === 'medium' || q.kind === 'heavy') q.armor = policy(s, q);
      const p = aiPlan(s, 0);
      // aiPlan re-plates; put our policy back.
      for (const q of s.sides[0].squadrons) if (q.kind === 'medium' || q.kind === 'heavy') q.armor = policy(s, q);
      if (!validatePlan(s.sides[0], p, s).ok) { p.feint = null; p.recon = null; }
      sorties += (p.raid?.squadronIds ?? []).map((id) => s.sides[0].squadrons.find((q) => q.id === id)).filter((q) => q && (q.kind === 'medium' || q.kind === 'heavy')).reduce((a, q) => a + q!.airframes.filter((x) => x.status === 'ready').length, 0);
      endTurnSingle(s, p);
    }
    weeks += s.archive.length;
    bombers += s.archive.reduce((a, e) => a + e.lostHits[0].filter((h) => h.lethal && (h.kind === 'medium' || h.kind === 'heavy')).length, 0);
    all += s.archive.reduce((a, e) => a + e.trueLosses[0], 0);
    if (s.outcome![0] === 'victory' || s.outcome![0] === 'pyrrhic') wins++;
  }
  console.log(`${name.padEnd(13)} bombers lost per 100 sorties ${((bombers / Math.max(1, sorties)) * 100).toFixed(1)} · per 10 weeks ${((bombers / weeks) * 10).toFixed(2)} · all aircraft per 10 weeks ${((all / weeks) * 10).toFixed(2)} · wins ${Math.round((wins / games) * 100)}%`);
}
