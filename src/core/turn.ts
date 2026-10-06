import { tech } from './tech';
import { remember } from './leaders';
import { stationLife } from './vignettes';
import { plural } from './text';
import { aiIntent } from './ai';
import { planCost, researchTurns } from './actions';
import { AIRCRAFT, ARCHETYPE_INFO, RANKS, REQUEST_SHORT, RESEARCH, SQUADRON_NAMES, TARGETS, TRAIT_INFO } from './data';
import { buildDebrief, updatePerceived } from './reports';
import { CRIPPLED, facilityEffects } from './effects';
import { generateRequests } from './requests';
import { Rng } from './rng';
import { captainName, makeAirframe, makeLeader, makeSquadron } from './setup';
import { finishDay, flyable, gatherFliers, newDay, resolveRaid, resolveRecon, type Flier } from './sim';
import {
  applyPressure,
  bomberRange,
  depthFor,
  enterTheater,
  frontSector,
  reachableSites,
  rollWeather,
  SECTOR_PRESSURE,
  sectorOwner,
  syncFacilities,
  theaterDecision,
  theaterDef,
  theaterMods,
  THEATERS,
} from './theaters';
import type {
  AircraftKind,
  ArchiveEntry,
  Facilities,
  GameState,
  Hit,
  Leader,
  Memo,
  Order,
  Outcome,
  PlaneRecord,
  RaidResult,
  RequestKind,
  SideId,
  SideState,
  Squadron,
  TargetId,
  Trait,
  TurnPlan,
} from './types';

/** Which theater (1..3) the war has reached; drives AI escalation and HQ demands. */
export function act(state: GameState): 1 | 2 | 3 {
  return Math.min(3, state.theater.index + 1) as 1 | 2 | 3;
}

function memo(side: SideState, turn: number, kind: Memo['kind'], subject: string, body: string, from = 'Air Ministry') {
  side.memos.unshift({ turn, from, subject, body, kind });
  if (side.memos.length > 40) side.memos.length = 40;
}

/** Depots hold at most this much fuel and munitions. */
export const STORES_CAP = 240;

/** Production points per week. */
export function factoryRate(side: SideState): number {
  const f = side.factory;
  return (3 + f.level * 2.5) * facilityEffects(side.facilities).production * (1 + tech(side, 'production')) * (f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.75 : 1);
}

/** The AI's resource multiplier: difficulty plus escalation through the theaters. */
export function aiBonus(state: GameState, side: SideState): number {
  const difficulty = 0.4 + 0.75 * side.insight; // green ~0.51, seasoned ~0.74, wald ~1.08
  return difficulty * (1 + 0.15 * (act(state) - 1));
}

/** Between theaters the Ministry partly makes good a depleted wing. */
function reinforce(rng: Rng, state: GameState, side: SideState, news: string[]) {
  const planes = side.squadrons.reduce((x, q) => x + q.airframes.length, 0);
  const shortfall = Math.max(0, 28 - planes);
  // The Ministry makes good what a trusted commander has lost; a doubted one gets little or nothing.
  const share = Math.max(0, Math.min(0.7, (side.trust - 30) / 100));
  const n = Math.round(shortfall * share);
  if (n <= 0) {
    if (shortfall > 0) news.push(`The Air Ministry declines to replace the wing's losses: "Confidence in the conduct of operations does not at present justify it."`);
    return;
  }
  let delivered = 0;
  for (let i = 0; i < n; i++) {
    const fighters = side.squadrons.filter((q) => q.kind === 'fighter').reduce((x, q) => x + q.airframes.length, 0);
    const kind: AircraftKind = fighters < planes / 2 || i % 2 === 0 ? 'fighter' : 'medium';
    const sq = side.squadrons.filter((q) => q.kind === kind).sort((x, y) => x.airframes.length - y.airframes.length)[0];
    if (!sq || sq.airframes.length >= 10) continue;
    sq.airframes.push(makeAirframe(state, rng, kind, side.id));
    sq.crews++;
    delivered++;
  }
  if (delivered) news.push(`The Air Ministry has sent ${delivered} replacement aircraft with crews for the new theater.`);
}

/** Remove lost airframes and crews, update morale, queue repairs. */
function applyLosses(rng: Rng, state: GameState, side: SideState, recs: PlaneRecord[], news: string[]) {
  const bySq = new Map<string, PlaneRecord[]>();
  for (const r of recs) {
    if (r.side !== side.id) continue;
    if (!bySq.has(r.squadronId)) bySq.set(r.squadronId, []);
    bySq.get(r.squadronId)!.push(r);
  }
  for (const sq of side.squadrons) {
    const mine = bySq.get(sq.id);
    if (!mine) {
      // Rested.
      sq.fatigue = Math.max(0, sq.fatigue - 0.35);
      sq.morale = Math.min(1, sq.morale + 0.08);
      sq.trauma = Math.max(0, sq.trauma - 0.15);
      continue;
    }
    let lost = 0;
    let kills = 0;
    let leaderLost = false;
    for (const r of mine) {
      const af = sq.airframes.find((a) => a.id === r.airframeId);
      kills += r.trueKills;
      if (r.fate === 'lost') {
        lost++;
        // Escape hatches and air-sea rescue bring home some of those who got out.
        const crew = AIRCRAFT[r.kind].crew;
        const out = r.chutes ?? 0;
        if (!r.lead && out > 0 && rng.chance(tech(side, 'escape'))) {
          const all = out >= crew;
          news.push(crew === 1 ? `The pilot of ${r.serial} (${sq.name}) baled out and has been brought home.` : `${all ? 'The crew' : `${out} of the crew`} of ${r.serial} (${sq.name}) got out and ${all ? 'have' : 'have'} been brought home.`);
          r.captain = `${captainName(side.id, r.serial, state.seed)} (${crew === 1 ? 'rescued, back with the squadron' : all ? 'rescued with his crew, back with the squadron' : `rescued with ${out - 1 > 0 ? `${out - 1} of his crew` : 'nobody else'}`})`;
          // A crew is a crew only if enough of it came back.
          if (out * 2 < crew) sq.crews--;
        } else {
          sq.crews--;
          // Men seen to bale out may turn up later as prisoners.
          if (!r.lead) prisonerPost(rng, state, side, sq, r);
        }
        // The leader flies callsign 1: if that aircraft is lost, he is missing. What became of him is only known weeks later.
        if (r.lead) {
          leaderLost = true;
          r.captain = `${sq.leader.rank} ${sq.leader.name}`;
        }
        if (!r.captain?.includes('rescued')) {
          side.roll = [...(side.roll ?? []), { week: state.turn, theater: state.theater.index, name: r.captain ?? captainName(side.id, r.serial, state.seed), serial: r.serial, squadron: sq.name, crew: AIRCRAFT[r.kind].crew, fate: 'missing' }];
        }
        sq.airframes = sq.airframes.filter((a) => a.id !== r.airframeId);
      } else if (r.fate === 'crashed') {
        if (rng.chance(0.25)) sq.crews--;
        sq.airframes = sq.airframes.filter((a) => a.id !== r.airframeId);
      } else if (af) {
        af.sorties++;
        af.hits = r.hits;
        af.patches += r.hits.length;
        if (af.condition < 75) {
          af.status = 'repair';
          af.repairTurns = Math.ceil((100 - af.condition) / 35);
        }
      }
    }
    const frac = lost / mine.length;
    const steady = sq.leader.trait === 'steady' ? 0.6 : 1;
    sq.morale = Math.max(0, Math.min(1, sq.morale - frac * 0.45 * steady + Math.min(0.08, kills * 0.02) + (lost === 0 ? 0.04 : 0) - (sq.fatigue > 0.6 ? 0.04 : 0)));
    sq.trauma = Math.min(1, sq.trauma * 0.7 + frac * 1.3);
    sq.fatigue = Math.min(1, sq.fatigue + 0.22 + (sq.leader.trait === 'shaken' ? 0.06 : 0));
    if (frac >= 0.4 && lost >= 2) remember(sq.leader, state.turn, `lost ${lost} of ${mine.length} aircraft in one operation`);
    // The leader's operations in command, and the reputation he earns after five of them.
    // The operation he was lost on counts too.
    if (leaderLost) sq.leader.ops = (sq.leader.ops ?? 0) + 1;
    // He planned and briefed this one even if he stayed behind with a squadron too small to lead.
    if (!leaderLost && !sq.leader.resting) {
      sq.leader.ops = (sq.leader.ops ?? 0) + 1;
      sq.leader.kills = (sq.leader.kills ?? 0) + kills;
      if (sq.leader.ops >= 5 && !sq.leader.trait) {
        sq.leader.trait = earnTrait(rng, sq);
        const info = TRAIT_INFO[sq.leader.trait];
        remember(sq.leader, state.turn, `became known as "${info.label}"`);
        news.push(`${sq.leader.rank} ${sq.leader.name} of ${sq.name} has a name in the wing now: ${info.label}. ${info.blurb}`);
      }
    }
    sq.skill = Math.min(0.95, sq.skill + 0.015 * (1 - frac));
    sq.crews = Math.max(0, sq.crews);
    if (frac >= 0.5 && mine.some((r) => r.fate !== 'lost')) {
      sq.notables.unshift(`Week ${state.turn}: the survivors are badly shaken after losing ${lost} of ${mine.length}.`);
    }
    // Only a CO who flew can go missing; a squadron wiped out while he stayed behind is re-formed under him.
    if (leaderLost) {
      const old = sq.leader;
      // His saying goes with him: no successor repeats it.
      if (old.said) side.usedLines = [...(side.usedLines ?? []), old.said];
      // Never reuse a name already heard in this war, so a new CO is never mistaken for the man he replaces.
      side.usedNames = [...new Set([...(side.usedNames ?? []), old.name])];
      // Two flight commanders could take over. The senior takes command; the commander may appoint the other this week.
      const [senior, other] = flightCommanders(rng, state, side, sq, old);
      sq.leader = senior;
      sq.candidate = other;
      sq.candidateWeek = state.turn + 1;
      const lostLead = mine.find((r) => r.lead && r.fate === 'lost');
      const line = `${old.rank} ${old.name}, commanding ${sq.name}, is missing${lostLead ? ` with ${lostLead.serial}` : ''}. ${sq.leader.rank} ${sq.leader.name} takes command.`;
      news.push(line);
      if (lostLead) leaderFate(rng, state, side, sq, lostLead, old);
      sq.notables.unshift(`Week ${state.turn}: ${old.rank} ${old.name} missing; ${sq.leader.rank} ${sq.leader.name} in command.`);
      memo(side, state.turn + 1, 'notice', `${sq.name}: change of command`, `${line} ${describeFlightCommander(sq.leader, 'He is the senior flight commander')} The other flight commander, ${describeFlightCommander(other, `${other.rank} ${other.name}`)} You may appoint him instead this week (Squadrons).`, 'Group HQ');
    }
    sq.notables = [...new Set(sq.notables)].slice(0, 5);
  }
}

