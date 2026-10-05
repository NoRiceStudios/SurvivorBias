/**
 * War theaters: the campaign is fought across three theaters in sequence.
 * Each theater is a strip of sectors holding named facilities. Pressure on
 * the contested boundary captures sectors; two sectors gained wins the theater.
 */
import type { Rng } from './rng';
import type {
  AircraftKind,
  Facilities,
  FacilityType,
  GameState,
  SecondaryObjective,
  SideId,
  SideState,
  Site,
  TheaterState,
  Weather,
} from './types';

export const SECTORS = 6;
/** Pressure needed to push the front one sector. */
export const SECTOR_PRESSURE = 24;
/** Sectors that must be gained to win a theater outright. */
export const DECISIVE_GAIN = 2;

export interface StageDef {
  week: number;
  title: string;
  text: string;
  flak?: number;
  detection?: number;
  weather?: Partial<Record<Weather, number>>;
  /** Multiplier on pressure gained from close-support missions. */
  support?: number;
}

export interface TheaterDef {
  id: string;
  name: string;
  season: string;
  weeks: number;
  blurb: string;
  /** Sector names from side 0's rear (index 0) to side 1's rear (index 5). */
  sectors: string[];
  /** Site types per depth (frontline, middle, rear) for each side. */
  layout: [FacilityType[], FacilityType[], FacilityType[]];
  flak: number;
  weather: Record<Weather, number>;
  stages: StageDef[];
  /** Secondary objective: the depth and type of the enemy site to wreck, plus the reward. */
  secondary: { depth: number; type: FacilityType; text: string; reward: SecondaryObjective['reward'] };
}

export const THEATERS: TheaterDef[] = [
  {
    id: 'narrow-sea',
    name: 'The Narrow Sea',
    season: 'Autumn',
    weeks: 10,
    blurb: 'A grey strip of water and the coastal plains either side of it. Whoever holds the air over the Narrows holds the crossing.',
    sectors: ['Fallowmere', 'Saltcote', 'Greywick Sands', 'Kesselspitze', 'Hafenburg', 'Brandmoor'],
    layout: [['airfield', 'fuel'], ['airfield', 'industry'], ['industry', 'fuel']],
    flak: 1,
    weather: { clear: 0.5, cloud: 0.35, storm: 0.15 },
    stages: [
      { week: 1, title: 'Opening moves', text: 'Both air arms are feeling each other out. Losses are expected to be light.' },
      { week: 4, title: 'Autumn gales', text: 'The weather is turning. Expect cloud over the targets and storms in the Narrows.', weather: { cloud: 0.15, storm: 0.1 } },
      { week: 8, title: 'Radar chains complete', text: 'Both sides have finished their coastal radar chains. Raids will be met earlier and in strength.', detection: 0.1 },
    ],
    secondary: { depth: 1, type: 'airfield', text: 'Put the enemy\'s forward airfield out of action', reward: { research: 'dropTanks', trust: 5 } },
  },
  {
    id: 'kessel-basin',
    name: 'The Kessel Basin',
    season: 'Winter',
    weeks: 10,
    blurb: 'A coal-and-steel valley ringed with flak. The aircraft works here build half of everything that flies.',
    sectors: ['Ashford Gap', 'Corran Vale', 'Millbrook', 'Eisenfeld', 'Kesselstadt', 'Rauchtal'],
    layout: [['airfield', 'industry'], ['industry', 'fuel'], ['industry', 'airfield']],
    flak: 1.3,
    weather: { clear: 0.35, cloud: 0.4, storm: 0.25 },
    stages: [
      { week: 1, title: 'Into the valley', text: 'The basin is the most heavily defended ground of the war. Flak is dense around every works.' },
      { week: 4, title: 'Deep winter', text: 'Snow and low cloud. Bombing results will be hard to observe and harder to believe.', weather: { cloud: 0.15, storm: 0.1 } },
      { week: 8, title: 'Box barrages', text: 'Both sides have massed their flak around what is left of their industry.', flak: 0.25 },
    ],
    secondary: { depth: 2, type: 'industry', text: 'Wreck the enemy\'s main aircraft works', reward: { supplies: 120, trust: 10 } },
  },
  {
    id: 'northern-approaches',
    name: 'The Northern Approaches',
    season: 'Spring',
    weeks: 10,
    blurb: 'Open country before the capitals. The armies are moving again, and every sortie in support of them counts.',
    sectors: ['Tarnhold', 'Wendover Ridge', 'Elmsgate', 'Nordwall', 'Grauburg', 'Nordheim'],
    layout: [['airfield', 'airfield'], ['industry', 'fuel'], ['industry', 'fuel']],
    flak: 1.15,
    weather: { clear: 0.6, cloud: 0.3, storm: 0.1 },
    stages: [
      { week: 1, title: 'The thaw', text: 'The ground has dried. Both armies are preparing to move.' },
      { week: 4, title: 'Spring offensive', text: 'The armies are on the move. Close support of the front now counts for more than ever.', support: 1.6 },
      { week: 8, title: 'Last reserves', text: 'Both sides are throwing in everything they have left. This is the decision.', detection: 0.1, support: 1.6 },
    ],
    secondary: { depth: 3, type: 'fuel', text: 'Burn the enemy\'s strategic fuel reserve', reward: { supplies: 80, trust: 15 } },
  },
];

