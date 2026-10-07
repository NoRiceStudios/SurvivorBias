/**
 * Station life: one or two short scenes a week from each side's own airfield,
 * more in a quiet week. They are built in the core from the side's own state
 * (who rested, who joined, who is missing), so in hotseat and LAN each
 * commander reads only the scenes of their own wing.
 */
import { TRAIT_INFO } from './data';
import { nationOf } from './factions';
import type { Rng } from './rng';
import type { GameState, SideState, Squadron } from './types';

interface Ctx {
  rng: Rng;
  state: GameState;
  side: SideState;
  /** Squadrons that did not fly this week. */
  rested: Squadron[];
  /** The template the last scene was built from, so it is never told again in this war. */
  key?: string;
}

/** Pick one of a scene's wordings that hasn't been used in this war yet. */
function tpick(c: Ctx, id: number, wordings: string[]): string | null {
  const free = wordings.map((_, i) => i).filter((i) => !c.side.usedLines?.includes(`scene:${id}:${i}`));
  if (!free.length) return null;
  const i = c.rng.pick(free);
  c.key = `scene:${id}:${i}`;
  return wordings[i];
}

/** Words that differ between the two air forces. */

/** A new man's name: never one already on the roll of the missing or used before in this war. */
function newcomer(c: Ctx): string {
  const { rng, side } = c;
  const taken = new Set([...(side.roll ?? []).map((e) => e.name.split(' ').slice(-1)[0]), ...(side.usedLines ?? []).filter((x) => x.startsWith('name:')).map((x) => x.slice(5))]);
  const nat = nationOf(side);
  const lasts = nat.crewLast.filter((x) => !taken.has(x));
  const last = rng.pick(lasts.length ? lasts : nat.crewLast);
  side.usedLines = [...(side.usedLines ?? []), `name:${last}`];
  return `${rng.pick(nat.juniorRanks)} ${rng.pick(nat.crewFirst)} ${last}`;
}

type Scene = (c: Ctx) => string | null;