/**
 * The two flight commanders who could take over a squadron, senior first. They
 * have flown with it for a while, so some already have a name in the wing.
 * A replacement is never senior to the man he replaces.
 */
function flightCommanders(rng: Rng, state: GameState, side: SideState, sq: Squadron, old: Leader): [Leader, Leader] {
  const taken = [...side.squadrons.map((q) => q.leader.name), ...(side.usedNames ?? [])];
  const a = makeLeader(rng, side.id, undefined, taken);
  const b = makeLeader(rng, side.id, undefined, [...taken, a.name]);
  const ranks = RANKS[side.id];
  const top = Math.max(0, ranks.indexOf(old.rank));
  a.rank = ranks[top];
  b.rank = ranks[Math.max(0, top - 1)];
  for (const c of [a, b]) {
    c.since = state.turn + 1;
    c.ops = 0;
    if (rng.chance(0.55)) {
      const w: Record<Trait, number> = {
        ace: sq.kind === 'fighter' ? 0.5 : 0,
        lucky: 1,
        steady: 1.4 + (c.archetype === 'timid' ? 0.4 : 0),
        sharpEyed: c.archetype === 'byTheBook' ? 2 : 0.7,
        shaken: sq.trauma > 0.3 ? 0.8 : 0.2,
      };
      c.trait = rng.weighted(w) as Trait;
      remember(c, state.turn, `was known as "${TRAIT_INFO[c.trait].label}" as a flight commander`);
    }
  }
  // Their names are spoken for now, whichever of them commands.
  side.usedNames = [...new Set([...(side.usedNames ?? []), a.name, b.name])];
  return [a, b];
}

/** One sentence on a flight commander: his character and, if he has one, his name in the wing. */
export function describeFlightCommander(l: Leader, who: string): string {
  return `${who}: "${ARCHETYPE_INFO[l.archetype].label}" (${ARCHETYPE_INFO[l.archetype].blurb.replace(/\.$/, '')})${l.trait ? `, known in the wing as "${TRAIT_INFO[l.trait].label}"` : ''}.`;
}

/** The reputation a leader earns, coloured by what his squadron went through. */
function earnTrait(rng: Rng, sq: Squadron): Trait {
  const fighter = sq.kind === 'fighter';
  const baledOut = (sq.leader.log ?? []).some((l) => l.text.startsWith('came back'));
  const w: Record<Trait, number> = {
    // An ace needs kills to his squadron's name.
    ace: (sq.leader.kills ?? 0) >= 3 ? (fighter ? 2 + sq.skill * 2 : 0.5) : 0,
    lucky: 0.8 + (baledOut ? 2 : 0),
    steady: 1 + (sq.morale > 0.6 ? 1 : 0) + (sq.leader.archetype === 'timid' ? 0.5 : 0),
    sharpEyed: sq.leader.archetype === 'byTheBook' ? 3 : 0.7,
    // Only a squadron that has been through the mill makes its CO a shaken man.
    shaken: sq.trauma > 0.3 ? sq.trauma * 3 + (sq.leader.archetype === 'pessimist' ? 0.5 : 0) : 0,
  };
  return rng.weighted(w) as Trait;
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : n === 3 ? 'three times' : `${n} times`);

/** A short obituary for a leader who had been in command a while, built from what the squadron remembers. */
const SUCCESSOR_SAYS: Record<Leader['archetype'], string[]> = {
  braggart: ['He\'d want us to give them hell. So we will.', 'Big boots to fill. I\'ve got big feet.', 'The squadron\'s still the best in the wing. I\'ll see it stays that way.', 'He bought the first round every time. I\'ll keep that going, at least.', 'They\'ll pay for him. With interest.'],
  pessimist: ['He was the best of us. That\'s usually how it goes.', 'We\'ll miss him. We\'ll be missing more of us before this is over.', 'I didn\'t want the job. Not like this.', 'He used to say the odds would catch up with us. They caught up with him first.', 'Someone has to sign the letters now. I suppose it\'s me.'],
  gloryHunter: ['We\'ll finish what he started.', 'He went in first. So will I.', 'He showed us how it\'s done. Now we do it.', 'Put us on the next big one, sir. For him.', 'He never once turned back. Neither will I.'],
  byTheBook: ['The squadron will carry on as he trained it.', 'His orders stand until I have reason to change them.', 'I have his notes. We will follow them.', 'He kept a clean log. I intend to keep it.', 'Procedure is what got most of us home. He wrote most of it.'],
  timid: ['We\'ll bring the boys home. That\'s what he wanted.', 'I\'ll try to keep them alive. He always did.', 'I\'m not the man he was. I\'ll be careful with them.', 'He knew every crew by name. I\'m learning them.', 'No heroics. He\'d have hated heroics.'],
};

/**
 * A veteran leader's obituary, written when he is presumed killed: one or two
 * human details rather than a list. His last call, something he used to say,
 * the request that mattered most, and a word from the man who took over.
 */
export function obituary(l: Leader, squadron: string, missingSince: number, lastWords?: string, successor?: Leader, used?: string[]): string {
  const parts: string[] = [`${l.rank} ${l.name}, missing since week ${missingSince}, is now presumed killed. He led ${squadron} on ${plural(l.ops ?? 0, 'operation')}.`];
  if (lastWords && !lastWords.startsWith('[')) parts.push(`His last call was: "${lastWords}"`);
  else if (lastWords) parts.push('His last call was a carrier wave and nothing more.');
  if (l.said) parts.push(`The squadron remembers him saying: "${l.said}"`);
  else if (l.trait) parts.push(`The wing knew him as "${TRAIT_INFO[l.trait].label}".`);
  // The request he pressed hardest, and what you said to it.
  const byKind = new Map<RequestKind, { asked: number; approved: number }>();
  for (const e of l.log ?? []) if (e.kind) {
    const k = byKind.get(e.kind) ?? { asked: 0, approved: 0 };
    k.asked++;
    if (e.approved) k.approved++;
    byKind.set(e.kind, k);
  }
  // The decision closest to his death, if it was recent; otherwise the request he pressed hardest.
  const lastAsk = [...(l.log ?? [])].reverse().find((e) => e.kind);
  const top = [...byKind.entries()].sort((a, b) => b[1].asked - a[1].asked)[0];
  // Only a decision that could have cost him his life is laid at his death: more risk granted, or less refused.
  const RISKY: RequestKind[] = ['pressHome', 'headOn'];
  const SAFER: RequestKind[] = ['rest', 'higher', 'breakOffSooner', 'tighterBox', 'plateTheHoles'];
  const bears = (e: NonNullable<Leader['log']>[number]) => !!e.kind && (e.approved ? RISKY.includes(e.kind) : SAFER.includes(e.kind));
  if (lastAsk && lastAsk.kind && missingSince - lastAsk.week <= 2 && bears(lastAsk)) {
    parts.push(lastAsk.approved
      ? `In week ${lastAsk.week} he asked ${REQUEST_SHORT[lastAsk.kind]}, and you agreed. He did not come back.`
      : `In week ${lastAsk.week} he asked ${REQUEST_SHORT[lastAsk.kind]}, and you said no.`);
  } else if (top && top[1].asked >= 2) {
    const [kind, k] = top;
    parts.push(`He asked ${times(k.asked)} ${REQUEST_SHORT[kind]}; ${k.approved === 0 ? 'you never agreed' : k.approved === k.asked ? (k.asked === 1 ? 'you agreed' : 'you agreed every time') : `you agreed ${times(k.approved)}`}.`);
  }
  const back = (l.log ?? []).find((e) => e.text.startsWith('came back through the lines'));
  if (back) parts.push(`He had come back through the lines once already, in week ${back.week}.`);
  if (successor) {
    // Each successor his own words: the line is chosen by his name, skipping any already spoken in this war.
    const lines = SUCCESSOR_SAYS[successor.archetype];
    const start = [...successor.name].reduce((a, c) => a + c.charCodeAt(0), 0) % lines.length;
    const line = [...lines.slice(start), ...lines.slice(0, start)].find((x) => !used?.includes(x)) ?? lines[start];
    used?.push(line);
    parts.push(`${successor.rank} ${successor.name}, who took over: "${line}"`);
  }
  parts.push('A letter to his family has gone out over your signature.');
  return parts.join(' ');
}

