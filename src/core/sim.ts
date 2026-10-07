import {
  AIRCRAFT,
  APPROACH_ZONES,
  ARMOR_FACTOR,
  ARMOR_FACTOR_ALLOY,
  ZONE_AREA,
  ZONE_DAMAGE,
} from './data';
import { facilityEffects } from './effects';
import { tech } from './tech';
import { nationOf, rulesOf, spec } from './factions';
import { ABORT_MECH, BANDITS, BOMBS_GONE, BREAK_OFF, CHATTER, CONTACT, ESCORT_HOME, ESCORT_KILL, FEINT_OUT, FORM_UP, GROUND_SITE, GROUND_SUPPORT, GUNNER_KILL, MANY, NO_FIGHTERS, rt, RUN_IN, SEEN_GO, SEEN_WHAT, SUPPORT_IN, TOWER, WE_ARE_HIT, WEATHER_OUT, WOUNDED } from './radio';
import { DEFAULT_LETHALITY, type LethalityTable } from './lethality';
import type { Rng } from './rng';
import { depthFor, escortRange, frontSector, theaterMods, THEATERS, WEATHER_EFFECT } from './theaters';
import type {
  Airframe,
  Approach,
  FighterApproach,
  GameState,
  Hit,
  PlaneRecord,
  RadioLine,
  RaidPlan,
  RaidResult,
  SideId,
  SideState,
  Squadron,
  TargetId,
  TurnPlan,
  ZoneId,
  ZoneMap,
} from './types';
import { ZONES } from './types';

export interface Flier {
  rec: PlaneRecord;
  af: Airframe;
  sq: Squadron;
  side: SideState;
  condition: number;
  alive: boolean;
  /** Turned for home (abort / break-off). */
  out: boolean;
  /** Mechanical abort before contact: back at base, out of the day's fighting. */
  home: boolean;
  callsign: string;
  /** Damage taken, accumulated hits on fighters who strafe it. */
  passesTaken: number;
  /** Drawn away by a feint: not available for the main raid. */
  committed: boolean;
  /** HIDDEN: this airframe type's lethality profile for the campaign. */
  leth: ZoneMap<number>;
  /** Defending fighter actually got off the ground (airfield damage). Rolled once per day. */
  available?: boolean;
}

/**
 * One day of operations. Every aircraft has exactly one Flier for the day, so
 * a fighter that meets a feint in the morning is still damaged (or dead) when
 * the main raid arrives.
 */
export interface Day {
  fliers: Map<string, Flier>;
  lethality: LethalityTable;
  /** Sweeps over the front have already met each other today. */
  metFront: boolean;
  landing: RadioLine[];
  /** Aircraft per squadron kept on the ground by cratered runways today. */
  grounded: Map<string, number>;
  /** Last calls heard today, so no two crews die on the same words in one week. */
  finals: string[];
}

export function newDay(lethality: LethalityTable = DEFAULT_LETHALITY): Day {
  return { fliers: new Map(), lethality, metFront: false, landing: [], grounded: new Map(), finals: [] };
}

const CLOCK: Record<FighterApproach, string[]> = {
  headOn: ['twelve', 'eleven', 'one'],
  tail: ['six', 'five', 'seven'],
  beam: ['three', 'nine', 'two', 'ten'],
};

export function emptyApproach(): Record<FighterApproach, number> {
  return { tail: 0, headOn: 0, beam: 0 };
}

export function armorLoad(sq: Squadron, side?: SideState): number {
  const total = ZONES.reduce((a, z) => a + sq.armor[z], 0);
  // Weight is measured against the standard airframe, so a nation's extra plates really cost speed.
  return (total / Math.max(1, AIRCRAFT[sq.kind].armorBudget)) * (1 - (side ? tech(side, 'plateWeight') : 0));
}

export function hitLethality(zone: ZoneId, f: Flier, armor = f.sq.armor[zone]): number {
  const res = f.side.research;
  const factor = res.includes('armorAlloy') ? ARMOR_FACTOR_ALLOY : ARMOR_FACTOR;
  // How the nation builds its aircraft: an armored seat, or tanks that burn.
  let p = f.leth[zone] * (rulesOf(f.side).lethality[zone] ?? 1) * Math.pow(factor, armor);
  if (zone === 'fuel' && res.includes('selfSealing')) p *= 0.45;
  if (zone === 'fuel' || zone === 'engines') p *= 1 - tech(f.side, 'fireproof');
  // Small, fast airframes take less punishment per hole but have less to lose.
  if (f.af.kind === 'fighter' || f.af.kind === 'recon') p *= 1.25;
  if (f.af.kind === 'heavy') p *= 0.8;
  p *= 1 + f.af.defect * 0.6;
  // The squadron leader is an old hand: he nurses a damaged aircraft home more often.
  if (f.rec.lead) p *= f.sq.leader.trait === 'lucky' ? 0.3 : 0.4;
  p *= 0.75;
  return Math.min(0.95, p);
}

