import { reception } from './radio';
import { AIRCRAFT, ARCHETYPE_BIAS, TARGETS, ZONE_LABEL } from './data';
import type { Rng } from './rng';
import { captainName } from './setup';
import { rulesOf } from './factions';
import { emptyApproach } from './sim';
import { WEATHER_EFFECT } from './theaters';
import type {
  Debrief,
  FighterApproach,
  PlaneRecord,
  RadioLine,
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
  /** Remarks already made by other leaders this week (without the speaker's name), so no two say the same. */
  weekSaid: string[] = [],
): SquadronReport {
  const sq = side.squadrons.find((s) => s.id === squadronId)!;
  const bias = ARCHETYPE_BIAS[sq.leader.archetype];
  const sent = recs.length;
  const survivors = recs.filter((r) => r.fate !== 'lost');
  const lossFrac = sent ? (sent - survivors.length) / sent : 0;
  // Shock widens the error bars; reporting-discipline training narrows them.
  const discipline = side.training.focus === 'reporting' ? 0.6 : 1;
  const noise = (0.12 + sq.trauma * 0.5 + lossFrac * 0.4 + (sq.leader.trait === 'shaken' ? 0.15 : 0)) * discipline;
  const sharp = sq.leader.trait === 'sharpEyed' ? 0.5 : 1;
  const biasScale = (b: number) => 1 + (b - 1) * (side.training.focus === 'reporting' ? 0.6 : 1) * sharp * rulesOf(side).bias;
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
  // Even a boastful squadron doesn't claim many more than it saw.
  const seenMax = Math.max(...survivors.map((r) => r.enemiesSeen), 0);
  if (seenMax > 0) report.claims = Math.min(report.claims, Math.ceil(seenMax * 1.3) + 1);
  // ...nor more than a few for every crew that came back to claim them.
  report.claims = Math.min(report.claims, survivors.length * 2 + 1);

  const seen = survivors.reduce((a, r) => a + r.enemiesSeen, 0) / survivors.length;
  // Noisy, but crews who were attacked never report seeing no fighters at all.
  report.enemyFightersReported = seen > 0 ? Math.max(1, Math.round(seen * biasScale(bias.enemies) * Math.min(2, Math.max(0.3, 1 + rng.gauss(noise * 1.2))))) : 0;

  for (const r of survivors) {
    for (const k of Object.keys(r.sawApproach) as FighterApproach[]) report.approachReported[k] += r.sawApproach[k];
  }
  // Shock blurs which way they came from.
  for (const k of Object.keys(report.approachReported) as FighterApproach[]) {
    report.approachReported[k] = Math.max(0, Math.round(report.approachReported[k] * (1 + rng.gauss(noise))));
  }

  const flakHits = survivors.reduce((a, r) => a + r.hits.filter((h) => h.approach === 'flak').length, 0) / survivors.length;
  report.flakReported = flakLabel((raid ? raid.flakLevel * 0.6 : 0) + flakHits * 0.35 * bias.flak + rng.gauss(0.1));

  const isBomberRaid = raid && raid.target !== 'sweep' && raid.target !== 'feint' && survivors.some((r) => r.role === 'raid');
  if (isBomberRaid) {
    if (rng.chance(bias.unknownRate + (sq.trauma > 0.5 ? 0.2 : 0) + WEATHER_EFFECT[raid.weather].unobserved)) {
      report.targetDamageReported = null;
      report.remarks.push(raid.weather === 'clear' ? 'Results unobserved owing to smoke.' : 'Results unobserved: target obscured by cloud.');
    } else {
      report.targetDamageReported = Math.min(100, Math.max(0, Math.round(trueDamage * biasScale(bias.damage) * (1 + rng.gauss(noise + 0.15)))));
    }
  }

  // Remarks: the voice of the leader, appropriate to the job the squadron flew.
  const L = `${sq.leader.rank} ${sq.leader.name}`;
  const lostN = sent - survivors.length;
  const role = recs[0].role;
  report.role = role;
  const defending = role === 'defense';
  const sweep = raid?.target === 'sweep';
  const escort = sq.kind === 'fighter' && !defending && !sweep;
  const hard = lostN > 0;
  const bomber = sq.kind === 'medium' || sq.kind === 'heavy';
  const remarks: Record<typeof sq.leader.archetype, [string[], string[]]> = {
    braggart: [
      [`${L}: "They scattered like pigeons. Put us up again tomorrow."`, report.claims >= 2 ? `${L}: "Best day's shooting this squadron has had."` : `${L}: "We gave as good as we got. Better, probably."`, `${L}: "Tell the papers. They'll want a photograph."`, hard ? `${L}: "Lost a couple, but you should see what we did to them."` : `${L}: "Not a scratch on us. Not one."`, hard ? `${L}: "They got lucky. Next time they won't."` : `${L}: "Easy. Too easy, really."`],
      [`${L}: "They never got near the works. Not while we were up."`, `${L}: "Sent them home with their tails on fire."`, `${L}: "Like shooting rabbits, sir."`, `${L}: "They won't try that again in a hurry."`],
    ],
    pessimist: [
      [`${L}: "There were more of them than last time. There are always more."`, `${L}: "We were lucky. Luck runs out."`, hard ? `${L}: "We left good men out there again."` : `${L}: "Nobody lost. Don't get used to it."`, `${L}: "Same route, same flak. They know our habits."`, `${L}: "Ask me again how it went in a month."`],
      [`${L}: "More of them every day. We can't stop them all."`, `${L}: "They got through. They'll be back tomorrow."`, `${L}: "We were scrambled late. We're always scrambled late."`, `${L}: "For every one we stop, two get through."`],
    ],
    gloryHunter: [
      [`${L} requests the squadron be given the lead next time.`, `${L}: "Give us the deep targets, sir. We can take it."`, !bomber ? `${L}: "We stayed with them all the way down. Put that in the record."` : sq.doctrine.altitude < 0.5 ? `${L}: "We went in lower than anyone. Put that in the record."` : `${L}: "We were first over the target. Put that in the record."`, `${L} asks that his crews be considered for decorations.`],
      [`${L}: "Let us go after them over their own fields, sir."`, `${L} asks to be taken off defence and given an offensive role.`, `${L}: "Waiting for them to come to us is no way to win a war."`],
    ],
    byTheBook: [
      [`${L} declines to confirm claims not witnessed by two crews.`, `${L}: "Report attached. Several items marked unconfirmed."`, `${L}: "Times, heights and headings are in the attached log, sir."`, sq.kind === 'fighter' ? `${L}: "Claims cross-checked between pilots. Two struck off."` : `${L} notes two crews disagree on the bombing results and has recorded both.`],
      [`${L}: "Interception report attached. Claims marked unconfirmed where not seen to crash."`, `${L} declines to confirm claims not witnessed by two pilots.`, `${L}: "Scramble to contact took eleven minutes. That can be improved."`],
    ],
    timid: [
      [`${L}: "The flak was the worst I have seen."`, escort ? `${L}: "We were spread too thin to cover the bombers."` : sweep ? `${L}: "We were bounced from above before we saw them."` : side.squadrons.some((q) => q.kind === 'heavy') ? `${L} recommends the target be given to the heavies.` : `${L}: "The target's too well defended for what we've got, sir."`, `${L}: "We kept together. That's the main thing."`, hard ? `${L}: "I can't keep sending them out like this, sir."` : `${L}: "Everyone home, thank God."`],
      [report.enemyFightersReported >= 6 ? `${L}: "We were heavily outnumbered, sir."` : `${L}: "We went in carefully, sir. No heroics."`, `${L}: "The boys need a rest. They're seeing bandits in every cloud."`, `${L}: "We engaged as best we could, sir."`],
    ],
  };
  // What happened today gives every character something particular to say.
  const cloudy = raid && raid.weather !== 'clear' && !defending;
  const heavy = lostN >= 2 && lostN / sent >= 0.3;
  const situational: Record<typeof sq.leader.archetype, string[]> = {
    braggart: [cloudy ? `${L}: "Cloud? Never noticed it."` : '', heavy ? `${L}: "Bad luck, that's all. Bad luck."` : '', !hard && sent >= 4 ? `${L}: "${sent} out, ${sent} back. Write that down."` : ''],
    pessimist: [cloudy ? (bomber ? `${L}: "Bombed through cloud. Could have hit a cow."` : `${L}: "Lost them in the cloud twice. They know it better than we do."`) : '', heavy ? `${L}: "${lostN} more. I've stopped learning the new names."` : '', report.enemyFightersReported >= 8 ? `${L}: "They had ${report.enemyFightersReported} up. Next time it'll be twenty."` : ''],
    gloryHunter: [heavy ? `${L}: "We paid for it. It was worth it."` : '', cloudy ? (bomber ? `${L}: "We went down under the cloud to be sure. Somebody had to."` : `${L}: "We dived through the cloud after them. Somebody had to."`) : '', report.claims >= 3 ? `${L}: "${report.claims} of them. Mark it on the board."` : ''],
    byTheBook: [cloudy ? (bomber ? `${L}: "Bombing on dead reckoning. Results should be treated with caution."` : `${L}: "Visibility poor. Claims made in cloud are marked unconfirmed."`) : '', heavy ? `${L}: "Losses are listed in the appendix, sir. With the names."` : '', !hard ? `${L}: "No losses. Procedure held."` : ''],
    timid: [heavy ? `${L}: "${lostN} crews, sir. I knew most of them."` : '', cloudy ? `${L}: "The cloud was a blessing. They couldn't find us either."` : '', !hard ? `${L}: "Everyone came home. Let's keep it that way."` : ''],
  };
  // A leader doesn't repeat himself: not one of his last three remarks, nor a dead man's saying.
  // Each man has his own handful of sayings from his type's repertoire, so two leaders of the same
  // character don't sound the same.
  const retired = side.usedLines ?? [];
  const recent = sq.leader.recent ?? [];
  const all = [...remarks[sq.leader.archetype][defending ? 1 : 0], ...situational[sq.leader.archetype].filter(Boolean)];
  const seed = [...sq.leader.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const own = all.filter((x, i) => ((seed >>> (i % 16)) & 1) === 1 || all.length <= 3 || situational[sq.leader.archetype].includes(x));
  // Nor what another leader already said this week.
  const fresh = (x: string) => x !== sq.lastRemark && !recent.includes(x) && !retired.some((r) => x.includes(`"${r}"`)) && !weekSaid.includes(x.replace(L, ''));
  const mine = (own.filter(fresh).length >= 1 ? own : all).filter(fresh);
  const pool = mine.length ? mine : all.filter((x) => x !== sq.lastRemark && !retired.some((r) => x.includes(`"${r}"`)));
  const ledHimself = recs.some((r) => r.lead) || sq.kind === 'recon';
  const said = ledHimself ? rng.pick(pool.length ? pool : all) : sq.leader.resting ? `${L} is on the medical officer's rest. His deputy led the squadron and wrote this report.` : sent <= 2 ? `${L} sent only a section of ${sent} and stayed on the ground to rebuild the squadron. He debriefed the crews himself.` : `${L} stayed behind to rebuild the squadron and debriefed the crews himself on their return.`;
  sq.lastRemark = said;
  weekSaid.push(said.replace(L, ''));
  if (ledHimself) sq.leader.recent = [...recent, said].slice(-3);
  const quote = ledHimself ? said.match(/"(.+)"/) : null;
  if (quote) sq.leader.said = quote[1];
  report.remarks.push(said);
  if (raid && raid.weather !== 'clear' && !defending) report.remarks.push(raid.weather === 'storm' ? 'Weather: storms and heavy cloud throughout.' : 'Weather: solid cloud over the target area.');
  if (lostN > 0 && report.enemyFightersReported === 0) {
    report.remarks.push(defending
      ? `${lostN === 1 ? 'One aircraft' : `${lostN} aircraft`} lost to the bombers' return fire.`
      : `No fighters seen. ${lostN === 1 ? 'The aircraft lost is' : `The ${lostN} aircraft lost are`} believed to have fallen to flak.`);
  }
  if (lostN > 0 && lostN / sent > 0.3) report.remarks.push(`${lostN === 1 ? 'One crew' : `${lostN} crews`} missing. Morale in the squadron is shaken.`);
  // What the ground crews say about the holes.
  const holes: Record<string, number> = {};
  for (const r of survivors) for (const h of r.hits) holes[h.zone] = (holes[h.zone] ?? 0) + 1;
  const worst = Object.entries(holes).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 3) {
    report.remarks.push(`Ground crew: "Most of the damage is in the ${ZONE_LABEL[worst[0] as keyof typeof ZONE_LABEL].toLowerCase()}. Could do with more plate there."`);
  }
  // Plates that stopped something: the only direct evidence armor is working.
  for (const r of survivors) {
    const saved = r.hits.find((h) => h.saved);
    if (saved) {
      report.remarks.push(`Ground crew: "The ${ZONE_LABEL[saved.zone].toLowerCase()} plate on ${r.serial} is dented deep. Without it she'd not have come home."`);
      break;
    }
  }
  report.mission = raid?.target;
  return report;
}