/**
 * What became of a missing leader, decided now and told weeks later. Only men
 * seen to bale out can turn up again: a few evade and come back, some are
 * taken prisoner. The rest are presumed killed, and only then is the letter
 * written.
 */
function leaderFate(rng: Rng, state: GameState, side: SideState, sq: Squadron, r: PlaneRecord, old: Leader) {
  const out = (r.chutes ?? 0) > 0;
  const roll = rng.next();
  const evade = old.trait === 'lucky' ? 0.3 : 0.12;
  const due = state.turn + rng.int(3, 4);
  const name = `${old.rank} ${old.name}`;
  if (out && roll < evade) {
    side.post = [...(side.post ?? []), { due, from: 'Group HQ', subject: `${name} is back`, body: `${name} of ${sq.name}, missing since week ${state.turn}, has made his way back through the lines. He resumes command of his squadron.`, returns: { squadronId: sq.id, leader: old }, serial: r.serial, fate: 'returned' }];
  } else if (out && roll < evade + 0.2) {
    side.post = [...(side.post ?? []), { due: due + 1, from: 'International Red Cross', subject: `${name} is alive`, body: `We are informed that ${name}, commanding ${sq.name}, missing since week ${state.turn}, is alive and a prisoner of war. Next-of-kin have been told.`, serial: r.serial, fate: 'prisoner' }];
  } else if ((old.ops ?? 0) >= 3) {
    side.post = [...(side.post ?? []), { due, from: 'Group HQ', subject: `In memoriam: ${name}`, body: '', obit: { leader: old, squadronId: sq.id, squadron: sq.name, week: state.turn, lastWords: r.lastWords }, serial: r.serial, fate: 'killed' }];
  } else {
    side.post = [...(side.post ?? []), { due, from: 'Group HQ', subject: `${name} presumed killed`, body: `${name}, missing with ${r.serial} since week ${state.turn}, is now presumed killed. He had commanded ${sq.name} for only ${plural(old.ops ?? 0, 'operation')}. Next-of-kin have been told.`, serial: r.serial, fate: 'killed' }];
  }
}

/**
 * The Y-Service listens to enemy wireless traffic and guesses next week's
 * operation. An AI enemy fixes its target a week ahead, so the guess can be
 * right; a human enemy has not chosen yet, so the analysts go by habit.
 */
function intelligenceWarnings(state: GameState, raids: [RaidResult | null, RaidResult | null]) {
  const rng = new Rng({ s: (state.rng.s ^ 0x2545f491) >>> 0 });
  const t = state.theater;
  const names = theaterDef(state).sectors;
  for (const side of state.sides) {
    const enemy = state.sides[(1 - side.id) as SideId];
    let truth: SideState['intent'] | null;
    if (enemy.isAI) truth = enemy.intent = aiIntent(state, enemy.id);
    else {
      const last = raids[enemy.id];
      truth = last && last.target !== 'feint' ? { target: last.target, siteId: last.siteId } : null;
    }
    const accuracy = 0.55 + (side.research.includes('radar') ? 0.15 : 0) + (side.research.includes('radarChain') ? 0.1 : 0) + (side.research.includes('intelOfficer') ? 0.1 : 0);
    let guess = truth;
    if (!rng.chance(accuracy)) {
      // A wrong steer: some other of our sites in their reach, or the front.
      const ours = reachableSites(state, enemy.id, 'medium').filter((x) => x.id !== truth?.siteId);
      guess = ours.length && rng.chance(0.65) ? (() => { const x = rng.pick(ours); return { target: x.type, siteId: x.id }; })() : truth?.target === 'support' ? null : { target: 'support' };
    }
    const prefix = enemy.isAI ? 'Y-Service' : 'Analysts, going by the enemy\'s habits';
    let text: string;
    let sector: number | undefined;
    if (!guess || guess.target === 'sweep') text = `${prefix}: enemy wireless traffic is quiet. No major bomber operation is expected.`;
    else if (guess.target === 'support') {
      sector = frontSector(t, enemy.id);
      text = guess === truth && truth?.push
        ? `${prefix}: heavy traffic from every enemy squadron. They are preparing a counter-offensive against ${names[sector]}, with all the fighters they can spare.`
        : `${prefix}: enemy bombers appear to be massing against our forward positions at ${names[sector]}.`;
    } else {
      const site = t.sites.find((x) => x.id === guess!.siteId);
      sector = site?.sector;
      text = `${prefix}: signals traffic points to a raid on our ${site?.name ?? 'works'}${sector !== undefined ? ` (${names[sector]})` : ''}.${guess === truth && truth?.focus && site ? ` They seem set on wrecking our ${site.type === 'industry' ? 'aircraft works' : site.type === 'airfield' ? 'airfields' : 'fuel depots'} one by one.` : ''}`;
    }
    const rec = side.perceived.warningRecord ?? [];
    const record = rec.length ? ` (Their record: right ${rec.filter(Boolean).length} of the last ${rec.length}.)` : '';
    text += record;
    side.perceived.warning = { text, sector, guess };
    // Their reliability as judged by their record once there is one, else by their equipment.
    const ratio = rec.length >= 4 ? rec.filter(Boolean).length / rec.length : accuracy;
    const reliability = ratio >= 0.75 ? 'good' : ratio >= 0.55 ? 'fair' : ratio >= 0.35 ? 'doubtful' : 'unreliable';
    memo(side, state.turn + 1, 'intel', 'Warning of enemy intentions', `${text} Reliability: ${reliability}.${sector !== undefined ? ' Fighters patrolling that sector would meet such a raid.' : ''}`, 'Air Intelligence');
  }
}

/** Crews seen to bale out may be reported as prisoners by the Red Cross a few weeks later. */
function prisonerPost(rng: Rng, state: GameState, side: SideState, sq: Squadron, r: PlaneRecord) {
  const chutes = r.chutes ?? 0;
  if (chutes === 0 || !rng.chance(0.6)) return;
  // Delivered at the end of week `due - 1`, i.e. two to four weeks after the loss.
  const due = state.turn + rng.int(3, 5);
  const captain = captainName(side.id, r.serial, state.seed);
  const one = AIRCRAFT[r.kind].crew === 1 || chutes === 1;
  const who = AIRCRAFT[r.kind].crew === 1 ? `${captain}, pilot of ${r.serial} (${sq.name})` : chutes === 1 ? `one man of the crew of ${r.serial} (${sq.name})` : `${chutes} of the crew of ${r.serial} (${sq.name}), ${captain} among them`;
  side.post = [...(side.post ?? []), {
    due,
    from: 'International Red Cross',
    subject: `Prisoners of war: ${r.serial}`,
    body: `We are informed that ${who}, missing since week ${state.turn}, ${one ? 'is' : 'are'} alive and ${one ? 'a prisoner' : 'prisoners'} of war. Next-of-kin have been told.`,
    serial: r.serial,
    fate: 'prisoner',
  }];
}

export const STRIKE_DAMAGE = 2.5;
/** The most one raid can move the front in a week. */
export const SWING_CAP = 15;

function applyDamage(state: GameState, siteId: string | undefined, dmg: number): number {
  const site = state.theater.sites.find((x) => x.id === siteId);
  if (!site || dmg <= 0) return 0;
  const before = site.condition;
  // Bombs on works do lasting harm: about three good raids cripple a type of works.
  site.condition = Math.max(0, Math.round(site.condition - dmg * STRIKE_DAMAGE));
  return before - site.condition;
}

/** Aircraft (built or on order) still without a crew, after counting crews in training. */
export function crewShortfall(side: SideState): number {
  const aircraft = side.squadrons.reduce((a, q) => a + q.airframes.length, 0) + side.factory.queue.length;
  const crews = side.squadrons.reduce((a, q) => a + Math.max(0, q.crews), 0) + side.training.inTraining;
  return Math.max(0, aircraft - crews);
}

