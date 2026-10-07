/**
 * High Command's weekly offers. Every week the Air Ministry puts three
 * proposals on the commander's desk, and he may accept one. Most are ordinary;
 * some are uncommon; a few are rare and can change the shape of the war. The
 * more High Command trusts the commander, the better the odds of a rare one.
 */
import { crewNeed, storesCap, type ActionResult } from './actions';
import { AIRCRAFT, RESEARCH } from './data';
import { factionFx } from './factions';
import { MOD_IDS, MODS } from './mods';
import { Rng } from './rng';
import { makeAirframe, makeLeader, makeSquadron } from './setup';
import { syncFacilities } from './theaters';
import type { AircraftKind, GameState, ModId, OfferCard, OfferKind, Offers, OfferTier, SideState } from './types';
import { SQUADRON_NAMES } from './data';

export const TIER_LABEL: Record<OfferTier, string> = { 0: 'Routine', 1: 'Uncommon', 2: 'Rare' };

interface OfferDef {
  kind: OfferKind;
  tier: OfferTier;
  /** Whether it is any use to this side now. */
  can?: (state: GameState, side: SideState) => boolean;
  /** Fix what the offer is about when it is made. */
  param?: (rng: Rng, state: GameState, side: SideState) => string | undefined;
  title: (side: SideState, card: OfferCard) => string;
  text: (side: SideState, card: OfferCard, state: GameState) => string;
  apply: (state: GameState, side: SideState, card: OfferCard) => void;
}

const typesFlown = (side: SideState): AircraftKind[] =>
  (['fighter', 'medium', 'heavy'] as AircraftKind[]).filter((k) => side.squadrons.some((q) => q.kind === k && q.airframes.length < 10));
const openResearch = (side: SideState) => RESEARCH.filter((r) => !side.research.includes(r.id) && (!r.requires || side.research.includes(r.requires)));
const lockedMods = (side: SideState): ModId[] => MOD_IDS.filter((m) => MODS[m].rare && !side.modsUnlocked?.includes(m));
const enemySites = (state: GameState, side: SideState) => state.theater.sites.filter((x) => x.owner !== side.id);