export function pickZone(rng: Rng, approach: Approach): ZoneId {
  const w = {} as Record<ZoneId, number>;
  for (const z of ZONES) w[z] = APPROACH_ZONES[approach][z] * ZONE_AREA[z];
  return rng.weighted(w);
}

/** Apply one hit. Returns true if it brought the aircraft down. */
export function applyHit(rng: Rng, f: Flier, approach: Approach): boolean {
  if (!f.alive) return false;
  const zone = pickZone(rng, approach);
  const hit: Hit = { zone, u: rng.next(), v: rng.next(), approach };
  f.rec.hits.push(hit);
  const armor = f.sq.armor[zone];
  // An old hand flies the best-kept aircraft and keeps a damaged one in the air longer.
  f.condition -= ZONE_DAMAGE[zone] * Math.pow(0.9, armor) * (f.af.kind === 'fighter' ? 1.4 : 1) * (f.rec.lead ? 0.65 : 1);
  const roll = rng.next();
  if (roll < hitLethality(zone, f) || f.condition <= 0) {
    hit.lethal = true;
    f.alive = false;
    f.rec.fate = 'lost';
    return true;
  }
  // The plate took a hit that would have been fatal without it.
  if (armor > 0 && roll < hitLethality(zone, f, 0)) hit.saved = true;
  return false;
}

function lastWords(rng: Rng, f: Flier, heard: string[] = []): string {
  // Two crews never die on the same words in one operation.
  const pick = (pool: string[]) => rng.pick(pool.filter((x) => !heard.includes(x)).length ? pool.filter((x) => !heard.includes(x)) : pool);
  const lethal = f.rec.hits.find((h) => h.lethal);
  const zone = lethal?.zone;
  const lines: Record<ZoneId, string[]> = {
    engines: ['Number two is burning, can\'t feather it, going down—', 'Both engines gone, we\'re losing height—', 'Engine fire! Engine fire! Extinguisher\'s useless—', 'Port engine\'s torn off the mount— she\'s going over—', 'No power, no power, she\'s going down—'],
    cockpit: ['[carrier wave, no voice]', 'Skipper\'s hit— I can\'t hold her— who can fly—', '[a short cry, then static]', 'Pilot\'s dead. I\'m trying to— I don\'t know how—', '[heavy breathing, then nothing]'],
    fuel: ['We\'re burning, the tanks are going, get out, get out—', 'Fuel\'s pouring out of the wing, she\'s on fire—', 'Fire in the bomb bay! Jump, jump, jump—', 'Tanks are holed, we\'re streaming petrol— one spark and—'],
    wingRoot: ['The wing\'s folding— it\'s coming off at the root—', 'Main spar\'s gone, she\'s rolling over—', 'Wing\'s gone! Wing\'s gone! Get out if you can—'],
    tail: ['Controls are gone, she won\'t answer—', 'Tail\'s shot away, we\'re spinning—', 'Elevator cables cut, nose is dropping, can\'t pull her up—'],
    nose: ['Nose is shot out, bombardier\'s dead, we\'re blind—', 'Glass is gone, wind like a hammer, losing her—', 'Front turret\'s gone, and the navigator with it—'],
    outerWing: ['Wing\'s on fire, outboard, can\'t put it out—', 'Aileron\'s shot off, she\'s rolling and I can\'t stop it—'],
    fuselage: ['Hit amidships, structure\'s breaking up—', 'Gunners are dead back there, she\'s falling apart—', 'She\'s breaking in two behind the wing—'],
  };
  const single: Record<ZoneId, string[]> = {
    engines: ['Engine\'s seized, oil all over the screen, going down—', 'Engine fire! I\'m getting out—', 'Glycol\'s gone, she\'s cooking, going down—'],
    cockpit: ['[carrier wave, no voice]', '[a short cry, then static]', 'I\'m hit— can\'t see—', 'Hit in the— tell my mother—'],
    fuel: ['Tank\'s burning, I\'m baling out—', 'She\'s on fire, the tank\'s gone—', 'Fire in the cockpit, canopy\'s stuck— canopy\'s stuck—'],
    wingRoot: ['Wing\'s coming off—', 'Main spar\'s gone, she\'s rolling—'],
    tail: ['No elevators, I\'m spinning—', 'Tail\'s shot away—', 'Rudder\'s gone, can\'t get out of the spin—'],
    nose: ['Prop\'s shot away, losing height—', 'Engine\'s hit, no power, going in—', 'Oil on the windscreen, I\'m blind—'],
    outerWing: ['Wingtip\'s gone, can\'t hold her—', 'Half the wing\'s gone, I\'m going over—'],
    fuselage: ['Control cables cut, she won\'t answer—', 'Stick\'s gone slack, nothing\'s connected—'],
  };
  if (!zone) return '[no further transmissions]';
  if (f.af.kind === 'fighter' || f.af.kind === 'recon') return pick(single[zone]);
  if (zone === 'engines' && f.af.kind === 'heavy') return pick(['Two engines gone on the port side, can\'t hold her—', 'Number three is burning, can\'t feather it, going down—']);
  return pick(lines[zone]);
}

