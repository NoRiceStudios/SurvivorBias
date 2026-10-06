/**
 * Text interface to Survivor Bias, for playtesting and automated play.
 * It shows exactly what the in-game UI shows (perceived state only).
 *
 *   npx tsx scripts/play.ts <save.json> <command> [; <command> ...]
 *
 * Run `help` for the command list.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  countedSites,
  AIRCRAFT,
  APPROACH_LABEL,
  ARCHETYPE_INFO,
  COSTS,
  DECISIVE_GAIN,
  MAX_ARMOR_PER_ZONE,
  RESEARCH,
  SECTORS,
  SECTOR_PRESSURE,
  TARGETS,
  THEATERS,
  WEATHER_LABEL,
  ZONE_LABEL,
  ZONES,
  aiPlan,
  approveRequest,
  armorUsed,
  declineRequest,
  bomberRange,
  cancelQueued,
  canBuild,
  carryPlan,
  currentStage,
  defaultPlan,
  depthFor,
  deserialize,
  escortRange,
  flyable,
  frontSector,
  planCost,
  queueAircraft,
  researchTurns,
  resolveTurn,
  sectorAtDepth,
  serialize,
  setApproach,
  setArmor,
  setDoctrine,
  setQc,
  setTrainingFocus,
  startCampaign,
  startResearch,
  upgradeFactory,
  upgradeFlak,
  upgradeTraining,
  validatePlan,
  type ActionResult,
  type AircraftKind,
  type GameState,
  type Hit,
  type QcPolicy,
  type Site,
  type Squadron,
  type TrainingFocus,
  type TurnPlan,
  type ZoneId,
  fitPlanToStores,
  BRANCHES,
  TRAIT_INFO,
  facilityEffects,
  CRIPPLED,
  REPAIR_COST,
  emergencyRepair,
  facilityCondition,
  buyConvoy,
  CONVOY,
  requestCrews,
  mergeSquadrons,
  crewPrice,
} from '../src/core';

interface SaveFile {
  state: string;
  plan: TurnPlan;
}

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.log('Usage: npx tsx scripts/play.ts <save.json> <command> [; <command> ...]');
  process.exit(1);
}
const commands = rest.join(' ').split(';').map((c) => c.trim()).filter(Boolean);
const failed: string[] = [];
let endShown = false;
let state: GameState | null = null;
let plan: TurnPlan | null = null;
if (existsSync(file)) {
  const save = JSON.parse(readFileSync(file, 'utf8')) as SaveFile;
  state = deserialize(save.state);
  plan = save.plan;
}
const out: string[] = [];
const say = (...lines: string[]) => out.push(...lines);
const me = () => state!.sides[0];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ten = (x: number) => `${Math.round(x * 10)}/10`;

const sqCode = (sq: Squadron) => `S${me().squadrons.indexOf(sq) + 1}`;
const siteCode = (site: Site) => `P${state!.theater.sites.indexOf(site) + 1}`;
function findSq(code: string): Squadron {
  const i = Number(code.replace(/^S/i, '')) - 1;
  const sq = me().squadrons[i];
  if (!sq) throw new Error(`No squadron ${code}. Use 'squadrons' to list them.`);
  return sq;
}
function findSite(code: string): Site {
  const i = Number(code.replace(/^P/i, '')) - 1;
  const site = state!.theater.sites[i];
  if (!site) throw new Error(`No site ${code}. Use 'map' to list them.`);
  return site;
}
function sectorArg(a: string): number {
  const n = Number(a) - 1;
  if (!(n >= 0 && n < SECTORS)) throw new Error(`Sector must be 1-${SECTORS}`);
  return n;
}
const sectorName = (n: number) => THEATERS[state!.theater.index].sectors[n];
const believed = (site: Site) => (site.owner === 0 ? site.condition : me().perceived.sites[site.id] ?? 100);
function check(r: ActionResult | void) {
  if (r && !r.ok) throw new Error(r.reason);
}
function zoneCounts(hits: Hit[]): string {
  const c: Partial<Record<ZoneId, number>> = {};
  for (const h of hits) c[h.zone] = (c[h.zone] ?? 0) + 1;
  return ZONES.filter((z) => c[z]).map((z) => `${ZONE_LABEL[z].toLowerCase()} ${c[z]}`).join(', ') || 'no holes';
}

/* ---------------- Views ---------------- */
function brief() {
  const st = state!;
  const t = st.theater;
  const def = THEATERS[t.index];
  const side = me();
  const stage = currentStage(st);
  const r = side.resources;
  const gain = t.held0 - t.start0;
  const obj = t.objectives.find((o) => o.side === 0)!;
  say(
    `=== Week ${st.turn} · ${def.name} (${def.season}) · theater week ${t.week + 1}/${def.weeks} · Stage: ${stage.title} ===`,
    `${stage.text}`,
    `Weather forecast for this operation: ${WEATHER_LABEL[st.forecast[0]]} (Met Office forecasts are usually right).`,
    `Resources: supplies ${r.supplies} · stores ${r.stores} (fuel and munitions) · replacement aircrew ${r.replacements}`,
    `High Command confidence: ${side.trust}/100 (deliveries grow with it; at 0 you are relieved) · Sectors held: ${t.held0}/${SECTORS}`,
    `Army liaison puts the pressure on the front at ${side.perceived.front >= 0 ? '+' : ''}${side.perceived.front} (a sector usually falls at about ±${SECTOR_PRESSURE}, at most one a week; liaison figures run a little optimistic).${side.perceived.frontBand ? ` Intelligence Section: the line really stands between ${side.perceived.frontBand[0]} and ${side.perceived.frontBand[1]}.` : ''}`,
    `Primary objective: gain ${DECISIVE_GAIN} sectors from the enemy (so far ${gain >= 0 ? '+' : ''}${gain}). If neither side breaks through by week ${def.weeks}, the theater goes to whoever holds the advantage, but only if they have taken at least one sector. Otherwise it is a stalemate.`,
    `Secondary objective: ${obj.text} [${obj.status.toUpperCase()}]`,
    ...(side.perceived.warning ? [`Intelligence warning: ${side.perceived.warning.text} (may be wrong${side.perceived.warning.sector !== undefined ? '; patrols over that sector would meet the raid' : ''})`] : []),
    `Theater record: ${THEATERS.map((th, i) => { const res = st.theaterResults.find((x) => x.index === i); return `${th.name}: ${res ? (res.winner === 0 ? 'WON' : res.winner === null ? 'DRAWN' : 'LOST') : i === t.index ? 'in progress' : 'to come'}`; }).join(' | ')}`,
    'Standing orders:',
    ...(side.orders.length ? side.orders.map((o) => `  - ${o.text}${o.deadline <= st.turn ? ' [DUE THIS WEEK]' : ''}`) : ['  (none)']),
    ...(adjutant().length ? ['Adjutant\'s notes:', ...adjutant().map((n) => `  ! ${n}`)] : []),
    ...(side.requests.length ? ['Requests from the squadrons (approve R# / decline R#):', ...side.requests.map((r, i) => `  R${r.n ?? i + 1} ${r.text}\n       If approved: ${r.effect}${r.cost ? ` Cost: ${r.cost} supplies.` : ''}`)] : []),
    'Correspondence this week:',
    ...side.memos.filter((m) => m.turn >= st.turn).map((m) => `  [${m.kind.toUpperCase()}] ${m.from} — ${m.subject}: ${m.body}`),
  );
}

