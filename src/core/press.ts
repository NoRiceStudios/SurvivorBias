/**
 * The home front. Every week the nation's newspaper prints the wing's returns
 * as High Command received them: inflated claims make for glorious headlines,
 * our own losses are always "light". What the public reads sets its mood; a
 * cheerful public buys war bonds (more supplies for the wing) but also expects
 * more, and High Command's directives grow with it.
 *
 * Papers are written in the core from each side's own returns, so in hotseat
 * and LAN each commander reads only their own nation's paper.
 */
import { nationOf } from './factions';
import type { Rng } from './rng';
import type { AircraftKind, Archetype, Hit, NationId, Newspaper, NewsColumn, Press, SideState, TargetId, Weather } from './types';

export const MOOD_START = 50;

const PAPER: Record<NationId, { name: string; motto: string; price: string }> = {
  aldmere: { name: 'The Aldmere Clarion', motto: 'All the News the Censor Allows', price: 'One Penny' },
  directorate: { name: 'Nordwacht', motto: 'Official Organ of the Directorate · Truth by Decree', price: '10 Pfennig' },
  varn: { name: 'Varn Morgenblad', motto: 'The League\'s Morning Paper · Printed in Record Numbers', price: '15 Øre' },
};

export function pressOf(side: SideState): Press {
  return (side.press ??= { mood: MOOD_START, bonds: 0, papers: [] });
}

export function moodLabel(mood: number): string {
  return mood < 20 ? 'Sullen' : mood < 35 ? 'Uneasy' : mood < 50 ? 'Steady' : mood < 65 ? 'Hopeful' : mood < 80 ? 'Confident' : 'Jubilant';
}

/** Supplies the week's war bonds buy for the wing: a gloomy public buys too few to cover what was promised. */
export function bondsFor(mood: number): number {
  return Math.max(-8, Math.min(22, Math.round((mood - 45) / 2.5)));
}

/** How much more High Command asks of the wing while the public expects victories (1 = nothing extra). */
export function expectation(side: SideState): number {
  const mood = side.press?.mood ?? MOOD_START;
  return 1 + Math.max(0, mood - 60) / 100;
}

/** The cost in confidence of a failed directive grows when the public has been promised more. */
export function failurePenalty(side: SideState): number {
  const mood = side.press?.mood ?? MOOD_START;
  return 1 + Math.max(0, mood - 65) / 80;
}

export interface MoodWeek {
  /** Enemy aircraft claimed in the returns to High Command. */
  claimed: number;
  /** Target damage claimed, in percent. */
  damage: number;
  /** Change in front pressure as the Army liaison gives it. */
  frontDelta: number;
  /** Our aircraft lost (telegrams reach the families whatever the papers say). */
  lost: number;
  /** The Air Ministry caught the wing's returns out this week. */
  caught: boolean;
}

/**
 * The public reads the week's paper. Claims and gains cheer it, telegrams and
 * corrections sour it, and it gets used to good news: the mood drifts back
 * towards the middle every week. The bonds it buys arrive with next deliveries.
 */
export function moodWeek(side: SideState, w: MoodWeek): void {
  const p = pressOf(side);
  const gain = Math.min(12, w.claimed) + Math.min(6, w.damage / 5) + Math.max(-6, Math.min(6, w.frontDelta * 0.25)) - w.lost * 0.6 - (w.caught ? 15 : 0);
  p.mood = Math.round(Math.max(0, Math.min(100, p.mood + gain - (p.mood - MOOD_START) * 0.2)));
  p.bonds = bondsFor(p.mood);
}

/** A theater won or lost moves the public more than any week's claims. */
export function moodAfterTheater(side: SideState, result: 'won' | 'lost' | 'stalemate'): void {
  const p = pressOf(side);
  // This week's bonds are already bought; the news tells in next week's.
  p.mood = Math.max(0, Math.min(100, p.mood + (result === 'won' ? 15 : result === 'lost' ? -20 : -6)));
}

export interface PaperInput {
  week: number;
  claimed: number;
  /** Damage claimed on the week's target, and how often the paper has already finished it off. */
  damage: { site: string; pct: number; before?: number } | null;
  mission: TargetId | null;
  lost: number;
  enemyClaim: number;
  frontDelta: number;
  taken?: string;
  lostSector?: string;
  theater?: { name: string; result: 'won' | 'lost' | 'stalemate' };
  caught: boolean;
  prevClaimed?: number;
  hero?: { name: string; squadron: string; archetype: Archetype; claims: number };
  photo?: { kind: AircraftKind; serial: string; hits: Hit[]; type: string };
  weather: Weather;
  moodBefore: number;
}

