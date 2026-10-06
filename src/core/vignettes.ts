/**
 * Station life: one or two short scenes a week from each side's own airfield,
 * more in a quiet week. They are built in the core from the side's own state
 * (who rested, who joined, who is missing), so in hotseat and LAN each
 * commander reads only the scenes of their own wing.
 */
import { CREW_FIRST, CREW_LAST, TRAIT_INFO } from './data';
import type { Rng } from './rng';
import type { GameState, SideState, Squadron } from './types';

interface Ctx {
  rng: Rng;
  state: GameState;
  side: SideState;
  /** Squadrons that did not fly this week. */
  rested: Squadron[];
}

/** Words that differ between the two air forces. */
const LOCAL = [
  { mess: 'the mess', money: 'shillings', padre: 'the padre', drink: 'warm beer', song: '"A Nightingale Sang"', town: 'the village pub', cards: 'brag' },
  { mess: 'the Kasino', money: 'marks', padre: 'the chaplain', drink: 'thin coffee', song: '"Lili Marleen"', town: 'the inn in the valley', cards: 'Skat' },
] as const;

function newcomer(c: Ctx): string {
  const { rng, side } = c;
  return `${rng.pick(side.id === 0 ? ['Plt Off', 'Sgt', 'Fg Off'] : ['Leutnant', 'Feldwebel', 'Unteroffizier'])} ${rng.pick(CREW_FIRST[side.id])} ${rng.pick(CREW_LAST[side.id])}`;
}

type Scene = (c: Ctx) => string | null;

