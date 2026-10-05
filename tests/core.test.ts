import { describe, expect, it } from 'vitest';
import {
  aiPlan,
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
  const plan: TurnPlan = {
    raid: { target: 'industry', squadronIds: [...bombers.map((s) => s.id), fighters[1]?.id].filter(Boolean) as string[] },
    defense: fighters[0] ? [fighters[0].id] : [],
    recon: null,
    embellish: 0,
  };
  let guard = 0;
  while (!validatePlan(side, plan).ok && guard++ < 10) {
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
        const r = resolveRaid(new Rng({ s: 1234 + g }), s, side, enemy, plan, aiPlan(s, 1));
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
