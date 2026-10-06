/**
 * Squadron leaders' requests: how the game teaches doctrine, tactics, QC and
 * training. Each week a leader may ask for something, in character, prompted by
 * what his squadron just went through. Approving applies it in one click. The
 * advice is only as good as the leader: some of it is the survivorship trap.
 */
import { AIRCRAFT, REQUEST_SHORT, ZONE_LABEL } from './data';
import { remember } from './leaders';
import { COSTS, setApproach } from './actions';
import type { Rng } from './rng';
import type { Archetype, Debrief, GameState, LeaderRequest, RequestKind, SideState, Squadron, TurnPlan, ZoneId } from './types';
import { ZONES } from './types';

/** How likely each character is to ask for each thing. */
const LEANING: Record<Archetype, Partial<Record<RequestKind, number>>> = {
  braggart: { pressHome: 2, headOn: 1.5, rest: 0.5, breakOffSooner: 0.3, plateTheHoles: 0.8 },
  pessimist: { breakOffSooner: 2, plateTheHoles: 2, rest: 1.5, higher: 1.5, pressHome: 0 },
  gloryHunter: { pressHome: 2.5, headOn: 2, rest: 0.4, breakOffSooner: 0.2, higher: 0.5 },
  byTheBook: { strictQc: 2, reporting: 2, plateTheHoles: 1.6, tighterBox: 1.5, gunnery: 1.2 },
  timid: { higher: 2, rest: 2, breakOffSooner: 1.8, tighterBox: 1.3, pressHome: 0, headOn: 0.3 },
};

const who = (sq: Squadron) => `${sq.leader.rank} ${sq.leader.name} (${sq.name})`;

/** Each leader puts a request in his own words, and not the same words every time he asks. */
function vary(sq: Squadron, kind: RequestKind, words: string[]): string {
  const seed = [...sq.leader.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 11);
  const asked = (sq.leader.log ?? []).filter((e) => e.kind === kind).length;
  return words[(seed + asked) % words.length];
}