function adjutant(): string[] {
  const side = me();
  const notes: string[] = [];
  for (const kind of ['medium', 'heavy', 'fighter'] as const) {
    const have = me().squadrons.filter((q) => q.kind === kind).reduce((a, q) => a + q.airframes.length, 0);
    const onOrder = me().factory.queue.filter((k) => k === kind).length;
    const lost3 = (me().roll ?? []).filter((e) => e.week >= state!.turn - 3 && me().squadrons.find((q) => q.name === e.squadron)?.kind === kind).length;
    if (have > 0 && have <= 6 && onOrder === 0) notes.push(`Only ${have} ${AIRCRAFT[kind].name[0]} left and none on order: order more (build ${kind}); crews follow aircraft, or ask the Ministry (crews N).`);
    else if (have > 0 && lost3 >= 4 && onOrder * 2 < lost3) notes.push(`We have lost ${lost3} ${AIRCRAFT[kind].name[0]} in three weeks and have ${onOrder} on order. At this rate the type will be gone in ${Math.max(1, Math.round((have / lost3) * 3))} weeks (build ${kind}).`);
  }
  const gutted = me().squadrons.filter((q) => q.airframes.length <= 2 && me().squadrons.some((o) => o !== q && o.kind === q.kind));
  for (const q of gutted) notes.push(`${sqCode(q)} ${q.name} is down to ${q.airframes.length} aircraft: merge it into another of its type (merge ${sqCode(q)} S#).`);
  const tired = side.squadrons.filter((q) => q.fatigue >= 0.7 && q.airframes.length > 0);
  if (tired.length) notes.push(`${tired.map((q) => `${sqCode(q)} ${q.name} (${Math.round(q.fatigue * 10)}/10)`).join(', ')} ${tired.length > 1 ? 'are' : 'is'} exhausted. Tired crews shoot and fly worse, and their morale slides. Each week standing down takes off about a third of it; it takes two or three to restore them fully.`);
  for (const sq of side.squadrons) {
    if (sq.morale <= 0.25) notes.push(`Morale in ${sqCode(sq)} ${sq.name} is very low. If the whole wing's morale stays this low for three weeks, the crews will refuse to fly.`);
    const idle = sq.airframes.filter((a) => a.status === 'ready').length - Math.max(0, sq.crews);
    if (idle >= 2) notes.push(`${sqCode(sq)} has ${idle} serviceable aircraft with no crews. The training school fills gaps as crews graduate.`);
  }
  const spare = side.squadrons.reduce((a, q) => a + Math.max(0, q.crews - q.airframes.length), 0) + side.resources.replacements;
  if (spare >= 8) notes.push(`${spare} trained or waiting aircrew have no aircraft. The works can build more (build ...).`);
  const c = planCost(side, plan!);
  if (c.stores > side.resources.stores) notes.push(`This week's plan needs ${c.stores} stores and we have ${side.resources.stores}.`);
  if (!side.researching && side.resources.supplies >= 70) notes.push('The engineers are idle (research ...).');
  if (side.factory.queue.length === 0 && side.resources.supplies >= 60) notes.push('Nothing is on order at the aircraft works (build ...).');
  if (side.trust < 30) notes.push(`High Command's confidence is ${side.trust}/100.`);
  if (state!.forecast[0] === 'storm') notes.push('Storms are forecast: bombing will be inaccurate, interceptions fewer, results hard to observe.');
  return notes.slice(0, 6);
}