interface RaidContext {
  rng: Rng;
  state: GameState;
  attacker: SideState;
  defender: SideState;
  radio: RadioLine[];
  /** Last calls already heard today, in this raid or another. */
  finals?: string[];
  t: number;
}

function say(ctx: RaidContext, side: SideId, callsign: string, text: string, heardBy: SideId = side, final = false) {
  ctx.radio.push({ t: Math.round(ctx.t), side, callsign, text, heardBy, ...(final ? { final } : {}) });
}

function skillMult(f: Flier): number {
  const s = f.sq.skill;
  const ace = f.sq.leader.trait === 'ace' ? 1.1 : 1;
  return (0.6 + 0.8 * s) * (1 + tech(f.side, 'hits')) * ace * (1 - f.sq.fatigue * 0.3);
}

function makeFlier(sq: Squadron, af: Airframe, side: SideState, role: PlaneRecord['role'], index: number, lethality: LethalityTable = DEFAULT_LETHALITY): Flier {
  const calls = nationOf(side).callsigns;
  const cs = calls[sq.insignia % calls.length];
  return {
    rec: {
      airframeId: af.id,
      serial: af.serial,
      squadronId: sq.id,
      kind: af.kind,
      side: side.id,
      role,
      hits: [],
      fate: 'returned',
      trueKills: 0,
      claims: 0,
      sawApproach: emptyApproach(),
      enemiesSeen: 0,
      // The squadron leader flies the first aircraft and answers to callsign 1.
      // The CO leads from callsign 1, but stays to rebuild a squadron that can put up only one or two aircraft.
      lead: index === 0 && role !== 'recon' && flyable(sq).length >= 3 && !sq.leader.resting ? true : undefined,
    },
    af,
    sq,
    side,
    condition: af.condition,
    alive: true,
    out: false,
    callsign: `${cs} ${index + 1}`,
    passesTaken: 0,
    committed: false,
    home: false,
    leth: lethality[af.kind],
  };
}

/** Airframes that can actually fly this turn for a squadron. */
export function flyable(sq: Squadron): Airframe[] {
  return sq.airframes.filter((a) => a.status === 'ready').slice(0, Math.max(0, sq.crews));
}

export function gatherFliers(side: SideState, ids: string[], role: (sq: Squadron) => PlaneRecord['role'], day?: Day): Flier[] {
  const out: Flier[] = [];
  for (const id of ids) {
    const sq = side.squadrons.find((s) => s.id === id);
    if (!sq) continue;
    // Cratered runways keep part of an operation on the ground (patrols scramble from dispersal strips).
    let list = flyable(sq);
    const r = role(sq);
    if (r !== 'defense' && list.length > 0) {
      const n = Math.max(1, Math.round(list.length * (1 - facilityEffects(side.facilities).grounded)));
      if (n < list.length) day?.grounded.set(sq.id, list.length - n);
      list = list.slice(0, n);
    }
    list.forEach((af, i) => {
      let f = day?.fliers.get(af.id);
      if (!f) {
        f = makeFlier(sq, af, side, r, i, day?.lethality);
        day?.fliers.set(af.id, f);
      }
      out.push(f);
    });
  }
  return out;
}

function dogfight(ctx: RaidContext, a: Flier, b: Flier) {
  const { rng } = ctx;
  // Each side gets a firing chance; initiative to the more skilled/aggressive.
  const order = rng.chance(0.5 + (skillMult(a) - skillMult(b)) * 0.3) ? [a, b] : [b, a];
  for (const [shooter, target] of [order, [order[1], order[0]]] as [Flier, Flier][]) {
    if (!shooter.alive || !target.alive) continue;
    const loadPenalty = 1 + armorLoad(target.sq, target.side) * 0.15 - armorLoad(shooter.sq, shooter.side) * 0.15;
    const lambda = 1.3 * skillMult(shooter) * (0.6 + 0.8 * shooter.sq.doctrine.aggression) * loadPenalty;
    const n = rng.poisson(lambda);
    target.rec.sawApproach.tail += 1;
    for (let i = 0; i < n; i++) {
      if (applyHit(rng, target, rng.weighted({ tail: 0.6, beam: 0.3, headOn: 0.1 }))) {
        shooter.rec.trueKills++;
        shooter.rec.claims++;
        break;
      }
    }
    // A damaged enemy diving away trailing smoke is easy to claim.
    if (target.alive && n > 0 && rng.chance(0.3)) shooter.rec.claims++;
  }
}