export function generateRequests(rng: Rng, state: GameState, side: SideState, d: Debrief): LeaderRequest[] {
  const candidates: (LeaderRequest & { weight: number })[] = [];
  const add = (sq: Squadron, kind: RequestKind, base: number, req: Omit<LeaderRequest, 'id' | 'squadronId' | 'kind'>) =>
    candidates.push({ ...req, id: '', squadronId: sq.id, kind, weight: base * (LEANING[sq.leader.archetype][kind] ?? 1) });

  for (const sq of side.squadrons) {
    // Recon pilots fly alone and unarmed; they have no doctrine or tactics to argue about.
    if (sq.kind === 'recon') continue;
    // A CO on rest leaves the squadron's business to his deputy.
    if (sq.leader.resting) continue;
    const recs = [...d.returned.filter((r) => r.squadronId === sq.id)];
    const lost = d.missing.filter((m) => m.squadronId === sq.id).length;
    const sent = recs.length + lost;
    const bomber = sq.kind === 'medium' || sq.kind === 'heavy';
    const L = who(sq);

    if (sq.fatigue >= 0.7) {
      add(sq, 'rest', 1.2, { text: `${L} requests a week's stand-down. ${vary(sq, 'rest', ['"The boys are dead on their feet, sir."', '"They\'re falling asleep in the crew room between briefings."', '"Give them a week and they\'ll fly for you again. Not before."', '"Two of my pilots were sick before take-off this morning, sir."'])}`, effect: 'The squadron stands down this week: fatigue falls, morale recovers.', cost: 0 });
    }
    if (bomber && lost > 0 && sq.doctrine.formation < 0.8) {
      add(sq, 'tighterBox', 1, { text: `${L} asks to fly a tighter box. ${vary(sq, 'tighterBox', [`"We lost ${lost} who straggled. Close up and the gunners cover each other."`, `"The ones they pick off are the ones who drift. ${lost} this week."`, '"Wingtip to wingtip, sir. It\'s the only thing that works."'])}`, effect: 'Formation +0.25: more defensive fire and fewer stragglers picked off.', cost: 0 });
    }
    if (bomber && recs.length) {
      const flak = recs.reduce((a, r) => a + r.hits.filter((h) => h.approach === 'flak').length, 0) / recs.length;
      if (flak >= 1.2 && sq.doctrine.altitude < 0.85) {
        add(sq, 'higher', 1, { text: `${L} asks to bomb from higher up. ${vary(sq, 'higher', ['"The flak was murderous at that height."', '"Another two thousand feet and their guns can\'t reach us half as well."', '"We came back with holes you could put your fist through. All flak."'])}`, effect: 'Altitude +0.2: less flak, but bombs fall less accurately.', cost: 0 });
      }
    }
    if (sent > 0 && lost / sent >= 0.3 && sq.doctrine.breakOff > 0.25) {
      add(sq, 'breakOffSooner', 1, { text: `${L} asks for authority to turn back sooner when losses mount. ${vary(sq, 'breakOffSooner', ['"No target is worth the whole squadron, sir."', '"When it goes wrong, let me bring the rest home."', '"I\'d rather fly it again next week with the crews I\'ve got."'])}`, effect: 'Break off at 15% fewer losses: fewer crews lost, more raids abandoned short of the target.', cost: 0 });
    }
    if (lost === 0 && sent > 0 && sq.doctrine.aggression < 0.85) {
      add(sq, 'pressHome', 0.5, { text: `${L}: ${vary(sq, 'pressHome', ['"We\'re holding back, sir. Let us press our attacks home."', '"We\'re bombing from too far out. Let us go in properly."', '"The boys are ready to go in harder. Let them."'])}`, effect: 'Aggression +0.2: more hits on the enemy, and more exposure for our crews.', cost: 0 });
    }
    if (sq.kind === 'fighter' && side.approach.tail > 0.45) {
      const hitByGunners = recs.filter((r) => r.role === 'defense' && r.hits.length > 0).length + lost;
      if (hitByGunners >= 2) {
        add(sq, 'headOn', 1, { text: `${L} wants to try head-on attacks. ${vary(sq, 'headOn', ['"Their tail gunners are murdering us coming in from astern."', '"From behind we fly straight into every gun they\'ve got."', '"Head-on, they\'ve only the nose guns. And the nerve to hold course."'])}`, effect: 'Interceptor tactics shift 20% from astern to head-on: fewer guns facing our fighters, a briefer firing pass.', cost: 0 });
      }
    }
    if (sq.skill < 0.45 && side.training.focus !== 'gunnery' && sent > 0) {
      add(sq, 'gunnery', 0.5, { text: `${L} asks the training school to put more weight on gunnery. ${vary(sq, 'gunnery', ['"The new boys can\'t hit a barn."', '"They come to us having fired at a drogue twice."', '"Half of them shoot at the right range by luck."'])}`, effect: 'Training syllabus switches to gunnery: graduates arrive more skilled.', cost: 0 });
    }
    if (side.training.focus !== 'reporting' && sq.leader.archetype === 'byTheBook' && sent > 0) {
      add(sq, 'reporting', 0.25, { text: `${L} asks the school to drill observation and reporting. "Half the claims in this wing are wishful thinking."`, effect: 'Training syllabus switches to reporting: debriefs grow more accurate, graduates fight a little worse.', cost: 0 });
    }
    // The classic advice: put the plate where the holes are.
    if (bomber && recs.length >= 2) {
      const holes: Partial<Record<ZoneId, number>> = {};
      for (const r of recs) for (const h of r.hits) holes[h.zone] = (holes[h.zone] ?? 0) + 1;
      const worst = (Object.entries(holes) as [ZoneId, number][]).sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] >= 3 && sq.armor[worst[0]] < 3) {
        const used = ZONES.reduce((a, z) => a + sq.armor[z], 0);
        const full = used >= AIRCRAFT[sq.kind].armorBudget;
        // If the budget is full, the plate comes off the zone with the fewest holes.
        const from = full ? ZONES.filter((z) => sq.armor[z] > 0 && z !== worst[0]).sort((a, b) => (holes[a] ?? 0) - (holes[b] ?? 0))[0] : undefined;
        if (!full || from) {
          add(sq, 'plateTheHoles', 0.55, {
            text: `${L} asks for more plate on the ${ZONE_LABEL[worst[0]].toLowerCase()}. ${vary(sq, 'plateTheHoles', [`"That's where we keep getting hit, sir. ${worst[1]} holes there this week alone."`, `"The riggers counted ${worst[1]} holes there. Stands to reason, sir."`, `"${worst[1]} patches on the ${ZONE_LABEL[worst[0]].toLowerCase()} this week. Armour it and we'll stop worrying."`])}`,
            effect: `One plate fitted to the ${ZONE_LABEL[worst[0]].toLowerCase()}${from ? `, taken from the ${ZONE_LABEL[from].toLowerCase()}` : ''}.`,
            cost: COSTS.armorChange,
            zone: worst[0],
            from,
          });
        }
      }
    }
  }
  const mechanical = d.returned.filter((r) => r.mechanical).length;
  if (mechanical >= 2 && side.factory.qc !== 'strict') {
    const sq = side.squadrons.find((q) => d.returned.some((r) => r.squadronId === q.id && r.mechanical)) ?? side.squadrons[0];
    add(sq, 'strictQc', 1.2, { text: `${who(sq)}: "${mechanical} aircraft turned back with faults this week. Ask the works to tighten up their inspections, sir."`, effect: 'Quality control set to strict: far fewer faulty aircraft, slower production.', cost: 0 });
  }

  // Up to two requests a week, from different squadrons and of different kinds, chosen by weight.
  const out: LeaderRequest[] = [];
  // A leader who raised something recently won't raise it again for a few weeks.
  const pool = candidates.filter((c) => {
    const last = side.squadrons.find((q) => q.id === c.squadronId)?.asked?.[c.kind];
    return c.weight > 0 && (last === undefined || state.turn - last >= 4);
  });
  for (let i = 0; i < 2 && pool.length; i++) {
    if (!rng.chance(i === 0 ? 0.85 : 0.5)) break;
    const w: Record<string, number> = {};
    pool.forEach((c, k) => (w[k] = c.weight));
    const k = Number(rng.weighted(w));
    const [pick] = pool.splice(k, 1);
    const { weight: _w, ...req } = pick;
    out.push({ ...req, id: `r${state.nextId++}`, n: out.length + 1, week: state.turn + 1 });
    const sq = side.squadrons.find((q) => q.id === pick.squadronId)!;
    sq.asked = { ...sq.asked, [pick.kind]: state.turn };
    for (let j = pool.length - 1; j >= 0; j--) if (pool[j].squadronId === pick.squadronId || pool[j].kind === pick.kind) pool.splice(j, 1);
  }
  return out;
}