const DEFS: OfferDef[] = [
  // --- Routine ---
  {
    kind: 'grant', tier: 0,
    title: () => 'Treasury grant',
    text: () => 'The Treasury releases a little more for the wing. +50 supplies.',
    apply: (_s, side) => { side.resources.supplies += 50; },
  },
  {
    kind: 'fuelTrain', tier: 0,
    title: () => 'An extra fuel train',
    text: (side) => `A train of fuel and munitions diverted to our depots. +35 stores (depots hold ${storesCap(side)}).`,
    apply: (_s, side) => { side.resources.stores = Math.min(storesCap(side), side.resources.stores + 35); },
  },
  {
    kind: 'crews', tier: 0,
    can: (_s, side) => crewNeed(side) > 0,
    title: () => 'Crews from Training Command',
    text: () => 'Two trained crews posted straight to squadrons short of men.',
    apply: (_s, side) => {
      let left = 2;
      for (const sq of [...side.squadrons].sort((a, b) => a.crews - a.airframes.length - (b.crews - b.airframes.length))) {
        while (left > 0 && sq.crews < sq.airframes.length) {
          sq.skill = (sq.skill * sq.crews + 0.4) / (sq.crews + 1);
          sq.crews++;
          left--;
        }
      }
      side.resources.replacements += left;
    },
  },
  {
    kind: 'labour', tier: 0,
    can: (state, side) => state.theater.sites.some((x) => x.owner === side.id && x.condition < 90),
    title: () => 'A labour battalion',
    text: () => 'Pioneers to clear rubble at every works, depot and airfield we hold. Each is repaired by 15%.',
    apply: (state, side) => {
      for (const x of state.theater.sites) if (x.owner === side.id) x.condition = Math.min(100, x.condition + 15);
      syncFacilities(state);
    },
  },
  {
    kind: 'leave', tier: 0,
    can: (_s, side) => side.squadrons.some((q) => q.fatigue > 0.2),
    title: () => 'A leave roster',
    text: () => 'Forty-eight-hour passes for every squadron in turn. Fatigue falls by a quarter everywhere; morale rises a little.',
    apply: (_s, side) => { for (const q of side.squadrons) { q.fatigue = Math.max(0, q.fatigue - 0.25); q.morale = Math.min(1, q.morale + 0.06); } },
  },
  {
    kind: 'tools', tier: 0,
    can: (_s, side) => side.factory.queue.length > 0,
    title: () => 'Machine tools on loan',
    text: () => 'Another works lends us its jigs for a week. +6 build points at the aircraft works.',
    apply: (_s, side) => { side.factory.progress += 6; },
  },
  // --- Uncommon ---
  {
    kind: 'ferry', tier: 1,
    can: (_s, side) => typesFlown(side).length > 0,
    param: (rng, _s, side) => rng.pick(typesFlown(side)),
    title: (side, c) => `Two ${AIRCRAFT[c.param as AircraftKind].name[side.id]}s from the pool`,
    text: (side, c) => `The ferry pool delivers two ${AIRCRAFT[c.param as AircraftKind].name[side.id]}s with their crews, from another command's reserve.`,
    apply: (state, side, c) => {
      const kind = c.param as AircraftKind;
      const rng = Rng.fromSeed(`${state.seed}|ferry|${side.id}|${state.turn}`);
      for (let i = 0; i < 2; i++) {
        const sq = side.squadrons.filter((q) => q.kind === kind && q.airframes.length < 10).sort((a, b) => a.airframes.length - b.airframes.length)[0];
        if (!sq) { side.resources.supplies += AIRCRAFT[kind].cost; continue; }
        sq.airframes.push(makeAirframe(state, rng, kind, side.id, 0.3));
        sq.skill = (sq.skill * sq.crews + 0.4) / (sq.crews + 1);
        sq.crews++;
      }
    },
  },
  {
    kind: 'priority', tier: 1,
    can: (_s, side) => !!side.researching,
    title: () => 'Priority for our project',
    text: (side) => `The Ministry of Aircraft Production puts ${RESEARCH.find((r) => r.id === side.researching)?.name ?? 'our project'} at the head of the list: two weeks' work done at once.`,
    apply: (_s, side) => { if (side.researching) side.researchProgress += 2; },
  },
  {
    kind: 'stockpile', tier: 1,
    title: () => 'Requisition a stockpile',
    text: () => 'A civilian stockpile requisitioned for the wing. +110 supplies, but the Treasury complains: confidence −4.',
    apply: (_s, side) => { side.resources.supplies += 110; side.trust = Math.max(0, side.trust - 4); },
  },
  {
    kind: 'instructors', tier: 1,
    title: () => 'Instructors from the front',
    text: () => 'Tour-expired veterans spend a fortnight with every squadron. Every squadron\'s skill rises.',
    apply: (_s, side) => { for (const q of side.squadrons) q.skill = Math.min(0.95, q.skill + 0.04); },
  },
  {
    kind: 'photos', tier: 1,
    can: (state, side) => enemySites(state, side).length > 0,
    title: () => 'Ministry photographs',
    text: () => 'Air Ministry reconnaissance has photographed every enemy site in the theater. We see each one as it really is.',
    apply: (state, side) => {
      for (const x of enemySites(state, side)) {
        side.perceived.sites[x.id] = x.condition;
        if (!side.perceived.photographed.includes(x.id)) side.perceived.photographed.push(x.id);
      }
    },
  },
  {
    kind: 'kits', tier: 1,
    title: () => 'Modification kits',
    text: () => 'Crates of field modification kits. The next two modifications fitted cost nothing (Squadrons, Field modifications).',
    apply: (_s, side) => { side.freeMods = (side.freeMods ?? 0) + 2; },
  },
  // --- Rare ---
  {
    kind: 'prototype', tier: 2,
    can: (_s, side) => lockedMods(side).length > 0,
    param: (rng, _s, side) => rng.pick(lockedMods(side)),
    title: (_side, c) => `Prototype: ${MODS[c.param as ModId].name}`,
    text: (_side, c) => `${MODS[c.param as ModId].desc} Released to this wing only; fit it under Squadrons.`,
    apply: (_s, side, c) => { side.modsUnlocked = [...new Set([...(side.modsUnlocked ?? []), c.param as ModId])]; },
  },
  {
    kind: 'secret', tier: 2,
    can: (_s, side) => openResearch(side).length > 0,
    param: (rng, _s, side) => rng.pick(openResearch(side)).id,
    title: (_side, c) => `Secret project: ${RESEARCH.find((r) => r.id === c.param)?.name}`,
    text: (_side, c) => `A project another command has finished, handed to us whole and in service at once. ${RESEARCH.find((r) => r.id === c.param)?.desc ?? ''}`,
    apply: (_s, side, c) => {
      const id = c.param!;
      if (side.research.includes(id)) return;
      side.research.push(id);
      if (side.researching === id) { side.researching = null; side.researchProgress = 0; }
    },
  },
  {
    kind: 'cabinet', tier: 2,
    title: () => 'A special vote of the War Cabinet',
    text: () => 'The War Cabinet votes the wing a special allocation. +200 supplies.',
    apply: (_s, side) => { side.resources.supplies += 200; },
  },
  {
    kind: 'dominion', tier: 2,
    can: (_s, side) => side.squadrons.length < 9,
    param: (rng) => String(rng.int(1, 1e9)),
    title: () => 'A squadron from overseas',
    text: (side) => `A fighter squadron from the Dominions joins the wing: six ${AIRCRAFT.fighter.name[side.id]}s, crews and ground staff.`,
    apply: (state, side, c) => {
      const rng = Rng.fromSeed(`${c.param}`);
      const used = new Set(side.squadrons.map((q) => q.name));
      const free = SQUADRON_NAMES[side.id].findIndex((n) => !used.has(n));
      const sq = makeSquadron(state, rng, side.id, 'fighter', 6, free >= 0 ? free : side.squadrons.length, undefined, [...side.squadrons.map((q) => q.leader.name), ...(side.usedNames ?? [])]);
      if (free < 0) sq.name = `${sq.name} (${side.squadrons.length + 1})`;
      sq.skill = 0.5;
      sq.notables = [`Week ${state.turn}: arrived from overseas to join the wing.`];
      side.squadrons.push(sq);
    },
  },
  {
    kind: 'ace', tier: 2,
    can: (_s, side) => side.squadrons.some((q) => q.kind !== 'recon' && q.airframes.length > 0 && !q.leader.resting),
    param: (rng, _s, side) => `${rng.pick(side.squadrons.filter((q) => q.kind !== 'recon' && q.airframes.length > 0 && !q.leader.resting)).id}|${rng.int(1, 1e9)}`,
    title: () => 'An ace to command',
    text: (side, c) => {
      const sq = side.squadrons.find((q) => q.id === c.param?.split('|')[0]);
      return `A famous ace, rested from another front, is offered command of ${sq?.name ?? 'a squadron'}. His squadron shoots 10% better; ${sq ? `${sq.leader.rank} ${sq.leader.name}` : 'the present CO'} stays on as his deputy.`;
    },
    apply: (state, side, c) => {
      const [sqId, seed] = (c.param ?? '').split('|');
      const sq = side.squadrons.find((q) => q.id === sqId);
      if (!sq) return;
      const ace = makeLeader(Rng.fromSeed(seed), side.id, undefined, [...side.squadrons.map((q) => q.leader.name), ...(side.usedNames ?? [])]);
      ace.trait = 'ace';
      ace.since = state.turn;
      ace.ops = 0;
      sq.deputy = sq.leader;
      sq.leader = ace;
      side.usedNames = [...new Set([...(side.usedNames ?? []), ace.name])];
      sq.notables = [`Week ${state.turn}: ${ace.rank} ${ace.name}, an ace from another front, took command.`, ...sq.notables].slice(0, 5);
    },
  },
  {
    kind: 'newDepot', tier: 2,
    title: () => 'A new fuel depot',
    text: () => 'A new underground depot is opened for the wing. Depots hold 40 more stores for the rest of the war, and it comes filled: +60 stores.',
    apply: (_s, side) => { side.depotBonus = (side.depotBonus ?? 0) + 40; side.resources.stores = Math.min(storesCap(side), side.resources.stores + 60); },
  },
];