const SITE_SUFFIX: Record<FacilityType, string[]> = {
  airfield: ['Airfield', 'Aerodrome', 'Landing Ground'],
  industry: ['Aircraft Works', 'Engine Works', 'Assembly Plant'],
  fuel: ['Fuel Depot', 'Oil Terminal', 'Tank Farm'],
};

export function theaterDef(state: GameState): TheaterDef {
  return THEATERS[state.theater.index];
}

/** Sector index for a given depth behind a side's front line (1 = frontline sector). */
export function sectorAtDepth(held0: number, side: SideId, depth: number): number {
  return side === 0 ? held0 - depth : held0 + depth - 1;
}

/** Depth of a sector as seen by the attacker (1 = enemy frontline sector). <=0 means own territory. */
export function depthFor(held0: number, attacker: SideId, sector: number): number {
  return attacker === 0 ? sector - held0 + 1 : held0 - sector;
}

export function sectorOwner(t: TheaterState, sector: number): SideId {
  return sector < t.held0 ? 0 : 1;
}

/** The enemy's frontline sector, from the attacker's point of view. */
export function frontSector(t: TheaterState, attacker: SideId): number {
  return attacker === 0 ? t.held0 : t.held0 - 1;
}

/** How deep a type can reach (in sectors past the front). */
export function bomberRange(kind: AircraftKind): number {
  return kind === 'heavy' ? 3 : kind === 'medium' ? 2 : kind === 'recon' ? 3 : 1;
}

export function escortRange(side: SideState): number {
  return side.research.includes('dropTanks') ? 3 : 2;
}

export function setupTheater(state: GameState, index: number, rng: Rng, headStart: SideId | null): TheaterState {
  const def = THEATERS[index];
  const held0 = SECTORS / 2;
  const sites: Site[] = [];
  const baseline: [Facilities, Facilities] = [
    { industry: 0, airfield: 0, fuel: 0 },
    { industry: 0, airfield: 0, fuel: 0 },
  ];
  for (const side of [0, 1] as SideId[]) {
    def.layout.forEach((types, d) => {
      const sector = sectorAtDepth(held0, side, d + 1);
      types.forEach((type, k) => {
        const suffix = SITE_SUFFIX[type][(index + k + d) % SITE_SUFFIX[type].length];
        sites.push({ id: `s${index}-${sector}-${k}`, name: `${def.sectors[sector]} ${suffix}`, type, sector, owner: side, condition: 100 });
        baseline[side][type]++;
      });
    });
  }
  const objectives: SecondaryObjective[] = [];
  for (const side of [0, 1] as SideId[]) {
    const enemy = (1 - side) as SideId;
    const sector = sectorAtDepth(held0, enemy, def.secondary.depth);
    const site = sites.find((s) => s.sector === sector && s.type === def.secondary.type) ?? sites.find((s) => s.owner === enemy)!;
    objectives.push({ side, siteId: site.id, text: `${def.secondary.text}: ${site.name}.`, reward: def.secondary.reward, status: 'open' });
  }
  void rng;
  const t: TheaterState = { index, id: def.id, week: 0, held0, start0: held0, sites, baseline, stage: 0, objectives };
  state.front = headStart === 0 ? HEAD_START : headStart === 1 ? -HEAD_START : 0;
  return t;
}

