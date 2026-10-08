/**
 * Enemy airmen who bale out over our side of the line are taken prisoner and
 * questioned. They know things our crews never can: what brought them down,
 * how strong their side is, where their bombers go next. But a prisoner talks
 * through his pride, his shock or his orders, just as our own crews report
 * through theirs, and the interrogator's read of him is not always right.
 *
 * Interrogations are written in the core for the side that holds the
 * prisoner; the truth behind each answer is kept for the archive.
 */
import { ZONE_LABEL } from './data';
import { nationOf } from './factions';
import { frontSector, theaterDef } from './theaters';
import type { Rng } from './rng';
import type { Archetype, FighterApproach, GameState, Interrogation, Leader, PlaneRecord, PrisonerTemper, SideState, Squadron, Statement, ZoneId } from './types';
import { ZONES } from './types';

/** An enemy airman in our hands this week. */
export interface Capture {
  rec: PlaneRecord;
  squadron: Squadron;
  /** His rank and name, as he gives them. */
  name: string;
  /** He led the squadron. */
  leader?: Leader;
}

/** What the enemy really meant to do next, as far as anyone on their side knew. */
export type Plan = { site: string; sector: number; type: string } | { support: number } | null;

const PHRASE: Record<FighterApproach, string> = { tail: 'from astern', headOn: 'head-on', beam: 'from the beam' };

export const TEMPER_NOTE: Record<PrisonerTemper, string> = {
  proud: 'Arrogant. Believes his own propaganda. Discount his figures.',
  shaken: 'Badly shaken. Talks quietly and to the point. Probably truthful.',
  talkative: 'Talks freely, perhaps too freely. Most of it is true; much of it is about his family.',
  stubborn: 'Name, rank and number. Then nothing.',
  false: 'Remarkably helpful. Too helpful. Treat with caution.',
};

export const TEMPER_LABEL: Record<PrisonerTemper, string> = { proud: 'Arrogant', shaken: 'Shaken', talkative: 'Talkative', stubborn: 'Stubborn', false: 'Too helpful' };

/** What a talkative prisoner adds, unasked. */
const CHATTER = ['My mother will be furious.', 'It was a new aircraft, too.', 'I was going on leave on Thursday.', 'Is there any chance of a cup of something?', 'Our squadron leader said this could not happen.', 'Please do not tell my wife.'];

const REMARKS = [
  'Asked for marmalade. Refused to say anything further until he got some.',
  'Spent forty minutes describing his dog.',
  'Offered to swap his watch for the interrogator\'s.',
  'Insisted on correcting our pronunciation of his name, his squadron and his aircraft.',
  'Wept at the sight of white bread.',
  'Asked whether his capture would be in the newspapers at home.',
  'Complained that our tea is not as good as the tea in prison camps in the films.',
  'Asked to be exchanged for "someone more important".',
  'Recognised the interrogator from before the war: they once sold each other the same bicycle.',
  'Demanded to speak to the manager.',
  'Asked what we feed our fighter pilots, and whether it is carrots.',
  'Requested a receipt for his parachute.',
];

const zl = (z: ZoneId) => ZONE_LABEL[z].toLowerCase();
/** "was" or "were", for a zone named in the plural ("the engines were hit"). */
const was = (z: ZoneId) => (ZONE_LABEL[z].endsWith('s') ? 'were' : 'was');

function pickTemper(rng: Rng, leader: boolean): PrisonerTemper {
  return rng.weighted<PrisonerTemper>(leader ? { proud: 3, stubborn: 3, false: 1.5, shaken: 1, talkative: 1 } : { proud: 1.5, shaken: 2.5, talkative: 2, stubborn: 1.5, false: 1 });
}

const LOOK: Record<PrisonerTemper, Archetype> = { proud: 'braggart', shaken: 'timid', talkative: 'gloryHunter', stubborn: 'byTheBook', false: 'pessimist' };

/** What the enemy side really meant to do next week. */
export function enemyPlan(state: GameState, enemy: SideState, lastRaid: { target: string; siteId?: string } | null): Plan {
  const intent = enemy.isAI ? enemy.intent : lastRaid && lastRaid.target !== 'feint' && lastRaid.target !== 'sweep' ? { target: lastRaid.target, siteId: lastRaid.siteId } : null;
  if (!intent || intent.target === 'sweep') return null;
  if (intent.target === 'support') return { support: frontSector(state.theater, enemy.id) };
  const site = state.theater.sites.find((x) => x.id === intent.siteId && x.owner !== enemy.id);
  return site ? { site: site.name, sector: site.sector, type: site.type === 'industry' ? 'aircraft works' : site.type === 'airfield' ? 'airfield' : 'fuel depot' } : null;
}