const BY_KIND = new Map(DEFS.map((d) => [d.kind, d]));

/** Chance weights of each tier: rarer offers come to a commander High Command trusts. */
export function tierWeights(side: SideState): Record<OfferTier, number> {
  const t = Math.max(0, Math.min(1.3, (side.trust + factionFx(side, 'offerLuck')) / 100));
  return { 0: 1, 1: 0.25 + 0.5 * t, 2: 0.03 + 0.3 * t * t };
}

/** This week's proposals: three (more for some air forces), all different, each useful now. */
export function rollOffers(rng: Rng, state: GameState, side: SideState, week: number): Offers {
  const n = 3 + factionFx(side, 'offerCards');
  const w = tierWeights(side);
  const cards: OfferCard[] = [];
  const taken = new Set<OfferKind>();
  for (let i = 0; i < n; i++) {
    let tier = Number(rng.weighted({ 0: w[0], 1: w[1], 2: w[2] })) as OfferTier;
    for (; tier >= 0; tier--) {
      const pool = DEFS.filter((d) => d.tier === tier && !taken.has(d.kind) && (!d.can || d.can(state, side)));
      if (!pool.length) continue;
      const def = rng.pick(pool);
      taken.add(def.kind);
      const param = def.param?.(rng, state, side);
      cards.push({ kind: def.kind, tier: def.tier, ...(param !== undefined ? { param } : {}) });
      break;
    }
  }
  return { week, cards };
}