export function buildDebrief(
  rng: Rng,
  turn: number,
  side: SideState,
  enemy: SideState,
  myRaids: RaidResult[],
  enemyRaids: RaidResult[],
  allRecs: PlaneRecord[],
  recon: { siteId: string; condition: number } | null,
  reconLost: boolean,
  damageTaken: Partial<Record<'industry' | 'airfield' | 'fuel', number>>,
  landing: RadioLine[] = [],
  sectorNames: string[] = [],
  seed = '',
): Debrief {
  const mine = allRecs.filter((p) => p.side === side.id);
  const returned = mine.filter((p) => p.fate !== 'lost');
  // What our sets pick up: without VHF, old HF equipment loses much of the traffic.
  const radioLines = reception(rng, side, [
    ...myRaids.flatMap((r) => r.radio.filter((l) => l.heardBy === side.id)),
    ...enemyRaids.flatMap((r) => r.radio.filter((l) => l.heardBy === side.id)).map((l) => ({ ...l, t: l.t + 200 })),
    ...landing.filter((l) => l.heardBy === side.id),
  ]);
  const missing = mine
    .filter((p) => p.fate === 'lost')
    .map((p) => ({ serial: p.serial, squadronId: p.squadronId, kind: p.kind, lastWords: p.lastWords, lastZone: p.lastZone, witnessed: p.witnessed, captain: p.captain ?? captainName(side, p.serial, seed) }));

  const mainRaid = myRaids.find((r) => r.target !== 'feint') ?? null;
  const reports: SquadronReport[] = [];
  const bySq = new Map<string, PlaneRecord[]>();
  for (const p of mine) {
    if (p.role === 'recon') continue;
    if (!bySq.has(p.squadronId)) bySq.set(p.squadronId, []);
    bySq.get(p.squadronId)!.push(p);
  }
  const involved = (r: RaidResult, sqId: string) => r.planes.some((p) => p.squadronId === sqId);
  const weekSaid: string[] = [];
  for (const [sqId, recs] of bySq) {
    const isDefense = recs[0].role === 'defense';
    // Defenders report on the enemy raid they met (the main one if they met both).
    const raid = isDefense
      ? enemyRaids.filter((r) => involved(r, sqId)).sort((x) => (x.target === 'feint' ? 1 : -1))[0] ?? null
      : myRaids.find((r) => involved(r, sqId)) ?? null;
    reports.push(squadronReport(rng, side, sqId, recs, raid, !isDefense && raid && raid === mainRaid ? raid.damage : 0, weekSaid));
  }

  const defenseSummary: string[] = [];
  let enemySeen = 0;
  const about = (n: number) => (n <= 1 ? 'a single enemy aircraft' : n === 2 ? 'a pair of enemy aircraft' : `a formation of about ${n} enemy aircraft`);
  const sectorName = (n: number) => sectorNames[n] ?? `sector ${n + 1}`;
  for (const enemyRaid of enemyRaids) {
    const enemyPlanes = enemyRaid.planes.filter((p) => p.side !== side.id);
    const seen = Math.max(1, Math.round(enemyPlanes.length * (1 + rng.gauss(0.3)) * 1.15));
    enemySeen += seen;
    const enemyLost = enemyPlanes.filter((p) => p.fate === 'lost').length;
    // Flak batteries and observers claim everything that falls, and some that doesn't.
    const groundClaims = Math.round(enemyLost * rng.range(0.4, 1.0) + rng.poisson(1.5));
    const ourSquadrons = [...new Set(enemyRaid.planes.filter((p) => p.side === side.id && p.role === 'defense').map((p) => side.squadrons.find((q) => q.id === p.squadronId)?.name).filter(Boolean))];
    if (enemyRaid.target === 'feint') {
      defenseSummary.push(`Observers report ${about(seen)} over ${sectorName(enemyRaid.sector)}. It turned away without bombing.${ourSquadrons.length ? ` ${ourSquadrons.join(' and ')} went after it.` : ''}`);
      continue;
    }
    if (enemyRaid.target === 'sweep') {
      defenseSummary.push(seen <= 2 ? 'A few enemy fighters swept over the front.' : `Enemy fighter sweep of roughly ${seen} aircraft over the front.`);
    } else {
      defenseSummary.push(enemyRaid.target === 'support'
        ? `Army reports ${seen <= 2 ? about(seen) : `about ${seen} enemy aircraft`} attacking our forward positions.`
        : `Observer Corps reports ${about(seen)} attacking our ${TARGETS[enemyRaid.target].name.toLowerCase()}.`);
      defenseSummary.push(`Flak batteries claim ${groundClaims} destroyed.`);
    }
    if (enemyRaid.planes.some((p) => p.side === side.id && p.role === 'raid')) {
      defenseSummary.push('Our fighter sweep over the front ran into the enemy formation.');
    }
  }
  if (enemyRaids.length === 0) defenseSummary.push('No enemy raid against our sector reported.');
  const dmg = Object.entries(damageTaken).filter(([, v]) => (v ?? 0) > 0);
  for (const [k, v] of dmg) defenseSummary.push(`Damage to our ${k === 'industry' ? 'aircraft works' : k === 'airfield' ? 'airfields' : 'fuel depots'}: ${v}% of capacity lost.`);
  if (reconLost) defenseSummary.push('Photo-reconnaissance aircraft failed to return.');
  void enemy;

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
    enemySeen,
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
  for (const r of d.returned) {
    const byKind = (p.survivorHitsByKind[r.kind] ??= Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<(typeof ZONES)[number], number>);
    for (const h of r.hits) {
      p.survivorHits[h.zone]++;
      byKind[h.zone]++;
    }
  }
  // Words, not a carrier wave: a call that says what hit them.
  for (const m of d.missing) if (m.lastWords && !m.lastWords.startsWith('[') && m.lastZone) {
    const calls = ((p.lastCalls ??= {})[m.kind] ??= Object.fromEntries(ZONES.map((z) => [z, 0])) as Record<(typeof ZONES)[number], number>);
    calls[m.lastZone]++;
  }
  p.claimedKillsTotal += d.reports.reduce((a, r) => a + r.claims, 0);
  // Beliefs about enemy repair: staff assume a modest recovery each turn.
  for (const k of Object.keys(p.sites)) p.sites[k] = Math.min(100, p.sites[k] + 3);
  if (myRaid?.siteId) {
    const dmgReports = d.reports.filter((r) => r.targetDamageReported !== null);
    if (dmgReports.length) {
      // Each squadron estimates the whole raid's damage: the staff take the average, as HQ does.
      const dmg = Math.round(dmgReports.reduce((a, r) => a + (r.targetDamageReported ?? 0), 0) / dmgReports.length);
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