function economy(rng: Rng, state: GameState, side: SideState) {
  const r = side.resources;
  const trustF = 0.4 + side.trust / 100;
  const bonus = side.isAI ? aiBonus(state, side) : 1;
  const sup = Math.round((45 + 45 * trustF) * (0.55 + 0.45 * Math.min(1.2, side.facilities.industry / 100)) * bonus);
  // Stores are rationed: a full effort every week burns more than arrives, and wrecked fuel depots cut deliveries.
  const stores = Math.round((26 + 28 * trustF) * facilityEffects(side.facilities).stores * bonus);
  // Aircrew are posted only for aircraft the wing has or has on order.
  const rep = Math.min(Math.max(0, crewShortfall(side) - r.replacements), Math.round((2 + 3 * trustF) * bonus));
  r.supplies += sup;
  r.stores = Math.min(STORES_CAP, r.stores + stores);
  r.replacements += rep;
  side.repaired = [];
  side.memos.unshift({
    turn: state.turn + 1,
    from: 'Supply Command',
    kind: 'supply',
    subject: 'Deliveries',
    body: `Delivered this week: ${sup} supplies, ${stores} stores (fuel and munitions), ${rep} replacement aircrew.`,
  });

  // Factory production.
  const f = side.factory;
  const rate = factoryRate(side);
  f.progress += rate;
  while (f.queue.length > 0 && f.progress >= AIRCRAFT[f.queue[0]].build) {
    const kind = f.queue.shift() as AircraftKind;
    f.progress -= AIRCRAFT[kind].build;
    const defectScale = f.qc === 'rushed' ? 1.4 : f.qc === 'strict' ? 0.15 : 0.5;
    const af = makeAirframe(state, rng, kind, side.id, defectScale);
    // Deliver to the squadron of that type with the fewest aircraft, or form one.
    const candidates = side.squadrons.filter((s) => s.kind === kind && s.airframes.length < 10);
    candidates.sort((a, b) => a.airframes.length - b.airframes.length);
    if (candidates.length > 0) candidates[0].airframes.push(af);
    else {
      const used = new Set(side.squadrons.map((q) => q.name));
      const free = SQUADRON_NAMES[side.id].findIndex((n) => !used.has(n));
      const sq = makeSquadron(state, rng, side.id, kind, 0, free >= 0 ? free : side.squadrons.length, undefined, [...side.squadrons.map((q) => q.leader.name), ...(side.usedNames ?? [])]);
      if (free < 0) sq.name = `${sq.name} (${side.squadrons.length + 1})`;
      sq.crews = 0;
      sq.airframes.push(af);
      side.squadrons.push(sq);
      memo(side, state.turn + 1, 'notice', `New squadron formed`, `${sq.name} has been formed to operate the ${AIRCRAFT[kind].name[side.id]}. ${sq.leader.rank} ${sq.leader.name} commanding.`, 'Group HQ');
    }
  }
  if (f.queue.length === 0) f.progress = Math.min(f.progress, 3);

  // Training: graduates join understrength squadrons.
  const t = side.training;
  const graduates = t.inTraining;
  t.inTraining = 0;
  let pool = graduates;
  const gradSkill = 0.25 + t.level * 0.07 + tech(side, 'training') + (t.focus === 'gunnery' || t.focus === 'evasion' ? 0.06 : 0) - (t.focus === 'reporting' ? 0.04 : 0);
  // Squadrons with no crew at all come first (a new recon flight must not wait for weeks), then the most short-handed.
  const needy = [...side.squadrons].sort((a, b) => (a.crews <= 0 ? -100 : 0) - (b.crews <= 0 ? -100 : 0) || a.crews - a.airframes.length - (b.crews - b.airframes.length));
  side.arrived = [];
  for (const sq of needy) {
    const before = pool;
    while (pool > 0 && sq.crews < sq.airframes.length) {
      sq.skill = (sq.skill * sq.crews + gradSkill) / (sq.crews + 1);
      sq.crews++;
      pool--;
    }
    if (before > pool) side.arrived.push({ squadronId: sq.id, n: before - pool });
  }
  // Crews move between squadrons of the same type, to where the aircraft are.
  for (const sq of side.squadrons) {
    let spare = sq.crews - sq.airframes.length;
    for (const to of side.squadrons) {
      if (spare <= 0) break;
      if (to === sq || to.kind !== sq.kind) continue;
      const need = Math.min(spare, to.airframes.length - to.crews);
      if (need <= 0) continue;
      to.skill = (to.skill * to.crews + sq.skill * need) / (to.crews + need);
      to.crews += need;
      sq.crews -= need;
      spare -= need;
    }
  }
  // Excess graduates wait in the pool as replacements.
  r.replacements += pool;
  const capacity = 1 + t.level * 2;
  // The school takes pupils only for aircraft that exist or are on order.
  const intake = Math.min(capacity, r.replacements, crewShortfall(side));
  r.replacements -= intake;
  t.inTraining = intake;

  // Repairs at the airfield.
  const repairCap = Math.round((4 + 8 * side.facilities.airfield / 100) * (1 + tech(side, 'repair')));
  let repaired = 0;
  for (const sq of side.squadrons) {
    for (const af of sq.airframes) {
      if (af.status !== 'repair') continue;
      if (repaired >= repairCap || r.supplies < 3) continue;
      r.supplies -= 3;
      repaired++;
      af.repairTurns--;
      if (af.repairTurns <= 0) {
        af.status = 'ready';
        af.condition = 100;
      }
    }
  }
  // Ready aircraft keep their latest holes visible until next sortie; patching is cosmetic.

  // Research.
  if (side.researching) {
    const item = RESEARCH.find((x) => x.id === side.researching)!;
    side.researchProgress++;
    if (side.researchProgress >= researchTurns(item.cost)) {
      side.research.push(item.id);
      memo(side, state.turn + 1, 'notice', `Development complete: ${item.name}`, item.desc, 'Ministry of Aircraft Production');
      side.researching = null;
      side.researchProgress = 0;
    }
  }

  // Facility repair: each site the side holds is patched up a little.
  // Crippled sites barely mend on their own: only paid emergency repairs bring them back quickly.
  for (const site of state.theater.sites) if (site.owner === side.id) site.condition = Math.min(100, site.condition + Math.round((site.condition < CRIPPLED ? 1 : 4) * (1 + tech(side, 'repair'))));
}

/** What moved the front, from one side's point of view, in the Army liaison's words. */
function pressureLedger(parts: Record<'air' | 'support' | 'strikes' | 'works' | 'escalation', number>, sign: number, supportFlown: boolean) {
  const labels: Record<keyof typeof parts, string> = {
    air: 'Fighting in the air (losses on both sides)',
    support: 'Close support over the front',
    strikes: 'Bombing of works and depots',
    works: 'State of works, depots and airfields (both sides)',
    escalation: 'Enemy reinforcements arriving',
  };
  const word = (v: number) =>
    v >= 8 ? 'strongly in our favour' : v >= 3 ? 'in our favour' : v > -3 ? 'little either way' : v > -8 ? 'against us' : 'strongly against us';
  const lines = (Object.keys(parts) as (keyof typeof parts)[])
    .map((k) => ({ k, v: parts[k] * sign }))
    .filter(({ k, v }) => Math.abs(v) >= 1.5 || k === 'air' || (k === 'support' && supportFlown))
    .map(({ k, v }) => ({ label: labels[k], effect: word(v), sign: v >= 3 ? 1 : v <= -3 ? -1 : 0 }));
  // One word for the size of the whole week's change.
  const total = Object.values(parts).reduce((a, b) => a + b, 0) * sign;
  const size = total >= 10 ? 'a large gain' : total >= 4 ? 'a gain' : total > -4 ? 'little change' : total > -10 ? 'a loss' : 'a large loss';
  lines.push({ label: 'Overall this week', effect: size, sign: total >= 4 ? 1 : total <= -4 ? -1 : 0 });
  return lines;
}

function newOrder(rng: Rng, state: GameState, side: SideState, exclude: Order['kind'][] = []): Order | null {
  const a = act(state);
  const t = state.theater;
  const def = theaterDef(state);
  const id = `o${state.nextId++}`;
  // Orders are issued at the end of a week, for the weeks that follow, and never outlive the theater.
  const next = state.turn + 1;
  const lastWeek = state.turn + Math.max(1, def.weeks - t.week);
  const due = (weeks: number) => Math.min(lastWeek, next + weeks - 1);
  const open = new Set(side.orders.filter((o) => !o.done && !o.failed).map((o) => o.kind));
  // A site just struck to order isn't ordered again straight away.
  const recentlyStruck = new Set(side.orders.filter((o) => o.kind === 'strike' && o.done && o.deadline >= state.turn - 2).map((o) => o.siteId));
  const targets = reachableSites(state, side.id, 'medium').filter((x) => !recentlyStruck.has(x.id));
  const w: Partial<Record<Order['kind'], number>> = {
    // No strike orders to a wing whose bomber arm has been gutted.
    strike: targets.length && lastWeek > next && side.squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy').reduce((a, q) => a + flyable(q).length, 0) >= 3 ? 0.45 : 0,
    kills: 0.3,
    sorties: 0.1,
    advance: t.week >= 2 && lastWeek - next >= 2 ? 0.2 : 0,
  };
  for (const k of [...open, ...exclude]) w[k] = 0;
  if (Object.values(w).every((x) => !x)) return null;
  const kind = rng.weighted(w);
  if (kind === 'strike') {
    const site = rng.pick(targets);
    // Strike orders always leave at least two weeks to plan and fly them.
    const deadline = due(rng.int(2, 3));
    const amount = 10 + 5 * a + rng.int(0, 6);
    return { id, kind, target: site.type, siteId: site.id, amount, goal: amount, from: side.perceived.sites[site.id] ?? 100, deadline, text: `Inflict at least ${amount}% damage on the ${site.name} by week ${deadline}.` };
  }
  if (kind === 'advance') {
    const sector = frontSector(t, side.id);
    const deadline = due(3);
    return { id, kind, amount: sector, deadline, text: `Support the Army until ${def.sectors[sector]} is in our hands, by week ${deadline}.` };
  }
  if (kind === 'kills') {
    // High Command asks for roughly what the wing usually reports: the median of recent weeks,
    // so one lucky (or inflated) week doesn't set an impossible quota.
    const recent = state.archive.slice(-5).map((e) => e.reportedToHq[side.id]).sort((x, y) => x - y);
    const rate = recent.length ? recent[Math.floor(recent.length / 2)] : 4;
    const weeks = Math.min(2, lastWeek - next + 1);
    // ...but never more than a fair share of the enemy fighters it believes are out there.
    const ceiling = Math.max(3, Math.round(side.perceived.enemyFighters * 0.35 * weeks));
    const amount = Math.max(3, Math.min(ceiling, Math.round(rate * weeks * rng.range(0.8, 1.0))));
    const deadline = due(weeks);
    return { id, kind, amount, deadline, text: `Destroy no fewer than ${amount} enemy aircraft ${weeks === 1 ? 'this coming week' : `in the next ${weeks} weeks`} (by week ${deadline}).` };
  }
  // Sorties over two weeks, so tired squadrons can be rested in one of them.
  const strength = side.squadrons.reduce((x, q) => x + flyable(q).length, 0);
  const weeks = Math.min(2, lastWeek - next + 1);
  const amount = Math.max(6, Math.round(strength * weeks * rng.range(0.5, 0.65)));
  return { id, kind, amount, deadline: due(weeks), text: `Mount at least ${amount} sorties ${weeks === 1 ? `this coming week (week ${next})` : `over the next two weeks (by week ${due(weeks)})`} to maintain pressure on the enemy.` };
}

