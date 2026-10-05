import { AIRCRAFT, ARCHETYPE_BIAS, TARGETS, ZONE_LABEL } from './data';
import type { Rng } from './rng';
import { emptyApproach } from './sim';
import { WEATHER_EFFECT } from './theaters';
import type {
  Debrief,
  FighterApproach,
  PlaneRecord,
  RaidResult,
  SideId,
  SideState,
  SquadronReport,
  TargetId,
} from './types';
import { ZONES } from './types';

function flakLabel(x: number): SquadronReport['flakReported'] {
  if (x < 0.4) return 'light';
  if (x < 0.8) return 'moderate';
  if (x < 1.2) return 'heavy';
  return 'murderous';
}

/**
 * Turn one squadron's survivors into a report, through the leader's
 * personality and the squadron's state of mind.
 */
export function squadronReport(
  rng: Rng,
  side: SideState,
  squadronId: string,
  recs: PlaneRecord[],
  raid: RaidResult | null,
  trueDamage: number,
): SquadronReport {
  const sq = side.squadrons.find((s) => s.id === squadronId)!;
  const bias = ARCHETYPE_BIAS[sq.leader.archetype];
  const sent = recs.length;
  const survivors = recs.filter((r) => r.fate !== 'lost');
  const lossFrac = sent ? (sent - survivors.length) / sent : 0;
  // Shock widens the error bars; reporting-discipline training narrows them.
  const discipline = side.training.focus === 'reporting' ? 0.6 : 1;
  const noise = (0.12 + sq.trauma * 0.5 + lossFrac * 0.4) * discipline;
  const biasScale = (b: number) => 1 + (b - 1) * (side.training.focus === 'reporting' ? 0.6 : 1);
  const report: SquadronReport = {
    squadronId,
    squadronName: sq.name,
    leader: { ...sq.leader },
    sent,
    returned: survivors.length,
    claims: 0,
    enemyFightersReported: 0,
    approachReported: emptyApproach(),
    flakReported: 'light',
    targetDamageReported: null,
    remarks: [],
  };
  if (survivors.length === 0) {
    report.noReport = true;
    report.remarks.push('No aircraft returned. No report.');
    return report;
  }

  let rawClaims = survivors.reduce((a, r) => a + r.claims, 0);
  let claimBias = biasScale(bias.claims);
  if (side.research.includes('gunCameras')) claimBias = 1 + (claimBias - 1) * 0.5;
  // Panic causes double counting.
  rawClaims *= 1 + lossFrac * 0.5;
  report.claims = Math.max(0, Math.round(rawClaims * claimBias * (1 + rng.gauss(noise))));

  const seen = survivors.reduce((a, r) => a + r.enemiesSeen, 0) / survivors.length;
  report.enemyFightersReported = Math.max(0, Math.round(seen * biasScale(bias.enemies) * (1 + rng.gauss(noise * 1.2))));

  for (const r of survivors) {
    for (const k of Object.keys(r.sawApproach) as FighterApproach[]) report.approachReported[k] += r.sawApproach[k];
  }
  // Shock blurs which way they came from.
  for (const k of Object.keys(report.approachReported) as FighterApproach[]) {
    report.approachReported[k] = Math.max(0, Math.round(report.approachReported[k] * (1 + rng.gauss(noise))));
  }

  const flakHits = survivors.reduce((a, r) => a + r.hits.filter((h) => h.approach === 'flak').length, 0) / survivors.length;
  report.flakReported = flakLabel((raid ? raid.flakLevel * 0.6 : 0) + flakHits * 0.35 * bias.flak + rng.gauss(0.1));

  const isBomberRaid = raid && raid.target !== 'sweep' && survivors.some((r) => r.role === 'raid');
  if (isBomberRaid) {
    if (rng.chance(bias.unknownRate + (sq.trauma > 0.5 ? 0.2 : 0) + WEATHER_EFFECT[raid.weather].unobserved)) {
      report.targetDamageReported = null;
      report.remarks.push(raid.weather === 'clear' ? 'Results unobserved owing to smoke.' : 'Results unobserved: target obscured by cloud.');
    } else {
      report.targetDamageReported = Math.max(0, Math.round(trueDamage * biasScale(bias.damage) * (1 + rng.gauss(noise + 0.15))));
    }
  }

  // Remarks: the voice of the leader.
  const L = `${sq.leader.rank} ${sq.leader.name}`;
  const lostN = sent - survivors.length;
  switch (sq.leader.archetype) {
    case 'braggart':
      report.remarks.push(rng.pick([`${L}: "They scattered like pigeons. Put us up again tomorrow."`, `${L}: "Best day's shooting this squadron has had."`]));
      break;
    case 'pessimist':
      report.remarks.push(rng.pick([`${L}: "There were more of them than last time. There are always more."`, `${L}: "We were lucky. Luck runs out."`]));
      break;
    case 'gloryHunter':
      report.remarks.push(rng.pick([`${L} requests the squadron be given the lead next time.`, `${L}: "Give us the deep targets, sir. We can take it."`]));
      break;
    case 'byTheBook':
      report.remarks.push(rng.pick([`${L} declines to confirm claims not witnessed by two crews.`, `${L}: "Report attached. Several items marked unconfirmed."`]));
      break;
    case 'timid':
      report.remarks.push(rng.pick([`${L}: "The flak was the worst I have seen."`, `${L} recommends the target be given to the heavies.`]));
      break;
  }
  if (lostN > 0 && lostN / sent > 0.3) report.remarks.push(`${lostN} crews missing. Morale in the squadron is shaken.`);
  // What the ground crews say about the holes.
  const holes: Record<string, number> = {};
  for (const r of survivors) for (const h of r.hits) holes[h.zone] = (holes[h.zone] ?? 0) + 1;
  const worst = Object.entries(holes).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 3) {
    report.remarks.push(`Ground crew: "Most of the damage is in the ${ZONE_LABEL[worst[0] as keyof typeof ZONE_LABEL].toLowerCase()}. Could do with more plate there."`);
  }
  return report;
}