function map() {
  const st = state!;
  const t = st.theater;
  say(`Theater map (${THEATERS[t.index].name}). Sector 1 is our rear, sector ${SECTORS} the enemy rear. The front runs between sector ${t.held0} and ${t.held0 + 1}.`);
  for (let s = 0; s < SECTORS; s++) {
    const ours = s < t.held0;
    const patrols = Object.entries(plan!.cover).filter(([, sec]) => sec === s).map(([id]) => sqCode(me().squadrons.find((q) => q.id === id)!));
    say(`[${s + 1}] ${sectorName(s)} — ${ours ? 'OURS' : 'ENEMY'}${patrols.length ? ` · our patrols: ${patrols.join(', ')}` : ''}${plan!.feint?.sector === s ? ' · FEINT planned here' : ''}`);
    for (const site of t.sites.filter((x) => x.sector === s)) {
      if (site.owner === 0) say(`     ${siteCode(site)} ${site.name} (${site.type}) — ours, ${site.condition}%`);
      else {
        const d = depthFor(t.held0, 0, site.sector);
        const reach = d <= 2 ? 'medium & heavy bombers' : d <= 3 ? 'heavy bombers only' : 'out of range';
        say(`     ${siteCode(site)} ${site.name} (${site.type}) — enemy, believed ${believed(site)}%${me().perceived.photographed.includes(site.id) ? ' (photographed)' : ''} · depth ${d} · reachable by ${reach} · ${d <= escortRange(me()) ? 'within escort range' : 'beyond escort range'}${plan!.raid?.siteId === site.id ? ' · <<< CURRENT TARGET' : ''}`);
      }
    }
  }
}

function squadrons() {
  for (const sq of me().squadrons) {
    const info = ARCHETYPE_INFO[sq.leader.archetype];
    const d = sq.doctrine;
    const repairs = sq.airframes.filter((a) => a.status === 'repair').length;
    say(
      `${sqCode(sq)} ${sq.name} — ${AIRCRAFT[sq.kind].name[0]} (${AIRCRAFT[sq.kind].role}), range ${sq.kind === 'fighter' ? escortRange(me()) : bomberRange(sq.kind)} sectors`,
      `    aircraft ${sq.airframes.length} (${flyable(sq).length} ready, ${repairs} in repair) · crews ${sq.crews} · skill ${ten(sq.skill)} · morale ${ten(sq.morale)} · fatigue ${ten(sq.fatigue)}`,
      `    leader: ${sq.leader.rank} ${sq.leader.name} — "${info.label}": ${info.blurb} · ${sq.leader.ops ?? 0} operation${sq.leader.ops === 1 ? '' : 's'} in command${sq.leader.trait ? ` · known as "${TRAIT_INFO[sq.leader.trait].label}": ${TRAIT_INFO[sq.leader.trait].blurb}` : ''}`,
      ...(sq.leader.log ?? []).slice(-3).map((e) => `    record: week ${e.week}, ${e.text}`),
      `    doctrine: aggression ${d.aggression.toFixed(2)} · formation ${d.formation.toFixed(2)} · altitude ${d.altitude.toFixed(2)} · break off at ${pct(d.breakOff)} lost`,
      `    armor (${armorUsed(sq)}/${AIRCRAFT[sq.kind].armorBudget} plates): ${ZONES.filter((z) => sq.armor[z]).map((z) => `${z} ${sq.armor[z]}`).join(', ') || 'none'}`,
      ...sq.notables.slice(0, 2).map((n) => `    note: ${n}`),
    );
  }
}

function hangar(code: string) {
  const sq = findSq(code);
  const st = state!;
  const comp = st.archive.slice(-10).flatMap((e) => e.survivorHits[0]).filter((h) => (h.kind ?? 'medium') === sq.kind);
  const counts: Record<string, number> = {};
  for (const h of comp) counts[h.zone] = (counts[h.zone] ?? 0) + 1;
  say(`Hangar — ${sq.name} (${AIRCRAFT[sq.kind].name[0]}). Plates ${armorUsed(sq)}/${AIRCRAFT[sq.kind].armorBudget} (max ${MAX_ARMOR_PER_ZONE} per zone; fitting a plate costs ${COSTS.armorChange} supplies, removing is free; plates add weight, slower aircraft are caught more often).`);
  say(`Damage survey of returned ${AIRCRAFT[sq.kind].name[0]}s (last 10 weeks; each type is built differently): ${comp.length} holes plotted.`);
  for (const z of ZONES) say(`   ${ZONE_LABEL[z].padEnd(12)} armor ${'■'.repeat(sq.armor[z])}${'□'.repeat(MAX_ARMOR_PER_ZONE - sq.armor[z])}   holes seen: ${counts[z] ?? 0}${comp.length ? ` (${Math.round(((counts[z] ?? 0) / comp.length) * 100)}%)` : ''}`);
  say('Airframes:');
  for (const af of sq.airframes) say(`   ${af.serial}: ${af.status === 'repair' ? `in repair (${af.repairTurns}w)` : 'ready'}, condition ${af.condition}%, ${af.sorties} sorties, last sortie: ${zoneCounts(af.hits)}`);
}

function factory() {
  const side = me();
  const f = side.factory;
  say(`Aircraft works level ${f.level}/5, condition ${side.facilities.industry}%, quality control: ${f.qc}. Expand: ${COSTS.factoryUpgrade(f.level)} supplies.`);
  say(`Flak defences strength ${Math.round(side.flak * 100)}. Add batteries: ${COSTS.flakUpgrade(side.flak)} supplies + 20 stores.`);
  say('Can build:');
  for (const k of ['fighter', 'medium', 'heavy', 'recon'] as AircraftKind[]) {
    const s = AIRCRAFT[k];
    say(`   ${k}: ${s.name[0]} — ${s.role}, ${s.cost} supplies, ${s.build} production points, crew ${s.crew}${canBuild(side, k) ? '' : ` [requires ${RESEARCH.find((r) => r.id === s.requires)?.name}]`}`);
  }
  say(`Queue: ${f.queue.length ? f.queue.map((k, i) => `${i + 1}. ${k}`).join(', ') : 'empty'} (progress carried ${f.progress.toFixed(1)} pts)`);
}

