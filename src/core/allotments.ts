/**
 * High Command's weekly allotment: with the answer to the week's returns come
 * three offers, and the commander takes one. The more High Command trusts the
 * wing, the likelier the rare and exceptional offers. Some come with strings
 * attached: favours are never free.
 */
import { RESEARCH } from './data';
import { aircraftLabel, nationOf, storesCap } from './factions';
import { makeAirframe, makeSquadron } from './setup';
import { Rng } from './rng';
import { newOrder } from './turn';
import type { ActionResult } from './actions';
import type { AircraftKind, Allotment, AllotmentRarity, GameState, SideState, Squadron } from './types';

/** Chance of each rarity per offer, by High Command's confidence in the wing. */
export function allotmentOdds(trust: number): Record<AllotmentRarity, number> {
  if (trust >= 75) return { common: 0.4, rare: 0.42, exceptional: 0.18 };
  if (trust >= 40) return { common: 0.6, rare: 0.32, exceptional: 0.08 };
  return { common: 0.8, rare: 0.18, exceptional: 0.02 };
}

export const RARITY_LABEL: Record<AllotmentRarity, string> = { common: 'Routine', rare: 'Priority', exceptional: 'Most Secret' };

type Offer = Omit<Allotment, 'id' | 'card' | 'rarity'>;
interface Card {
  id: string;
  rarity: AllotmentRarity;
  /** The offer as it reads this week, or null when it makes no sense for this wing now. */
  make: (state: GameState, side: SideState) => Offer | null;
  apply: (state: GameState, side: SideState, a: Allotment, rng: Rng) => string;
}

const combat = (side: SideState) => side.squadrons.filter((q) => q.kind !== 'recon');
const typeName = (side: SideState, kind: AircraftKind) => aircraftLabel(side, kind);

/** The squadron of a type with the fewest aircraft and room for more. */
function receiving(side: SideState, kind: AircraftKind): Squadron | undefined {
  return side.squadrons.filter((q) => q.kind === kind && q.airframes.length < 10).sort((a, b) => a.airframes.length - b.airframes.length)[0];
}

/** The type the wing is shortest of, among fighters and bombers it already flies. */
function neediestKind(side: SideState): AircraftKind | undefined {
  const kinds = [...new Set(combat(side).filter((q) => q.airframes.length < 10).map((q) => q.kind))];
  const count = (k: AircraftKind) => side.squadrons.filter((q) => q.kind === k).reduce((a, q) => a + q.airframes.length, 0);
  return kinds.sort((a, b) => count(a) - count(b))[0];
}

function deliver(state: GameState, side: SideState, kind: AircraftKind, n: number, rng: Rng, defectScale = 0.5): number {
  let given = 0;
  for (let i = 0; i < n; i++) {
    const sq = receiving(side, kind);
    if (!sq) break;
    sq.airframes.push(makeAirframe(state, rng, kind, side, defectScale));
    given++;
  }
  return given;
}

function formSquadron(state: GameState, side: SideState, kind: AircraftKind, size: number, rng: Rng): Squadron {
  const used = new Set(side.squadrons.map((q) => q.name));
  const free = nationOf(side).squadronNames.findIndex((n) => !used.has(n));
  const sq = makeSquadron(state, rng, side, kind, size, free >= 0 ? free : side.squadrons.length, undefined, [...side.squadrons.map((q) => q.leader.name), ...(side.usedNames ?? [])]);
  if (free < 0) sq.name = `${sq.name} (${side.squadrons.length + 1})`;
  side.squadrons.push(sq);
  return sq;
}

/** Projects the engineers could take up now. */
function openResearch(side: SideState) {
  return RESEARCH.filter((r) => !side.research.includes(r.id) && r.id !== side.researching && (!r.requires || side.research.includes(r.requires)));
}

const sqById = (side: SideState, id?: string) => side.squadrons.find((q) => q.id === id);

