import { describe, expect, it } from 'vitest';
import {
  aiPlan,
  applyCommands,
  redactFor,
  type Command,
  approveRequest,
  carryPlan,
  crewShortfall,
  facilityEffects,
  fitPlanToStores,
  planCost,
  theaterDecision,
  HEAD_START,
  gatherFliers,
  newDay,
  resolveRecon,
  resolveTurn,
  applyPressure,
  depthFor,
  reachableSites,
  SECTOR_PRESSURE,
  THEATERS,
  chooseArmor,
  deserialize,
  emptyPlan,
  endTurnSingle,
  resolveRaid,
  Rng,
  serialize,
  setArmor,
  startCampaign,
  validatePlan,
  ZONES,
  type GameState,
  type TurnPlan,
  type ZoneId,
} from '../src/core';

function playerPlan(state: GameState): TurnPlan {
  const side = state.sides[0];
  const fighters = side.squadrons.filter((s) => s.kind === 'fighter');
  const bombers = side.squadrons.filter((s) => s.kind !== 'fighter' && s.kind !== 'recon');
  const site = reachableSites(state, 0, 'medium')[0];
  const plan: TurnPlan = {
    raid: site
      ? { target: site.type, siteId: site.id, squadronIds: [...bombers.map((s) => s.id), fighters[1]?.id].filter(Boolean) as string[] }
      : { target: 'support', squadronIds: bombers.map((s) => s.id) },
    defense: fighters[0] ? [fighters[0].id] : [],
    cover: {},
    recon: null,
    feint: null,
    embellish: 0,
  };
  let guard = 0;
  while (!validatePlan(side, plan, state).ok && guard++ < 10) {
    if (plan.raid && plan.raid.squadronIds.length > 1) plan.raid.squadronIds.pop();
    else plan.raid = null;
  }
  return plan;
}