function training() {
  const t = me().training;
  say(`Training school level ${t.level}/5 (intake ${1 + t.level * 2} crews/week, expand ${COSTS.trainingUpgrade(t.level)} supplies). Syllabus: ${t.focus}. In training: ${t.inTraining}. Awaiting intake: ${me().resources.replacements}.`);
  say('Syllabus options: balanced | gunnery (more skilled graduates) | evasion (more skilled graduates) | reporting (more accurate reports, less combat skill).');
}

function research() {
  const side = me();
  say(side.researching ? `In development: ${RESEARCH.find((r) => r.id === side.researching)!.name} (${side.researchProgress}/${researchTurns(RESEARCH.find((r) => r.id === side.researching)!.cost)} weeks)` : 'Engineers are idle.');
  for (const b of BRANCHES) {
    say(`${b.name}:`);
    for (const r of RESEARCH.filter((x) => x.branch === b.id)) {
      const status = side.research.includes(r.id) ? 'IN SERVICE' : side.researching === r.id ? 'IN HAND' : r.requires && !side.research.includes(r.requires) ? `needs ${r.requires}` : `${r.cost} supplies, ${researchTurns(r.cost)}w`;
      say(`   ${r.requires ? '  ↳ ' : ''}${r.id}: ${r.name} [${status}] — ${r.desc}`);
    }
  }
}

function intel() {
  const p = me().perceived;
  const officer = me().research.includes('intelOfficer');
  say(`Enemy fighters (our estimate): ${officer ? `${Math.max(0, p.enemyFighters - p.enemyFightersSd)}-${p.enemyFighters + p.enemyFightersSd}` : `~${p.enemyFighters}`} · enemy aircraft claimed destroyed so far: ${p.claimedKillsTotal}`);
  say(`How enemy fighters attack (as reported by returning crews): ${Object.entries(p.enemyApproach).map(([k, v]) => `${APPROACH_LABEL[k as 'tail']} ${pct(v)}`).join(', ')}`);
  say(`Our interceptor tactics: ${Object.entries(me().approach).map(([k, v]) => `${APPROACH_LABEL[k as 'tail']} ${pct(v)}`).join(', ')}`);
  say(`Claims per week: ${state!.archive.map((e) => e.claimed[0]).join(', ') || 'none yet'}`);
  const st = state!;
  const est = (type: 'industry' | 'airfield' | 'fuel') => facilityCondition(st.theater, 1, type, (x) => p.sites[x.id] ?? 100);
  const ours = me().facilities;
  const theirs = { industry: est('industry'), airfield: est('airfield'), fuel: est('fuel') };
  const eo = facilityEffects(ours);
  const et = facilityEffects(theirs);
  say(`Effect of the bombing (below ${CRIPPLED}% works are CRIPPLED: airfields halve fighter cover, depots/works lose a further 30%):`,
    `  Our airfields ${ours.airfield}%${eo.crippled.airfield ? ' CRIPPLED' : ''}: ${Math.round(eo.grounded * 100)}% of each operation grounded · their airfields ~${theirs.airfield}%${et.crippled.airfield ? ' CRIPPLED' : ''}: ~${Math.round(et.grounded * 100)}% grounded`,
    `  Our fuel depots ${ours.fuel}%${eo.crippled.fuel ? ' CRIPPLED' : ''}: stores deliveries ${Math.round(eo.stores * 100)}% · theirs ~${theirs.fuel}%${et.crippled.fuel ? ' CRIPPLED' : ''}: ~${Math.round(et.stores * 100)}%`,
    `  Our works ${ours.industry}%${eo.crippled.industry ? ' CRIPPLED' : ''}: production ${Math.round(eo.production * 100)}% · theirs ~${theirs.industry}%${et.crippled.industry ? ' CRIPPLED' : ''}: ~${Math.round(et.production * 100)}%`,
    `  Emergency repairs: \`repair airfield|fuel|industry\` (${REPAIR_COST} supplies, +20% to each of our sites of that type, once a week each).`,
    `  Their works that count (within two sectors of the front): ${(['airfield', 'fuel', 'industry'] as const).map((k) => countedSites(st.theater, 1, k).map((x) => x.name).join(', ')).filter(Boolean).join('; ') || 'none'}. A side with no works of a type left counts as 40%.`);
}

/** In a chain of commands the plan is shown once, after the last change, not after every one. */
let planDirty = false;
function planChanged() {
  if (commands.length > 1) planDirty = true;
  else planView();
}

