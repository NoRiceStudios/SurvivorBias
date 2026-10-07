/**
 * The Field Manual (F1 or the "?" tab): one short page per term the game uses,
 * so nothing has to be explained in paragraphs on the screens themselves.
 */
import { SECTOR_PRESSURE, DECISIVE_GAIN } from '../core/theaters';
import { STORES_CAP } from '../core/turn';
import type { Hit, ZoneId } from '../core/types';
import { h } from './dom';
import { icon } from './icons';
import { aircraftCanvas } from './sprites';
import { pressureGauge } from './theaterui';
import { pips } from './widgets';

/** A few holes, placed the same way every time, for the illustrations. */
function holes(zones: ZoneId[]): Hit[] {
  return zones.map((zone, i) => ({ zone, u: ((i * 37) % 100) / 100, v: ((i * 53) % 100) / 100, approach: 'tail' }));
}
const plot = (hits: Hit[], plates?: Partial<Record<ZoneId, number>>, dotColor?: string) => h('div', { class: 'blueprint-wrap' }, aircraftCanvas('medium', { side: 0, style: 'blueprint', hits, dots: true, bigDots: true, zonePlates: plates, dotColor }, 3));
const stamp = (text: string, kind = '') => h('span', { class: `stamp big ${kind}` }, text);
const bar = (v: number, cls = '') => h('span', { class: `fx-bar ${cls}` }, h('i', { style: `width:${v}%` }), h('span', { class: 'fx-tick', style: 'left:50%' }), h('em', null, `${v}%`));

/** One small picture per page, drawn from the game's own pieces. */
const ART: Record<string, () => HTMLElement> = {
  'The turn': () => stamp('ORDERS ISSUED'),
  'Survivorship bias': () => h('div', { class: 'art-row' },
    h('figure', null, plot(holes(['outerWing', 'outerWing', 'fuselage', 'fuselage', 'tail', 'outerWing', 'fuselage', 'wingRoot'])), h('figcaption', null, 'What came back')),
    h('figure', null, plot(holes(['engines', 'cockpit', 'engines', 'fuel', 'cockpit']), undefined, '#ff3b30'), h('figcaption', null, 'What brought them down'))),
  Supplies: () => icon('supplies', 64),
  Stores: () => icon('fuel', 64),
  Confidence: () => h('span', { class: 'stamp big notice' }, 'CONFIDENCE 62 ▲3'),
  'Pressure and sectors': () => pressureGauge(10, { label: 'Pressure' }),
  Strike: () => aircraftCanvas('medium', { side: 0, seed: 3 }, 3),
  'Close support': () => aircraftCanvas('medium', { side: 0, seed: 5 }, 3),
  Sweep: () => aircraftCanvas('fighter', { side: 0, seed: 2 }, 4),
  'Escort and defence': () => h('div', { class: 'art-row' }, aircraftCanvas('fighter', { side: 0, seed: 1 }, 3), aircraftCanvas('medium', { side: 0, seed: 2 }, 3)),
  Feint: () => aircraftCanvas('fighter', { side: 0, style: 'outline', lineColor: '#2a2721' }, 4),
  'Fatigue and morale': () => h('div', { class: 'art-pips' }, h('span', null, 'Fatigue ', pips(0.8, 10, 0.6)), h('span', null, 'Morale ', pips(0.3, 10, 0.3, true))),
  Doctrine: () => h('div', { class: 'seg' }, ...['Loose', 'Standard', 'Tight box'].map((x, i) => h('button', { class: `seg-btn ${i === 2 ? 'on' : ''}` }, x))),
  Armor: () => plot(holes(['outerWing', 'fuselage']), { cockpit: 2, engines: 2, fuel: 1 }),
  'Leaders and reports': () => h('div', { class: 'art-row' }, ...['Showman', 'Gloomy', 'By the book', 'Cautious'].map((x) => h('span', { class: 'trait' }, x))),
  'Believed condition': () => h('div', { class: 'art-col' }, bar(64, 'est'), h('span', { class: 'small muted' }, '≈64%: from crews\' reports')),
  'Crippled works': () => h('div', { class: 'art-col' }, bar(38, 'crippled'), h('span', { class: 'small muted' }, 'Below the tick: crippled')),
  'Y-Service': () => h('span', { class: 'stamp big intel' }, 'Y-SERVICE'),
  'Returns policy': () => h('div', { class: 'seg' }, ...['Accurate', 'Optimistic', 'Creative'].map((x, i) => h('button', { class: `seg-btn ${i === 1 ? 'on' : ''}` }, x))),
};