const SCENES: Scene[] = [
  // A wake for a commanding officer posted missing.
  (c) => {
    const ranks = nationOf(c.side).ranks;
    const co = (c.side.roll ?? []).find((e) => c.state.turn - e.week <= 2 && ranks.some((r) => e.name.startsWith(r)) && e.fate !== 'returned' && e.fate !== 'prisoner');
    if (!co) return null;
    const L = nationOf(c.side).local;
    return tpick(c, 1, [
      `${co.squadron} held a wake for ${co.name} in ${L.mess}. Somebody played the piano badly, and nobody stopped him.`,
      `Nobody has moved ${co.name}'s cap from the peg in the ${co.squadron} crew room.`,
    ]);
  },
  // After a bad week.
  (c) => {
    const lost = (c.side.roll ?? []).filter((e) => e.week === c.state.turn);
    if (lost.length < 3) return null;
    const L = nationOf(c.side).local;
    const sq = lost[0].squadron;
    return tpick(c, 2, [
      `After this week's losses ${sq} went to ${L.town}, all of them, and drank to the empty chairs. The landlord wouldn't take their money.`,
      `${L.mess[0].toUpperCase()}${L.mess.slice(1)} was very quiet tonight. ${lost.length} sets of kit to pack, and nobody wanted to start.`,
    ]);
  },
  // A quiet evening for a squadron that stood down.
  (c) => {
    const sq = c.rested.length ? c.rng.pick(c.rested) : null;
    if (!sq) return null;
    const L = nationOf(c.side).local;
    const lead = `${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]}`;
    return tpick(c, 3, [
      `${sq.name} stood down. In ${L.mess}, ${lead} lost eleven ${L.money} at ${L.cards} and the gramophone played ${L.song} until somebody hid the needle.`,
      `With ${sq.name} stood down, half the squadron cycled to ${L.town}. They were back by midnight, mostly.`,
      `${sq.name} spent its day off painting a new nose on the squadron's oldest aircraft. Opinions differ on whether it is a lady or a dragon.`,
      `A football match: ${sq.name} against the ground crews. The ground crews won, and have not stopped saying so.`,
    ]);
  },
  // A letter for someone posted missing in the last few weeks.
  (c) => {
    // Not for a man already known to be alive.
    const recent = (c.side.roll ?? []).filter((e) => c.state.turn - e.week <= 3 && e.fate !== 'returned' && e.fate !== 'prisoner');
    if (!recent.length) return null;
    const e = c.rng.pick(recent);
    const L = nationOf(c.side).local;
    return tpick(c, 4, [
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
    return tpick(c, 5, [
      `${who}, nineteen, joined ${sq.name} from the training school${a.n > 1 ? ` with ${a.n - 1} other${a.n > 2 ? 's' : ''}` : ''}. He has eleven hours on type and asks a great many questions.`,
      `New faces in ${sq.name}: ${who}${a.n > 1 ? ` and ${a.n - 1} more` : ''}. The old hands have stopped learning the new ones' names until they have flown three operations.`,
      `${who} arrived at ${sq.name} with a new uniform, a guitar and a photograph of his mother. ${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]} gave him the bed by the stove.`,
    ]);
  },
  // A leader with a reputation, off duty.
  (c) => {
    const known = c.side.squadrons.filter((q) => q.leader.trait);
    if (!known.length) return null;
    const fresh = known.filter((q) => !c.side.usedLines?.includes(`trait:${q.leader.name}`));
    if (!fresh.length) return null;
    const sq = c.rng.pick(fresh);
    const name = `${sq.leader.rank} ${sq.leader.name}`;
    const t = sq.leader.trait!;
    // One scene per man's reputation, and each wording told once in a war.
    const scenes: Record<string, string[]> = {
      ace: [
        `The local paper wants a photograph of ${name}. He has told them, twice, to photograph his ground crew instead.`,
        `A girl from ${nationOf(c.side).local.town} sent ${name} a scarf she had knitted. He wears it on every operation and denies it is for luck.`,
      ],
      lucky: [
        `The men of ${sq.name} touch ${name}'s sleeve before every operation. He pretends not to notice.`,
        `${name} lost his lucky coin in the long grass by dispersal. Half of ${sq.name} spent the afternoon looking for it, and found it.`,
      ],
      steady: [
        `${name} spent the evening going round the huts of ${sq.name}, a word for every crew. Nobody remembers what he said, only that he came.`,
        `When the telegram boy cycled up the lane, ${name} met him at the gate himself, so that nobody else would have to.`,
      ],
      sharpEyed: [
        `${name} sent back two of his own squadron's claims as "not proven". The squadron grumbled, then bought him a drink.`,
        `${name} keeps a notebook of every claim his crews make, and what was confirmed afterwards. He will not let anyone read it.`,
      ],
      shaken: [
        `${name} was seen walking the perimeter track alone at three in the morning. The squadron adjutant has asked the medical officer to "have a look at him, casually".`,
        `${name} has started smoking again. His hands, someone noticed, are not quite steady when he lights up.`,
        `${name} read the casualty list twice at breakfast, then left his tea untouched.`,
      ],
    };
    const ids = ['ace', 'lucky', 'steady', 'sharpEyed', 'shaken'];
    const line = scenes[t] ? tpick(c, 10 + ids.indexOf(t), scenes[t]) : `${TRAIT_INFO[t].label}: ${name}.`;
    if (!line) return null;
    c.side.usedLines = [...(c.side.usedLines ?? []), `trait:${sq.leader.name}`];
    return line;
  },
  // A squadron that keeps losing its commanding officers.
  (c) => {
    const sq = c.side.squadrons.find((q) => (q.cosLost ?? 0) >= 3 && !c.side.usedLines?.includes(`chair:${q.id}:${q.cosLost}`));
    if (!sq) return null;
    const line = tpick(c, 20, [
      `Nobody in ${sq.name} wants the commanding officer's office now. ${sq.cosLost} COs in this war; the signwriter has stopped painting the name on the door.`,
      `In ${sq.name} they have started calling the CO's chair "the hot seat", and not as a joke. ${sq.leader.rank} ${sq.leader.name.split(' ').slice(-1)[0]} sits in it anyway.`,
      `The adjutant of ${sq.name} keeps the CO's letters of condolence in a folder of their own now. It is a thick folder.`,
    ]);
    if (line) c.side.usedLines = [...(c.side.usedLines ?? []), `chair:${sq.id}:${sq.cosLost}`];
    return line;
  },
  // The ground crews.
  (c) => {
    const sq = c.side.squadrons.find((q) => q.airframes.some((a) => a.status === 'repair'));
    if (!sq) return null;
    const af = sq.airframes.find((a) => a.status === 'repair')!;
    return tpick(c, 6, [
      `The fitters of ${sq.name} worked through the night on ${af.serial} by the light of hooded lamps. One of them has counted the patches on her: ${af.patches}.`,
      `${af.serial} of ${sq.name} is in the hangar with her wing off. Her rigger talks to her while he works, and says she listens.`,
    ]);
  },
];

/** This week's scenes for one side: more when the wing stood down. */
export function stationLife(rng: Rng, state: GameState, side: SideState, rested: Squadron[], quiet: boolean): string[] {
  const c: Ctx = { rng, state, side, rested };
  // Hard weeks have their own scenes: a wake, a letter, kit to pack.
  const lostThisWeek = (side.roll ?? []).some((e) => e.week === state.turn);
  // A bloody week is never a silent one: a CO lost or three crews missing bring one or two scenes.
  const lostNow = (side.roll ?? []).filter((e) => e.week === state.turn);
  const coLost = lostNow.some((e) => (side.usedNames ?? []).some((n) => e.name.endsWith(` ${n}`)));
  const n = quiet ? 2 : coLost || lostNow.length >= 3 ? 1 + (rng.chance(0.5) ? 1 : 0) : rested.length > 0 || (side.arrived?.length ?? 0) > 0 || lostThisWeek ? (rng.chance(0.65) ? 1 : 0) : rng.chance(0.3) ? 1 : 0;
  const out: string[] = [];
  // A wake or a bad week comes first when there is one; the other kinds are shuffled.
  const rest = [...SCENES.keys()].slice(2);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const order = [0, 1, ...rest];
  const keys: string[] = [];
  for (const i of order) {
    if (out.length >= n) break;
    c.key = undefined;
    const s = SCENES[i](c);
    // A scene is told once in a war.
    if (s && !out.includes(s) && !(c.key && side.usedLines?.includes(c.key))) {
      out.push(s);
      if (c.key) keys.push(c.key);
    }
  }
  side.usedLines = [...(side.usedLines ?? []), ...keys].slice(-400);
  return out;
}