function planView() {
  const side = me();
  const p = plan!;
  const name = (ids: string[]) => ids.map((id) => { const sq = side.squadrons.find((q) => q.id === id); return sq ? `${sqCode(sq)} (${flyable(sq).length})` : '?'; }).join(', ') || 'none';
  const target = p.raid ? (p.raid.siteId ? `strike ${state!.theater.sites.find((x) => x.id === p.raid!.siteId)?.name}` : TARGETS[p.raid.target].name) : null;
  const c = planCost(side, p);
  const v = validatePlan(side, p, state!);
  say(
    target ? `Plan: ${target} with ${name(p.raid?.squadronIds ?? [])}` : 'Plan: no operation this week (a defensive week).',
    `Defence: ${p.defense.map((id) => { const sq = side.squadrons.find((q) => q.id === id)!; const cv = p.cover[id]; return `${sqCode(sq)} ${cv === undefined ? 'defending the airfields and works (scrambled against raids)' : `patrolling ${sectorName(cv)} [${cv + 1}]`}`; }).join(', ') || 'none'}`,
    `Feint: ${p.feint ? `${name(p.feint.squadronIds)} over ${sectorName(p.feint.sector)} [${p.feint.sector + 1}]` : 'none'} · Recon: ${p.recon ? `${name([p.recon.squadronId])} photographing ${state!.theater.sites.find((x) => x.id === p.recon!.siteId)?.name}` : 'none'}`,
    `Returns policy: ${p.embellish === 0 ? 'accurate' : p.embellish < 0.6 ? 'optimistic' : 'creative'} · Cost: stores ${c.stores}/${side.resources.stores}`,
    v.ok ? 'Orders are valid.' : `PROBLEM: ${v.reason}`,
  );
}

/* ---------------- Actions ---------------- */
/** Coming from "no operation", the ready squadrons go back on the job. */
function autoAssign(kind: string): string[] {
  const p = plan!;
  return me().squadrons
    .filter((q) => (kind === 'sweep' ? q.kind === 'fighter' && !p.defense.includes(q.id) : q.kind === 'medium' || q.kind === 'heavy') && flyable(q).length > 0 && !p.feint?.squadronIds.includes(q.id))
    .map((q) => q.id);
}

function assign(code: string, roleArg: string) {
  const sq = findSq(code);
  const p = plan!;
  const role = ({ bomb: 'raid', escort: 'raid', sweep: 'raid', raid: 'raid', defend: 'defense', defense: 'defense', feint: 'feint', photo: 'recon', recon: 'recon', rest: 'rest' } as Record<string, string>)[roleArg];
  if (!role) throw new Error('Role must be one of: bomb, escort, sweep, defend, feint, photo, rest');
  p.defense = p.defense.filter((i) => i !== sq.id);
  delete p.cover[sq.id];
  if (p.raid) p.raid.squadronIds = p.raid.squadronIds.filter((i) => i !== sq.id);
  if (p.recon?.squadronId === sq.id) p.recon = null;
  if (p.feint) {
    p.feint.squadronIds = p.feint.squadronIds.filter((i) => i !== sq.id);
    if (!p.feint.squadronIds.length) p.feint = null;
  }
  const t = state!.theater;
  if (role === 'raid') {
    if (!p.raid) p.raid = sq.kind === 'fighter' ? { target: 'sweep', squadronIds: [] } : { target: 'support', squadronIds: [] };
    if (p.raid.target === 'sweep' && sq.kind !== 'fighter') throw new Error('Only fighters fly sweeps. Choose a bombing mission first.');
    p.raid.squadronIds.push(sq.id);
  } else if (role === 'defense') {
    if (sq.kind !== 'fighter') throw new Error('Only fighters can defend');
    p.defense.push(sq.id);
  } else if (role === 'recon') {
    if (sq.kind !== 'recon') throw new Error('Only recon aircraft photograph');
    p.recon = { squadronId: sq.id, siteId: p.raid?.siteId ?? t.sites.find((x) => x.owner === 1)!.id };
  } else if (role === 'feint') {
    const main = p.raid?.siteId ? t.sites.find((x) => x.id === p.raid!.siteId)!.sector : p.raid ? frontSector(t, 0) : undefined;
    const options = [1, 2].map((d) => sectorAtDepth(t.held0, 1, d)).filter((x) => x >= 0 && x < SECTORS && x !== main);
    p.feint = { squadronIds: [...(p.feint?.squadronIds ?? []), sq.id], sector: p.feint?.sector ?? options[0] };
  }
}