export function interrogate(rng: Rng, state: GameState, captor: SideState, enemy: SideState, c: Capture, plan: Plan): Interrogation {
  const nat = nationOf(enemy);
  const leader = !!c.leader;
  const temper = pickTemper(rng, leader);
  const seemed = rng.chance(0.7) ? temper : rng.pick((['proud', 'shaken', 'talkative', 'stubborn', 'false'] as PrisonerTemper[]).filter((x) => x !== temper));
  const rankOf = (full: string) => [...nat.crewRanks, ...nat.ranks].sort((a, b) => b.length - a.length).find((r) => full.startsWith(`${r} `)) ?? '';
  const rank = c.leader?.rank ?? rankOf(c.name);
  const name = c.leader?.name ?? c.name.slice(rank.length).trim();
  const number = `${100000 + ((c.rec.serial.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0) % 900000)}`;
  const silent = `"${name}. ${rank}. ${number}."`;
  const sectors = theaterDef(state).sectors;
  const friend = rng.pick(nat.crewFirst);
  // A stubborn man lets one thing slip.
  const statements: Statement[] = [];
  const honest = temper === 'shaken' || temper === 'talkative';
  const say = (s: Statement) => statements.push(s);

  // How he came down.
  const lethal = c.rec.hits.find((x) => x.lethal) ?? c.rec.hits[c.rec.hits.length - 1];
  if (lethal) {
    const zone = zl(lethal.zone);
    const flak = lethal.approach === 'flak';
    const truth = flak ? `Brought down by flak; the ${zone} ${was(lethal.zone)} hit.` : `Brought down by a fighter attacking ${PHRASE[lethal.approach as FighterApproach]}; the ${zone} ${was(lethal.zone)} hit.`;
    let a: string;
    let note: string | undefined;
    if (temper === 'stubborn') a = silent;
    else if (temper === 'proud') a = flak ? '"A lucky shell. Your gunners could not hit a barn twice."' : '"Your fighters? They never touched us. Engine trouble."';
    else if (temper === 'false') {
      const other = rng.pick((['tail', 'headOn', 'beam'] as FighterApproach[]).filter((x) => x !== lethal.approach));
      a = `"One of your fighters, ${PHRASE[other]}. We did not see him until too late."`;
      note = `If true, our attacks ${PHRASE[other]} are telling.`;
    } else {
      a = flak ? `"Flak, over the target. The ${zone} went and we went with it."` : `"One of your fighters, ${PHRASE[lethal.approach as FighterApproach]}. Hit our ${zone}. We never had a chance."`;
      if (temper === 'talkative') a = a.replace(/"$/, ` ${rng.pick(CHATTER)}"`);
      note = flak ? 'Our flak, then. The gunners will be pleased.' : `If true, our attacks ${PHRASE[lethal.approach as FighterApproach]} are telling.`;
    }
    say({ topic: 'downed', q: 'How were you brought down?', a, note, truth });
  }

  const pool: Statement['topic'][] = ['strength', 'target', 'armor', 'morale'];
  const asked = new Set(rng.chance(leader ? 1 : 0.6) && plan !== undefined ? ['target'] : []);
  while (asked.size < (leader ? 3 : 2)) asked.add(rng.pick(pool));
  const slip = temper === 'stubborn' ? rng.pick([...asked]) : null;
  const open = (topic: string) => honest || slip === topic;

  // A stubborn man's silence still hides an answer: the archive keeps what he knew.
  const mute = (from: number) => {
    for (const x of statements.slice(from)) {
      x.a = silent;
      delete x.note;
      delete x.sector;
      delete x.figure;
    }
  };
  for (const topic of pool) {
    if (!asked.has(topic)) continue;
    const from = statements.length;
    const slipped = slip === topic ? 'He let this slip.' : undefined;
    if (topic === 'strength') {
      const truth = enemy.squadrons.filter((q) => q.kind === 'fighter').reduce((a, q) => a + q.airframes.length, 0);
      const f = open(topic) ? rng.range(0.85, 1.15) : temper === 'proud' ? rng.range(1.6, 2.4) : rng.range(0.4, 0.6);
      const fig = Math.max(1, Math.round(truth * f));
      const a = open(topic) ? (temper === 'talkative' ? `"Oh, about ${fig}. ${friend} says more, but ${friend} cannot count."` : `"${fig}, maybe. Fewer every week."`)
        : temper === 'proud' ? `"Hundreds. Well, ${fig}. More than enough for you."` : `"Only ${fig} left. We are finished, really."`;
      say({ topic, q: QUESTION[topic], a, figure: fig, note: slipped ?? `Fighters in the sector: ${fig}, by his account.`, truth: `${truth} fighters.` });
    } else if (topic === 'target') {
      const truth = plan === null ? 'No bomber operation was planned.' : 'support' in plan ? `They planned close support against ${sectors[plan.support]}.` : `They planned to strike the ${plan.site} (${sectors[plan.sector]}).`;
      const where = plan && ('support' in plan ? { name: `our positions at ${sectors[plan.support]}`, sector: plan.support } : { name: `the ${plan.site}`, sector: plan.sector });
      let a: string;
      let sector: number | undefined;
      if (open(topic) && rng.chance(0.8)) {
        a = where ? `"They were talking about ${where.name}. That is all I know."` : '"Nothing is planned. We have nothing left to plan with."';
        sector = where?.sector;
      } else if (temper === 'proud') {
        a = plan && !('support' in plan) ? `"Wherever we like. Your ${plan.type}, probably. You will see."` : '"Wherever we like. You will see."';
      } else {
        // A false steer: one of our other sites, or nothing at all.
        const ours = state.theater.sites.filter((x) => x.owner === captor.id && (!plan || 'support' in plan || x.name !== plan.site));
        const decoy = ours.length ? rng.pick(ours) : null;
        a = decoy ? `"The ${decoy.name}. Everyone knows it. Next week."` : '"Nothing. We are finished."';
        sector = decoy?.sector;
      }
      say({ topic, q: QUESTION[topic], a, sector, note: slipped ?? (sector !== undefined ? `Fighters patrolling ${sectors[sector]} would meet such a raid.` : undefined), truth });
    } else if (topic === 'armor') {
      const arm = c.squadron.armor;
      const top = [...ZONES].sort((x, y) => arm[y] - arm[x])[0];
      const bare = ZONES.filter((z) => arm[z] === 0 && z !== top);
      const b = bare.length ? rng.pick(bare) : null;
      const truth = arm[top] > 0 ? `${c.squadron.name} carried armour on the ${zl(top)} (${arm[top]} plates)${b ? `, none on the ${zl(b)}` : ''}.` : 'His aircraft carried no armour at all.';
      const a = open(topic)
        ? arm[top] > 0 ? `"Plate behind the ${zl(top)}.${b ? ` Nothing on the ${zl(b)}, of course.` : ''}"` : '"Armour? We do not have any armour."'
        : temper === 'proud' ? '"We are armoured everywhere. Your bullets bounce off."'
        : b ? `"Plate on the ${zl(b)}. The ${zl(top)}? Nothing there."` : '"No armour. None at all."';
      say({ topic, q: QUESTION[topic], a, note: slipped ?? 'For the technical branch.', truth });
    } else {
      const m = enemy.squadrons.length ? enemy.squadrons.reduce((x, q) => x + q.morale, 0) / enemy.squadrons.length : 0.5;
      const low = m < 0.45;
      const a = open(topic) ? (low ? '"Bad. We lose too many, and the new ones do not last."' : `"The ${nat.local.drink} is terrible and the food is worse, but the boys keep flying."`)
        : temper === 'proud' ? '"Never better. We sing all the way to the target."' : low ? '"Never better. We cannot wait to come back."' : '"Terrible. Half the squadron wants to give up."';
      say({ topic, q: QUESTION[topic], a, note: slipped, truth: `Enemy morale stood at ${Math.round(m * 100)}%: ${low ? 'low' : m < 0.7 ? 'fair' : 'good'}.` });
    }
    if (temper === 'stubborn' && slip !== topic) mute(from);
  }

  const used = new Set(captor.usedLines ?? []);
  const free = REMARKS.map((_, i) => i).filter((i) => !used.has(`pow:${i}`));
  const ri = free.length ? rng.pick(free) : rng.int(0, REMARKS.length - 1);
  captor.usedLines = [...(captor.usedLines ?? []), `pow:${ri}`];
  return {
    id: `pow-${state.turn}-${c.rec.serial}`,
    week: state.turn,
    side: enemy.id,
    name,
    rank,
    unit: c.squadron.name,
    kind: c.rec.kind,
    serial: c.rec.serial,
    ...(leader ? { leader: true } : {}),
    archetype: c.leader?.archetype ?? LOOK[temper],
    temper,
    seemed,
    statements,
    remark: REMARKS[ri],
  };
}

const QUESTION: Record<Statement['topic'], string> = {
  downed: 'How were you brought down?',
  strength: 'How many fighters does your side have here?',
  target: 'Where are your bombers going next?',
  armor: 'Where is your aircraft armoured?',
  morale: 'How is morale in your squadron?',
};