/** Pick a line not printed before in this war, if there is one. */
function fresh(rng: Rng, side: SideState, key: string, lines: string[]): string {
  const used = new Set(side.usedLines ?? []);
  const free = lines.map((_, i) => i).filter((i) => !used.has(`press:${key}:${i}`));
  const i = free.length ? rng.pick(free) : rng.int(0, lines.length - 1);
  side.usedLines = [...(side.usedLines ?? []), `press:${key}:${i}`];
  return lines[i];
}

const GENERIC = ['AIR ARM KEEPS UP THE PRESSURE', 'ANOTHER GOOD WEEK IN THE AIR', 'ENEMY FEELS THE WEIGHT OF OUR WINGS', 'STEADY PROGRESS IN THE AIR WAR', 'OUR AIRMEN UNDAUNTED', 'NEW SUCCESSES FOR THE AIR ARM', 'ENEMY "RATTLED", SAYS MINISTRY'];
const GENERIC_DECK = ['Our airmen are "only getting started".', 'The Ministry calls it "a week of quiet triumph".', '"Every one counts," says the Ministry, which counts them.', 'Experts describe the enemy as "increasingly worried".', 'The figure is "conservative", says a spokesman, who declined to say compared to what.'];

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'umpteenth'];

const n = (k: number, one: string, many: string) => (k === 1 ? one : many.replace('#', String(k)));

function headline(rng: Rng, x: PaperInput, us: string): [string, string] {
  const k = x.claimed;
  if (x.theater?.result === 'won') return [`VICTORY IN ${x.theater.name.toUpperCase()}!`, `Bells to be rung in every town. The ${us} air arm "simply unstoppable", says Ministry.`];
  if (x.theater?.result === 'lost') return [rng.pick([`${x.theater.name.toUpperCase()}: LINES SHORTENED AS PLANNED`, `BRILLIANT WITHDRAWAL FROM ${x.theater.name.toUpperCase()}`]), 'Our forces move to stronger positions further back. "Exactly as intended," says a spokesman, who did not wish to be named.'];
  if (x.theater?.result === 'stalemate') return [`ENEMY FAILS TO DEFEAT US IN ${x.theater.name.toUpperCase()}`, 'The campaign season ends with the line exactly where the Ministry always said it would be.'];
  if (x.taken) return [`${x.taken.toUpperCase()} IS OURS!`, `The Army marches in behind the air arm. Townsfolk "overjoyed", reports our correspondent from a safe distance.`];
  if (x.lostSector) return [`STRATEGIC REPOSITIONING AT ${x.lostSector.toUpperCase()}`, 'The Army has moved back a little to give the enemy more room to make mistakes.'];
  if (x.damage && x.damage.pct >= 20) {
    const again = x.damage.before ? `, for the ${ORDINAL[Math.min(ORDINAL.length - 1, x.damage.before)]} time this year` : '';
    return [rng.pick([`${x.damage.site.toUpperCase()} IN FLAMES`, `${x.damage.site.toUpperCase()} WIPED OFF THE MAP`, `BOMBERS LEVEL ${x.damage.site.toUpperCase()}`]), `"${x.damage.pct}% destroyed," say the crews. The enemy is "finished there", says the Ministry${again}.`];
  }
  if (k >= 8) return [rng.pick([`${k} RAIDERS DOWN!`, `${k} ENEMY AIRCRAFT BLASTED FROM THE SKY`, `BLACK DAY FOR THE ENEMY: ${k} DOWN`]), 'The enemy air force "cannot go on like this for long", says an expert.'];
  if (k >= 3) return [rng.pick([`${k} ENEMY AIRCRAFT DESTROYED`, `OUR AIRMEN BAG ${k}`, `${k} MORE FOR THE TALLY`]), x.lost ? 'Our own losses were light.' : 'Every one of our aircraft returned safely.'];
  if (x.lost >= 4) return [rng.pick(['OUR BOYS GIVE AS GOOD AS THEY GET', 'FIERCE FIGHTING IN THE AIR', 'AIR ARM IN GREAT BATTLE']), 'Details cannot yet be given, for reasons of security and morale.'];
  if (x.mission === 'support') return ['AIR ARM SMASHES ENEMY POSITIONS', 'The Army is "grateful", "impressed" and "a little surprised".'];
  if (!x.mission && k === 0) return [rng.pick(['QUIET WEEK: ENEMY TOO AFRAID TO FLY', 'WING READY FOR ACTION', 'SECRET PREPARATIONS AT OUR AIRFIELDS']), '"No comment," says the Ministry, meaningfully.'];
  return [rng.pick(GENERIC), k ? `${n(k, 'One enemy aircraft', '# enemy aircraft')} destroyed. ${rng.pick(GENERIC_DECK)}` : 'Results are being assessed and will be excellent.'];
}