function bomberPass(ctx: RaidContext, fighter: Flier, bomber: Flier, bombers: Flier[]) {
  const { rng } = ctx;
  const approach = rng.weighted(ctx.defender.approach) as FighterApproach;
  bomber.passesTaken++;
  // Everyone in the same squadron sees the attack and how it came in.
  for (const b of bombers) if (b.alive && b.sq === bomber.sq) b.rec.sawApproach[approach]++;
  fighter.rec.sawApproach[approach]++;

  // Defensive fire from the formation at the attacking fighter.
  const formation = bomber.sq.doctrine.formation;
  const guns = AIRCRAFT[bomber.af.kind].guns;
  const coverage = approach === 'tail' ? 1.25 : approach === 'beam' ? 0.95 : 0.4;
  const defLambda = 0.3 * (guns / 4) * skillMult(bomber) * (0.6 + formation * 0.9) * coverage * (1 + tech(bomber.side, 'turrets'));
  const defHits = rng.poisson(defLambda);
  for (let i = 0; i < defHits; i++) {
    if (applyHit(rng, fighter, approach === 'headOn' ? 'headOn' : 'tail')) {
      bomber.rec.trueKills++;
      // Every gunner in the box who was firing believes it was his.
      for (const b of bombers)
        if (b.alive && b.sq === bomber.sq && rng.chance(0.18 + formation * 0.25)) b.rec.claims++;
      bomber.rec.claims++;
      say(ctx, bomber.side.id, bomber.callsign, rt(rng, GUNNER_KILL, { clock: rng.pick(CLOCK[approach]) }));
      return;
    }
  }
  if (defHits > 0 && rng.chance(0.25)) bomber.rec.claims++;

  // The attack itself.
  const closing = approach === 'headOn' ? 0.8 : approach === 'beam' ? 0.85 : 1.0;
  const slow = 1 + armorLoad(bomber.sq, bomber.side) * 0.2;
  const lambda = 2.2 * skillMult(fighter) * (0.65 + 0.7 * fighter.sq.doctrine.aggression) * closing * slow;
  const n = rng.poisson(lambda);
  for (let i = 0; i < n; i++) {
    if (applyHit(rng, bomber, approach)) {
      fighter.rec.trueKills++;
      fighter.rec.claims++;
      break;
    }
  }
  if (bomber.alive && n > 0 && rng.chance(0.35)) fighter.rec.claims++;
}

function witnessLoss(ctx: RaidContext, lost: Flier, flight: Flier[]) {
  const { rng } = ctx;
  const radios = lost.side.research.includes('radios');
  if (rng.chance(radios ? 0.85 : 0.3)) {
    lost.rec.lastWords = lastWords(rng, lost, [...ctx.radio.filter((l) => l.final).map((l) => l.text), ...(ctx.finals ?? [])]);
    ctx.finals?.push(lost.rec.lastWords);
    lost.rec.lastZone = lost.rec.hits.find((h) => h.lethal)?.zone;
    say(ctx, lost.side.id, lost.callsign, lost.rec.lastWords, lost.side.id, true);
  }
  // How many got out has to agree with what killed her: a dead pilot in a single-seater, or an
  // aircraft that blew up, leaves few or no parachutes.
  const crew = AIRCRAFT[lost.af.kind].crew;
  const what = rng.pick(SEEN_WHAT);
  const lethal = lost.rec.hits.find((x) => x.lethal)?.zone;
  const max = crew === 1 && lethal === 'cockpit' ? 0 : /blew up|broke up/.test(what) ? Math.min(1, crew) : crew;
  const chutes = rng.int(0, max);
  lost.rec.chutes = chutes;
  const mate = flight.find((f) => f.alive && !f.home && f.sq === lost.sq);
  if (mate && rng.chance(0.75)) {
    lost.rec.witnessed = `${mate.callsign} reported it "${what}", ${chutes > 0 ? `${chutes} chute${chutes > 1 ? 's' : ''} seen` : 'no chutes'}.`;
    const count = chutes > 0 ? rng.pick([`I count ${chutes} chute${chutes > 1 ? 's' : ''}.`, `${chutes === 1 ? 'One chute' : `${chutes} chutes`}, I think.`]) : rng.pick(['No chutes.', 'Nobody got out.', 'No chutes. None.']);
    say(ctx, mate.side.id, mate.callsign, rt(rng, SEEN_GO, { lost: lost.callsign, what, chutes: count }));
  }
}