export const ALLOTMENT_CARDS: Card[] = [
  // --- Routine ---
  {
    id: 'spareAircraft', rarity: 'common',
    make: (_s, side) => {
      const kind = neediestKind(side);
      return kind ? { title: 'Reserve aircraft', text: `One ${typeName(side, kind)} from the reserve pool, delivered to the squadron that needs it most.`, kind } : null;
    },
    apply: (state, side, a, rng) => `${deliver(state, side, a.kind!, 1, rng)} ${typeName(side, a.kind!)} delivered from the reserve pool.`,
  },
  {
    id: 'crews', rarity: 'common',
    make: (_s, side) => {
      const sq = combat(side).filter((q) => q.crews < q.airframes.length).sort((a, b) => (a.crews - a.airframes.length) - (b.crews - b.airframes.length))[0];
      return sq
        ? { title: 'Aircrew posting', text: `Two trained crews posted straight to ${sq.name}, which has aircraft standing idle.`, squadronId: sq.id }
        : { title: 'Aircrew posting', text: 'Two trained crews for the replacement pool.' };
    },
    apply: (_state, side, a) => {
      const sq = sqById(side, a.squadronId);
      if (sq && sq.crews < sq.airframes.length) {
        sq.skill = (sq.skill * sq.crews + 0.4 * 2) / (sq.crews + 2);
        sq.crews += 2;
        return `Two crews have joined ${sq.name}.`;
      }
      side.resources.replacements += 2;
      return 'Two crews have joined the replacement pool.';
    },
  },
  {
    id: 'fuelConvoy', rarity: 'common',
    make: (_s, side) => (side.resources.stores <= storesCap(side) - 20 ? { title: 'Fuel convoy', text: 'An extra convoy of fuel and munitions: +40 stores.' } : null),
    apply: (_state, side) => {
      side.resources.stores = Math.min(storesCap(side), side.resources.stores + 40);
      return 'The fuel convoy is in: +40 stores.';
    },
  },
  {
    id: 'repairGangs', rarity: 'common',
    make: (_s, side) => {
      const n = side.squadrons.reduce((a, q) => a + q.airframes.filter((f) => f.status === 'repair').length, 0);
      return n ? { title: 'Repair gangs', text: `A works party from the depot: every aircraft in the hangars (${n} now) is a week nearer flying.`, n } : null;
    },
    apply: (_state, side) => {
      let done = 0;
      for (const q of side.squadrons) for (const f of q.airframes) {
        if (f.status !== 'repair') continue;
        f.repairTurns--;
        if (f.repairTurns <= 0) { f.status = 'ready'; f.condition = 100; done++; }
      }
      return `The depot's fitters have been and gone: ${done} aircraft back on the line.`;
    },
  },
  {
    id: 'leave', rarity: 'common',
    make: (_s, side) => {
      const sq = combat(side).filter((q) => q.fatigue >= 0.35).sort((a, b) => b.fatigue - a.fatigue)[0];
      return sq ? { title: 'Leave passes', text: `Forty-eight hours' leave for ${sq.name}: much less fatigue, a little more morale. They still fly this week.`, squadronId: sq.id } : null;
    },
    apply: (_state, side, a) => {
      const sq = sqById(side, a.squadronId);
      if (!sq) return 'The leave passes came too late.';
      sq.fatigue = Math.max(0, sq.fatigue - 0.35);
      sq.morale = Math.min(1, sq.morale + 0.08);
      return `${sq.name} are back from leave, rested.`;
    },
  },
  {
    id: 'requisition', rarity: 'common',
    make: () => ({ title: 'Special requisition', text: 'A one-off grant from the Ministry: +35 supplies.' }),
    apply: (_state, side) => {
      side.resources.supplies += 35;
      return 'The requisition was granted: +35 supplies.';
    },
  },
  {
    id: 'armySurplus', rarity: 'common',
    make: (_s, side) => (side.resources.stores >= 40 ? { title: 'Army exchange', text: 'The Army trades materiel for fuel: +60 supplies.', catch: 'The Army takes 30 stores.' } : null),
    apply: (_state, side) => {
      side.resources.supplies += 60;
      side.resources.stores = Math.max(0, side.resources.stores - 30);
      return 'The exchange is done: +60 supplies, 30 stores handed to the Army.';
    },
  },
  {
    id: 'pressVisit', rarity: 'common',
    make: (_s, side) => {
      const sq = combat(side).filter((q) => q.airframes.length > 0).sort((a, b) => a.fatigue - b.fatigue)[0];
      return sq ? { title: 'Newsreel visit', text: 'The newsreel cameras want a heroic wing: +6 confidence with High Command.', catch: `${sq.name} fly extra sorties for the cameras: fatigue rises.`, squadronId: sq.id } : null;
    },
    apply: (_state, side, a) => {
      side.trust = Math.min(100, side.trust + 6);
      const sq = sqById(side, a.squadronId);
      if (sq) sq.fatigue = Math.min(1, sq.fatigue + 0.2);
      return 'The newsreel men have their pictures. The Air Council saw them too.';
    },
  },
  {
    id: 'rushedDelivery', rarity: 'common',
    make: (_s, side) => {
      const kind = neediestKind(side);
      return kind ? { title: 'Rushed delivery', text: `Two ${typeName(side, kind)} straight off a night shift.`, catch: 'Uninspected: many of them will have faults.', kind } : null;
    },
    apply: (state, side, a, rng) => `${deliver(state, side, a.kind!, 2, rng, 2)} ${typeName(side, a.kind!)} delivered, uninspected.`,
  },

  // --- Priority ---
  {
    id: 'reconPhotos', rarity: 'rare',
    make: (state, side) => {
      // The site whose state the wing has most wrong.
      const site = state.theater.sites
        .filter((x) => x.owner !== side.id)
        .sort((a, b) => Math.abs((side.perceived.sites[b.id] ?? 100) - b.condition) - Math.abs((side.perceived.sites[a.id] ?? 100) - a.condition))[0];
      // The photographs are taken now, while the truth is at hand (a LAN client only ever sees believed conditions).
      return site ? { title: 'Ministry photographs', text: `Photographs of the ${site.name} from the Ministry's own reconnaissance: its true state.`, siteId: site.id, n: site.condition } : null;
    },
    apply: (state, side, a) => {
      const site = state.theater.sites.find((x) => x.id === a.siteId);
      if (!site || a.n === undefined) return 'The photographs show a site that is no longer there.';
      side.perceived.sites[site.id] = a.n;
      if (!side.perceived.photographed.includes(site.id)) side.perceived.photographed.push(site.id);
      return `Photographs show the ${site.name} at ${a.n}%.`;
    },
  },
  {
    id: 'researchPush', rarity: 'rare',
    make: (_s, side) => {
      const item = RESEARCH.find((r) => r.id === side.researching);
      return item ? { title: 'Ministry scientists', text: `A team from the Ministry joins the work on ${item.name}: two weeks' progress at once.`, researchId: item.id } : null;
    },
    apply: (_state, side) => {
      if (!side.researching) return 'The scientists found nothing to work on.';
      side.researchProgress += 2;
      return 'The Ministry scientists have joined the engineers.';
    },
  },
  {
    id: 'veterans', rarity: 'rare',
    make: (_s, side) => {
      const sq = combat(side).filter((q) => q.crews > 0 && q.skill < 0.85).sort((a, b) => a.skill - b.skill)[0];
      return sq ? { title: 'Instructors from the front', text: `Seasoned airmen spend a fortnight with ${sq.name}: their crews fly much better.`, squadronId: sq.id } : null;
    },
    apply: (_state, side, a) => {
      const sq = sqById(side, a.squadronId);
      if (!sq) return 'The instructors arrived to find no squadron.';
      sq.skill = Math.min(0.9, sq.skill + 0.12);
      return `${sq.name} have flown with the old hands.`;
    },
  },
  {
    id: 'twoAircraft', rarity: 'rare',
    make: (_s, side) => {
      const kind = neediestKind(side);
      return kind ? { title: 'Priority allocation', text: `Two ${typeName(side, kind)} from the factory, ahead of other commands.`, kind } : null;
    },
    apply: (state, side, a, rng) => `${deliver(state, side, a.kind!, 2, rng)} ${typeName(side, a.kind!)} delivered.`,
  },
  {
    id: 'instructors', rarity: 'rare',
    make: (_s, side) => (side.training.level < 5 ? { title: 'Training staff', text: 'More instructors and a second airfield for the school: training expanded one level.' } : null),
    apply: (_state, side) => {
      side.training.level = Math.min(5, side.training.level + 1);
      return 'The training school has been expanded.';
    },
  },
  {
    id: 'propaganda', rarity: 'rare',
    make: () => ({ title: 'Propaganda campaign', text: 'The Ministry makes the wing famous: +12 confidence with High Command.', catch: 'Famous wings get extra directives: one more order arrives.' }),
    apply: (state, side, _a, rng) => {
      side.trust = Math.min(100, side.trust + 12);
      const o = newOrder(rng, state, side);
      if (!o) return 'The wing is in every newspaper.';
      side.orders.push(o);
      side.memos.unshift({ turn: state.turn, from: 'Air Ministry', subject: 'Operational directive', body: o.text, kind: 'order' });
      return `The wing is in every newspaper. A further directive follows: ${o.text}`;
    },
  },
  {
    id: 'veteranTransfer', rarity: 'rare',
    make: (_s, side) => {
      const ranked = combat(side).filter((q) => q.crews > 0).sort((a, b) => a.skill - b.skill);
      const to = ranked[0], from = ranked[ranked.length - 1];
      return ranked.length >= 2 && from.skill - to.skill > 0.05
        ? { title: 'Section leaders cross-posted', text: `Experienced section leaders move to ${to.name}: its crews fly far better.`, catch: `${from.name} lose them and fly a little worse.`, squadronId: to.id, otherId: from.id }
        : null;
    },
    apply: (_state, side, a) => {
      const to = sqById(side, a.squadronId), from = sqById(side, a.otherId);
      if (to) to.skill = Math.min(0.9, to.skill + 0.16);
      if (from) from.skill = Math.max(0.2, from.skill - 0.07);
      return 'The section leaders have changed squadrons.';
    },
  },

  // --- Most Secret ---
  {
    id: 'prototype', rarity: 'exceptional',
    make: (_s, side) => {
      const item = openResearch(side).sort((a, b) => b.cost - a.cost)[0];
      return item ? { title: 'Prototype released', text: `The Ministry releases ${item.name} to the wing, finished and paid for. ${item.desc}`, researchId: item.id } : null;
    },
    apply: (_state, side, a) => {
      const item = RESEARCH.find((r) => r.id === a.researchId);
      if (!item || side.research.includes(item.id)) return 'The prototype was already in service.';
      side.research.push(item.id);
      return `${item.name} is in service.`;
    },
  },
  {
    id: 'newSquadron', rarity: 'exceptional',
    make: (_s, side) => {
      const kind = neediestKind(side) ?? 'fighter';
      return { title: 'A new squadron', text: `A fresh squadron of five ${typeName(side, kind)}, with crews, joins the wing.`, kind };
    },
    apply: (state, side, a, rng) => {
      const sq = formSquadron(state, side, a.kind!, 5, rng);
      return `${sq.name} has joined the wing with five ${typeName(side, a.kind!)}. ${sq.leader.rank} ${sq.leader.name} commanding.`;
    },
  },
  {
    id: 'advocate', rarity: 'exceptional',
    make: (_s, side) => (side.advocate ? null : { title: 'A friend on the Air Council', text: 'Someone on the Air Council speaks for you: the next directive you fail costs no confidence.' }),
    apply: (_state, side) => {
      side.advocate = true;
      return 'You have a friend on the Air Council.';
    },
  },
  {
    id: 'loanedWing', rarity: 'exceptional',
    make: (_s, side) => {
      const kind = neediestKind(side);
      return kind ? { title: 'Aircraft on loan', text: `Another command hands over four ${typeName(side, kind)}.`, catch: 'Its commander has friends on the Air Council: −8 confidence.', kind } : null;
    },
    apply: (state, side, a, rng) => {
      side.trust = Math.max(0, side.trust - 8);
      return `${deliver(state, side, a.kind!, 4, rng)} ${typeName(side, a.kind!)} have arrived on loan.`;
    },
  },
];