function launch() {
  const st = state!;
  const v = validatePlan(me(), plan!, st);
  if (!v.ok) throw new Error(`Cannot launch: ${v.reason}`);
  const week = st.turn;
  const theatersBefore = st.theaterResults.length;
  resolveTurn(st, [plan!, aiPlan(st, 1)]);
  plan = carryPlan(st, 0, plan!);
  const d = st.lastDebriefs[0]!;
  say(`######## OPERATIONS ROOM — WEEK ${week} ########`, 'R/T log (lines marked HOME are from our own defences):');
  for (const l of d.radio) say(`  ${l.t >= 200 ? 'DEFENCE' : `T+${String(l.t).padStart(3, '0')}`}  ${l.callsign.padEnd(10)} ${l.text}`);
  say('', `######## DEBRIEF — WEEK ${week} ########`);
  if (d.theaterNews.length) say('From the front:', ...d.theaterNews.map((x) => `  * ${x}`));
  const sent = d.reports.reduce((a, r) => a + r.sent, 0);
  say(sent ? `${d.reports.reduce((a, r) => a + r.returned, 0)} of ${sent} aircraft returned.` : 'No operations flown this week.');
  say('Returned aircraft (ground crew damage plot):');
  for (const r of d.returned) {
    const sq = me().squadrons.find((q) => q.id === r.squadronId);
    say(`  ${r.serial} ${AIRCRAFT[r.kind].name[0]} (${sq ? sqCode(sq) : 'disbanded'}, ${r.role})${r.fate === 'crashed' ? ' WRITTEN OFF ON LANDING' : r.fate === 'aborted' ? ' turned back early' : ''}: ${zoneCounts(r.hits)}`);
  }
  const bomberHits = d.returned.filter((r) => r.kind === 'medium' || r.kind === 'heavy').flatMap((r) => r.hits);
  if (bomberHits.length) say(`  Bomber damage this operation: ${zoneCounts(bomberHits)}`);
  say('Squadron reports (Form 541):');
  for (const r of d.reports) {
    if (r.noReport) { say(`  ${r.squadronName}: NO REPORT — ${r.returned}/${r.sent} returned.`); continue; }
    const tot = r.approachReported.tail + r.approachReported.headOn + r.approachReported.beam;
    const mostly = tot ? (Object.keys(r.approachReported) as ('tail' | 'headOn' | 'beam')[]).sort((a, b) => r.approachReported[b] - r.approachReported[a])[0] : null;
    const results = r.targetDamageReported === null ? (r.mission === 'sweep' || r.mission === 'feint' || !r.mission ? 'n/a' : 'unobserved')
      : r.mission === 'support' ? `enemy positions ${r.targetDamageReported > 25 ? 'heavily' : r.targetDamageReported > 10 ? 'well' : 'lightly'} hit` : r.targetDamageReported < 3 ? 'bombs fell wide' : `est. ${r.targetDamageReported}% destroyed`;
    say(`  ${r.squadronName} (${r.leader.rank} ${r.leader.name}): returned ${r.returned}/${r.sent} · claims ${r.claims} destroyed · ${r.mission ? 'enemy fighters' : 'escorts seen'} ${r.enemyFightersReported ? `~${r.enemyFightersReported}` : 'none seen'} · attacks mostly ${mostly ? APPROACH_LABEL[mostly].toLowerCase() : '—'} · flak ${r.flakReported} · results: ${results}`);
    for (const x of r.remarks) say(`      ${x}`);
  }
  // The Intelligence Section cross-checks the squadrons' estimates of the enemy.
  const est = d.reports.filter((r) => !r.noReport).map((r) => r.enemyFightersReported);
  if (me().research.includes('intelOfficer') && est.length >= 2) {
    const lo = Math.min(...est), hi = Math.max(...est);
    say(hi > lo * 1.8 ? `  Intelligence Section: estimates of enemy fighters range from ${lo} to ${hi}. At least one squadron is badly wrong.` : `  Intelligence Section: squadron estimates broadly agree (${lo}–${hi}).`);
  }
  if (d.missing.length) {
    say('Missing:');
    for (const m of d.missing) say(`  ${m.serial} ${AIRCRAFT[m.kind].name[0]} — ${m.captain}${AIRCRAFT[m.kind].crew > 1 && !m.captain?.includes('(') ? ` and ${AIRCRAFT[m.kind].crew - 1} crew` : ''}. Last heard: ${m.lastWords ? `"${m.lastWords}"` : 'nothing'}${m.witnessed ? ` · ${m.witnessed}` : ''}`);
  }
  say('Home front:', ...d.defenseSummary.map((x) => `  ${x}`));
  const photographed = d.recon && st.theater.sites.find((x) => x.id === d.recon!.siteId);
  if (d.recon && photographed) say(`  PHOTOGRAPHIC INTERPRETATION: ${photographed.name} at ${d.recon.condition}% capacity.`);
  if (d.station?.length) say('Station life:', ...d.station.map((x) => `  ~ ${x}`));
  if (d.pressure?.length) say('Army liaison, the front this week:', ...d.pressure.map((p) => `  ${p.label}: ${p.effect}`));
  say('Signal from High Command:', ...(d.hqResponse.length ? d.hqResponse.map((x) => `  ${x}`) : ['  Returns acknowledged.']));
  say('');
  if (st.theaterResults.length > theatersBefore) {
    const res = st.theaterResults[st.theaterResults.length - 1];
    const weeks = st.archive.filter((e) => e.theater === res.index);
    say(`######## THEATER DECIDED: ${res.name.toUpperCase()} — ${res.winner === 0 ? 'VICTORY' : res.winner === null ? 'STALEMATE' : 'DEFEAT'}${res.decisive ? ' (decisive)' : ''} after ${res.weeks} weeks ########`,
      `Our aircraft lost in this theater: ${weeks.reduce((a, e) => a + e.trueLosses[0], 0)} · enemy aircraft claimed by our crews: ${weeks.reduce((a, e) => a + e.claimed[0], 0)}`);
    if (!st.outcome) say(`The wing redeploys to ${THEATERS[st.theater.index].name}. ${me().memos[0]?.body ?? ''}`);
    say('');
  }
  if (st.outcome) endView();
  else brief();
}

function endView() {
  const st = state!;
  const texts: Record<string, string> = {
    victory: 'VICTORY', pyrrhic: 'PYRRHIC VICTORY', stalemate: 'ARMISTICE', relieved: 'RELIEVED OF COMMAND', collapse: 'THE FRONT HAS COLLAPSED',
    mutiny: 'THE CREWS WILL NOT FLY', grounded: 'GROUNDED', defeat: 'DEFEAT',
  };
  const sum = (f: (e: (typeof st.archive)[number]) => number) => st.archive.reduce((x, e) => x + f(e), 0);
  say(`######## THE WAR IS OVER: ${texts[st.outcome![0]]} ########`);
  say(`Theaters: ${st.theaterResults.map((r) => `${r.name} ${r.winner === 0 ? 'won' : r.winner === null ? 'drawn' : 'lost'}${r.decisive ? ' (decisive)' : ''} in ${r.weeks}w`).join(' | ')}`);
  say(`Weeks: ${st.archive.length} · our aircraft lost: ${sum((e) => e.trueLosses[0])} · enemy aircraft claimed by crews: ${sum((e) => e.claimed[0])} · reported to HQ: ${sum((e) => e.reportedToHq[0])} · ACTUALLY destroyed: ${sum((e) => e.trueKills[0])}`);
  for (const k of ['fighter', 'medium', 'heavy', 'recon'] as AircraftKind[]) {
    const surv = st.archive.flatMap((e) => e.survivorHits[0]).filter((h) => (h.kind ?? 'medium') === k);
    const lost = st.archive.flatMap((e) => e.lostHits[0]).filter((h) => (h.kind ?? 'medium') === k);
    if (!surv.length && !lost.length) continue;
    const fatal = lost.filter((h) => h.lethal);
    say(`DECLASSIFIED — where our ${AIRCRAFT[k].name[0]}s were hit:`);
    for (const z of ZONES) {
      const c = (a: Hit[]) => a.filter((h) => h.zone === z).length;
      say(`   ${ZONE_LABEL[z].padEnd(12)} on survivors ${String(c(surv)).padStart(4)} · on aircraft that did not return ${String(c(lost)).padStart(4)} · fatal hits ${String(c(fatal)).padStart(3)} · chance one hit brings her down ${pct(st.lethality[k][z])}`);
    }
  }
}

