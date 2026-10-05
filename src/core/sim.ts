import {
  AIRCRAFT,
  APPROACH_ZONES,
  ARMOR_FACTOR,
  ARMOR_FACTOR_ALLOY,
  CALLSIGNS,
  ZONE_AREA,
  ZONE_DAMAGE,
} from './data';
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
}

export function newDay(lethality: LethalityTable = DEFAULT_LETHALITY): Day {
  return { fliers: new Map(), lethality, metFront: false, landing: [] };
}

const CLOCK: Record<FighterApproach, string[]> = {
  headOn: ['twelve', 'eleven', 'one'],
  tail: ['six', 'five', 'seven'],
  beam: ['three', 'nine', 'two', 'ten'],
};

export function emptyApproach(): Record<FighterApproach, number> {
  return { tail: 0, headOn: 0, beam: 0 };
}

export function armorLoad(sq: Squadron): number {
  const total = ZONES.reduce((a, z) => a + sq.armor[z], 0);
  return total / Math.max(1, AIRCRAFT[sq.kind].armorBudget);
}

export function hitLethality(zone: ZoneId, f: Flier, armor = f.sq.armor[zone]): number {
  const res = f.side.research;
  const factor = res.includes('armorAlloy') ? ARMOR_FACTOR_ALLOY : ARMOR_FACTOR;
  let p = f.leth[zone] * Math.pow(factor, armor);
  if (zone === 'fuel' && res.includes('selfSealing')) p *= 0.45;
  // Small, fast airframes take less punishment per hole but have less to lose.
  if (f.af.kind === 'fighter' || f.af.kind === 'recon') p *= 1.25;
  if (f.af.kind === 'heavy') p *= 0.8;
  p *= 1 + f.af.defect * 0.6;
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
  f.condition -= ZONE_DAMAGE[zone] * Math.pow(0.8, armor) * (f.af.kind === 'fighter' ? 1.4 : 1);
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

function lastWords(rng: Rng, f: Flier): string {
  const lethal = f.rec.hits.find((h) => h.lethal);
  const zone = lethal?.zone;
  const lines: Record<ZoneId, string[]> = {
    engines: ['Number two is burning, can\'t feather it, going down—', 'Both engines gone, we\'re losing height—', 'Engine fire! Engine fire! Extinguisher\'s useless—'],
    cockpit: ['[carrier wave, no voice]', 'Skipper\'s hit— I can\'t hold her— who can fly—', '[a short cry, then static]'],
    fuel: ['We\'re burning, the tanks are going, get out, get out—', 'Fuel\'s pouring out of the wing, she\'s on fire—'],
    wingRoot: ['The wing\'s folding— it\'s coming off at the root—', 'Main spar\'s gone, she\'s rolling over—'],
    tail: ['Controls are gone, she won\'t answer—', 'Tail\'s shot away, we\'re spinning—'],
    nose: ['Nose is shot out, bombardier\'s dead, we\'re blind—', 'Glass is gone, wind like a hammer, losing her—'],
    outerWing: ['Wing\'s on fire, outboard, can\'t put it out—'],
    fuselage: ['Hit amidships, structure\'s breaking up—', 'Gunners are dead back there, she\'s falling apart—'],
  };
  const single: Record<ZoneId, string[]> = {
    engines: ['Engine\'s seized, oil all over the screen, going down—', 'Engine fire! I\'m getting out—'],
    cockpit: ['[carrier wave, no voice]', '[a short cry, then static]', 'I\'m hit— can\'t see—'],
    fuel: ['Tank\'s burning, I\'m baling out—', 'She\'s on fire, the tank\'s gone—'],
    wingRoot: ['Wing\'s coming off—', 'Main spar\'s gone, she\'s rolling—'],
    tail: ['No elevators, I\'m spinning—', 'Tail\'s shot away—'],
    nose: ['Prop\'s shot away, losing height—', 'Engine\'s hit, no power, going in—'],
    outerWing: ['Wingtip\'s gone, can\'t hold her—'],
    fuselage: ['Control cables cut, she won\'t answer—'],
  };
  if (!zone) return '[no further transmissions]';
  if (f.af.kind === 'fighter' || f.af.kind === 'recon') return rng.pick(single[zone]);
  if (zone === 'engines' && f.af.kind === 'heavy') return rng.pick(['Two engines gone on the port side, can\'t hold her—', 'Number three is burning, can\'t feather it, going down—']);
  return rng.pick(lines[zone]);
}

interface RaidContext {
  rng: Rng;
  state: GameState;
  attacker: SideState;
  defender: SideState;
  radio: RadioLine[];
  t: number;
}

function say(ctx: RaidContext, side: SideId, callsign: string, text: string, heardBy: SideId = side) {
  ctx.radio.push({ t: Math.round(ctx.t), side, callsign, text, heardBy });
}

function skillMult(f: Flier): number {
  const s = f.sq.skill;
  const gyro = f.side.research.includes('gyroSight') ? 1.15 : 1;
  return (0.6 + 0.8 * s) * gyro * (1 - f.sq.fatigue * 0.3);
}

function makeFlier(sq: Squadron, af: Airframe, side: SideState, role: PlaneRecord['role'], index: number, lethality: LethalityTable = DEFAULT_LETHALITY): Flier {
  const cs = CALLSIGNS[side.id][sq.insignia % CALLSIGNS[side.id].length];
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
    flyable(sq).forEach((af, i) => {
      let f = day?.fliers.get(af.id);
      if (!f) {
        f = makeFlier(sq, af, side, role(sq), i, day?.lethality);
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
    const loadPenalty = 1 + armorLoad(target.sq) * 0.15 - armorLoad(shooter.sq) * 0.15;
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
  const defLambda = 0.3 * (guns / 4) * skillMult(bomber) * (0.6 + formation * 0.9) * coverage;
  const defHits = rng.poisson(defLambda);
  for (let i = 0; i < defHits; i++) {
    if (applyHit(rng, fighter, approach === 'headOn' ? 'headOn' : 'tail')) {
      bomber.rec.trueKills++;
      // Every gunner in the box who was firing believes it was his.
      for (const b of bombers)
        if (b.alive && b.sq === bomber.sq && rng.chance(0.18 + formation * 0.25)) b.rec.claims++;
      bomber.rec.claims++;
      say(ctx, bomber.side.id, bomber.callsign, `Got him! Fighter going down at ${rng.pick(CLOCK[approach])} o'clock!`);
      return;
    }
  }
  if (defHits > 0 && rng.chance(0.25)) bomber.rec.claims++;

  // The attack itself.
  const closing = approach === 'headOn' ? 0.8 : approach === 'beam' ? 0.85 : 1.0;
  const slow = 1 + armorLoad(bomber.sq) * 0.2;
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
    lost.rec.lastWords = lastWords(rng, lost);
    say(ctx, lost.side.id, lost.callsign, lost.rec.lastWords);
  }
  const mate = flight.find((f) => f.alive && !f.home && f.sq === lost.sq);
  if (mate && rng.chance(0.75)) {
    const chutes = rng.int(0, AIRCRAFT[lost.af.kind].crew);
    const what = rng.pick(['is going down', 'has gone in', 'is falling out of formation', 'just blew up']);
    say(
      ctx,
      mate.side.id,
      mate.callsign,
      `${lost.callsign} ${what}. ${chutes > 0 ? `I count ${chutes} chute${chutes > 1 ? 's' : ''}.` : 'No chutes.'}`,
    );
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
      if (lead) say(ctx, sq.side, lead.callsign, `${sq.leader.rank} ${sq.leader.name.split(' ')[1]}: break off, break off, all ${lead.callsign.split(' ')[0]} aircraft turn for home.`);
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
  const ctx: RaidContext = { rng, state, attacker, defender, radio: [], t: 0 };

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
    if (f.available === undefined) f.available = rng.chance(0.7 + 0.3 * Math.min(1, defender.facilities.airfield / 100));
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
  const wxLine = state.weather === 'cloud' ? ' Solid cloud forecast over the target.' : state.weather === 'storm' ? ' Rain and turbulence all the way.' : '';
  say(ctx, attacker.id, lead.callsign, target === 'feint'
    ? `${lead.callsign.split(' ')[0]} Leader, diversion force of ${raid.length}, heading for ${THEATER_SECTOR(state, sector)}. Let's be seen.${wxLine}`
    : `${lead.callsign.split(' ')[0]} Leader, ${raid.length} aircraft formed up, setting course.${wxLine}`);

  // Outbound: mechanical aborts from factory defects.
  for (const f of raid) {
    if (f.af.defect > 0 && rng.chance(f.af.defect * 0.5)) {
      f.out = true;
      f.home = true;
      f.rec.fate = 'aborted';
      f.rec.mechanical = true;
      ctx.t += 3;
      const single = f.af.kind === 'fighter' || f.af.kind === 'recon';
      say(ctx, attacker.id, f.callsign, rng.pick(['Losing oil pressure, turning back.', single ? 'Engine running rough, aborting.' : 'Rough running on number one, aborting.', 'Hydraulics failed, returning to base.']));
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
    p = (p + mods.detection + (0.5 - avgAlt) * 0.2) * wx.detection;
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
    say(ctx, attacker.id, speaker(raid).callsign, `Bandits, ${rng.pick(CLOCK[approach])} o'clock ${rng.pick(['high', 'level', 'low'])}! ${interceptors.length > 12 ? 'Lots of them!' : 'Here they come.'}`);
    say(ctx, defender.id, interceptors[0].callsign, `Contact. ${bombers.length > 0 ? `${bombers.length >= 10 ? 'Large' : 'Small'} bomber formation` : 'Enemy fighters'}, ${escorts.length > 0 ? 'with escort' : 'no escort seen'}. Attacking.`, defender.id);
  } else {
    say(ctx, attacker.id, speaker(raid).callsign, state.weather === 'clear' ? 'Sky is clear. No fighters yet.' : 'No fighters yet. Cloud\'s thick; they may not find us.');
  }

  const rounds = 3;
  for (let round = 0; round < rounds; round++) {
    ctx.t += 6;
    // Escorts beyond their range turn back after the first engagement.
    if (round === 1 && depth > escortReach && escorts.some((e) => e.alive && !e.out) && target !== 'sweep') {
      const e0 = escorts.find((e) => e.alive)!;
      say(ctx, attacker.id, e0.callsign, 'Fuel state critical. Little friends turning for home. You\'re on your own.');
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
      if (!foe.alive) say(ctx, attacker.id, e.callsign, rng.pick(['Got one!', 'Splash one bandit.', 'He\'s going down, burning.']));
      if (!e.alive) witnessLoss(ctx, e, raid);
    }
    // Free interceptors attack bombers.
    const liveBombers = bombers.filter((b) => b.alive && !b.home && (!b.out || round === rounds - 1));
    if (liveBombers.length > 0) {
      for (const i of liveInterceptors) {
        if (!i.alive || tied.has(i)) continue;
        const passes = 1 + (rng.chance(i.sq.doctrine.aggression) ? 1 : 0);
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
          if (!i.alive) break;
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
      }
    }
    checkBreakOff(ctx, raid, startCounts, aborted);
    // Damaged bombers occasionally call in.
    for (const b of bombers) {
      if (b.alive && !b.out && b.condition < 55 && rng.chance(0.2)) {
        const z = b.rec.hits[b.rec.hits.length - 1]?.zone;
        say(ctx, attacker.id, b.callsign, `We're hit${z ? ` — ${zonePhrase(z)}` : ''}. Still flying.`);
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
    if (overBombers.length > 0) say(ctx, attacker.id, overBombers[0].callsign, support
      ? rng.pick(['Going in low over the lines. Pick your targets.', 'Down on the deck. Guns and bombs on the trenches.'])
      : rng.pick(['Flak ahead. Steady... steady...', 'Bomb doors open. Hold her level.', state.weather === 'clear' ? 'Target in sight, running in.' : 'Can\'t see a thing through this. Bombing on dead reckoning.']));
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
    damage *= 1.25 * wx.accuracy;
    if (bombers.some((b) => b.alive && !b.out)) say(ctx, attacker.id, speaker(bombers.filter((b) => !b.out)).callsign, 'Bombs gone. Turning for home.');
    // Defender's ground observers see the bombs fall.
    say(ctx, defender.id, 'Ground', support ? 'Enemy bombers low over our forward positions.' : `Bombs falling on ${site?.name ?? 'our facilities'}. Fires visible.`, defender.id);
  }

  // Egress: stragglers get picked off.
  ctx.t += 10;
  for (const i of interceptors.filter((x) => x.alive)) {
    const stragglers = bombers.filter((b) => b.alive && !b.home && b.condition < 55);
    if (stragglers.length === 0 || !rng.chance(0.45)) continue;
    const s = rng.pick(stragglers);
    bomberPass(ctx, i, s, bombers);
    if (!s.alive) witnessLoss(ctx, s, raid);
  }

  ctx.t += 25;
  const landed = raid.filter((f) => f.alive).length;
  say(ctx, attacker.id, 'Tower', `${landed} of ${raid.length} aircraft back over base.`);

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
  const threat = hunters.length ? 0.6 : 0.12 + (enemy.research.includes('radar') ? 0.1 : 0);
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