/** Our losses in the Ministry's words, whatever they were. */
function lossWords(lost: number): string {
  if (lost === 0) return 'All our aircraft returned safely.';
  if (lost <= 2) return 'Our own losses were light.';
  if (lost <= 5) return 'A small number of our aircraft are overdue.';
  return 'Our losses, though regrettable, were in keeping with the scale of the victory.';
}

const HERO: Record<Archetype, string[]> = {
  braggart: [
    '"Frankly, I could have got more," said {name}. "The others kept getting in the way."',
    '"It\'s a gift," said {name}. "Some men have it." He then bought the whole mess a round, on credit.',
    '{name} demonstrated his technique for our reporter using two forks and a sugar bowl. The sugar bowl did not survive.',
    '"Write that I was outnumbered," said {name}. "By a lot. More than that. Yes."',
  ],
  pessimist: [
    '"We were lucky. Next time we won\'t be," said {name}. The paper salutes his modesty.',
    '"Most of them will be back next week," said {name}, gloomily. The paper has printed this as "Most of them won\'t be back."',
    '"I expect I\'ll be shot down on Tuesday," said {name}, who has said so every week since the war began.',
    'Asked for a message to the nation, {name} said: "Keep the receipts." The Ministry is studying what he meant.',
  ],
  gloryHunter: [
    '"Put my name in big letters," said {name}, before posing for our photographer with both thumbs up.',
    '{name} asked whether the paper could also print his good side. This is it.',
    '{name} has asked us to mention that he is unmarried.',
    '"Give me the most dangerous job you have," said {name}. He was given this interview.',
  ],
  byTheBook: [
    '{name} declined to comment until his figures were confirmed by Form 541, in triplicate. "That is the procedure," he said.',
    '"I can confirm nothing," said {name}. The paper has confirmed it for him.',
    '{name} asked our reporter for his credentials, his ration book and a second form of identification, then went to bed.',
    '"The figures are provisional," said {name}. The paper has printed them in bold, as is the procedure.',
  ],
  timid: [
    '{name} said he would rather not be in the newspaper. We have printed his name in bold.',
    'Asked about his success, {name} went pale and asked to be left alone. A true hero never boasts.',
    '{name} was found hiding behind the parachute store when our reporter arrived. "Modesty itself," says his squadron.',
    '"Please don\'t mention me," said {name}. We have mentioned him twice: {name}.',
  ],
};

const HOME_ALL = [
  'Saucepans wanted. Every aluminium saucepan makes a fighter. The Ministry has received 41,000 saucepans and is unsure what to do with them.',
  'Carrots help you see in the dark, says the Ministry of Food. Our night fighters are said to eat nothing else.',
  'Lost: one carrier pigeon, grey, answers to "Corporal". Last seen heading for the enemy lines. Reward offered.',
  'Knit for the boys! The wing has received 312 balaclavas this month and would like, if possible, some socks.',
  'Spot the spy: spies can be recognised by their suspicious manner and foreign hats. Report all hats.',
  'Careless talk costs lives. So does careful talk. On the whole, best not to talk.',
  'Wanted: young men of good eyesight and poor imagination. Apply at your nearest recruiting office.',
  'Recipe of the week: mock duck (contains no duck). Next week: mock mock duck.',
  'The war will continue as normal over the holiday weekend.',
  'Blackout reminder: a lit cigarette can be seen from 20,000 feet, says the Ministry. So can a lit pipe, a lit cigar and a lit Ministry.',
  'Our aircraft works report record output. The record was set in a week the works were not bombed, which the Ministry asks us not to mention.',
  'A reader asks why our airmen do not simply fly higher, where the enemy cannot reach them. The Ministry is looking into it.',
  'Paper shortage: this newspaper is printed on both sides to save paper. Please also read it twice.',
  'Puzzle corner: how many enemy aircraft were destroyed this week? (Answer on the front page. Do not count them yourself.)',
];

const HOME_NATION: Record<NationId, string[]> = {
  aldmere: [
    'Tea ration unchanged. The Minister assures the nation he has also cut back, to four cups before breakfast.',
    'A Saltcote man has grown a marrow in the shape of the Air Minister. The Minister has asked for it to be eaten.',
    'Letters: Sir, — I have seen one of our bombers with a hole in its wing. Should I be worried? — "Concerned", {town}. (No.)',
  ],
  directorate: [
    'By order of the Directorate, enthusiasm is compulsory between 06:00 and 22:00. Off-duty enthusiasm is encouraged.',
    'Citizens are reminded that rumours are forbidden. This includes the rumour that rumours are forbidden.',
    'The Directorate thanks the citizens of the eastern districts for their voluntary donation of all their bicycles.',
  ],
  varn: [
    'Factory 9 has built its thousandth aircraft, and one spare wheel. The wheel is on display at the town hall.',
    'The League reminds families that every aircraft is identical, so there is no need to ask which one your son flies.',
    'Aquavit ration halved. The other half has been sent to the front, where it is "keeping the engines warm".',
  ],
};

