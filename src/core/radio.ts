/**
 * Radio-telephone chatter. Every call has several wordings, some depend on the
 * weather, the aircraft type or the character of the squadron leader, so no two
 * operations sound the same. `{x}` placeholders are filled in by `rt()`.
 */
import type { Rng } from './rng';
import type { Archetype, RadioLine, SideState, Weather } from './types';

export type Pool = string[];

/** Pick a wording and fill in its placeholders. */
export function rt(rng: Rng, pool: Pool, vars: Record<string, string | number> = {}): string {
  return rng.pick(pool).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export const FORM_UP: Record<Archetype, Pool> = {
  braggart: [
    '{c} Leader, {n} aircraft formed up. Let\'s give them something to remember.',
    '{c} Leader, all {n} up and pretty. Setting course, chaps; drinks are on whoever bags the first one.',
    '{c} Leader to all {c}s: {n} aboard, nobody gets lost and nobody gets clever. Except me.',
  ],
  pessimist: [
    '{c} Leader, {n} aircraft formed up. Setting course. Keep it tight; it\'s a long way.',
    '{c} Leader, {n} of us. Same route as last time. They\'ll be waiting.',
    '{c} Leader, formed up, {n} aircraft. Check your oxygen and say your prayers.',
  ],
  gloryHunter: [
    '{c} Leader, {n} aircraft. We go in first and we go in hard.',
    '{c} Leader, {n} formed up and setting course. Today we make the papers.',
    '{c} Leader, all {n} airborne. Follow me in, and don\'t you dare turn back.',
  ],
  byTheBook: [
    '{c} Leader, {n} aircraft formed up at angels twelve, setting course on time.',
    '{c} Leader, {n} aircraft. Formation check complete. Course one-three-five, as briefed.',
    '{c} Leader. {n} aircraft airborne, R/T discipline from here on, please.',
  ],
  timid: [
    '{c} Leader, {n} aircraft formed up. Setting course. Watch the sun.',
    '{c} Leader, er, {n} up. Stay close to me, everyone. Very close.',
    '{c} Leader, {n} aircraft. If it gets hot we keep together and we come home together.',
  ],
};

export const FEINT_OUT: Pool = [
  '{c} Leader, diversion force of {n}, heading for {sector}. Let\'s be seen.',
  '{c} Leader, {n} of us making a nuisance over {sector}. Wave to the observers, boys.',
  '{c} Leader, decoy flight of {n}, course for {sector}. Make plenty of noise.',
];

export const WEATHER_OUT: Record<Weather, Pool> = {
  clear: ['', '', ' Gin clear today.', ' Visibility unlimited. So is theirs.'],
  cloud: [' Solid cloud forecast over the target.', ' Ten-tenths cloud ahead.', ' Cloud base at four thousand, nothing above but grey.'],
  storm: [' Rain and turbulence all the way.', ' Icing on the wings already.', ' Lightning ahead. Hang on to your teeth.'],
};

export const ABORT_MECH: { multi: Pool; single: Pool } = {
  multi: [
    'Losing oil pressure, turning back.',
    'Rough running on number one, aborting.',
    'Hydraulics failed, returning to base.',
    'Intercom\'s dead and the rear turret won\'t traverse. Aborting.',
    'Port engine overheating. Sorry, Leader, we\'re going home.',
    'Bomb doors won\'t open. Turning back.',
  ],
  single: [
    'Losing oil pressure, turning back.',
    'Engine running rough, aborting.',
    'Guns won\'t charge. Going home.',
    'Coolant temperature off the clock, turning back.',
    'Undercarriage won\'t come up. Aborting.',
  ],
};

export const BANDITS: Pool = [
  'Bandits, {clock} o\'clock {height}! {many}',
  'Fighters! {clock} o\'clock {height}, coming in fast!',
  'Tally-ho, bandits {clock} o\'clock {height}. {many}',
  'Watch it, watch it, {clock} o\'clock {height}! {many}',
  'Here they come, {clock} o\'clock {height}. Gunners, wake up!',
];
export const MANY: { lots: Pool; few: Pool } = {
  lots: ['Lots of them!', 'Dozens of the blighters!', 'Sky\'s full of them!', 'Too many to count!'],
  few: ['Here they come.', 'A handful, no more.', 'Only a few.', 'Steady, steady.'],
};

export const CONTACT: Pool = [
  'Contact. {what}, {escort}. Attacking.',
  'Tally-ho! {what}, {escort}. Going in.',
  'Have them in sight. {what}, {escort}. Follow me down.',
  'Bogeys confirmed: {what}, {escort}. Pick your targets.',
];

export const NO_FIGHTERS: Record<Weather, Pool> = {
  clear: ['Sky is clear. No fighters yet.', 'Nothing about. Too quiet for my liking.', 'No bandits. Either they\'re asleep or they\'re waiting.'],
  cloud: ['No fighters yet. Cloud\'s thick; they may not find us.', 'Nothing in sight. Can\'t see much of anything in this muck.'],
  storm: ['No fighters. Nobody sane is flying in this.', 'Nothing up but us and the lightning.'],
};

export const ESCORT_KILL: Pool = [
  'Got one!', 'Splash one bandit.', 'He\'s going down, burning.', 'Scratch one!', 'Flamer! Did you see him go?', 'He\'s baled out. One less.',
];

export const GUNNER_KILL: Pool = [
  'Got him! Fighter going down at {clock} o\'clock!',
  'Tail gunner here: I got him, he\'s smoking, he\'s going in!',
  'Top turret: hit him, hit him! He\'s spinning!',
  'He\'s on fire! Fighter down, {clock} o\'clock!',
  'Got the so-and-so! He went straight past us burning.',
];

export const ESCORT_HOME: Pool = [
  'Fuel state critical. Little friends turning for home. You\'re on your own.',
  'Sorry, big friends, we\'re on fumes. Turning back. Good luck.',
  'Escort leader: that\'s our limit. You\'re on your own from here.',
];

export const WE_ARE_HIT: Pool = [
  'We\'re hit{where}. Still flying.',
  'Took a burst{where}. She\'s holding.',
  'We\'ve been hit{where}. Flight engineer\'s having a look.',
  'Hit{where}! We can manage. Keep going.',
  'Holes all over{where}, but she\'s still flying.',
];

export const WOUNDED: Pool = [
  'Navigator\'s wounded. Somebody get the first-aid kit to him.',
  'Wireless op is hit, bleeding badly. We\'re keeping on.',
  'Rear gunner\'s not answering. Can someone go back and look?',
  'Flight engineer\'s hit in the leg. He says carry on.',
];

export const CHATTER: { bomber: Pool; fighter: Pool } = {
  bomber: [
    'Close up, close up! Don\'t straggle!',
    'Gunners, short bursts. Make every round count.',
    'Keep the box tight, he\'s looking for a straggler.',
    'Watch that one on the beam, he\'s lining up.',
    'Anyone seen {other}? Lost sight of him.',
    'Keep off the R/T unless you\'ve something to say.',
  ],
  fighter: [
    'Break left, break left!',
    'I\'m on his tail. Cover me.',
    'Watch your six, {other}!',
    'Two on my tail, can\'t shake them!',
    'Re-form on me. Re-form!',
    'Keep an eye on the bombers, don\'t chase them down.',
  ],
};

export const SEEN_GO: Pool = [
  '{lost} {what}. {chutes}',
  'Oh God, {lost} {what}. {chutes}',
  '{lost} {what}. {chutes} Poor devils.',
  'Did you see that? {lost} {what}. {chutes}',
];
export const SEEN_WHAT: Pool = ['is going down', 'has gone in', 'is falling out of formation', 'just blew up', 'is spinning down', 'went straight into the ground', 'broke up in the air'];

export const BREAK_OFF: Pool = [
  '{leader}: break off, break off, all {c} aircraft turn for home.',
  '{leader} to all {c}s: that\'s enough. Turn for home. Now.',
  '{leader}: we can\'t take any more of this. {c}s, follow me out.',
];

export const RUN_IN: Record<Weather, Pool> = {
  clear: ['Flak ahead. Steady... steady...', 'Bomb doors open. Hold her level.', 'Target in sight, running in.', 'Left, left... steady... right a touch...', 'Hold her steady, skipper. Nearly there.'],
  cloud: ['Can\'t see a thing through this. Bombing on dead reckoning.', 'Gap in the cloud! Running in, quick as you like.', 'Flak bursting in the cloud, can\'t see the aiming point.'],
  storm: ['Can\'t see a thing through this. Bombing on dead reckoning.', 'Bomb-aimer can\'t see the ground. Dropping on time and distance.', 'She\'s bucking like a horse; bombing on the navigator\'s reckoning.'],
};

export const SUPPORT_IN: Pool = [
  'Going in low over the lines. Pick your targets.',
  'Down on the deck. Guns and bombs on the trenches.',
  'Gun pits on the left, tanks in the wood. Go!',
  'Our boys are firing flares. Bomb past the flares!',
];

export const BOMBS_GONE: Pool = [
  'Bombs gone. Turning for home.',
  'Bombs gone! Let\'s get out of here.',
  'Bombs away. Close the doors and go.',
  'That\'s the lot. Home, James.',
];

export const GROUND_SUPPORT: Pool = [
  'Enemy bombers low over our forward positions.',
  'Forward observer: enemy aircraft strafing the line.',
  'Bombs on the trenches. Stretcher-bearers forward.',
];
export const GROUND_SITE: Pool = [
  'Bombs falling on {site}. Fires visible.',
  'Heavy explosions at {site}. Fire brigades turning out.',
  '{site} reports bombs in the area. Damage being assessed.',
  'Air raid on {site}. Shelters full, smoke everywhere.',
];

export const TOWER: { all: Pool; some: Pool; none: Pool } = {
  all: ['{landed} of {n} aircraft back over base. All home.', 'All {n} down safe. Tea\'s on.', '{landed} of {n} landed. Not a scratch on the count.'],
  some: ['{landed} of {n} aircraft back over base.', '{landed} of {n} down. We\'re still waiting on the rest.', 'Tower: {landed} of {n} home. Ambulances standing by.', '{landed} of {n} landed. Keep the lights on a while longer.'],
  none: ['None of the {n} has come back yet. We\'re still listening.', 'No aircraft back. Keep listening on the frequency.'],
};

/** Old HF sets: words lost in the static. */
const STATIC: Pool = ['—crackle—', '[static]', '—…—', '[unreadable]', '[fading]'];

/**
 * What a side hears over its radio sets. Without VHF sets the wing listens on
 * old HF equipment: many calls never get through and those that do are broken
 * up. Tower and ground reports come in by landline and are always heard.
 */
export function reception(rng: Rng, side: SideState, lines: RadioLine[]): RadioLine[] {
  if (side.research.includes('radios')) return lines;
  const out: RadioLine[] = [];
  for (const l of lines) {
    if (l.callsign === 'Tower' || l.callsign === 'Ground' || l.final) {
      out.push(l);
      continue;
    }
    if (!rng.chance(0.55)) continue;
    const words = l.text.split(' ');
    if (words.length > 3 && rng.chance(0.6)) {
      const at = rng.int(1, words.length - 2);
      const len = rng.int(1, Math.min(3, words.length - at - 1));
      words.splice(at, len, rng.pick(STATIC));
    }
    out.push({ ...l, text: words.join(' ') });
  }
  return out;
}