function checkBreakOff(ctx: RaidContext, fliers: Flier[], startCounts: Map<Squadron, number>, aborted: string[]) {
  for (const [sq, n] of startCounts) {
    const mine = fliers.filter((f) => f.sq === sq);
    if (mine.length === 0 || mine.every((f) => f.out || !f.alive)) continue;
    const lost = mine.filter((f) => !f.alive).length;
    if (lost / n >= sq.doctrine.breakOff && lost > 0) {
      for (const f of mine) if (f.alive) {
        f.out = true;
        f.rec.fate = 'aborted';
      }
      aborted.push(sq.id);
      const lead = mine.find((f) => f.alive);
      // The CO gives the order if he is still flying; otherwise whoever is left in front.
      const coAlive = mine.some((f) => f.rec.lead && f.alive);
      if (lead) say(ctx, sq.side, lead.callsign, coAlive
        ? rt(ctx.rng, BREAK_OFF, { leader: `${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]}`, c: lead.callsign.split(' ')[0] })
        : `${lead.callsign} here. ${mine.some((f) => f.rec.lead) ? 'The CO\'s gone. ' : ''}All ${lead.callsign.split(' ')[0]} aircraft, break off and follow me home.`);
    }
  }
}

export interface RaidOpts {
  day?: Day;
  /** Feint: the sector overflown. Only `onlyDefenders` engage it. */
  feintSector?: number;
  onlyDefenders?: Flier[];
  /** Enemy fighters sweeping the front, met in addition to the defenders. */
  screen?: Flier[];
}

/**
 * Resolve one side's raid (or feint) against the other side's defences.
 * Pass a shared Day so aircraft keep their state across the day's engagements.
 */