const PAGES: [string, string, string][] = [
  ['The turn', 'How a week goes', 'Plan in the War Room (mission, tasks, doctrine, armor, factory, research), launch, listen to the radio, read the debrief, file your reports. High Command answers, and the next week begins. You never see the battle itself, only what the crews who come back say about it.'],
  ['Survivorship bias', 'The point of the game', 'The holes on the aircraft that come back show where an aircraft can be hit and still come home. The aircraft that were hit somewhere else did not come back, so their damage is never recorded. Last calls on the radio are the only clue to what brings an aircraft down.'],
  ['Supplies', 'Resource', 'Pay for armor, aircraft, training, research and repairs. Delivered every week; more when High Command trusts you, and more again with the Requisition Office and War Economy Board. Wrecks on our side of the line (written off on landing, or defenders shot down) return about a third of their cost as salvage.'],
  ['Stores', 'Resource', `Fuel, bombs and ammunition. Every aircraft that flies uses them, and so do maximum-effort raids, live-fire practice at the school and new flak batteries. The Ministry rations them by the wing's strength: about two thirds of what a full effort by every aircraft would use, a little more when it trusts you. Depots hold at most ${STORES_CAP}; wrecked fuel depots cut deliveries. A convoy buys more once a week.`],
  ['Confidence', 'High Command', 'How far High Command trusts you (0-100). It moves with the results you report, not the results you get. Deliveries grow with it; at 0 you are relieved. Optimistic returns raise it until photographs or the observers catch you out.'],
  ['Pressure and sectors', 'The front', `The Army liaison's estimate of who is winning on the ground. When it reaches about ±${SECTOR_PRESSURE} a sector changes hands, at most one a week. Take ${DECISIVE_GAIN} sectors to win a theater outright. Losses inflicted, close support and damage to enemy works push it your way.`],
  ['Strike', 'Mission', 'Bomb a named enemy airfield, aircraft works or fuel depot. Damage cuts the enemy\'s output and adds pressure week after week. Only sites within your bombers\' range can be struck; escorts may not reach as far.'],
  ['Close support', 'Mission', 'Bomb enemy positions at the front. Pushes the front directly, flown low into the Army\'s flak.'],
  ['Sweep', 'Mission', 'Fighters only: hunt enemy fighters over the front.'],
  ['Escort and defence', 'Fighter tasks', 'Escorts fly with the bombers and tie up interceptors. Defending fighters stay home: on patrol over one sector they almost always meet a raid there and rarely anywhere else; in central reserve they meet most raids, given warning.'],
  ['Feint', 'Task', 'A squadron flies over another enemy sector first, to draw the enemy reserve away from the real raid. Controllers who have seen many feints are slower to take the bait.'],
  ['Fatigue and morale', 'Squadrons', 'Fatigue rises each week a squadron flies and falls by about a third when it rests; tired crews shoot and fly worse, and above 6/10 morale slides. Morale falls with losses; if the wing\'s average stays very low for three weeks, the crews refuse to fly.'],
  ['Doctrine', 'Squadrons', 'Formation (tight box: more return fire, fewer stragglers picked off, claims run high), altitude (higher: less flak and harder to find, but bombs scatter), aggression (press home: more hits, more exposure) and when to break off. The Squadrons tab shows each effect as a change against standard.'],
  ['Turrets', 'Squadrons', 'Bombers can move their guns: standard, tail-heavy (a wall of fire astern, little ahead) or a chin turret against head-on attacks. A refit costs 15 supplies. The gunners say where the attacks came from; the crews who were shot down say nothing. Enemy pilots see the guns too and, given a few weeks, go round them.'],
  ['Armor', 'Squadrons', 'Each type carries only a few plates; each adds weight, and a slow aircraft is caught more often. Plates fitted where the fatal hits land save aircraft. Where is that? The holes on the survivors will not tell you directly.'],
  ['Leaders and reports', 'Squadrons', 'Every report is coloured by the leader who writes it: showmen claim high, gloomy ones see more fighters than there were, by-the-book leaders report only what they are sure of. Shaken crews see double. After about five operations a leader earns a reputation.'],
  ['Believed condition', 'Intelligence', 'How much of an enemy site still works, as far as we know: from crews\' bombing reports (often optimistic) or, better, from photographs. The ≈ sign marks an estimate.'],
  ['Crippled works', 'Intelligence', 'Below 50% a type of works is crippled and the effect jumps: crippled airfields halve fighter cover, crippled depots and works cut deliveries and production further. Only works within two sectors of the front count.'],
  ['Y-Service', 'Intelligence', 'Signals intelligence. Warns of enemy raids, sometimes naming the sector. Its record is shown with each warning; it can be wrong.'],
  ['Returns policy', 'High Command', 'How the adjutant presents results to High Command: accurate, optimistic or creative. Set in the War Room orders column.'],
];

let open = false;
let page = 0;

export function toggleManual(render: () => void) {
  open = !open;
  render();
}

/** The manual overlay, when open. */
export function manualOverlay(render: () => void): HTMLElement | null {
  if (!open) return null;
  const [title, kind, text] = PAGES[page];
  return h('div', { class: 'manual-veil', onclick: (e: MouseEvent) => { if (e.target === e.currentTarget) { open = false; render(); } } },
    h('div', { class: 'manual paper' },
      h('div', { class: 'manual-head' }, h('h2', null, 'Field Manual'), h('span', { class: 'muted small' }, 'F1 or Esc to close'),
        h('button', { class: 'btn small', onclick: () => { open = false; render(); } }, 'Close')),
      h('div', { class: 'manual-body' },
        h('nav', { class: 'manual-index' }, PAGES.map(([t], i) => h('button', { class: `manual-link ${i === page ? 'on' : ''}`, onclick: () => { page = i; render(); } }, t))),
        h('article', null, h('div', { class: 'letter-kicker' }, kind), h('h1', null, title), h('p', { class: 'manual-text' }, text),
          ART[title] ? h('div', { class: 'manual-art' }, ART[title]()) : null))));
}

export function manualOpen(): boolean {
  return open;
}
