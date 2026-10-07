/**
 * What the turret layout is worth: the same campaigns flown with each fixed
 * layout, and with the layout chosen from the gunners' reports.
 * Usage: npx tsx scripts/turrets.ts [games]
 */
import { aiPlan, chooseTurrets, endTurnSingle, startCampaign, validatePlan, type GameState, type Squadron, type TurretFit } from '../src/core';

type Policy = (s: GameState, q: Squadron) => TurretFit;

const policies: Record<string, Policy> = {
  standard: () => 'standard',
  'tail-heavy': () => 'tail',
  'chin turret': () => 'nose',
  'from reports': (s, q) => chooseTurrets(s.sides[0], q),
};

const games = Number(process.argv[2] ?? 20);
for (const [name, policy] of Object.entries(policies)) {
  let bombers = 0, kills = 0, wins = 0, weeks = 0, sorties = 0;
  for (let g = 0; g < games; g++) {
    const s = startCampaign({ seed: `turrets-${g}`, aiInsight: 0.45 });
    while (!s.outcome) {
      const p = aiPlan(s, 0);
      // aiPlan refits from reports; put our policy back (free, so only the layout differs).
      for (const q of s.sides[0].squadrons) if (q.kind === 'medium' || q.kind === 'heavy') q.turrets = policy(s, q);
      if (!validatePlan(s.sides[0], p, s).ok) { p.feint = null; p.recon = null; }
      sorties += (p.raid?.squadronIds ?? []).map((id) => s.sides[0].squadrons.find((q) => q.id === id)).filter((q) => q && (q.kind === 'medium' || q.kind === 'heavy')).reduce((a, q) => a + q!.airframes.filter((x) => x.status === 'ready').length, 0);
      endTurnSingle(s, p);
    }
    weeks += s.archive.length;
    bombers += s.archive.reduce((a, e) => a + e.lostHits[0].filter((h) => h.lethal && (h.kind === 'medium' || h.kind === 'heavy')).length, 0);
    kills += s.archive.reduce((a, e) => a + e.trueLosses[1], 0);
    if (s.outcome![0] === 'victory' || s.outcome![0] === 'pyrrhic') wins++;
  }
  console.log(`${name.padEnd(13)} bombers lost per 100 sorties ${((bombers / Math.max(1, sorties)) * 100).toFixed(1)} · enemy aircraft lost per 10 weeks ${((kills / weeks) * 10).toFixed(2)} · wins ${Math.round((wins / games) * 100)}%`);
}
