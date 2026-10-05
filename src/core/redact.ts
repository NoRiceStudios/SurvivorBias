/**
 * What one commander is allowed to know. In a LAN game the host sends the
 * joining player only this view: their own side in full, the public theater
 * map with enemy sites at their *believed* condition, and nothing of the
 * opponent's wing, plans, reports or the hidden truth. When the war is over
 * the archives open and the full state is shared.
 */
import { emptyPerceived } from './setup';
import type { GameState, SideId, SideState } from './types';
import { ZONES } from './types';

function blankSide(s: SideState): SideState {
  return {
    ...s,
    isAI: false,
    insight: 0,
    resources: { supplies: 0, stores: 0, replacements: 0 },
    squadrons: [],
    factory: { level: 0, qc: 'standard', queue: [], progress: 0 },
    training: { level: 0, focus: 'balanced', inTraining: 0 },
    facilities: { industry: 0, airfield: 0, fuel: 0 },
    research: [],
    researching: null,
    researchProgress: 0,
    trust: 0,
    approach: { tail: 1 / 3, headOn: 1 / 3, beam: 1 / 3 },
    flak: 0,
    perceived: emptyPerceived(),
    orders: [],
    memos: [],
    lowMoraleTurns: 0,
    caught: 0,
    observed: { feints: 0, support: 0 },
    requests: [],
  };
}

export function redactFor(full: GameState, viewer: SideId): GameState {
  const s = JSON.parse(JSON.stringify(full)) as GameState;
  if (s.outcome) return s; // The archives are open.
  const enemy = (1 - viewer) as SideId;
  const me = s.sides[viewer];
  s.sides[enemy] = blankSide(s.sides[enemy]);
  s.seed = 'redacted';
  s.rng = { s: 0 };
  s.lethality = Object.fromEntries(['fighter', 'medium', 'heavy', 'recon'].map((k) => [k, Object.fromEntries(ZONES.map((z) => [z, 0]))])) as GameState['lethality'];
  // The coming week's weather is known only as a forecast; the front only as the Army liaison reports it.
  s.weather = s.forecast[viewer];
  s.forecast = [s.forecast[viewer], s.forecast[viewer]];
  s.front = viewer === 0 ? me.perceived.front : -me.perceived.front;
  // Enemy sites are shown at their believed condition.
  for (const site of s.theater.sites) if (site.owner !== viewer) site.condition = me.perceived.sites[site.id] ?? 100;
  s.theater.objectives = s.theater.objectives.filter((o) => o.side === viewer);
  s.lastDebriefs[enemy] = null;
  s.sealed[enemy] = null;
  // The archive keeps only what this commander saw: own claims, own losses, survivor damage.
  for (const e of s.archive) {
    e.trueKills = [0, 0];
    e.trueLosses[enemy] = 0;
    e.claimed[enemy] = 0;
    e.reportedToHq[enemy] = 0;
    e.facilities[enemy] = { industry: 0, airfield: 0, fuel: 0 };
    e.front = 0;
    e.lostHits = [[], []];
    e.survivorHits[enemy] = [];
  }
  return s;
}