const WEATHER = ['WEATHER: deleted by the Censor.', 'WEATHER: [— — — — —]. Readers are asked not to look out of the window.', 'WEATHER: the enemy would like to know. So would we.', 'WEATHER: as last week, but more so.'];

/** The week's front page. */
export function writePaper(rng: Rng, side: SideState, x: PaperInput): Newspaper {
  const nat = nationOf(side);
  const paper = PAPER[nat.id];
  const p = pressOf(side);
  const [head, deck] = headline(rng, x, nat.short);
  const ministry = Math.floor(x.lost / 2);
  // The lead: what the crews (via High Command) say they did, then our losses in the Ministry's words.
  const lead: string[] = [];
  if (x.claimed > 0) lead.push(`Our airmen destroyed ${n(x.claimed, 'one enemy aircraft', '# enemy aircraft')} this week, the Air Ministry announced last night.`);
  if (x.damage && x.damage.pct > 0) lead.push(`Bombers of the ${nat.wing} struck the ${x.damage.site}, leaving it "${x.damage.pct}% destroyed".`);
  else if (x.mission === 'support') lead.push('Our bombers flew in close support of the Army, which "could hear it from miles away".');
  else if (x.mission === 'sweep') lead.push('Our fighters swept the skies over the front and found them, in the words of one pilot, "lovely".');
  if (!lead.length) lead.push(`A spokesman for the ${nat.wing} described the week as "busy, in a quiet sort of way".`);
  lead.push(lossWords(x.lost));
  if (x.claimed >= 5) lead.push(rng.pick(['"At this rate the enemy will run out of aircraft by the end of the month," said an expert, as he has every month.', 'Experts calculate that the enemy air force has now been destroyed one and a half times.']));

  const columns: NewsColumn[] = [];
  if (x.caught && x.prevClaimed !== undefined) {
    columns.push({ kind: 'correction', head: 'Correction', body: `In a recent edition we reported ${n(x.prevClaimed, 'one enemy aircraft', '# enemy aircraft')} destroyed. The Air Ministry asks us to point out that this figure was "provisional". ${paper.name} regrets nothing.` });
  }
  if (x.enemyClaim > 0 || x.lost > 0) {
    columns.push({ kind: 'enemy', head: 'Enemy lies exposed', body: x.enemyClaim > ministry
      ? `Enemy wireless claims ${n(x.enemyClaim, 'one of our aircraft', '# of our aircraft')} destroyed this week. The Ministry puts the true figure at ${ministry === 0 ? 'none at all' : ministry}. "A transparent lie," said a spokesman.`
      : x.enemyClaim === 0
        ? 'Enemy wireless claims nothing at all this week. "Even they could not think of anything," said a spokesman.'
        : `Enemy wireless claims only ${n(x.enemyClaim, 'one of our aircraft', '# of our aircraft')} this week. "For once they are telling the truth," said a spokesman, "which is suspicious in itself."` });
  }
  // The week's top scorer, never credited with more than the paper's own total.
  const heroClaims = Math.min(x.hero?.claims ?? 0, x.claimed);
  if (x.hero && heroClaims >= 2) {
    columns.push({ kind: 'hero', head: `Hero of the week: ${x.hero.name}`, body: `${x.hero.squadron} claims ${heroClaims} this week. ${fresh(rng, side, `hero-${x.hero.archetype}`, HERO[x.hero.archetype]).replace(/\{name\}/g, x.hero.name)}` });
  }
  const home = [...HOME_ALL, ...HOME_NATION[nat.id]].map((s) => s.replace('{town}', nat.local.town.replace(/^the /, 'near the ')));
  columns.push({ kind: 'home', head: 'On the home front', body: fresh(rng, side, 'home', home) });
  columns.push({ kind: 'weather', head: 'Weather', body: rng.pick(WEATHER).replace(/^WEATHER: /, '') });

  const photo = x.photo
    ? { kind: x.photo.kind, serial: x.photo.serial, hits: x.photo.hits, caption: x.photo.hits.length >= 6 ? `${x.photo.type} ${x.photo.serial} home again. "Barely a scratch," says her crew.` : x.photo.hits.length ? `${x.photo.type} ${x.photo.serial} home again, with a few souvenirs.` : `${x.photo.type} ${x.photo.serial} home again without a mark on her.` }
    : undefined;
  return {
    week: x.week,
    ...paper,
    headline: head,
    deck,
    lead: lead.join(' '),
    columns,
    photo,
    claimed: x.claimed,
    enemyClaim: x.enemyClaim,
    ministryLosses: ministry,
    lost: x.lost,
    mood: p.mood,
    moodBefore: x.moodBefore,
    bonds: p.bonds,
    expect: expectation(side),
  };
}