/** Recompute each side's aggregate facility condition from the sites it holds. */
export function syncFacilities(state: GameState) {
  const t = state.theater;
  for (const side of state.sides) {
    for (const type of ['industry', 'airfield', 'fuel'] as FacilityType[]) {
      const own = t.sites.filter((s) => s.owner === side.id && s.type === type);
      const base = Math.max(1, t.baseline[side.id][type]);
      side.facilities[type] = Math.min(150, Math.round(own.reduce((a, s) => a + s.condition, 0) / base));
    }
  }
}

export function currentStage(state: GameState): StageDef {
  const def = theaterDef(state);
  let st = def.stages[0];
  for (const s of def.stages) if (state.theater.week + 1 >= s.week) st = s;
  return st;
}

/** Combined environmental modifiers from the theater and its stages so far. */
export function theaterMods(state: GameState): { flak: number; detection: number; support: number; weather: Record<Weather, number> } {
  const def = theaterDef(state);
  const weather = { ...def.weather };
  let flak = def.flak;
  let detection = 0;
  let support = 1;
  for (const s of def.stages) {
    if (state.theater.week + 1 < s.week) continue;
    flak += s.flak ?? 0;
    detection += s.detection ?? 0;
    if (s.support) support = s.support;
    for (const [k, v] of Object.entries(s.weather ?? {})) weather[k as Weather] += v as number;
  }
  return { flak, detection, support, weather };
}

/** Roll next week's weather and each side's (unreliable) forecast. */
export function rollWeather(state: GameState, rng: Rng) {
  const w = rng.weighted(theaterMods(state).weather) as Weather;
  state.weather = w;
  // Forecasts are right about three times in four; when wrong, they are off by one step, never clear-for-storm.
  const near: Record<Weather, Weather[]> = { clear: ['cloud'], cloud: ['clear', 'storm'], storm: ['cloud'] };
  const fc = (): Weather => (rng.chance(0.75) ? w : rng.pick(near[w]));
  state.forecast = [fc(), fc()];
}

export const WEATHER_EFFECT: Record<Weather, { accuracy: number; detection: number; flak: number; unobserved: number }> = {
  clear: { accuracy: 1, detection: 1, flak: 1, unobserved: 0 },
  cloud: { accuracy: 0.75, detection: 0.85, flak: 0.9, unobserved: 0.3 },
  storm: { accuracy: 0.5, detection: 0.65, flak: 0.75, unobserved: 0.55 },
};

export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Clear', cloud: 'Overcast', storm: 'Storms' };

