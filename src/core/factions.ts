/**
 * The air forces a commander can lead. Each is good at one thing and pays for
 * it somewhere else, so the same war asks for a different strategy.
 */
import type { TechKey } from './data';
import type { FactionId, SideState } from './types';

/** Numeric traits of a faction, beyond the development effects it starts with. */
export type FactionKey =
  /** Aircraft cost, ×(1 + x). */
  | 'aircraftCost'
  /** Supplies delivered every week, flat. */
  | 'supplies'
  /** Stores delivered every week, ×(1 + x). */
  | 'stores'
  /** Skill of the crews the wing starts the war with, +x. */
  | 'startSkill'
  /** Aircraft per squadron at the start of the war, +x. */
  | 'startSize'
  /** Price of trained crews from the Ministry, ×(1 + x). */
  | 'crewPrice'
  /** Weekly gains in High Command's confidence, ×(1 + x). */
  | 'trustGain'
  /** Weekly losses of High Command's confidence, ×(1 + x). */
  | 'trustLoss'
  /** High Command's offers come as if confidence were this much higher. */
  | 'offerLuck'
  /** Extra offers on the desk each week. */
  | 'offerCards';

export interface Faction {
  id: FactionId;
  name: string;
  motto: string;
  blurb: string;
  strengths: string[];
  weaknesses: string[];
  fx: Partial<Record<FactionKey, number>>;
  /** Effects that work like developments already in service. */
  tech?: Partial<Record<TechKey, number>>;
}

export const FACTIONS: Record<FactionId, Faction> = {
  arsenal: {
    id: 'arsenal',
    name: 'The Arsenal',
    motto: 'Factories first.',
    blurb: 'A wing backed by the biggest aircraft works in the country. It can replace its losses faster than anyone, but fuel and good crews are always short.',
    strengths: ['Aircraft works +30% output', 'Aircraft cost 15% less', '+10 supplies every week'],
    weaknesses: ['Stores deliveries 15% smaller', 'Crews start and graduate less skilled'],
    fx: { aircraftCost: -0.15, supplies: 10, stores: -0.15, startSkill: -0.05 },
    tech: { production: 0.3, training: -0.05 },
  },
  cadre: {
    id: 'cadre',
    name: 'The Old Cadre',
    motto: 'Few, but the best.',
    blurb: 'Regular squadrons with long-service crews. Every crew is worth two of the enemy\'s, and the wing knows it, but every aircraft lost is hard to replace.',
    strengths: ['Crews start much more skilled', 'Graduates start more skilled', 'Lost crews get home 10% more often', 'Ministry crews cost 25% less'],
    weaknesses: ['Squadrons start two aircraft short', 'Aircraft cost 15% more', 'Aircraft works −15% output'],
    fx: { startSkill: 0.15, startSize: -2, aircraftCost: 0.15, crewPrice: -0.25 },
    tech: { training: 0.08, escape: 0.1, production: -0.15 },
  },
  patronage: {
    id: 'patronage',
    name: 'Friends at Court',
    motto: 'The Air Council\'s favourite.',
    blurb: 'A commander with friends in the Air Council. High Command offers more and better, and success is noticed. So is failure.',
    strengths: ['High Command makes four offers a week, not three', 'Offers come as if confidence were 20 higher', 'Confidence gains 50% larger'],
    weaknesses: ['Confidence losses 25% larger', '10 supplies less every week'],
    fx: { offerCards: 1, offerLuck: 20, trustGain: 0.5, trustLoss: 0.25, supplies: -10 },
  },
};

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

export function factionFx(side: Pick<SideState, 'faction'>, key: FactionKey): number {
  return side.faction ? FACTIONS[side.faction]?.fx[key] ?? 0 : 0;
}

export function factionTech(side: Pick<SideState, 'faction'>, key: TechKey): number {
  return side.faction ? FACTIONS[side.faction]?.tech?.[key] ?? 0 : 0;
}