interface Reported {
  kills: number;
  /** Reported damage, by site id. */
  damage: Record<string, number>;
  sorties: number;
  /** Our own aircraft lost: these can't be talked down. */
  lost: number;
}

function highCommand(rng: Rng, state: GameState, side: SideState, enemy: SideState, reported: Reported, plan: TurnPlan, hqLines: string[], photo: { siteId: string; condition: number } | null = null, unobserved = false) {
  // HQ only knows what it is told.
  const e = Math.max(0, Math.min(1, plan.embellish));
  const toHq: Reported = {
    kills: Math.round(reported.kills * (1 + e * 0.8)),
    damage: Object.fromEntries(Object.entries(reported.damage).map(([k, v]) => [k, Math.round((v ?? 0) * (1 + e * 0.8))])),
    sorties: reported.sorties,
    lost: reported.lost,
  };
  let trustDelta = 0;
  const failedKinds: Order['kind'][] = [];
  hqLines.push(`Returns submitted: ${toHq.kills} enemy aircraft destroyed${toHq.kills !== reported.kills ? ` (crews claimed ${reported.kills})` : ''}${Object.values(toHq.damage).length ? `, target damage ${Object.values(toHq.damage)[0]}%` : ''}.`);
  for (const o of side.orders) {
    if (o.done || o.failed) continue;
    // A strike order on a site we now hold is moot.
    if (o.kind === 'strike' && o.siteId && state.theater.sites.find((x) => x.id === o.siteId)?.owner === side.id) {
      o.done = true;
      hqLines.push(`Order rescinded: "${o.text}" The site is now in our hands.`);
      continue;
    }
    // Nor can the wing be held to a strike its bombers can no longer reach.
    const strikeSite = o.kind === 'strike' ? state.theater.sites.find((x) => x.id === o.siteId) : undefined;
    const reach = Math.max(0, ...side.squadrons.filter((q) => (q.kind === 'medium' || q.kind === 'heavy') && q.airframes.length > 0).map((q) => bomberRange(q.kind)));
    if (strikeSite && depthFor(state.theater.held0, side.id, strikeSite.sector) > reach) {
      o.done = true;
      hqLines.push(`Order rescinded: "${o.text}" The target is now beyond the reach of our bombers.`);
      continue;
    }
    if (o.kind === 'kills') o.amount -= toHq.kills;
    if (o.kind === 'strike' && o.siteId) {
      o.amount -= toHq.damage[o.siteId] ?? 0;
      // Photographs count: the damage they show since the order was set, whatever the crews could see.
      if (photo?.siteId === o.siteId && o.goal !== undefined && o.from !== undefined) {
        const shown = o.from - photo.condition;
        if (o.goal - shown < o.amount) {
          o.amount = o.goal - shown;
          if (o.amount <= 0) hqLines.push(`Photographs show the ${state.theater.sites.find((x) => x.id === o.siteId)?.name ?? 'target'} at ${photo.condition}%.`);
        }
      }
    }
    if (o.kind === 'sorties') o.amount -= toHq.sorties;
    // The Army knows where its own front line is: this one cannot be talked up.
    const advanced = o.kind === 'advance' && sectorOwner(state.theater, o.amount) === side.id;
    if (o.kind !== 'advance' ? o.amount <= 0 : advanced) {
      o.done = true;
      trustDelta += 8;
      hqLines.push(`Order fulfilled: "${o.text}" — noted with satisfaction.`);
    } else if (state.turn >= o.deadline && o.kind === 'strike' && unobserved && plan.raid?.siteId === o.siteId && !o.graced) {
      // The bombs went down but nobody saw where: HQ waits a week for photographs.
      o.graced = true;
      o.deadline++;
      hqLines.push(`"${o.text}" The results were not observed. HQ will wait one more week for photographic evidence.`);
    } else if (state.turn >= o.deadline) {
      o.failed = true;
      failedKinds.push(o.kind);
      trustDelta -= 7;
      hqLines.push(`Order NOT fulfilled: "${o.text}"`);
    }
  }
  // Claims impress less the more HQ already trusts the wing; and its confidence wears off unless orders are met.
  trustDelta += Math.min(4, toHq.kills * 0.3) * (side.trust > 80 ? 0.5 : 1);
  if (side.trust > 75 && trustDelta < 8) trustDelta -= 2;
  // Our own losses are counted by the Air Ministry, not by us: a bloody week costs confidence.
  // Measured against the wing's size: four lost from a gutted wing hurts more than from a full one.
  const strength = Math.max(8, side.squadrons.reduce((a, q) => a + q.airframes.length, 0) + reported.lost);
  const bloody = Math.max(0, reported.lost - Math.round(strength * 0.08));
  if (bloody > 0) {
    trustDelta -= bloody * 1.5;
    hqLines.push(`The Air Ministry notes the loss of ${reported.lost} aircraft this week. Losses on this scale will have to be justified by results.`);
  }
  // Inspection: HQ's own photo-recon may contradict an embellished report.
  if (e > 0.05) {
    const p = 0.08 + e * 0.35 + side.caught * 0.05;
    if (rng.chance(p)) {
      side.caught++;
      trustDelta -= 18 + 8 * side.caught;
      hqLines.push('Air Ministry photographic interpretation does not support your claims. A formal inquiry has been opened.');
      memo(side, state.turn + 1, 'reprimand', 'Discrepancy in returns', 'Your recent returns are inconsistent with independent reconnaissance. You will ensure that future returns reflect what was achieved, not what was hoped for. Form 1180 (Explanation of Discrepancy) is to be submitted in triplicate.');
    }
  }
  side.trust = Math.max(side.isAI ? 20 : 0, Math.min(100, Math.round(side.trust + trustDelta)));
  side.orders = side.orders.filter((o) => !o.done && !o.failed);
  if (side.orders.length === 0 || (side.orders.length < 2 && rng.chance(0.35))) {
    const o = newOrder(rng, state, side, failedKinds);
    if (o) {
      side.orders.push(o);
      memo(side, state.turn + 1, 'order', 'Operational directive', o.text);
    }
  }
  // Intelligence from above: optimistic, sometimes plain wrong.
  const enemyFighters = enemy.squadrons.filter((s) => s.kind === 'fighter').reduce((a, s) => a + s.airframes.length, 0);
  const propaganda = rng.range(0.55, 0.95);
  const hqEstimate = Math.round(enemyFighters * propaganda + rng.gauss(4));
  if (rng.chance(0.5)) {
    // HQ believes its own arithmetic: big claims make it think the enemy is finished.
    const claimed = state.archive.slice(-2).reduce((x, e) => x + e.reportedToHq[side.id], 0);
    const stale = claimed >= 12 && rng.chance(Math.min(0.5, claimed / 60));
    memo(side, state.turn + 1, 'intel', 'Intelligence summary', stale
      ? 'Enemy fighter strength is assessed as broken. Remaining units are poorly trained and short of fuel. Bomber crews may expect light opposition.'
      : `Air Intelligence estimates enemy fighter strength in this sector at approximately ${Math.max(4, hqEstimate)} aircraft. Morale among enemy aircrew is believed to be poor.`);
  }
  if (trustDelta >= 10) memo(side, state.turn + 1, 'commendation', 'Commendation', 'The Air Officer Commanding wishes to convey his appreciation for the wing\'s recent efforts.');
  if (side.trust < 25) memo(side, state.turn + 1, 'reprimand', 'Confidence in your command', 'The Air Council is reviewing the conduct of operations in your sector. Results are expected.');
  return toHq;
}

function crewLoss(s: SideState): number {
  return 1 - s.squadrons.reduce((x, q) => x + q.crews, 0) / 28;
}