export function offerTitle(side: SideState, card: OfferCard): string {
  return BY_KIND.get(card.kind)?.title(side, card) ?? card.kind;
}
export function offerText(state: GameState, side: SideState, card: OfferCard): string {
  return BY_KIND.get(card.kind)?.text(side, card, state) ?? '';
}

/** Accept one of this week's offers. One a week; the rest are withdrawn. */
export function takeOffer(state: GameState, side: SideState, i: number): ActionResult {
  const o = side.offers;
  if (!o || o.week !== state.turn) return { ok: false, reason: 'High Command has made no offer this week' };
  if (o.taken !== undefined) return { ok: false, reason: 'One offer a week: this week\'s has been accepted' };
  const card = o.cards[i];
  const def = card && BY_KIND.get(card.kind);
  if (!card || !def) return { ok: false, reason: 'No such offer' };
  if (def.can && !def.can(state, side)) return { ok: false, reason: 'That offer is no use to the wing any longer' };
  def.apply(state, side, card);
  o.taken = i;
  side.memos.unshift({ turn: state.turn, from: 'Air Ministry', kind: 'supply', subject: `Accepted: ${def.title(side, card)}`, body: def.text(side, card, state) });
  return { ok: true };
}

/** An AI wing takes the rarest offer, and among equals the one it values most. */
export function aiTakeOffer(state: GameState, side: SideState) {
  const o = side.offers;
  if (!o || o.week !== state.turn || o.taken !== undefined || !o.cards.length) return;
  const value: Partial<Record<OfferKind, number>> = { dominion: 9, cabinet: 8, secret: 7, ace: 6, newDepot: 5, prototype: 3, ferry: 6, stockpile: side.trust > 55 ? 5 : -20, instructors: 4, priority: 4, photos: 2, kits: 1, crews: 5, grant: 4, fuelTrain: side.resources.stores < 80 ? 6 : 2, labour: 3, leave: 3, tools: 2 };
  const best = o.cards.map((c, i) => ({ i, v: c.tier * 10 + (value[c.kind] ?? 0) })).sort((a, b) => b.v - a.v)[0];
  takeOffer(state, side, best.i);
}