/** Ids reserved for what allotments create, far above the shared counter. */
const ALLOTMENT_ID_BASE = 10_000_000;

const RANK: Record<AllotmentRarity, number> = { common: 0, rare: 1, exceptional: 2 };

/** Three offers for the coming week, drawn by High Command's confidence. */
export function drawAllotments(rng: Rng, state: GameState, side: SideState): Allotment[] {
  const odds = allotmentOdds(side.trust);
  const out: Allotment[] = [];
  const order: AllotmentRarity[] = ['exceptional', 'rare', 'common'];
  for (let i = 0; i < 3; i++) {
    const want = rng.weighted(odds);
    // If nothing of that rarity fits the wing now, the next one down (or up) stands in.
    const tryOrder = [want, ...order.filter((r) => r !== want).sort((a, b) => Math.abs(RANK[a] - RANK[want]) - Math.abs(RANK[b] - RANK[want]) || RANK[b] - RANK[a])];
    for (const rarity of tryOrder) {
      const offers = ALLOTMENT_CARDS
        .filter((c) => c.rarity === rarity && !out.some((o) => o.card === c.id))
        .map((c) => ({ c, o: c.make(state, side) }))
        .filter((x): x is { c: Card; o: Offer } => !!x.o);
      if (!offers.length) continue;
      const { c, o } = rng.pick(offers);
      out.push({ ...o, id: `al${state.nextId++}`, card: c.id, rarity });
      break;
    }
  }
  return out;
}