/** Early-ending conditions that are about a commander, not a theater. */
function commandFailure(state: GameState): [Outcome, Outcome] | null {
  const [a, b] = state.sides;
  for (const s of state.sides) {
    const avgMorale = s.squadrons.length ? s.squadrons.reduce((x, q) => x + q.morale, 0) / s.squadrons.length : 0;
    s.lowMoraleTurns = avgMorale < 0.15 ? s.lowMoraleTurns + 1 : 0;
  }
  const lose = (s: SideState): Outcome | null => {
    const planes = s.squadrons.reduce((x, q) => x + q.airframes.length, 0);
    if (s.trust <= 0 && !s.isAI) return 'relieved';
    if (planes === 0 && s.resources.supplies < AIRCRAFT.fighter.cost && s.factory.queue.length === 0) return 'grounded';
    if (s.lowMoraleTurns >= 3) return 'mutiny';
    return null;
  };
  const la = lose(a);
  const lb = lose(b);
  if (la && lb) return [la, lb];
  if (la) return [la, 'victory'];
  if (lb) return ['victory', lb];
  return null;
}

/** The war's verdict once the last theater is decided. */
function warOutcome(state: GameState): [Outcome, Outcome] {
  const last = state.theaterResults[state.theaterResults.length - 1];
  if (last.decisive && last.winner !== null) {
    const w = last.winner;
    const res: [Outcome, Outcome] = ['collapse', 'collapse'];
    res[w] = crewLoss(state.sides[w]) > 0.6 ? 'pyrrhic' : 'victory';
    return res;
  }
  const score = state.theaterResults.reduce((a, r) => a + (r.winner === 0 ? 1 : r.winner === 1 ? -1 : 0), 0);
  if (score > 0) return [crewLoss(state.sides[0]) > 0.6 ? 'pyrrhic' : 'victory', 'defeat'];
  if (score < 0) return ['defeat', crewLoss(state.sides[1]) > 0.6 ? 'pyrrhic' : 'victory'];
  return ['stalemate', 'stalemate'];
}

/** Secondary objectives are judged on what the commander believes, and HQ may check later. */
function secondaryObjectives(rng: Rng, state: GameState, news: [string[], string[]]) {
  for (const o of state.theater.objectives) {
    const side = state.sides[o.side];
    const site = state.theater.sites.find((x) => x.id === o.siteId)!;
    const believed = side.perceived.sites[o.siteId] ?? 100;
    if (o.status === 'open') {
      const captured = site.owner === o.side;
      // Taken by the Army: its engineers report what state the works were in. Intact means no credit to the wing.
      if (captured && !site.takenWrecked) {
        o.status = 'overrun';
        news[o.side].push(`The Army has taken the ${site.name} intact. The secondary objective was to wreck it from the air: no credit to the wing.`);
        continue;
      }
      if (captured || believed <= 25) {
        const confirmed = captured || side.perceived.photographed.includes(o.siteId);
        o.status = confirmed ? 'confirmed' : 'claimed';
        o.claimedAt = site.condition;
        const r = o.reward;
        if (r.supplies) side.resources.supplies += r.supplies;
        if (r.trust) side.trust = Math.min(100, side.trust + r.trust);
        if (r.research && !side.research.includes(r.research)) side.research.push(r.research);
        const rewards = [r.supplies ? `${r.supplies} supplies` : '', r.trust ? 'the confidence of the Air Council' : '', r.research ? `priority delivery of ${RESEARCH.find((x) => x.id === r.research)?.name}` : ''].filter(Boolean).join(', ');
        news[o.side].push(`Secondary objective achieved${captured ? ': Army engineers confirm the works were wrecked before they arrived' : confirmed ? ' and confirmed' : ' (on crews\' reports)'}: ${site.name}. Awarded: ${rewards}.`);
      }
    } else if (o.status === 'claimed' && site.owner === o.side) {
      // The Army walks into the works and sees for itself.
      if (site.takenWrecked) o.status = 'confirmed';
      // Wrecked when we claimed it and rebuilt since: the engineers can see the fresh concrete.
      else if ((o.claimedAt ?? 100) <= 30) {
        o.status = 'confirmed';
        news[o.side].push(`The Army has taken the ${site.name}. It had been rebuilt, but the engineers confirm it was wrecked when the wing claimed it.`);
      } else {
        o.status = 'discredited';
        side.trust = Math.max(side.isAI ? 20 : 0, side.trust - 15);
        news[o.side].push(`The Army has taken the ${site.name} and found it in working order. Your claim to have destroyed it has been withdrawn.`);
        memo(side, state.turn + 1, 'reprimand', 'Objective not achieved', `Army engineers found the ${site.name} intact. The award made on the strength of your returns is noted against your record.`);
      }
    } else if (o.status === 'claimed' && site.owner !== o.side) {
      // Unconfirmed claims can come back to haunt a commander.
      if (side.perceived.photographed.includes(o.siteId) && (side.perceived.sites[o.siteId] ?? 0) <= 25) o.status = 'confirmed';
      else if (site.condition > 45 && (o.claimedAt ?? site.condition) > 30 && rng.chance(0.3)) {
        o.status = 'discredited';
        side.trust = Math.max(side.isAI ? 20 : 0, side.trust - 15);
        // The Ministry's photographs replace the crews' estimate.
        side.perceived.sites[o.siteId] = site.condition;
        if (!side.perceived.photographed.includes(o.siteId)) side.perceived.photographed.push(o.siteId);
        news[o.side].push(`Air Ministry reconnaissance shows the ${site.name} working normally. Your claim to have destroyed it has been withdrawn.`);
        memo(side, state.turn + 1, 'reprimand', 'Objective not achieved', `Photographs taken this week show the ${site.name} in full operation. The award made on the strength of your returns is noted against your record.`);
      }
    }
  }
}

export interface TurnResult {
  raids: [RaidResult | null, RaidResult | null];
  feints: [RaidResult | null, RaidResult | null];
}

/**
 * Resolve a full turn given both commanders' plans. Mutates state.
 */
