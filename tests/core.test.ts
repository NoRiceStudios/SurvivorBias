import { describe, expect, it } from 'vitest';
import {
  aiPlan,
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
  ZONE_LETHALITY,
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
  it('survivor damage is concentrated in low-lethality zones', () => {
    const lostZ: Record<string, number> = {};
    const survZ: Record<string, number> = {};
    for (let g = 0; g < 6; g++) {
      const s = startCampaign({ seed: `wald${g}` });
      for (let i = 0; i < 8 && !s.outcome; i++) endTurnSingle(s, playerPlan(s));
      for (const e of s.archive) {
        for (const h of e.lostHits[0].filter((x) => x.lethal)) lostZ[h.zone] = (lostZ[h.zone] ?? 0) + 1;
        for (const h of e.survivorHits[0]) survZ[h.zone] = (survZ[h.zone] ?? 0) + 1;
      }
    }
    const share = (m: Record<string, number>, zs: ZoneId[]) => {
      const tot = Object.values(m).reduce((a, b) => a + b, 0);
      return zs.reduce((a, z) => a + (m[z] ?? 0), 0) / tot;
    };
    const deadly: ZoneId[] = ZONES.filter((z) => ZONE_LETHALITY[z] >= 0.1);
    // The hits that brought planes down are concentrated where survivors show few holes.
    expect(share(lostZ, deadly)).toBeGreaterThan(share(survZ, deadly) * 2);
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
        const plan = playerPlan(s);
        const r = resolveRaid(new Rng({ s: 1234 + g }), s, side, enemy, plan.raid, aiPlan(s, 1));
        if (!r) continue;
        const mine = r.planes.filter((p) => p.side === 0 && p.kind !== 'fighter');
        sent += mine.length;
        lost += mine.filter((p) => p.fate === 'lost').length;
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
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.version).toBe(3);
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