/** Take one of the week's offers; the others lapse. */
export function chooseAllotment(state: GameState, side: SideState, id: string): ActionResult {
  const a = side.allotments?.find((x) => x.id === id);
  if (!a) return { ok: false, reason: 'That offer is no longer open' };
  const card = ALLOTMENT_CARDS.find((c) => c.id === a.card);
  if (!card) return { ok: false, reason: 'Unknown offer' };
  // Its own random stream, so a LAN host replaying the choice gets the same aircraft (the seed itself is hidden from a client).
  const rng = Rng.fromSeed(`allotment:${a.id}:${state.turn}`);
  // Ids for whatever the allotment creates come from a block reserved for it, not the shared counter: a LAN client
  // takes it during planning and the host replays it at sealing, after its own commands have used up other ids,
  // and the client's orders must name the same new squadron the host has.
  const shared = state.nextId;
  state.nextId = ALLOTMENT_ID_BASE + Number(a.id.replace(/\D/g, '')) * 50;
  let result: string;
  try {
    result = card.apply(state, side, a, rng);
  } finally {
    state.nextId = shared;
  }
  side.allotments = [];
  side.memos.unshift({ turn: state.turn, from: 'High Command', subject: a.title, body: result, kind: 'notice' });
  if (side.memos.length > 40) side.memos.length = 40;
  return { ok: true };
}

/** How the AI (and the scripted balance player) choose: the rarest, preferring offers without strings. */
export function autoChooseAllotment(state: GameState, side: SideState): void {
  const best = [...(side.allotments ?? [])].sort((a, b) => RANK[b.rarity] * 2 - (b.catch ? 1 : 0) - (RANK[a.rarity] * 2 - (a.catch ? 1 : 0)))[0];
  if (best) chooseAllotment(state, side, best.id);
}