export function resolveRaid(
  rng: Rng,
  state: GameState,
  attacker: SideState,
  defender: SideState,
  raidPlan: RaidPlan | null,
  defPlan: TurnPlan,
  opts: RaidOpts = {},
): RaidResult | null {
  if (!raidPlan || raidPlan.squadronIds.length === 0) return null;
  const day = opts.day ?? newDay(state.lethality);
  const target: TargetId = raidPlan.target;
  const ctx: RaidContext = { rng, state, attacker, defender, radio: [], t: 0, finals: day.finals };

  const raid = gatherFliers(attacker, raidPlan.squadronIds, (sq) =>
    target === 'feint' ? 'feint' : sq.kind === 'fighter' ? (target === 'sweep' ? 'raid' : 'escort') : 'raid', day,
  ).filter((f) => f.alive && (target !== 'sweep' || f.af.kind === 'fighter'));
  if (raid.length === 0) return null;
  const bombers = raid.filter((f) => f.af.kind === 'medium' || f.af.kind === 'heavy');
  const escorts = raid.filter((f) => f.af.kind === 'fighter');
  const th = state.theater;
  const site = raidPlan.siteId ? th.sites.find((x) => x.id === raidPlan.siteId) : undefined;
  const sector = opts.feintSector ?? (site ? site.sector : frontSector(th, attacker.id));
  const depth = depthFor(th.held0, attacker.id, sector);
  const mods = theaterMods(state);
  const wx = WEATHER_EFFECT[state.weather];
  const escortReach = escortRange(attacker);

  // Airfield damage grounds some of the defending fighters (decided once per day).
  const defenders = (opts.onlyDefenders ?? gatherFliers(defender, defPlan.defense, () => 'defense', day)).filter((f) => {
    if (f.available === undefined) f.available = rng.chance((0.7 + 0.3 * Math.min(1, defender.facilities.airfield / 100)) * facilityEffects(defender.facilities).cover);
    return f.af.kind === 'fighter' && f.alive && f.available && (opts.onlyDefenders ? true : !f.committed);
  });
  const screen = (opts.screen ?? []).filter((f) => f.alive && !f.out);

  const startCounts = new Map<Squadron, number>();
  for (const f of raid) startCounts.set(f.sq, (startCounts.get(f.sq) ?? 0) + 1);
  const aborted: string[] = [];

  // The formation leader is a bomber when there are bombers.
  const lead = bombers[0] ?? raid[0];
  const speaker = (pool: Flier[]) => pool.find((f) => f.alive && !f.home) ?? lead;
  ctx.t = 5;
  const wxLine = rng.pick(WEATHER_OUT[state.weather]);
  const vars = { c: lead.callsign.split(' ')[0], n: raid.length, sector: THEATER_SECTOR(state, sector) };
  say(ctx, attacker.id, lead.callsign, rt(rng, target === 'feint' ? FEINT_OUT : FORM_UP[lead.sq.leader.archetype], vars) + wxLine);

  // Outbound: mechanical aborts from factory defects.
  for (const f of raid) {
    if (f.af.defect > 0 && rng.chance(f.af.defect * 0.5 * (1 - tech(attacker, 'reliability')))) {
      f.out = true;
      f.home = true;
      f.rec.fate = 'aborted';
      f.rec.mechanical = true;
      ctx.t += 3;
      const single = f.af.kind === 'fighter' || f.af.kind === 'recon';
      say(ctx, attacker.id, f.callsign, rng.pick(single ? ABORT_MECH.single : ABORT_MECH.multi));
    }
  }

  // Detection: fighters patrolling the raided sector almost always find it;
  // the central reserve depends on warning time; other patrols rarely arrive.
  const radar = defender.research.includes('radar') ? 0.25 : 0;
  const avgAlt = raid.reduce((a, f) => a + f.sq.doctrine.altitude, 0) / raid.length;
  const cover = defPlan.cover ?? {};
  const detectFor = (d: Flier): number => {
    const c = cover[d.sq.id];
    let p = c === undefined ? 0.55 + radar : c === sector ? 0.95 : Math.abs(c - sector) === 1 ? 0.3 + radar * 0.5 : 0.05;
    p = (p + mods.detection + tech(defender, 'detection') + (0.5 - avgAlt) * 0.2) * wx.detection;
    return Math.max(0, Math.min(0.97, p));
  };
  const interceptors = [
    ...defenders.filter((d) => rng.chance(opts.onlyDefenders ? 0.95 * wx.detection : detectFor(d))),
    ...screen.filter(() => rng.chance(0.85 * wx.detection)),
  ];
  for (const f of raid) f.rec.enemiesSeen = Math.max(f.rec.enemiesSeen, interceptors.length);
  for (const d of interceptors) d.rec.enemiesSeen = Math.max(d.rec.enemiesSeen, raid.length);

  ctx.t = 35;
  if (interceptors.length > 0) {
    const approach = rng.weighted(defender.approach) as FighterApproach;
    const caller = speaker(raid);
    // Only a bomber has gunners to wake.
    say(ctx, attacker.id, caller.callsign, rt(rng, caller.af.kind === 'fighter' ? BANDITS.filter((l) => !l.includes('Gunners')) : BANDITS, { clock: rng.pick(CLOCK[approach]), height: rng.pick(['high', 'level', 'low']), many: rng.pick(interceptors.length > 12 ? MANY.lots : MANY.few) }));
    say(ctx, defender.id, interceptors[0].callsign, rt(rng, CONTACT, {
      what: bombers.length > 0 ? `${bombers.length >= 10 ? rng.pick(['Large', 'Big', 'Heavy']) : rng.pick(['Small', 'Light'])} bomber formation` : 'Enemy fighters',
      escort: bombers.length === 0 ? rng.pick(['a fighter sweep', 'fighters hunting', 'no bombers with them']) : escorts.length > 0 ? rng.pick(['with escort', 'fighters above them', 'escorted']) : rng.pick(['no escort seen', 'no little friends', 'unescorted']),
    }), defender.id);
  } else {
    say(ctx, attacker.id, speaker(raid).callsign, rt(rng, NO_FIGHTERS[state.weather]));
  }

  const rounds = 3;
  for (let round = 0; round < rounds; round++) {
    ctx.t += 6;
    // Escorts beyond their range turn back after the first engagement.
    if (round === 1 && depth > escortReach && escorts.some((e) => e.alive && !e.out) && target !== 'sweep') {
      const e0 = escorts.find((e) => e.alive)!;
      say(ctx, attacker.id, e0.callsign, rt(rng, ESCORT_HOME));
      for (const e of escorts) if (e.alive) e.out = true;
    }
    const liveEscorts = escorts.filter((f) => f.alive && !f.out);
    const liveInterceptors = interceptors.filter((f) => f.alive);
    // Escorts tie up interceptors.
    const tied = new Set<Flier>();
    for (const e of liveEscorts) {
      const free = liveInterceptors.filter((i) => !tied.has(i) && i.alive);
      if (free.length === 0) break;
      if (!rng.chance(0.55 + e.sq.doctrine.aggression * 0.35)) continue;
      const foe = rng.pick(free);
      tied.add(foe);
      dogfight(ctx, e, foe);
      if (!foe.alive) {
        say(ctx, attacker.id, e.callsign, rt(rng, ESCORT_KILL));
        witnessLoss(ctx, foe, interceptors);
      }
      if (!e.alive) witnessLoss(ctx, e, raid);
    }
    // Free interceptors attack bombers.
    const liveBombers = bombers.filter((b) => b.alive && !b.home && (!b.out || round === rounds - 1));
    if (liveBombers.length > 0) {
      for (const i of liveInterceptors) {
        if (!i.alive || tied.has(i)) continue;
        // A CO runs the fight rather than pressing a second attack himself.
        const passes = 1 + (!i.rec.lead && rng.chance(i.sq.doctrine.aggression) ? 1 : 0);
        for (let p = 0; p < passes; p++) {
          const pool = bombers.filter((b) => b.alive && !b.home);
          if (pool.length === 0) break;
          // Stragglers and loose formations get picked on.
          const weights: Record<string, number> = {};
          pool.forEach((b, k) => {
            weights[k] = (b.condition < 50 ? 2.5 : 1) * (1.4 - b.sq.doctrine.formation * 0.6) * (b.out ? 1.6 : 1);
          });
          const target = pool[Number(rng.weighted(weights))];
          bomberPass(ctx, i, target, bombers);
          if (!target.alive) witnessLoss(ctx, target, raid);
          if (!i.alive) {
            witnessLoss(ctx, i, interceptors);
            break;
          }
        }
      }
    } else if (target === 'sweep') {
      // Fighter sweep: everyone mixes it up.
      for (const i of liveInterceptors) {
        if (tied.has(i) || !i.alive) continue;
        const foes = escorts.filter((e) => e.alive && !e.home);
        if (foes.length === 0) break;
        const foe = rng.pick(foes);
        dogfight(ctx, i, foe);
        if (!foe.alive) witnessLoss(ctx, foe, raid);
        if (!i.alive) witnessLoss(ctx, i, interceptors);
      }
    }
    checkBreakOff(ctx, raid, startCounts, aborted);
    // Damaged bombers occasionally call in.
    for (const b of bombers) {
      if (b.alive && !b.out && b.condition < 55 && rng.chance(0.2)) {
        const z = b.rec.hits[b.rec.hits.length - 1]?.zone;
        say(ctx, attacker.id, b.callsign, rt(rng, WE_ARE_HIT, { where: z ? ` — ${zonePhrase(z)}` : '' }));
        if (rng.chance(0.25)) say(ctx, attacker.id, b.callsign, rt(rng, WOUNDED));
      }
    }
    // Background chatter while the fight goes on.
    const talkers = raid.filter((f) => f.alive && !f.home);
    if (interceptors.length > 0 && talkers.length > 1 && rng.chance(0.5)) {
      const who = rng.pick(talkers);
      const gone = raid.filter((f) => !f.alive && f.sq === who.sq);
      const mate = rng.pick(talkers.filter((f) => f !== who));
      // Lines about the bombers only when there are bombers; "anyone seen…" only about someone actually gone.
      const pool = (who.af.kind === 'fighter' ? CHATTER.fighter : CHATTER.bomber)
        .filter((l) => (target !== 'sweep' || !l.includes('bombers')) && (!l.includes('Anyone seen') || gone.length > 0))
        .filter((l) => !ctx.radio.some((x) => x.text === l.replace('{other}', gone[0]?.callsign ?? mate.callsign)));
      if (pool.length) {
        const line = rng.pick(pool);
        say(ctx, attacker.id, who.callsign, rt(rng, [line], { other: line.includes('Anyone seen') ? gone[0].callsign : mate.callsign }));
      }
    }
  }

  // Target: flak and bombs.
  let damage = 0;
  if (target !== 'sweep' && target !== 'feint') {
    ctx.t += 12;
    const support = target === 'support';
    // The Army masses anti-aircraft guns where close support keeps coming in.
    const frontFlak = support ? 0.8 * Math.min(1.8, 1 + 0.35 * defender.observed.support) : 1;
    const flakLevel = defender.flak * mods.flak * wx.flak * (0.7 + 0.3 * Math.min(1, defender.facilities.industry / 100)) * frontFlak;
    const overTarget = raid.filter((f) => f.alive && !f.out);
    const overBombers = overTarget.filter((f) => f.af.kind !== 'fighter');
    if (overBombers.length > 0) say(ctx, attacker.id, overBombers[0].callsign, rt(rng, support ? SUPPORT_IN : RUN_IN[state.weather]));
    for (const f of overTarget) {
      const exposure = f.af.kind === 'fighter' ? 0.25 : 1;
      const alt = support ? 0.15 : f.sq.doctrine.altitude;
      const n = rng.poisson(flakLevel * (1.55 - alt) * 3.6 * exposure);
      for (let i = 0; i < n; i++) if (applyHit(rng, f, 'flak')) {
        witnessLoss(ctx, f, raid);
        break;
      }
    }
    for (const b of bombers.filter((x) => x.alive && !x.out)) {
      const alt = support ? 0.15 : b.sq.doctrine.altitude;
      const acc = 0.3 + 0.35 * b.sq.skill + 0.25 * (1 - alt) + 0.1 * b.sq.doctrine.aggression;
      damage += AIRCRAFT[b.af.kind].payload * acc * rng.range(0.5, 1.5);
    }
    // Bombsights, bigger bombs and target markers.
    const blind = wx.accuracy + (1 - wx.accuracy) * tech(attacker, 'blindBombing');
    damage *= 1.25 * blind * (1 + tech(attacker, 'accuracy')) * (1 + tech(attacker, 'payload'));
    if (bombers.some((b) => b.alive && !b.out)) say(ctx, attacker.id, speaker(bombers.filter((b) => !b.out)).callsign, rt(rng, BOMBS_GONE));
    // Defender's ground observers see the bombs fall.
    say(ctx, defender.id, 'Ground', rt(rng, support ? GROUND_SUPPORT : GROUND_SITE, { site: site?.name ?? 'our facilities' }), defender.id);
  }

  // Egress: stragglers get picked off.
  ctx.t += 10;
  for (const i of interceptors.filter((x) => x.alive)) {
    const stragglers = bombers.filter((b) => b.alive && !b.home && b.condition < 55);
    if (stragglers.length === 0 || !rng.chance(0.45)) continue;
    const s = rng.pick(stragglers);
    bomberPass(ctx, i, s, bombers);
    if (!s.alive) witnessLoss(ctx, s, raid);
    if (!i.alive) witnessLoss(ctx, i, interceptors);
  }

  ctx.t += 25;
  const landed = raid.filter((f) => f.alive).length;
  say(ctx, attacker.id, 'Tower', rt(rng, landed === raid.length ? TOWER.all : landed === 0 ? TOWER.none : TOWER.some, { landed, n: raid.length }));

  return {
    attacker: attacker.id,
    target,
    siteId: site?.id,
    sector,
    weather: state.weather,
    planes: [...raid, ...defenders, ...screen].map((f) => f.rec),
    damage: Math.round(damage),
    aborted,
    interceptors: interceptors.length,
    flakLevel: defender.flak * mods.flak * wx.flak,
    lost: [
      [...raid, ...defenders, ...screen].filter((f) => f.side.id === 0 && f.rec.fate === 'lost').length,
      [...raid, ...defenders, ...screen].filter((f) => f.side.id === 1 && f.rec.fate === 'lost').length,
    ],
    radio: ctx.radio,
  };
}