/** Approve a request: apply it to the side (and this week's plan, for rest). */
export function approveRequest(side: SideState, id: string, plan?: TurnPlan): { ok: true } | { ok: false; reason: string } {
  const req = side.requests.find((r) => r.id === id);
  if (!req) return { ok: false, reason: 'That request is no longer on the desk' };
  const sq = side.squadrons.find((q) => q.id === req.squadronId);
  if (!sq) return { ok: false, reason: 'That squadron no longer exists' };
  if (side.resources.supplies < req.cost) return { ok: false, reason: 'Not enough supplies' };
  const d = sq.doctrine;
  switch (req.kind) {
    case 'rest':
      if (plan) {
        // Stand down for one week; next week the squadron returns to the duties it had.
        const r = plan.raid?.squadronIds.includes(sq.id) ?? false;
        const f = plan.feint?.squadronIds.includes(sq.id) ?? false;
        const def = plan.defense.includes(sq.id);
        if (r || f || def) plan.rested = [...(plan.rested ?? []), { id: sq.id, raid: r, feint: f, defense: def, cover: plan.cover[sq.id] }];
        plan.defense = plan.defense.filter((x) => x !== sq.id);
        delete plan.cover[sq.id];
        if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.filter((x) => x !== sq.id);
        if (plan.feint) plan.feint.squadronIds = plan.feint.squadronIds.filter((x) => x !== sq.id);
        if (plan.feint && plan.feint.squadronIds.length === 0) plan.feint = null;
      }
      break;
    case 'tighterBox': d.formation = Math.min(1, d.formation + 0.25); break;
    case 'higher': d.altitude = Math.min(1, d.altitude + 0.2); break;
    case 'breakOffSooner': d.breakOff = Math.max(0.1, d.breakOff - 0.15); break;
    case 'pressHome': d.aggression = Math.min(1, d.aggression + 0.2); break;
    case 'headOn': {
      const a = side.approach;
      const shift = Math.min(0.2, a.tail);
      setApproach(side, { tail: a.tail - shift, headOn: a.headOn + shift, beam: a.beam });
      break;
    }
    case 'gunnery': side.training.focus = 'gunnery'; break;
    case 'reporting': side.training.focus = 'reporting'; break;
    case 'strictQc': side.factory.qc = 'strict'; break;
    case 'plateTheHoles':
      if (req.from) sq.armor[req.from] = Math.max(0, sq.armor[req.from] - 1);
      if (req.zone) sq.armor[req.zone] = Math.min(3, sq.armor[req.zone] + 1);
      break;
  }
  side.resources.supplies -= req.cost;
  sq.morale = Math.min(1, sq.morale + 0.03);
  remember(sq.leader, req.week ?? 0, `asked ${REQUEST_SHORT[req.kind]}, and you agreed`, req.kind, true);
  side.requests = side.requests.filter((r) => r.id !== id);
  return { ok: true };
}

export function declineRequest(side: SideState, id: string) {
  const req = side.requests.find((r) => r.id === id);
  if (!req) return;
  const sq = side.squadrons.find((q) => q.id === req.squadronId);
  if (sq) {
    sq.morale = Math.max(0, sq.morale - 0.01);
    remember(sq.leader, req.week ?? 0, `asked ${REQUEST_SHORT[req.kind]}, and you said no`, req.kind, false);
  }
  side.requests = side.requests.filter((r) => r.id !== id);
}