const SCENES: Scene[] = [
  // A wake for a commanding officer posted missing.
  (c) => {
    const ranks = c.side.id === 0 ? ['Flt Lt', 'Sqn Ldr', 'Wg Cdr'] : ['Hauptmann', 'Major', 'Oberst'];
    const co = (c.side.roll ?? []).find((e) => c.state.turn - e.week <= 2 && ranks.some((r) => e.name.startsWith(r)) && e.fate !== 'returned' && e.fate !== 'prisoner');
    if (!co) return null;
    const L = LOCAL[c.side.id];
    return c.rng.pick([
      `${co.squadron} held a wake for ${co.name} in ${L.mess}. Somebody played the piano badly, and nobody stopped him.`,
      `Nobody has moved ${co.name}'s cap from the peg in the ${co.squadron} crew room.`,
    ]);
  },
  // After a bad week.
  (c) => {
    const lost = (c.side.roll ?? []).filter((e) => e.week === c.state.turn);
    if (lost.length < 3) return null;
    const L = LOCAL[c.side.id];
    const sq = lost[0].squadron;
    return c.rng.pick([
      `After this week's losses ${sq} went to ${L.town}, all of them, and drank to the empty chairs. The landlord wouldn't take their money.`,
      `${L.mess[0].toUpperCase()}${L.mess.slice(1)} was very quiet tonight. ${lost.length} sets of kit to pack, and nobody wanted to start.`,
    ]);
  },
  // A quiet evening for a squadron that stood down.
  (c) => {
    const sq = c.rested.length ? c.rng.pick(c.rested) : null;
    if (!sq) return null;
    const L = LOCAL[c.side.id];
    const lead = `${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]}`;
    return c.rng.pick([
      `${sq.name} stood down. In ${L.mess}, ${lead} lost eleven ${L.money} at ${L.cards} and the gramophone played ${L.song} until somebody hid the needle.`,
      `With ${sq.name} stood down, half the squadron cycled to ${L.town}. They were back by midnight, mostly.`,
      `${sq.name} spent its day off painting a new nose on the squadron's oldest aircraft. Opinions differ on whether it is a lady or a dragon.`,
      `A football match: ${sq.name} against the ground crews. The ground crews won, and have not stopped saying so.`,
    ]);
  },
  // A letter for someone posted missing in the last few weeks.
  (c) => {
    const recent = (c.side.roll ?? []).filter((e) => c.state.turn - e.week <= 3 && e.fate !== 'returned');
    if (!recent.length) return null;
    const e = c.rng.pick(recent);
    const L = LOCAL[c.side.id];
    return c.rng.pick([
      `${newcomer(c)} of ${e.squadron} sat up late writing to the family of ${e.name}, missing since week ${e.week}. ${L.padre[0].toUpperCase()}${L.padre.slice(1)} helped with the hard part.`,
      `The kit of ${e.name} (${e.serial}) was packed and labelled for next-of-kin. Somebody kept back his photograph of a girl in a summer dress, in case.`,
      `${e.squadron} left a chair empty in ${L.mess} for ${e.name}. Nobody said why, and nobody sat in it.`,
    ]);
  },
  // New faces from the school.
  (c) => {
    const arrived = c.side.arrived ?? [];
    if (!arrived.length) return null;
    const a = c.rng.pick(arrived);
    const sq = c.side.squadrons.find((q) => q.id === a.squadronId);
    if (!sq) return null;
    const who = newcomer(c);
    return c.rng.pick([
      `${who}, nineteen, joined ${sq.name} from the training school${a.n > 1 ? ` with ${a.n - 1} other${a.n > 2 ? 's' : ''}` : ''}. He has eleven hours on type and asks a great many questions.`,
      `New faces in ${sq.name}: ${who}${a.n > 1 ? ` and ${a.n - 1} more` : ''}. The old hands have stopped learning the new ones' names until they have flown three operations.`,
      `${who} arrived at ${sq.name} with a new uniform, a guitar and a photograph of his mother. ${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]} gave him the bed by the stove.`,
    ]);
  },
  // A leader with a reputation, off duty.
  (c) => {
    const known = c.side.squadrons.filter((q) => q.leader.trait);
    if (!known.length) return null;
    const sq = c.rng.pick(known);
    const name = `${sq.leader.rank} ${sq.leader.name}`;
    switch (sq.leader.trait) {
      case 'ace': return `The local paper wants a photograph of ${name}. He has told them, twice, to photograph his ground crew instead.`;
      case 'lucky': return `The men of ${sq.name} touch ${name}'s sleeve before every operation. He pretends not to notice.`;
      case 'steady': return `${name} spent the evening going round the huts of ${sq.name}, a word for every crew. Nobody remembers what he said, only that he came.`;
      case 'sharpEyed': return `${name} sent back two of his own squadron's claims as "not proven". The squadron grumbled, then bought him a drink.`;
      case 'shaken': return `${name} was seen walking the perimeter track alone at three in the morning. ${sq.name}'s adjutant has asked the medical officer to "have a look at him, casually".`;
      default: return `${TRAIT_INFO[sq.leader.trait!].label}: ${name}.`;
    }
  },
  // The ground crews.
  (c) => {
    const sq = c.side.squadrons.find((q) => q.airframes.some((a) => a.status === 'repair'));
    if (!sq) return null;
    const af = sq.airframes.find((a) => a.status === 'repair')!;
    return c.rng.pick([
      `The fitters of ${sq.name} worked through the night on ${af.serial} by the light of hooded lamps. One of them has counted the patches on her: ${af.patches}.`,
      `${af.serial} of ${sq.name} is in the hangar with her wing off. Her rigger talks to her while he works, and says she listens.`,
    ]);
  },
];

/** This week's scenes for one side: more when the wing stood down. */
export function stationLife(rng: Rng, state: GameState, side: SideState, rested: Squadron[], quiet: boolean): string[] {
  const c: Ctx = { rng, state, side, rested };
  const n = quiet ? 2 : rested.length > 0 || (side.arrived?.length ?? 0) > 0 ? (rng.chance(0.6) ? 1 : 0) : rng.chance(0.25) ? 1 : 0;
  const out: string[] = [];
  // Shuffle the kinds of scene so the week's choice varies.
  const order = [...SCENES.keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    if (out.length >= n) break;
    const s = SCENES[i](c);
    // A scene is told once in a war.
    if (s && !out.includes(s) && !side.usedLines?.includes(s)) out.push(s);
  }
  side.usedLines = [...(side.usedLines ?? []), ...out].slice(-300);
  return out;
}