/** Move the front if pressure has built up. Returns news lines per side. */
export function applyPressure(state: GameState, flew: [boolean, boolean] = [true, true]): [string[], string[]] {
  const t = state.theater;
  const def = theaterDef(state);
  const news: [string[], string[]] = [[], []];
  // At most one sector falls per week; the defenders regroup behind it.
  if (Math.abs(state.front) >= SECTOR_PRESSURE) {
    const winner: SideId = state.front > 0 ? 0 : 1;
    // The Army won't go over the top without air cover overhead: no operation, no capture.
    if (!flew[winner]) {
      state.front = winner === 0 ? SECTOR_PRESSURE - 1 : 1 - SECTOR_PRESSURE;
      news[winner].push('The Army is ready to attack but will not move without our aircraft overhead. The push waits for a week we fly.');
      return news;
    }
    const sector = frontSector(t, winner);
    if (sector < 0 || sector >= SECTORS) return news;
    t.held0 += winner === 0 ? 1 : -1;
    state.front -= winner === 0 ? SECTOR_PRESSURE : -SECTOR_PRESSURE;
    const cap = SECTOR_PRESSURE / 2;
    state.front = Math.max(-cap, Math.min(cap, state.front));
    // Captured facilities change hands, wrecked.
    for (const s of t.sites.filter((x) => x.sector === sector)) {
      s.owner = winner;
      s.takenWrecked = s.condition <= 25;
      s.condition = Math.min(s.condition, 30);
    }
    const name = def.sectors[sector];
    news[winner].push(`The Army reports ${name} taken. Its facilities are in our hands, badly damaged.`);
    news[(1 - winner) as SideId].push(`${name} has fallen. We have lost every facility in the sector.`);
  }
  return news;
}

/** Check whether the theater has been decided. */
export function theaterDecision(state: GameState): { winner: SideId | null; decisive: boolean } | null {
  const t = state.theater;
  const def = theaterDef(state);
  const gain = t.held0 - t.start0;
  if (gain >= DECISIVE_GAIN) return { winner: 0, decisive: true };
  if (gain <= -DECISIVE_GAIN) return { winner: 1, decisive: true };
  if (t.week >= def.weeks) {
    // Winning on advantage needs ground to show for it: without a sector taken, it is a stalemate.
    const score = gain * SECTOR_PRESSURE + state.front;
    if (score > 15 && gain >= 1) return { winner: 0, decisive: false };
    if (score < -15 && gain <= -1) return { winner: 1, decisive: false };
    return { winner: null, decisive: false };
  }
  return null;
}

/** Sites a side can reach with a given aircraft type this week. */
export function reachableSites(state: GameState, side: SideId, kind: AircraftKind): Site[] {
  const t = state.theater;
  return t.sites.filter((s) => s.owner !== side && depthFor(t.held0, side, s.sector) <= bomberRange(kind));
}

/** Pressure the winner of the last theater carries into the next one (it is shown to both sides). */
export const HEAD_START = 8;

/** Move the war into a theater: lay out its sites, reset beliefs, brief both commanders. */
export function enterTheater(state: GameState, index: number, rng: Rng, headStart: SideId | null) {
  state.theater = setupTheater(state, index, rng, headStart);
  const def = THEATERS[index];
  for (const side of state.sides) {
    side.perceived.sites = Object.fromEntries(state.theater.sites.filter((x) => x.owner !== side.id).map((x) => [x.id, 100]));
    side.perceived.photographed = [];
    side.perceived.front = side.id === 0 ? state.front : 0 - state.front;
    // Redeployment: the ground crews catch up on repairs, crews get a breather.
    if (index > 0) {
      side.requests = side.requests.filter((r) => r.kind !== 'rest');
      side.requests.forEach((r, i) => (r.n = i + 1));
      for (const sq of side.squadrons) {
        for (const af of sq.airframes) if (af.status === 'repair') {
          af.status = 'ready';
          af.condition = 100;
        }
        sq.fatigue = 0;
        sq.morale = Math.min(1, sq.morale + 0.1);
      }
    }
    const obj = state.theater.objectives.find((o) => o.side === side.id)!;
    side.memos.unshift({
      turn: state.turn,
      from: 'Air Ministry',
      kind: 'order',
      subject: `Theater of operations: ${def.name}`,
      body: `${def.blurb} You are to win air superiority over ${def.name} and support the Army in taking ${DECISIVE_GAIN} sectors from the enemy. Secondary objective: ${obj.text}${headStart === null ? '' : headStart === side.id ? ` The momentum of the last campaign carries over: the front opens at +${HEAD_START} in our favour.` : ` The enemy arrives with the momentum of the last campaign: the front opens at −${HEAD_START}.`}`,
    });
  }
  syncFacilities(state);
  rollWeather(state, rng);
}