export function zonePhrase(z: ZoneId): string {
  return {
    nose: 'nose is shot up',
    cockpit: 'holes in the canopy',
    engines: 'engine\'s running rough',
    fuel: 'fuel leak in the wing',
    wingRoot: 'wing root\'s holed',
    outerWing: 'outer wing\'s like a colander',
    fuselage: 'fuselage is full of holes',
    tail: 'tail\'s shot up',
  }[z];
}

/** Recon flight: unarmed, fast. Returns true if it got its photos home. */
/**
 * Recon flight: unarmed and fast. Fighters patrolling the photographed
 * sector stand a good chance of catching it.
 */
export function resolveRecon(
  rng: Rng,
  side: SideState,
  enemy: SideState,
  squadronId: string,
  day: Day = newDay(),
  patrols: Flier[] = [],
): { ok: boolean; rec: PlaneRecord | null; intercepted: boolean } {
  const sq = side.squadrons.find((s) => s.id === squadronId);
  if (!sq) return { ok: false, rec: null, intercepted: false };
  const af = flyable(sq)[0];
  if (!af) return { ok: false, rec: null, intercepted: false };
  const f = day.fliers.get(af.id) ?? makeFlier(sq, af, side, 'recon', 0, day.lethality);
  day.fliers.set(af.id, f);
  const hunters = patrols.filter((p) => p.alive);
  const threat = (hunters.length ? 0.6 : 0.12 + (enemy.research.includes('radar') ? 0.1 : 0)) * (1 - tech(side, 'stealth'));
  const intercepted = rng.chance(threat);
  if (intercepted) {
    const n = rng.poisson(hunters.length ? 3 : 2);
    for (let i = 0; i < n; i++) {
      if (applyHit(rng, f, rng.pick(['tail', 'beam'] as const)) && hunters.length) {
        rng.pick(hunters).rec.trueKills++;
        break;
      }
    }
  }
  if (rng.chance(0.15)) applyHit(rng, f, 'flak');
  return { ok: f.alive, rec: f.rec, intercepted };
}

/** End of the day: shot-up aircraft may be written off on landing; write back condition. */
export function finishDay(rng: Rng, day: Day) {
  for (const f of day.fliers.values()) {
    if (f.alive && f.condition < 25 && rng.chance((25 - f.condition) / 50)) {
      f.rec.fate = 'crashed';
      day.landing.push({ t: 190, side: f.side.id, callsign: f.callsign, text: 'Undercarriage won\'t come down. Belly landing.', heardBy: f.side.id });
    }
    f.af.condition = Math.max(0, Math.round(f.condition));
  }
}

function THEATER_SECTOR(state: GameState, sector: number): string {
  return THEATERS[state.theater.index].sectors[sector] ?? 'the line';
}