export function buildDebrief(
  rng: Rng,
  turn: number,
  side: SideState,
  enemy: SideState,
  myRaid: RaidResult | null,
  enemyRaid: RaidResult | null,
  recon: { siteId: string; condition: number } | null,
  reconRec: PlaneRecord | null,
  damageTaken: Partial<Record<'industry' | 'airfield' | 'fuel', number>>,
): Debrief {
  const mine: PlaneRecord[] = [
    ...(myRaid?.planes.filter((p) => p.side === side.id) ?? []),
    ...(enemyRaid?.planes.filter((p) => p.side === side.id) ?? []),
    ...(reconRec ? [reconRec] : []),
  ];
  const returned = mine.filter((p) => p.fate !== 'lost');
  const radioLines = [
    ...(myRaid?.radio.filter((l) => l.heardBy === side.id) ?? []),
    ...(enemyRaid?.radio.filter((l) => l.heardBy === side.id) ?? []).map((l) => ({ ...l, t: l.t + 200 })),
  ];
  const missing = mine
    .filter((p) => p.fate === 'lost')
    .map((p) => ({ serial: p.serial, squadronId: p.squadronId, kind: p.kind, lastWords: p.lastWords }));

  const reports: SquadronReport[] = [];
  const bySq = new Map<string, PlaneRecord[]>();
  for (const p of mine) {
    if (p.role === 'recon') continue;
    const k = p.squadronId;
    if (!bySq.has(k)) bySq.set(k, []);
    bySq.get(k)!.push(p);
  }
  for (const [sqId, recs] of bySq) {
    const isDefense = recs[0].role === 'defense';
    const raid = isDefense ? enemyRaid : myRaid;
    reports.push(squadronReport(rng, side, sqId, recs, raid, isDefense ? 0 : (myRaid?.damage ?? 0)));
  }

  const defenseSummary: string[] = [];
  if (enemyRaid) {
    const enemyPlanes = enemyRaid.planes.filter((p) => p.side !== side.id);
    const bombers = enemyPlanes.filter((p) => p.kind !== 'fighter').length;
    const fighters = enemyPlanes.filter((p) => p.kind === 'fighter').length;
    const seen = Math.max(0, Math.round((bombers + fighters) * (1 + rng.gauss(0.3)) * 1.15));
    const enemyLost = enemyPlanes.filter((p) => p.fate === 'lost').length;
    // Flak batteries and observers claim everything that falls, and some that doesn't.
    const groundClaims = Math.round(enemyLost * rng.range(0.4, 1.0) + rng.poisson(1.5));
    if (enemyRaid.target === 'sweep') {
      defenseSummary.push(`Enemy fighter sweep of roughly ${seen} aircraft over our sector.`);
    } else {
      defenseSummary.push(enemyRaid.target === 'support'
        ? `Army reports about ${seen} enemy aircraft attacking our forward positions.`
        : `Observer Corps reports an enemy formation of about ${seen} aircraft attacking our ${TARGETS[enemyRaid.target].name.toLowerCase()}.`);
      defenseSummary.push(`Flak batteries claim ${groundClaims} destroyed.`);
    }
    const dmg = Object.entries(damageTaken).filter(([, v]) => (v ?? 0) > 0);
    for (const [k, v] of dmg) defenseSummary.push(`Damage to our ${k === 'industry' ? 'aircraft works' : k === 'airfield' ? 'airfields' : 'fuel depots'}: ${v}% of capacity lost.`);
  } else {
    defenseSummary.push('No enemy raid against our sector reported.');
  }

  if (reconRec && !recon) defenseSummary.push('Photo-reconnaissance aircraft failed to return.');

  return {
    turn,
    side: side.id,
    returned,
    missing,
    reports,
    radio: radioLines.sort((a, b) => a.t - b.t),
    recon,
    theaterNews: [],
    defenseSummary,
    facilityDamageTaken: damageTaken,
    hqResponse: [],
  };
}