describe('rng', () => {
  it('is deterministic', () => {
    const a = Rng.fromSeed('x');
    const b = Rng.fromSeed('x');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('campaign', () => {
  it('runs a full campaign deterministically', () => {
    const run = () => {
      const s = startCampaign({ seed: 'det' });
      while (!s.outcome) endTurnSingle(s, playerPlan(s));
      return s;
    };
    const a = run();
    const b = run();
    expect(a.outcome).not.toBeNull();
    expect(serialize(a)).toBe(serialize(b));
    expect(a.archive.length).toBeGreaterThan(0);
  });

  it('survives a save/load round trip mid-campaign', () => {
    const s = startCampaign({ seed: 'save' });
    for (let i = 0; i < 5 && !s.outcome; i++) endTurnSingle(s, playerPlan(s));
    const copy = deserialize(serialize(s));
    endTurnSingle(s, playerPlan(s));
    endTurnSingle(copy, playerPlan(copy));
    expect(serialize(copy)).toBe(serialize(s));
  });

  it('rejects garbage saves', () => {
    expect(() => deserialize('{"a":1}')).toThrow();
  });

  it('debriefs never contain hits from lost aircraft', () => {
    const s = startCampaign({ seed: 'debrief' });
    for (let i = 0; i < 6 && !s.outcome; i++) {
      endTurnSingle(s, playerPlan(s));
      const d = s.lastDebriefs[0]!;
      expect(d.returned.every((r) => r.fate !== 'lost')).toBe(true);
      expect(Object.keys(d.missing[0] ?? {})).not.toContain('hits');
    }
  });
});

describe('survivorship bias', () => {
  it('survivor damage is concentrated in low-lethality zones (for each campaign\'s own profile)', () => {
    // Count, per campaign, how many fatal hits and survivor holes fall in that campaign's deadly zones.
    let fatalDeadly = 0, fatalAll = 0, survDeadly = 0, survAll = 0;
    for (let g = 0; g < 8; g++) {
      const s = startCampaign({ seed: `wald${g}` });
      for (let i = 0; i < 8 && !s.outcome; i++) endTurnSingle(s, playerPlan(s));
      for (const kind of ['medium', 'fighter'] as const) {
        const leth = s.lethality[kind];
        const deadly = new Set(ZONES.filter((z) => leth[z] >= 0.1));
        for (const e of s.archive) {
          for (const h of e.lostHits[0].filter((x) => x.lethal && x.kind === kind)) { fatalAll++; if (deadly.has(h.zone)) fatalDeadly++; }
          for (const h of e.survivorHits[0].filter((x) => x.kind === kind)) { survAll++; if (deadly.has(h.zone)) survDeadly++; }
        }
      }
    }
    // The hits that brought planes down are concentrated where survivors show few holes.
    expect(fatalDeadly / fatalAll).toBeGreaterThan((survDeadly / survAll) * 2);
  });

  it('rolls a different hidden profile for each aircraft type and campaign', () => {
    const a = startCampaign({ seed: 'prof-a' }).lethality;
    const b = startCampaign({ seed: 'prof-b' }).lethality;
    expect(a.medium).not.toEqual(a.heavy);
    expect(a.medium).not.toEqual(b.medium);
    expect(startCampaign({ seed: 'prof-a' }).lethality).toEqual(a);
    for (const k of ['fighter', 'medium', 'heavy', 'recon'] as const) {
      for (const z of ZONES) expect(a[k][z]).toBeGreaterThan(0);
      // Outer wings and fuselage are always forgiving.
      expect(a[k].outerWing).toBeLessThan(0.05);
      expect(a[k].fuselage).toBeLessThan(0.05);
    }
  });

  it('armoring where survivors are NOT hit beats armoring the holes', () => {
    const survival = (insight: number) => {
      let sent = 0;
      let lost = 0;
      for (let g = 0; g < 30; g++) {
        const s = startCampaign({ seed: `armor${g}` });
        const side = s.sides[0];
        // Learn from some sorties first.
        for (let i = 0; i < 3; i++) endTurnSingle(s, playerPlan(s));
        side.insight = insight;
        for (const sq of side.squadrons) sq.armor = chooseArmor(side, sq);
        const enemy = s.sides[1];
        // This test is about armor, not stores: let the enemy put up its full defence.
        enemy.resources.stores = 1000;
        const plan = playerPlan(s);
        const def = aiPlan(s, 1);
        // Several engagements per campaign, each from the same starting state.
        for (let k = 0; k < 4; k++) {
          const copy = JSON.parse(JSON.stringify(s)) as GameState;
          const r = resolveRaid(new Rng({ s: 1234 + g * 7 + k }), copy, copy.sides[0], copy.sides[1], plan.raid, def);
          if (!r) continue;
          const mine = r.planes.filter((p) => p.side === 0 && p.kind !== 'fighter');
          sent += mine.length;
          lost += mine.filter((p) => p.fate === 'lost').length;
        }
      }
      return 1 - lost / Math.max(1, sent);
    };
    const naive = survival(0);
    const wald = survival(1);
    expect(wald).toBeGreaterThan(naive);
  });
});

describe('actions', () => {
  it('enforces the armor budget', () => {
    const s = startCampaign({ seed: 'a' });
    const sq = s.sides[0].squadrons.find((q) => q.kind === 'fighter')!;
    for (const z of ZONES) sq.armor[z] = 0;
    expect(setArmor(s.sides[0], sq.id, 'cockpit', 3).ok).toBe(true);
    expect(setArmor(s.sides[0], sq.id, 'engines', 1).ok).toBe(false);
  });

  it('rejects a squadron that raids and defends', () => {
    const s = startCampaign({ seed: 'b' });
    const f = s.sides[0].squadrons[0];
    const plan = emptyPlan();
    plan.raid = { target: 'sweep', squadronIds: [f.id] };
    plan.defense = [f.id];
    expect(validatePlan(s.sides[0], plan).ok).toBe(false);
  });
});

describe('theaters', () => {
  it('starts in the first theater with symmetric sites', () => {
    const s = startCampaign({ seed: 't0' });
    expect(s.theater.index).toBe(0);
    const own = (side: 0 | 1) => s.theater.sites.filter((x) => x.owner === side).length;
    expect(own(0)).toBe(own(1));
    expect(s.sides[0].facilities.industry).toBe(100);
  });

  it('captures a sector and its facilities when pressure builds', () => {
    const s = startCampaign({ seed: 't1' });
    const before = s.theater.held0;
    const frontSites = s.theater.sites.filter((x) => x.sector === before);
    s.front = SECTOR_PRESSURE + 5;
    applyPressure(s);
    expect(s.theater.held0).toBe(before + 1);
    for (const x of frontSites) expect(x.owner).toBe(0);
    expect(s.front).toBe(5);
  });

  it('medium bombers cannot reach the enemy rear sector', () => {
    const s = startCampaign({ seed: 't2' });
    const rear = s.theater.sites.find((x) => x.owner === 1 && depthFor(s.theater.held0, 0, x.sector) === 3)!;
    const plan = playerPlan(s);
    plan.raid = { target: rear.type, siteId: rear.id, squadronIds: s.sides[0].squadrons.filter((q) => q.kind === 'medium').map((q) => q.id) };
    expect(validatePlan(s.sides[0], plan, s).ok).toBe(false);
    expect(reachableSites(s, 0, 'heavy').some((x) => x.id === rear.id)).toBe(true);
  });

  it('fighters patrolling the raided sector intercept more often than those patrolling elsewhere', () => {
    const count = (coverRight: boolean) => {
      let n = 0;
      for (let g = 0; g < 40; g++) {
        const s = startCampaign({ seed: `cov${g}` });
        const plan = playerPlan(s);
        const site = s.theater.sites.find((x) => x.id === plan.raid!.siteId)!;
        const def = aiPlan(s, 1);
        def.defense = s.sides[1].squadrons.filter((q) => q.kind === 'fighter').map((q) => q.id);
        def.cover = Object.fromEntries(def.defense.map((id) => [id, coverRight ? site.sector : 5]));
        const r = resolveRaid(new Rng({ s: 99 + g }), s, s.sides[0], s.sides[1], plan.raid, def);
        n += r?.interceptors ?? 0;
      }
      return n;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 2);
  });

  it('a campaign moves through more than one theater', () => {
    let maxTheater = 0;
    for (let g = 0; g < 6; g++) {
      const s = startCampaign({ seed: `prog${g}` });
      while (!s.outcome) endTurnSingle(s, playerPlan(s));
      maxTheater = Math.max(maxTheater, s.theaterResults.length);
      for (const r of s.theaterResults) expect(r.weeks).toBeLessThanOrEqual(THEATERS[r.index].weeks);
    }
    expect(maxTheater).toBeGreaterThan(1);
  });
});

describe('theater transitions', () => {
  it('orders after a theater change only name sites in the new theater', () => {
    for (let g = 0; g < 6; g++) {
      const s = startCampaign({ seed: `orders${g}` });
      while (!s.outcome && s.theater.index === 0) endTurnSingle(s, playerPlan(s));
      if (s.outcome) continue;
      for (const side of s.sides)
        for (const o of side.orders) if (o.siteId) expect(s.theater.sites.some((x) => x.id === o.siteId)).toBe(true);
    }
  });
});

describe('hotseat missions', () => {
  /** Defender holds every fighter squadron in reserve. */
  const reserveDefence = (s: GameState): TurnPlan => {
    const p = emptyPlan();
    p.defense = s.sides[1].squadrons.filter((q) => q.kind === 'fighter').map((q) => q.id);
    return p;
  };

  it('a feint draws reserve fighters away from the main raid', () => {
    const run = (withFeint: boolean) => {
      let met = 0;
      for (let g = 0; g < 40; g++) {
        const s = startCampaign({ seed: `feint${g}` });
        const plan = playerPlan(s);
        const fighters = s.sides[0].squadrons.filter((q) => q.kind === 'fighter');
        plan.raid!.squadronIds = plan.raid!.squadronIds.filter((id) => id !== fighters[1].id);
        const main = s.theater.sites.find((x) => x.id === plan.raid!.siteId)!.sector;
        plan.feint = withFeint ? { squadronIds: [fighters[1].id], sector: main === 3 ? 4 : 3 } : null;
        const r = resolveTurn(s, [plan, reserveDefence(s)]);
        met += r.raids[0]?.interceptors ?? 0;
      }
      return met;
    };
    expect(run(true)).toBeLessThan(run(false) * 0.85);
  });

  it('a feint over the main raid sector is rejected', () => {
    const s = startCampaign({ seed: 'feint-same' });
    const plan = playerPlan(s);
    const main = s.theater.sites.find((x) => x.id === plan.raid!.siteId)!.sector;
    const f = s.sides[0].squadrons.find((q) => q.kind === 'fighter' && !plan.raid!.squadronIds.includes(q.id) && !plan.defense.includes(q.id));
    plan.defense = [];
    plan.feint = { squadronIds: [f?.id ?? s.sides[0].squadrons[0].id], sector: main };
    expect(validatePlan(s.sides[0], plan, s).ok).toBe(false);
  });

  it('a fighter sweep screens the front against enemy close support', () => {
    let screened = 0;
    for (let g = 0; g < 20; g++) {
      const s = startCampaign({ seed: `screen${g}` });
      const attack = emptyPlan();
      attack.raid = { target: 'support', squadronIds: s.sides[0].squadrons.filter((q) => q.kind === 'medium').map((q) => q.id) };
      const def = emptyPlan();
      def.raid = { target: 'sweep', squadronIds: s.sides[1].squadrons.filter((q) => q.kind === 'fighter').map((q) => q.id) };
      const r = resolveTurn(s, [attack, def]);
      screened += r.raids[0]!.interceptors;
    }
    expect(screened).toBeGreaterThan(20 * 5);
  });

  it('every aircraft has exactly one record per day', () => {
    const s = startCampaign({ seed: 'unique' });
    const plan = playerPlan(s);
    const ai = aiPlan(s, 1);
    resolveTurn(s, [plan, ai]);
    for (const d of s.lastDebriefs) {
      const ids = [...d!.returned, ...d!.missing.map((m) => ({ airframeId: m.serial }))].map((r) => r.airframeId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('recon over a patrolled sector is intercepted more often', () => {
    const run = (patrolled: boolean) => {
      let jumped = 0;
      for (let g = 0; g < 60; g++) {
        const s = startCampaign({ seed: `recon${g}` });
        const site = s.theater.sites.find((x) => x.owner === 1)!;
        const fighters = s.sides[1].squadrons.filter((q) => q.kind === 'fighter');
        const day = newDay();
        const patrols = patrolled ? gatherFliers(s.sides[1], fighters.map((q) => q.id), () => 'defense', day) : [];
        s.sides[0].squadrons.push({ ...s.sides[0].squadrons[0], id: 'rc', kind: 'recon', airframes: [{ ...s.sides[0].squadrons[0].airframes[0], id: 'rcaf', kind: 'recon' }], crews: 1 });
        const r = resolveRecon(new Rng({ s: g }), s.sides[0], s.sides[1], 'rc', day, patrols);
        if (r.intercepted) jumped++;
        void site;
      }
      return jumped;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 2);
  });

  it('sealed hotseat orders survive a save and load', () => {
    const s = startCampaign({ seed: 'sealed', mode: 'hotseat', commanders: ['Cdre Ashworth', 'Oberst Voigt'] });
    s.sealed[0] = playerPlan(s);
    const copy = deserialize(serialize(s));
    expect(copy.sealed[0]).toEqual(s.sealed[0]);
    expect(copy.sides[1].commander).toBe('Oberst Voigt');
  });

  it('loads a version 2 save', () => {
    const s = startCampaign({ seed: 'v2' }) as unknown as Record<string, unknown>;
    const old = { ...s, version: 2 } as Record<string, unknown>;
    delete old.sealed;
    delete old.lethality;
    for (const side of old.sides as { resources: Record<string, number> }[]) {
      delete side.resources.stores;
      side.resources.fuel = 140;
      side.resources.munitions = 90;
    }
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.version).toBe(5);
    expect(loaded.sides[0].resources.stores).toBe(173);
    expect('fuel' in loaded.sides[0].resources).toBe(false);
    expect(loaded.lethality.medium.cockpit).toBeGreaterThan(0);
    expect(loaded.sealed).toEqual([null, null]);
  });
});

describe('names', () => {
  it('squadron leaders in a wing never share a first name or surname', () => {
    for (let g = 0; g < 30; g++) {
      const s = startCampaign({ seed: `names${g}` });
      for (const side of s.sides) {
        const names = side.squadrons.map((q) => q.leader.name.split(' '));
        expect(new Set(names.map((n) => n[0])).size).toBe(names.length);
        expect(new Set(names.map((n) => n.slice(1).join(' '))).size).toBe(names.length);
      }
    }
  });
});

describe('playtest fixes', () => {
  it('at most one sector falls per week', () => {
    const s = startCampaign({ seed: 'cascade' });
    const before = s.theater.held0;
    s.front = SECTOR_PRESSURE * 3;
    applyPressure(s);
    expect(s.theater.held0).toBe(before + 1);
    expect(Math.abs(s.front)).toBeLessThanOrEqual(SECTOR_PRESSURE / 2);
  });

  it('standing orders never fall due after the theater ends, and never duplicate', () => {
    for (let g = 0; g < 8; g++) {
      const s = startCampaign({ seed: `ord${g}` });
      while (!s.outcome) {
        endTurnSingle(s, playerPlan(s));
        if (s.outcome) break;
        const lastWeek = s.turn + (THEATERS[s.theater.index].weeks - s.theater.week) - 1;
        for (const side of s.sides) {
          const open = side.orders.filter((o) => !o.done && !o.failed);
          expect(new Set(open.map((o) => o.kind)).size).toBe(open.length);
          for (const o of open) expect(o.deadline).toBeLessThanOrEqual(lastWeek + 1);
        }
      }
    }
  });

  it('aircraft that abort with mechanical trouble are never shot down later that day', () => {
    for (let g = 0; g < 30; g++) {
      const s = startCampaign({ seed: `abort${g}` });
      for (const sq of s.sides[0].squadrons) for (const af of sq.airframes) af.defect = 0.9;
      const r = resolveTurn(s, [playerPlan(s), aiPlan(s, 1)]);
      for (const raid of [r.raids[0], r.feints[0]]) {
        if (!raid) continue;
        const abortedLines = raid.radio.filter((l) => /turning back|aborting|returning to base/.test(l.text)).map((l) => l.callsign);
        for (const cs of abortedLines) {
          expect(raid.radio.some((l) => l.text.startsWith(`${cs} is going down`) || l.text.startsWith(`${cs} has gone in`) || l.text.startsWith(`${cs} just blew up`))).toBe(false);
        }
      }
    }
  });

  it('single-seat fighters never radio about bombardiers or several engines', () => {
    for (let g = 0; g < 30; g++) {
      const s = startCampaign({ seed: `words${g}` });
      for (let w = 0; w < 4 && !s.outcome; w++) endTurnSingle(s, playerPlan(s));
      for (const d of s.lastDebriefs) {
        for (const m of d!.missing.filter((x) => x.kind === 'fighter')) {
          expect(m.lastWords ?? '').not.toMatch(/bombardier|Both engines|Number two|Skipper|Gunners/);
        }
      }
    }
  });

  it('armor records the hits it stopped', () => {
    let saved = 0;
    for (let g = 0; g < 20; g++) {
      const s = startCampaign({ seed: `saved${g}` });
      for (const sq of s.sides[0].squadrons) if (sq.kind === 'medium') { for (const z of ZONES) sq.armor[z] = 0; sq.armor.cockpit = 3; sq.armor.engines = 3; }
      endTurnSingle(s, playerPlan(s));
      saved += s.lastDebriefs[0]!.returned.flatMap((r) => r.hits).filter((h) => h.saved).length;
    }
    expect(saved).toBeGreaterThan(0);
  });
});

describe('leader requests', () => {
  it('leaders make requests for the human side only, and approving applies them', () => {
    const kinds = new Set<string>();
    let approved = 0;
    for (let g = 0; g < 10; g++) {
      const s = startCampaign({ seed: `req${g}` });
      for (let w = 0; w < 8 && !s.outcome; w++) {
        endTurnSingle(s, playerPlan(s));
        expect(s.sides[1].requests).toEqual([]);
        expect(s.sides[0].requests.length).toBeLessThanOrEqual(2);
        for (const r of [...s.sides[0].requests]) {
          kinds.add(r.kind);
          const sq = s.sides[0].squadrons.find((q) => q.id === r.squadronId)!;
          const before = JSON.stringify({ d: sq.doctrine, a: sq.armor, ap: s.sides[0].approach, t: s.sides[0].training.focus, q: s.sides[0].factory.qc });
          const plan = playerPlan(s);
          const res = approveRequest(s.sides[0], r.id, plan);
          if (!res.ok) continue;
          approved++;
          const after = JSON.stringify({ d: sq.doctrine, a: sq.armor, ap: s.sides[0].approach, t: s.sides[0].training.focus, q: s.sides[0].factory.qc });
          if (r.kind === 'rest') {
            expect(plan.raid?.squadronIds ?? []).not.toContain(sq.id);
            expect(plan.defense).not.toContain(sq.id);
          } else expect(after).not.toBe(before);
          expect(s.sides[0].requests.find((x) => x.id === r.id)).toBeUndefined();
        }
      }
    }
    expect(approved).toBeGreaterThan(5);
    expect(kinds.size).toBeGreaterThan(3);
  });

  it('the plate request moves armor towards where the holes are', () => {
    for (let g = 0; g < 30; g++) {
      const s = startCampaign({ seed: `plate${g}` });
      for (let w = 0; w < 6 && !s.outcome; w++) {
        endTurnSingle(s, playerPlan(s));
        const r = s.sides[0].requests.find((x) => x.kind === 'plateTheHoles');
        if (!r) continue;
        const sq = s.sides[0].squadrons.find((q) => q.id === r.squadronId)!;
        const before = sq.armor[r.zone!];
        expect(approveRequest(s.sides[0], r.id).ok).toBe(true);
        expect(sq.armor[r.zone!]).toBe(before + 1);
        return;
      }
    }
    throw new Error('no plate request seen in 30 campaigns');
  });
});

describe('LAN: redaction and command replay', () => {
  const played = () => {
    const s = startCampaign({ seed: 'lan', mode: 'lan' });
    for (let w = 0; w < 4 && !s.outcome; w++) resolveTurn(s, [playerPlan(s), aiPlan(s, 1)]);
    return s;
  };

  it('the joining player learns nothing about the enemy wing or the hidden truth', () => {
    const s = played();
    const v = redactFor(s, 1);
    const json = JSON.stringify(v);
    expect(v.sides[0].squadrons).toEqual([]);
    expect(v.sides[0].resources.supplies).toBe(0);
    for (const sq of s.sides[0].squadrons) for (const af of sq.airframes) expect(json).not.toContain(af.serial);
    for (const k of ['fighter', 'medium', 'heavy', 'recon'] as const) for (const z of ZONES) expect(v.lethality[k][z]).toBe(0);
    expect(v.rng.s).toBe(0);
    expect(v.lastDebriefs[0]).toBeNull();
    for (const site of v.theater.sites.filter((x) => x.owner === 0)) expect(site.condition).toBe(s.sides[1].perceived.sites[site.id] ?? 100);
    for (const e of v.archive) {
      expect(e.lostHits).toEqual([[], []]);
      expect(e.trueKills).toEqual([0, 0]);
      expect(e.survivorHits[0]).toEqual([]);
    }
    // Own side is intact.
    expect(v.sides[1]).toEqual(s.sides[1]);
  });

  it('at the end of the war the archives open', () => {
    const s = played();
    s.outcome = ['victory', 'defeat'];
    expect(redactFor(s, 1)).toEqual(JSON.parse(JSON.stringify(s)));
  });

  it('commands replayed on the host give exactly the joining player result', () => {
    const s = played();
    s.sides[1].resources.supplies = 1000;
    s.sides[1].researching = null;
    const client = redactFor(s, 1);
    const side = s.sides[1];
    const project = ['radar', 'selfSealing', 'photoRecon', 'radios'].find((r) => !side.research.includes(r))!;
    const sq = side.squadrons.find((q) => q.kind === 'medium')!;
    const free = ZONES.find((z) => sq.armor[z] > 0)!;
    const cmds: Command[] = [
      { k: 'armor', sq: sq.id, zone: free, value: sq.armor[free] - 1 },
      { k: 'armor', sq: sq.id, zone: 'cockpit', value: Math.min(3, sq.armor.cockpit + 1) },
      { k: 'doctrine', sq: sq.id, d: { formation: 0.9 } },
      { k: 'build', kind: 'fighter' },
      { k: 'research', id: project },
      { k: 'focus', v: 'gunnery' },
    ];
    const plan = playerPlan(s);
    expect(applyCommands(client, 1, cmds, plan).ok).toBe(true);
    expect(applyCommands(s, 1, cmds, plan).ok).toBe(true);
    expect(s.sides[1]).toEqual(client.sides[1]);
  });

  it('a command the host cannot apply is reported', () => {
    const s = played();
    s.sides[1].resources.supplies = 0;
    expect(applyCommands(s, 1, [{ k: 'build', kind: 'medium' }]).ok).toBe(false);
  });
});

describe('playtest round 2 fixes', () => {
  it('no sector falls in a week the winning side flew nothing', () => {
    const s = startCampaign({ seed: 'idle' });
    const before = s.theater.held0;
    s.front = SECTOR_PRESSURE + 5;
    applyPressure(s, [false, true]);
    expect(s.theater.held0).toBe(before);
    expect(s.front).toBe(SECTOR_PRESSURE - 1);
    applyPressure(s, [true, true]);
    expect(s.theater.held0).toBe(before);
    s.front = SECTOR_PRESSURE;
    applyPressure(s, [true, false]);
    expect(s.theater.held0).toBe(before + 1);
  });

  it('strike orders are never due in the week they are issued', () => {
    for (let g = 0; g < 8; g++) {
      const s = startCampaign({ seed: `lead${g}` });
      const seen = new Set<string>(s.sides[0].orders.map((o) => o.id));
      while (!s.outcome) {
        endTurnSingle(s, playerPlan(s));
        for (const o of s.sides[0].orders) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          if (o.kind === 'strike') expect(o.deadline).toBeGreaterThan(s.turn);
        }
      }
    }
  });

  it('a new theater opens with the head start visible to both sides', () => {
    for (let g = 0; g < 12; g++) {
      const s = startCampaign({ seed: `head${g}` });
      let index = 0;
      while (!s.outcome && s.theater.index === index) endTurnSingle(s, playerPlan(s));
      if (s.outcome) continue;
      if (s.theater.week !== 0) continue;
      expect(Math.abs(s.front)).toBeLessThanOrEqual(HEAD_START);
      expect(s.sides[0].perceived.front).toBe(s.front);
      expect(s.sides[1].perceived.front).toBe(0 - s.front);
      index++;
      return;
    }
  });

  it('a stand-down lasts one week, then the squadron returns to its duties', () => {
    const s = startCampaign({ seed: 'rest' });
    const plan = playerPlan(s);
    const sq = s.sides[0].squadrons.find((q) => plan.raid!.squadronIds.includes(q.id))!;
    s.sides[0].requests = [{ id: 'rx', n: 1, squadronId: sq.id, kind: 'rest', text: '', effect: '', cost: 0 }];
    expect(approveRequest(s.sides[0], 'rx', plan).ok).toBe(true);
    expect(plan.raid!.squadronIds).not.toContain(sq.id);
    endTurnSingle(s, plan);
    const next = carryPlan(s, 0, plan);
    expect(next.raid!.squadronIds).toContain(sq.id);
  });

  it('request numbers stay put and leaders do not repeat themselves for a few weeks', () => {
    for (let g = 0; g < 10; g++) {
      const s = startCampaign({ seed: `nag${g}` });
      const lastAsked = new Map<string, number>();
      for (let w = 0; w < 10 && !s.outcome; w++) {
        const week = s.turn;
        endTurnSingle(s, playerPlan(s));
        s.sides[0].requests.forEach((r, i) => expect(r.n).toBe(i + 1));
        for (const r of s.sides[0].requests) {
          expect(s.sides[0].squadrons.find((q) => q.id === r.squadronId)!.kind).not.toBe('recon');
          const key = `${r.squadronId}:${r.kind}`;
          const prev = lastAsked.get(key);
          if (prev !== undefined) expect(week - prev).toBeGreaterThanOrEqual(4);
          lastAsked.set(key, week);
        }
        s.sides[0].requests = [];
      }
    }
  });

  it('a strike needs at least one bomber squadron', () => {
    const s = startCampaign({ seed: 'nobomb' });
    const plan = playerPlan(s);
    plan.raid!.squadronIds = s.sides[0].squadrons.filter((q) => q.kind === 'fighter').slice(1, 2).map((q) => q.id);
    plan.defense = plan.defense.filter((id) => !plan.raid!.squadronIds.includes(id));
    const v = validatePlan(s.sides[0], plan, s);
    expect(v.ok).toBe(false);
  });

  it('the archive counts aircraft written off on landing as losses', () => {
    let checked = 0;
    for (let g = 0; g < 120 && checked < 2; g++) {
      const s = startCampaign({ seed: `wo${g}` });
      for (let w = 0; w < 6 && !s.outcome; w++) {
        endTurnSingle(s, playerPlan(s));
        const d = s.lastDebriefs[0]!;
        const crashed = d.returned.filter((r) => r.fate === 'crashed').length;
        if (crashed === 0) continue;
        expect(s.archive[s.archive.length - 1].trueLosses[0]).toBe(d.missing.length + crashed);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('designer decisions after round 2', () => {
  it('a timeout win needs at least one sector taken; otherwise it is a stalemate', () => {
    const s = startCampaign({ seed: 'stale' });
    s.theater.week = THEATERS[s.theater.index].weeks;
    s.front = 23;
    expect(theaterDecision(s)).toEqual({ winner: null, decisive: false });
    s.theater.held0 = s.theater.start0 + 1;
    expect(theaterDecision(s)).toEqual({ winner: 0, decisive: false });
    s.theater.held0 = s.theater.start0 - 1;
    s.front = -23;
    expect(theaterDecision(s)).toEqual({ winner: 1, decisive: false });
  });

  it('a secondary objective taken intact by the Army earns the wing nothing', () => {
    const s = startCampaign({ seed: 'overrun' });
    const o = s.theater.objectives.find((x) => x.side === 0)!;
    const site = s.theater.sites.find((x) => x.id === o.siteId)!;
    // March the front up to the objective's sector, with the site intact.
    while (s.theater.held0 <= site.sector && !s.outcome) {
      s.front = SECTOR_PRESSURE;
      applyPressure(s);
    }
    expect(site.owner).toBe(0);
    expect(site.takenWrecked).toBe(false);
    endTurnSingle(s, playerPlan(s));
    expect(o.status).toBe('overrun');
    expect(s.lastDebriefs[0]!.theaterNews.some((n) => n.includes('no credit'))).toBe(true);
  });

  it('a wrecked objective taken by the Army is confirmed', () => {
    const s = startCampaign({ seed: 'wrecked' });
    const o = s.theater.objectives.find((x) => x.side === 0)!;
    const site = s.theater.sites.find((x) => x.id === o.siteId)!;
    site.condition = 10;
    while (s.theater.held0 <= site.sector) {
      s.front = SECTOR_PRESSURE;
      applyPressure(s);
    }
    endTurnSingle(s, playerPlan(s));
    expect(o.status).toBe('confirmed');
  });

  it('cratered airfields keep part of an operation on the ground', () => {
    expect(facilityEffects({ industry: 100, airfield: 100, fuel: 100 }).grounded).toBe(0);
    expect(facilityEffects({ industry: 100, airfield: 40, fuel: 100 }).grounded).toBeCloseTo(0.3);
    const s = startCampaign({ seed: 'craters' });
    const bombers = s.sides[0].squadrons.filter((q) => q.kind === 'medium');
    const before = gatherFliers(s.sides[0], bombers.map((q) => q.id), () => 'raid', newDay()).length;
    s.sides[0].facilities.airfield = 20;
    const day = newDay();
    const after = gatherFliers(s.sides[0], bombers.map((q) => q.id), () => 'raid', day).length;
    expect(after).toBeLessThan(before);
    expect([...day.grounded.values()].reduce((a, b) => a + b, 0)).toBe(before - after);
    // Defensive patrols scramble from dispersal strips.
    const fighters = s.sides[0].squadrons.filter((q) => q.kind === 'fighter').map((q) => q.id);
    expect(gatherFliers(s.sides[0], fighters, () => 'defense', newDay()).length).toBeGreaterThan(0);
  });

  it('the school trains crews only for aircraft that exist or are on order', () => {
    for (let g = 0; g < 6; g++) {
      const s = startCampaign({ seed: `crews${g}` });
      for (let w = 0; w < 12 && !s.outcome; w++) endTurnSingle(s, playerPlan(s));
      const side = s.sides[0];
      const aircraft = side.squadrons.reduce((a, q) => a + q.airframes.length, 0) + side.factory.queue.length;
      const crews = side.squadrons.reduce((a, q) => a + q.crews, 0) + side.training.inTraining;
      // In training never pushes crews past aircraft by more than one week's graduates.
      expect(side.training.inTraining).toBeLessThanOrEqual(Math.max(0, aircraft - (crews - side.training.inTraining)));
      expect(crewShortfall(side)).toBeGreaterThanOrEqual(0);
    }
  });

  it('fuel and munitions are one stock of stores', () => {
    const s = startCampaign({ seed: 'stores' });
    expect(s.sides[0].resources.stores).toBeGreaterThan(0);
    expect('fuel' in s.sides[0].resources).toBe(false);
    const before = s.sides[0].resources.stores;
    endTurnSingle(s, playerPlan(s));
    expect(s.sides[0].resources.stores).not.toBe(before);
  });

  it('a plan can be shrunk to what the depots hold, keeping bombers before escorts', () => {
    const s = startCampaign({ seed: 'fit' });
    const plan = playerPlan(s);
    s.sides[0].resources.stores = Math.floor(planCost(s.sides[0], plan).stores * 0.7);
    expect(validatePlan(s.sides[0], plan, s).ok).toBe(false);
    fitPlanToStores(s, 0, plan);
    expect(planCost(s.sides[0], plan).stores).toBeLessThanOrEqual(s.sides[0].resources.stores);
    expect(validatePlan(s.sides[0], plan, s).ok).toBe(true);
    if (plan.raid) expect(plan.raid.squadronIds.some((id) => s.sides[0].squadrons.find((q) => q.id === id)!.kind === 'medium')).toBe(true);
  });
});
