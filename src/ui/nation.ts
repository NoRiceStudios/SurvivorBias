/**
 * Which nation sits in each seat of the war on screen, so paint, names and
 * uniforms follow the nation rather than the seat. The app sets it whenever
 * it renders a campaign.
 */
import { NATION_IDS, NATIONS, nationOf, type Nation } from '../core/factions';
import { h } from './dom';
import type { GameState, NationId, SideId, SideState } from '../core/types';
import { tip, type Tip } from './tip';

let seats: [NationId, NationId] = ['aldmere', 'directorate'];

export function setSeats(state: GameState | null) {
  seats = state ? [nationOf(state.sides[0]).id, nationOf(state.sides[1]).id] : ['aldmere', 'directorate'];
}

export function nationAt(side: SideId): Nation {
  return NATIONS[seats[side]];
}

/**
 * The uniforms, buildings and badges a seat is drawn with: Aldmere's (0) or
 * the Directorate's (1). The League of Varn wears Aldmere's cut in its own colours.
 */
export function look(side: SideId): SideId {
  return seats[side] === 'directorate' ? 1 : 0;
}

/** Roundel colours: [centre, ring, edge]. */
export const ROUNDEL: Record<NationId, [string, string, string]> = {
  aldmere: ['#a8332a', '#e8e4d4', '#2c4672'],
  directorate: ['#1a1a1a', '#d8b040', '#d8b040'],
  varn: ['#e8e4d4', '#2f5a3a', '#e8e4d4'],
};

/** Secret stamp on the commander's folder. */
export const FOLDER_TAB: Record<NationId, string> = {
  aldmere: 'AIR MINISTRY · MOST SECRET',
  directorate: 'DIREKTORAT · GEHEIM',
  varn: 'LIGAENS FORSVARSSTAB · HEMMELIG',
};

/** What a side's nation is good and bad at, for a tooltip. A classic war has none. */
export function nationTip(side: SideState): Tip {
  if (!side.faction) return { head: side.name, text: 'A classic war: both sides fight by the same rules.' };
  const n = NATIONS[side.faction];
  return { head: n.name, text: `${n.blurb} Strengths: ${n.strengths.join('; ')}. Weaknesses: ${n.weaknesses.join('; ')}.` };
}

/** The nations chosen on the title and LAN screens, kept while the player moves between menus. */
export const chosen: { seats: [NationId, NationId]; on: boolean } = { seats: ['aldmere', 'directorate'], on: true };

/** A row of nation buttons for one seat; picking the other seat's nation swaps the two. */
export function nationPicker(seat: SideId, label: string, refresh: () => void): HTMLElement {
  const other = (1 - seat) as SideId;
  const pick = (id: NationId) => {
    if (chosen.seats[other] === id) chosen.seats[other] = chosen.seats[seat];
    chosen.seats[seat] = id;
    refresh();
  };
  const n = NATIONS[chosen.seats[seat]];
  return h('div', { class: 'nation-pick' },
    h('div', { class: 'menu-note' }, label),
    h('div', { class: 'seg mini' }, NATION_IDS.map((id) =>
      h('button', { class: `seg-btn ${chosen.seats[seat] === id ? 'on' : ''}`, ...tip(nationTip({ faction: id, name: NATIONS[id].name } as SideState)), onclick: () => pick(id) }, NATIONS[id].short))),
    h('div', { class: 'nation-blurb small', ...tip(nationTip({ faction: n.id, name: n.name } as SideState)) }, n.blurb));
}

/** The switch between a war of nations and the classic, symmetric war. */
export function nationToggle(refresh: () => void): HTMLElement {
  return h('button', { class: 'btn menu small', ...tip({ text: 'Classic: both sides fight by the same rules, as Aldmere and the Directorate.' }), onclick: () => { chosen.on = !chosen.on; refresh(); } },
    chosen.on ? 'Nations: on' : 'Nations: off (classic war)');
}

export function chosenFactions(): [NationId, NationId] | undefined {
  return chosen.on ? [...chosen.seats] : undefined;
}