/** Update a commander's beliefs from a debrief. Never touches truth. */
export function updatePerceived(rng: Rng, side: SideState, d: Debrief, myRaid: RaidResult | null) {
  const p = side.perceived;
  const fighterReports = d.reports.filter((r) => !r.noReport && r.enemyFightersReported > 0);
  if (fighterReports.length > 0) {
    const est = fighterReports.reduce((a, r) => a + r.enemyFightersReported, 0) / fighterReports.length;
    // Seen on one raid is only part of the force; staff multiply up.
    const total = est * 2.2;
    p.enemyFighters = Math.round(p.enemyFighters * 0.5 + total * 0.5);
    const spread = Math.sqrt(fighterReports.reduce((a, r) => a + (r.enemyFightersReported * 2.2 - total) ** 2, 0) / fighterReports.length);
    p.enemyFightersSd = Math.round(p.enemyFightersSd * 0.5 + (spread + total * 0.25) * 0.5);
  }
  const app = emptyApproach();
  for (const r of d.reports) for (const k of Object.keys(app) as FighterApproach[]) app[k] += r.approachReported[k];
  const tot = app.tail + app.headOn + app.beam;
  if (tot > 0) {
    for (const k of Object.keys(app) as FighterApproach[]) p.enemyApproach[k] = p.enemyApproach[k] * 0.5 + (app[k] / tot) * 0.5;
  }
  for (const r of d.returned) for (const h of r.hits) p.survivorHits[h.zone]++;
  p.claimedKillsTotal += d.reports.reduce((a, r) => a + r.claims, 0);
  // Beliefs about enemy repair: staff assume a modest recovery each turn.
  for (const k of Object.keys(p.sites)) p.sites[k] = Math.min(100, p.sites[k] + 3);
  if (myRaid?.siteId) {
    const dmgReports = d.reports.filter((r) => r.targetDamageReported !== null);
    if (dmgReports.length) {
      const dmg = dmgReports.reduce((a, r) => a + (r.targetDamageReported ?? 0), 0);
      p.sites[myRaid.siteId] = Math.max(0, (p.sites[myRaid.siteId] ?? 100) - dmg);
      p.photographed = p.photographed.filter((x) => x !== myRaid.siteId);
    }
  }
  if (d.recon) {
    p.sites[d.recon.siteId] = d.recon.condition;
    if (!p.photographed.includes(d.recon.siteId)) p.photographed.push(d.recon.siteId);
  }
  void rng;
  void ZONES;
  void AIRCRAFT;
}

export function sideOf(id: SideId): SideId {
  return id;
}