export function resolveTurn(state: GameState, plans: [TurnPlan, TurnPlan]): TurnResult {
  const rng = new Rng(state.rng);
  const battle = rng.fork(`battle-${state.turn}`);
  const [s0, s1] = state.sides;
  const t = state.theater;
  // Squadrons ordered up with aircraft ready, to tell the commander if any of them never got off the ground.
  const ordered = ([0, 1] as SideId[]).map((id) => [...(plans[id].raid?.squadronIds ?? []), ...(plans[id].feint?.squadronIds ?? [])]
    .map((sid) => state.sides[id].squadrons.find((q) => q.id === sid))
    .filter((q): q is NonNullable<typeof q> => !!q && flyable(q).length > 0));
  const mods = theaterMods(state);
  // A choice of commanding officer not taken in its week lapses: the senior man keeps command.
  for (const sd of state.sides) for (const q of sd.squadrons) if (q.candidate && (q.candidateWeek ?? 0) <= state.turn) {
    delete q.candidate;
    delete q.candidateWeek;
  }

  // Pay for stores.
  for (const id of [0, 1] as SideId[]) {
    const c = planCost(state.sides[id], plans[id]);
    state.sides[id].resources.stores = Math.max(0, state.sides[id].resources.stores - c.stores);
  }

  const day = newDay(state.lethality);
  const other = (id: SideId) => (1 - id) as SideId;

  // 1. Feints go in first. The enemy controller may scramble reserve squadrons at them;
  //    patrols over the feint sector engage it as a matter of course.
  const feints: [RaidResult | null, RaidResult | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const f = plans[id].feint;
    if (!f || f.squadronIds.length === 0) continue;
    const defender = state.sides[other(id)];
    const dp = plans[other(id)];
    const radar = defender.research.includes('radar');
    // Controllers who have seen diversions recently are slower to take the bait.
    const bait = (radar ? 0.25 : 0.5) / (1 + defender.observed.feints);
    const drawnSquadrons = new Set(dp.defense.filter((sqId) => dp.cover[sqId] === f.sector || (dp.cover[sqId] === undefined && battle.chance(bait))));
    const drawn = gatherFliers(defender, dp.defense, () => 'defense', day).filter((x) => drawnSquadrons.has(x.sq.id) && x.af.kind === 'fighter' && x.alive && !x.committed);
    for (const x of drawn) x.committed = true;
    feints[id] = resolveRaid(battle, state, state.sides[id], defender, { target: 'feint', squadronIds: f.squadronIds }, dp, { day, feintSector: f.sector, onlyDefenders: drawn });
  }

  // 2. Main raids. Fighters sweeping the front also screen it: enemy close-support
  //    raids and sweeps over the front run into them.
  const sweepers = (id: SideId): Flier[] => {
    const r = plans[id].raid;
    return r?.target === 'sweep' ? gatherFliers(state.sides[id], r.squadronIds, () => 'raid', day).filter((f) => f.af.kind === 'fighter') : [];
  };
  const raids: [RaidResult | null, RaidResult | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const r = plans[id].raid;
    let screen: Flier[] = [];
    if (r && (r.target === 'support' || (r.target === 'sweep' && !day.metFront))) {
      screen = sweepers(other(id));
      if (r.target === 'sweep' && screen.length) day.metFront = true;
    }
    raids[id] = resolveRaid(battle, state, state.sides[id], state.sides[other(id)], r, plans[other(id)], { day, screen });
  }

  // 3. Recon: fighters patrolling the photographed sector may catch it.
  const recons: [ReturnType<typeof resolveRecon> | null, ReturnType<typeof resolveRecon> | null] = [null, null];
  for (const id of [0, 1] as SideId[]) {
    const p = plans[id];
    if (!p.recon) continue;
    const site = t.sites.find((x) => x.id === p.recon!.siteId);
    const ep = plans[other(id)];
    const patrols = site
      ? gatherFliers(state.sides[other(id)], ep.defense.filter((sqId) => ep.cover[sqId] === site.sector), () => 'defense', day).filter((f) => f.alive && f.available !== false && f.af.kind === 'fighter')
      : [];
    recons[id] = resolveRecon(battle, state.sides[id], state.sides[other(id)], p.recon.squadronId, day, patrols);
  }

  // 4. Landing.
  finishDay(battle, day);
  const allRecs = [...day.fliers.values()].map((f) => f.rec);
  const stayedDown: [string[], string[]] = [[], []];
  for (const id of [0, 1] as SideId[]) {
    for (const q of ordered[id]) if (!allRecs.some((r) => r.squadronId === q.id)) stayedDown[id].push(q.name);
  }

  // Damage (true). Strikes hit sites; close support pushes the front directly.
  const damageTaken: [Partial<Facilities>, Partial<Facilities>] = [{}, {}];
  const supportPush: [number, number] = [0, 0];
  for (const id of [0, 1] as SideId[]) {
    const r = raids[id];
    if (!r) continue;
    if (r.target === 'support') {
      // Crippled airfields and depots can't sustain an offensive over the front.
      const eff = facilityEffects(state.sides[id].facilities);
      const crippled = (eff.crippled.airfield ? 0.6 : 1) * (eff.crippled.fuel ? 0.75 : 1);
      supportPush[id] = (r.damage * mods.support * crippled) / (1 + 0.25 * state.sides[other(id)].observed.support);
    }
    else if (r.target !== 'sweep' && r.target !== 'feint') {
      const dealt = applyDamage(state, r.siteId, r.damage);
      damageTaken[(1 - id) as SideId][r.target] = dealt;
      r.damage = dealt;
    }
  }

  // Losses & morale.
  // Did last week's warnings come true?
  for (const id of [0, 1] as SideId[]) {
    const p = state.sides[id].perceived;
    if (!p.warning || p.warning.guess === undefined) continue;
    const actual = raids[other(id)];
    const bomb = actual && actual.target !== 'sweep' ? actual : null;
    const g = p.warning.guess;
    const right = g === null || g.target === 'sweep' ? !bomb : !!bomb && bomb.target === g.target && (bomb.siteId ?? null) === (g.siteId ?? null);
    p.warningRecord = [...(p.warningRecord ?? []), right].slice(-8);
  }
  const lossNews: [string[], string[]] = [[], []];
  for (const id of [0, 1] as SideId[]) {
    if (stayedDown[id].length) lossNews[id].push(`${stayedDown[id].join(' and ')} ${stayedDown[id].length > 1 ? 'were' : 'was'} ordered up but never took off.`);
  }
  for (const id of [0, 1] as SideId[]) {
    const n = state.sides[id].squadrons.reduce((a, q) => a + (day.grounded.get(q.id) ?? 0), 0);
    if (n > 0) lossNews[id].push(`Cratered runways kept ${n === 1 ? 'one of our aircraft' : `${n} of our aircraft`} on the ground (airfields at ${state.sides[id].facilities.airfield}%).`);
  }
  for (const id of [0, 1] as SideId[]) applyLosses(rng, state, state.sides[id], allRecs, lossNews[id]);
  // Commanding officers on the medical officer's rest: two weeks, then back, usually steadier.
  for (const id of [0, 1] as SideId[]) {
    for (const q of state.sides[id].squadrons) {
      const l = q.leader;
      if (!l.resting) continue;
      l.resting--;
      if (l.resting > 0) continue;
      delete l.resting;
      const name = `${l.rank} ${l.name}`;
      if (rng.chance(0.6)) {
        l.trait = 'steady';
        remember(l, state.turn, 'came back from rest a steadier man');
        lossNews[id].push(`${name} is back with ${q.name} after his rest. The squadron says he is his old self again, and steadier: "${TRAIT_INFO.steady.label}".`);
      } else {
        remember(l, state.turn, 'came back from rest, still shaken');
        lossNews[id].push(`${name} is back with ${q.name} after his rest. The medical officer is not satisfied: he is still a shaken man.`);
      }
    }
  }
  // Letters arriving this week: Red Cross news of men who were posted missing.
  for (const id of [0, 1] as SideId[]) {
    const sd = state.sides[id];
    const arriving = (sd.post ?? []).filter((p) => p.due <= state.turn + 1);
    sd.post = (sd.post ?? []).filter((p) => p.due > state.turn + 1);
    for (const p of arriving) {
      // The obituary names the man who leads the squadron now, if he is not missing himself.
      if (p.obit) {
        const now = sd.squadrons.find((q) => q.id === p.obit!.squadronId);
        p.body = obituary(p.obit.leader, p.obit.squadron, p.obit.week, p.obit.lastWords, now?.leader, (sd.usedLines ??= []));
      }
      // A leader who got back through the lines takes his squadron again.
      const back = p.returns && sd.squadrons.find((q) => q.id === p.returns!.squadronId);
      if (back && p.returns) {
        remember(p.returns.leader, state.turn, 'came back through the lines after being posted missing');
        remember(back.leader, state.turn, `handed the squadron back to ${p.returns.leader.name}`);
        lossNews[id].push(`${back.leader.rank} ${back.leader.name} hands ${back.name} back to ${p.returns.leader.rank} ${p.returns.leader.name} and returns to flying as a flight commander.`);
        back.leader = p.returns.leader;
        back.notables = [`Week ${state.turn}: ${p.returns.leader.rank} ${p.returns.leader.name} back through the lines; command handed back to him.`, ...back.notables.filter((n) => !n.includes(`${p.returns!.leader.name} missing;`))].slice(0, 5);
        // He may say his own sayings again.
        if (p.returns.leader.said) sd.usedLines = (sd.usedLines ?? []).filter((x) => x !== p.returns!.leader.said);
      }
      // The roll of the missing learns what became of them.
      const entry = p.serial ? sd.roll?.find((e) => e.serial === p.serial) : undefined;
      if (entry && p.fate) entry.fate = p.fate;
      memo(sd, state.turn + 1, 'notice', p.subject, p.body, p.from);
      lossNews[id].push(`${p.from}: ${p.body}`);
    }
  }

  // Pressure on the front moves on true results.
  const lost0 = allRecs.filter((r) => r.side === 0 && r.fate === 'lost').length;
  const lost1 = allRecs.filter((r) => r.side === 1 && r.fate === 'lost').length;
  const strat0 = raids[0] && raids[0].target !== 'support' ? raids[0].damage : 0;
  const strat1 = raids[1] && raids[1].target !== 'support' ? raids[1].damage : 0;
  syncFacilities(state);
  const parts = {
    air: (lost1 - lost0) * 2 + rng.gauss(3),
    // No single raid can move the front by more than SWING_CAP in a week.
    support: Math.min(SWING_CAP, supportPush[0] * 1.15) - Math.min(SWING_CAP, supportPush[1] * 1.15),
    strikes: Math.min(SWING_CAP, strat0 * 0.15) - Math.min(SWING_CAP, strat1 * 0.15),
    // Wrecked works keep telling at the front, week after week.
    works:
      (Math.min(120, s0.facilities.industry) - Math.min(120, s1.facilities.industry)) * 0.06 +
      (Math.min(120, s0.facilities.fuel) - Math.min(120, s1.facilities.fuel)) * 0.05 +
      (Math.min(120, s0.facilities.airfield) - Math.min(120, s1.facilities.airfield)) * 0.04,
    escalation: s1.isAI ? -0.8 * (act(state) - 1) : 0,
  };
  const delta = parts.air + parts.support + parts.strikes + parts.works + parts.escalation;
  const front0 = state.front;
  state.front = Math.round(state.front + delta);
  t.week++;
  const flew = (id: SideId) => !!(raids[id] || feints[id]) || plans[id].defense.length > 0;
  const news = applyPressure(state, [flew(0), flew(1)]);
  for (const id of [0, 1] as SideId[]) news[id].unshift(...lossNews[id]);
  // The Army warns a week ahead when a line is close to giving way, on either side.
  for (const id of [0, 1] as SideId[]) {
    // Only when a line first comes close to breaking, not every week it stays there.
    const f = id === 0 ? state.front : 0 - state.front;
    const f0 = id === 0 ? front0 : 0 - front0;
    const near = SECTOR_PRESSURE - 8;
    const names = theaterDef(state).sectors;
    // No "one more week" when there is no week left in the theater.
    if (t.week >= theaterDef(state).weeks) continue;
    if (f <= -near && f0 > -near) news[id].push(`Army liaison: the line at ${names[frontSector(t, other(id))] ?? 'the front'} is cracking. Another week like this one and it will give way.`);
    else if (f >= near && f0 < near) news[id].push(`Army liaison: the enemy line at ${names[frontSector(t, id)] ?? 'the front'} is wavering. One more good week could break it.`);
  }
  syncFacilities(state);

  // Debriefs.
  const debriefs: [ReturnType<typeof buildDebrief>, ReturnType<typeof buildDebrief>] = [null!, null!];
  const toHq: [Reported, Reported] = [null!, null!];
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    const enemy = state.sides[(1 - id) as SideId];
    const rc = recons[id];
    const reconSite = plans[id].recon ? t.sites.find((x) => x.id === plans[id].recon!.siteId) : undefined;
    let reconResult: { siteId: string; condition: number } | null = null;
    if (rc?.ok && reconSite) {
      if (state.weather === 'storm' && rng.chance(0.6)) news[id].push('Photo-reconnaissance returned, but the target was hidden by cloud.');
      else reconResult = { siteId: reconSite.id, condition: Math.max(0, Math.min(100, Math.round(reconSite.condition + rng.gauss(2)))) };
    }
    if (rc?.intercepted && rc.ok) news[id].push('The photo-reconnaissance aircraft was jumped by fighters over the target and only just got home.');
    const d = buildDebrief(rng, state.turn, side, enemy,
      [raids[id], feints[id]].filter((x): x is RaidResult => !!x),
      [raids[other(id)], feints[other(id)]].filter((x): x is RaidResult => !!x),
      allRecs, reconResult, !!rc && !rc.ok, damageTaken[id], day.landing, theaterDef(state).sectors, state.seed);
    d.pressure = pressureLedger(parts, id === 0 ? 1 : -1, !!(raids[0]?.target === 'support' || raids[1]?.target === 'support'));
    updatePerceived(rng, side, d, raids[id]);
    // Army liaison: honest about towns, optimistic about pressure.
    // Army liaison: optimistic, but steady from week to week, so its figure and its words agree.
    side.perceived.front = Math.round(state.front * (id === 0 ? 1 : -1) + 4 + rng.gauss(1)) || 0;
    // An Intelligence Section cross-checks the Army's figures and can put the line within a band.
    if (side.research.includes('intelOfficer')) {
      const f = (id === 0 ? state.front : 0 - state.front) + rng.int(-2, 2);
      const lo = 3 * Math.floor((f - 2) / 3);
      side.perceived.frontBand = [lo, lo + 6];
    } else delete side.perceived.frontBand;
    // Group Intelligence will not credit our defenders with more aircraft than the observers saw.
    const defClaims = d.reports.filter((r) => r.role === 'defense').reduce((a, r) => a + r.claims, 0);
    const credit = Math.min(defClaims, d.enemySeen ?? defClaims);
    if (credit < defClaims) d.hqResponse.push(`Group Intelligence credits our fighters with ${credit} of the ${defClaims} they claimed: the observers counted no more than ${d.enemySeen} enemy aircraft over our side.`);
    const reported: Reported = {
      kills: d.reports.filter((r) => r.role !== 'defense').reduce((a, r) => a + r.claims, 0) + credit,
      damage: {},
      sorties: d.reports.reduce((a, r) => a + r.sent, 0),
      lost: d.missing.length + d.returned.filter((r) => r.fate === 'crashed').length,
    };
    const sid = raids[id]?.siteId;
    // The squadrons' estimates of the same target are averaged, not added.
    const estimates = d.reports.filter((r) => r.targetDamageReported !== null).map((r) => r.targetDamageReported ?? 0);
    if (sid && estimates.length) reported.damage[sid] = Math.min(100, Math.round(estimates.reduce((a, b) => a + b, 0) / estimates.length));
    const unobserved = !!sid && raids[id]?.siteId === sid && estimates.length === 0;
    toHq[id] = highCommand(rng, state, side, enemy, reported, plans[id], d.hqResponse, reconResult, unobserved);
    debriefs[id] = d;
  }
  secondaryObjectives(rng, state, news);
  // Station life, from each side's own airfield.
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    const flying = new Set([...(plans[id].raid?.squadronIds ?? []), ...plans[id].defense, ...(plans[id].feint?.squadronIds ?? []), plans[id].recon?.squadronId]);
    const rested = side.squadrons.filter((q) => !flying.has(q.id) && q.airframes.length > 0);
    if (!side.isAI) debriefs[id].station = stationLife(rng.fork(`station-${id}-${state.turn}`), state, side, rested, !raids[id] && !feints[id]);
  }
  // Squadron leaders bring their requests to the commander (the AI runs its own wing).
  for (const id of [0, 1] as SideId[]) {
    const side = state.sides[id];
    side.requests = side.isAI ? [] : generateRequests(rng, state, side, debriefs[id]);
  }
  // Each side remembers what it saw the enemy do (observers, the Army). Memory fades.
  for (const id of [0, 1] as SideId[]) {
    const o = state.sides[id].observed;
    o.feints = o.feints * 0.6 + (feints[other(id)] ? 1 : 0);
    const before = o.support;
    o.support = o.support * 0.6 + (raids[other(id)]?.target === 'support' ? 1 : 0);
    // The side flying close support hears, in words, that the enemy has started to read it.
    if (before < 1.4 && o.support >= 1.4) news[other(id)].push('Army liaison: the enemy has got used to our close support. More flak over the line, positions dug deeper. Each raid like it will tell a little less until we vary our approach.');
  }

  // Archive the truth.
  const hitsOf = (side: SideId, lost: boolean): Hit[] =>
    allRecs
      .filter((r) => r.side === side && (lost ? r.fate === 'lost' : r.fate !== 'lost'))
      .flatMap((r) => r.hits.map((h) => ({ ...h, kind: r.kind })));
  const crashed = (side: SideId) => allRecs.filter((r) => r.side === side && r.fate === 'crashed').length;
  const entry: ArchiveEntry = {
    turn: state.turn,
    // Aircraft written off on landing are losses too, though the enemy can't claim them.
    trueLosses: [lost0 + crashed(0), lost1 + crashed(1)],
    trueKills: [lost1, lost0],
    claimed: [debriefs[0].reports.reduce((a, r) => a + r.claims, 0), debriefs[1].reports.reduce((a, r) => a + r.claims, 0)],
    reportedToHq: [toHq[0].kills, toHq[1].kills],
    facilities: [{ ...s0.facilities }, { ...s1.facilities }],
    theater: t.index,
    sectors0: t.held0,
    front: state.front,
    lostHits: [hitsOf(0, true), hitsOf(1, true)],
    survivorHits: [hitsOf(0, false), hitsOf(1, false)],
  };
  state.archive.push(entry);

  for (const id of [0, 1] as SideId[]) economy(rng, state, state.sides[id]);
  syncFacilities(state);

  // Has the theater been decided?
  const decision = theaterDecision(state);
  if (decision) {
    const def = theaterDef(state);
    state.theaterResults.push({ index: t.index, name: def.name, winner: decision.winner, weeks: t.week, decisive: decision.decisive, gain: t.held0 - t.start0 });
    for (const id of [0, 1] as SideId[]) {
      const side = state.sides[id];
      const won = decision.winner === id;
      const lostT = decision.winner !== null && !won;
      news[id].push(
        won ? `${def.name}: VICTORY. ${decision.decisive ? 'The enemy front has broken.' : 'We hold the advantage as the campaign season ends.'}`
        : lostT ? `${def.name}: DEFEAT. ${decision.decisive ? 'Our front has broken.' : 'The enemy holds the advantage as the season ends.'}`
        : (() => {
          // Where the line stood when the season ended, in the liaison's words, and what it costs.
          const ours = id === 0 ? state.front : 0 - state.front;
          const why = t.held0 === t.start0
            ? ours > 15 ? 'The pressure was ours at the end, but the Army never took a sector, and the Air Council counts sectors.'
              : ours < -15 ? 'The enemy pressed hard at the end, but took no sector either.'
              : 'Neither side came close to breaking the line.'
            : (t.held0 - t.start0) * (id === 0 ? 1 : -1) > 0 ? 'We took ground, but the advantage was no longer ours when the season ended.'
            : 'The enemy took ground, but could not keep the advantage to the end.';
          return `${def.name}: the campaign ends in stalemate. ${why} The Air Council's confidence in the wing falls.`;
        })(),
      );
      // A stalemate is a disappointment too: the Air Council wanted ground.
      side.trust = Math.max(side.isAI ? 20 : 0, Math.min(100, side.trust + (won ? 15 : lostT ? -12 : -6)));
      if (won) side.resources.supplies += 100;
    }
    if (t.index + 1 < THEATERS.length) {
      const next = THEATERS[t.index + 1];
      for (const id of [0, 1] as SideId[]) news[id].push(`The wing is redeploying to ${next.name}.`);
      enterTheater(state, t.index + 1, rng, decision.winner);
      for (const id of [0, 1] as SideId[]) reinforce(rng, state, state.sides[id], news[id]);
      // Orders from the old theater lapse; High Command issues fresh ones.
      for (const side of state.sides) {
        side.memos = side.memos.filter((m) => !(m.turn === state.turn + 1 && m.kind === 'order' && m.subject === 'Operational directive'));
        side.orders = [];
        const o = newOrder(rng, state, side);
        if (o) {
          side.orders.push(o);
          memo(side, state.turn + 1, 'order', 'Operational directive', o.text);
        }
      }
    } else {
      state.outcome = warOutcome(state);
    }
  }
  for (const id of [0, 1] as SideId[]) debriefs[id].theaterNews.push(...news[id]);
  state.lastDebriefs = debriefs;
  if (!state.outcome) state.outcome = commandFailure(state);
  if (!decision) rollWeather(state, rng);
  state.rng = rng.state;
  if (!state.outcome) intelligenceWarnings(state, raids);
  state.sealed = [null, null];
  if (!state.outcome) state.turn++;
  return { raids, feints };
}