function run(cmd: string) {
  const [verb, ...a] = cmd.split(/\s+/);
  if (verb === 'help') {
    say(
      'Views: brief | map | squadrons | hangar S# | factory | training | research | intel | plan',
      'Orders: mission strike P# | mission support | mission sweep | mission none',
      '        assign S# bomb|escort|sweep|defend|feint|photo|rest · patrol S# <sector#>|base · feint <sector#> · photo P#',
      '        returns accurate|optimistic|creative · tactics tail=N headon=N beam=N',
      'Management: armor S# <zone> <0-3> (zones: nose cockpit engines fuel wingRoot outerWing fuselage tail)',
      '        doctrine S# aggression=0..1 formation=0..1 altitude=0..1 breakoff=0.1..1',
      '        build fighter|medium|heavy|recon · cancel <queue#> · research <id> · upgrade factory|training|flak',
      '        qc rushed|standard|strict · focus balanced|gunnery|evasion|reporting',
      'Requests: approve R# · decline R# (squadron leaders\' requests, listed in the brief)',
      'crews N — ask the Ministry for N trained aircrew for aircraft without crews (price rises as confidence falls)',
      'merge S# S# — fold a squadron down to one or two aircraft into another of the same type',
      `convoy — buy a stores convoy (${CONVOY.supplies} supplies for ${CONVOY.stores} stores, once a week)`,
      'repair airfield|fuel|industry — emergency repairs to our own works (40 supplies, once a week per type)',
      'fit — trim this week\'s plan to the stores we hold (drops the feint, then recon, then bomber squadrons each with a matching escort, then patrols)',
      'Turn: launch (fly this week\'s operation and read the debrief)',
      'UI: screenshot <screen> <out.png> [S#] — screens: title briefing operations squadrons hangar factory training research intel radio debrief-aircraft debrief-reports debrief-missing debrief-home end-summary end-archive end-ledger',
      'Start: new green|seasoned|wald [seed]. Chain commands with ";".',
    );
    return;
  }
  if (verb === 'new') {
    const insight = { green: 0.15, seasoned: 0.45, wald: 0.9 }[a[0] as 'green'] ?? 0.45;
    state = startCampaign({ mode: 'single', aiInsight: insight, seed: a[1] ?? String(Date.now()) });
    plan = defaultPlan(state, 0);
    say(`New campaign started (${a[0] ?? 'seasoned'}).`);
    brief();
    return;
  }
  if (!state || !plan) throw new Error('No campaign. Start one with: new green|seasoned|wald');
  if (state.outcome && !['end', 'screenshot'].includes(verb)) {
    // Once is enough per call.
    if (!endShown) endView();
    endShown = true;
    return;
  }
  const side = me();
  switch (verb) {
    case 'brief': return brief();
    case 'map': return map();
    case 'squadrons': return squadrons();
    case 'hangar': return hangar(a[0]);
    case 'factory': return factory();
    case 'training': return training();
    case 'research': return a[0] ? (check(startResearch(side, a[0])), say(`Funded ${a[0]}.`)) : research();
    case 'intel': return intel();
    case 'plan': return planView();
    case 'end': return endView();
    case 'mission': {
      if (a[0] === 'none') plan.raid = null;
      else if (a[0] === 'support' || a[0] === 'sweep') {
        const ids = plan.raid?.squadronIds ?? [];
        plan.raid = { target: a[0], squadronIds: a[0] === 'sweep' ? ids.filter((id) => side.squadrons.find((q) => q.id === id)?.kind === 'fighter') : ids };
      } else if (a[0] === 'strike') {
        const site = findSite(a[1]);
        if (site.owner === 0) throw new Error('That site is ours');
        plan.raid = { target: site.type, siteId: site.id, squadronIds: plan.raid?.squadronIds.length ? plan.raid.squadronIds : autoAssign('strike') };
      } else throw new Error('mission strike P# | support | sweep | none');
      return planChanged();
    }
    case 'assign': assign(a[0], a[1]); return planChanged();
    case 'patrol': {
      const sq = findSq(a[0]);
      // Patrolling is a defensive job: put the squadron on defence if it isn't already.
      if (!plan.defense.includes(sq.id)) assign(a[0], 'defend');
      if (a[1] === 'reserve' || a[1] === 'base') delete plan.cover[sq.id];
      else {
        const sec = sectorArg(a[1]);
        if (sec >= state.theater.held0) throw new Error('You can only patrol sectors we hold');
        plan.cover[sq.id] = sec;
      }
      return planChanged();
    }
    case 'feint': {
      if (!plan.feint) throw new Error('Assign a squadron to feint first (assign S# feint)');
      plan.feint.sector = sectorArg(a[0]);
      return planChanged();
    }
    case 'photo': {
      if (!plan.recon) throw new Error('Assign a recon squadron first (assign S# photo)');
      plan.recon.siteId = findSite(a[0]).id;
      return planChanged();
    }
    case 'returns': plan.embellish = { accurate: 0, optimistic: 0.4, creative: 0.9 }[a[0] as 'accurate'] ?? 0; return planChanged();
    case 'tactics': {
      const kv = Object.fromEntries(a.map((x) => x.split('=')));
      check(setApproach(side, { tail: Number(kv.tail ?? 0), headOn: Number(kv.headon ?? kv.headOn ?? 0), beam: Number(kv.beam ?? 0) }));
      return intel();
    }
    case 'armor': check(setArmor(side, findSq(a[0]).id, a[1] as ZoneId, Number(a[2]))); return hangar(a[0]);
    case 'doctrine': {
      const kv = Object.fromEntries(a.slice(1).map((x) => x.split('=')));
      check(setDoctrine(side, findSq(a[0]).id, { aggression: kv.aggression && +kv.aggression, formation: kv.formation && +kv.formation, altitude: kv.altitude && +kv.altitude, breakOff: kv.breakoff && +kv.breakoff } as never));
      return squadrons();
    }
    case 'build': check(queueAircraft(side, a[0] as AircraftKind)); return factory();
    case 'cancel': check(cancelQueued(side, Number(a[0]) - 1)); return factory();
    case 'upgrade': check(a[0] === 'factory' ? upgradeFactory(side) : a[0] === 'training' ? upgradeTraining(side) : upgradeFlak(side)); say(`Upgraded ${a[0]}.`); return;
    case 'qc': check(setQc(side, a[0] as QcPolicy)); return factory();
    case 'focus': check(setTrainingFocus(side, a[0] as TrainingFocus)); return training();
    case 'launch':
      // A launch after a failed order in the same chain would fly a plan the commander didn't mean.
      if (failed.length) throw new Error(`Not launched: ${failed.length} earlier command${failed.length > 1 ? 's' : ''} in this chain failed. Fix ${failed.length > 1 ? 'them' : 'it'} and launch again.`);
      planDirty = false;
      return launch();
    case 'crews': {
      const before = new Map(side.squadrons.map((q) => [q.id, q.crews]));
      const pool = side.resources.replacements;
      check(requestCrews(side, Number(a[0] ?? 1)));
      const to = side.squadrons.filter((q) => q.crews > (before.get(q.id) ?? 0)).map((q) => `${sqCode(q)} +${q.crews - before.get(q.id)!}`);
      const spare = side.resources.replacements - pool;
      say(`Crews posted: ${[...to, ...(spare > 0 ? [`${spare} to the replacement pool`] : [])].join(', ')}. Supplies ${side.resources.supplies}.`);
      return;
    }
    case 'merge': {
      const from = findSq(a[0]);
      const into = findSq(a[1]);
      check(mergeSquadrons(state, side, from.id, into.id, plan));
      say(`${from.name} merged into ${into.name}. Squadron codes have changed: see 'squadrons'.`);
      return;
    }
    case 'convoy': check(buyConvoy(state, side)); say(`Convoy bought: stores now ${side.resources.stores}.`); return;
    case 'repair': check(emergencyRepair(state, side, a[0] as 'airfield')); say(`Repairs done. Our ${a[0]} now at ${side.facilities[a[0] as 'airfield']}%.`); return;
    case 'fit': {
      fitPlanToStores(state, 0, plan);
      say(`Plan trimmed to the stores we hold: costs ${planCost(side, plan).stores}/${side.resources.stores}.`);
      return;
    }
    case 'approve':
    case 'decline': {
      const num = Number(a[0]?.replace(/^R/i, ''));
      const req = side.requests.find((r, i) => (r.n ?? i + 1) === num);
      if (!req) throw new Error(`No request ${a[0]}. Requests are listed in the brief.`);
      if (verb === 'approve') check(approveRequest(side, req.id, plan));
      else declineRequest(side, req.id);
      say(`${verb === 'approve' ? 'Approved' : 'Declined'}: ${req.text}`);
      return;
    }
    case 'screenshot': {
      writeFileSync(file, JSON.stringify({ state: serialize(state), plan: plan! } satisfies SaveFile));
      execFileSync('node', [resolve(__dirname, 'shot-save.mjs'), file, a[0], a[1], a[2] ? findSq(a[2]).id : ''], { stdio: 'inherit' });
      say(`Screenshot saved to ${a[1]}. View it to judge the UI.`);
      return;
    }
    default: throw new Error(`Unknown command '${verb}'. Try 'help'.`);
  }
}

for (const c of commands) {
  try {
    run(c);
  } catch (e) {
    say(`ERROR (${c}): ${(e as Error).message}`);
    failed.push(`${c}: ${(e as Error).message}`);
  }
}
if (planDirty && state && plan && !state.outcome) planView();
// Failures inside a long chain are easy to miss: repeat them at the end.
if (failed.length > 1 || (failed.length && commands.length > 1)) say('', `!! ${failed.length} command${failed.length > 1 ? 's' : ''} failed:`, ...failed.map((f) => `   ${f}`));
if (state && plan) writeFileSync(file, JSON.stringify({ state: serialize(state), plan } satisfies SaveFile));
console.log(out.join('\n'));
