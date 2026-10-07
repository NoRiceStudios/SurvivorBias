import { describe, expect, it } from 'vitest';
import {
  AIRCRAFT,
  aircraftCost,
  applyCommand,
  armorBudget,
  armorUsed,
  capturedSites,
  CAPTURED_SUPPLIES,
  deserialize,
  emptyPlan,
  endTurnSingle,
  fitMod,
  OFFICE_SUPPLIES,
  planCost,
  redactFor,
  rollOffers,
  Rng,
  serialize,
  startCampaign,
  takeOffer,
  tierWeights,
  weeklyIncome,
  ZONES,
} from '../src/core';

describe('air forces', () => {
  it('the Old Cadre starts short of aircraft but with better crews', () => {
    const plain = startCampaign({ seed: 'f1', factions: [null, null] });
    const cadre = startCampaign({ seed: 'f1', factions: ['cadre', null] });
    const n = (s: typeof plain) => s.sides[0].squadrons.reduce((a, q) => a + q.airframes.length, 0);
    const skill = (s: typeof plain) => s.sides[0].squadrons.reduce((a, q) => a + q.skill, 0) / s.sides[0].squadrons.length;
    expect(n(cadre)).toBe(n(plain) - 8);
    expect(skill(cadre)).toBeGreaterThan(skill(plain) + 0.1);
    expect(aircraftCost(cadre.sides[0], 'fighter')).toBeGreaterThan(AIRCRAFT.fighter.cost);
  });

  it('the Arsenal builds cheaper and is short of stores', () => {
    const plain = startCampaign({ seed: 'f2', factions: [null, null] });
    const arsenal = startCampaign({ seed: 'f2', factions: ['arsenal', null] });
    expect(aircraftCost(arsenal.sides[0], 'medium')).toBeLessThan(AIRCRAFT.medium.cost);
    expect(weeklyIncome(arsenal, arsenal.sides[0]).stores).toBeLessThan(weeklyIncome(plain, plain.sides[0]).stores);
    expect(weeklyIncome(arsenal, arsenal.sides[0]).supplies).toBe(weeklyIncome(plain, plain.sides[0]).supplies + 10);
  });

  it('Friends at Court get four offers and better odds; confidence swings further', () => {
    const s = startCampaign({ seed: 'f3', factions: ['patronage', null] });
    expect(s.sides[0].offers?.cards.length).toBe(4);
    expect(s.sides[1].offers?.cards.length).toBe(3);
    const plain = startCampaign({ seed: 'f3', factions: [null, null] });
    expect(tierWeights(s.sides[0])[2]).toBeGreaterThan(tierWeights(plain.sides[0])[2]);
  });

  it('a random air force is drawn by the seed, the same every time', () => {
    const a = startCampaign({ seed: 'f4', factions: ['random', 'random'] });
    const b = startCampaign({ seed: 'f4', factions: ['random', 'random'] });
    expect(a.sides[0].faction).toBeDefined();
    expect(a.sides.map((x) => x.faction)).toEqual(b.sides.map((x) => x.faction));
  });
});

describe('High Command\'s offers', () => {
  it('three different offers every week, one may be accepted', () => {
    const s = startCampaign({ seed: 'o1' });
    const side = s.sides[0];
    expect(side.offers?.week).toBe(1);
    const kinds = side.offers!.cards.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(3);
    expect(applyCommand(s, 0, { k: 'offer', i: 0 }).ok).toBe(true);
    expect(applyCommand(s, 0, { k: 'offer', i: 1 }).ok).toBe(false);
    endTurnSingle(s, emptyPlan());
    expect(side.offers?.week).toBe(2);
    expect(side.offers?.taken).toBeUndefined();
  });

  it('rare offers come more often to a trusted commander', () => {
    const s = startCampaign({ seed: 'o2' });
    const side = s.sides[0];
    const rare = (trust: number) => {
      side.trust = trust;
      let n = 0;
      for (let i = 0; i < 400; i++) n += rollOffers(new Rng({ s: i * 7919 }), s, side, 1).cards.filter((c) => c.tier === 2).length;
      return n;
    };
    expect(rare(95)).toBeGreaterThan(rare(20) * 2);
  });

  it('a grant adds supplies; a squadron from overseas joins the wing', () => {
    const s = startCampaign({ seed: 'o3' });
    const side = s.sides[0];
    side.offers = { week: s.turn, cards: [{ kind: 'grant', tier: 0 }, { kind: 'dominion', tier: 2, param: '42' }] };
    const before = side.resources.supplies;
    expect(takeOffer(s, side, 0).ok).toBe(true);
    expect(side.resources.supplies).toBe(before + 50);
    side.offers = { week: s.turn, cards: [{ kind: 'dominion', tier: 2, param: '42' }] };
    const n = side.squadrons.length;
    expect(takeOffer(s, side, 0).ok).toBe(true);
    expect(side.squadrons.length).toBe(n + 1);
    expect(side.squadrons[n].airframes.length).toBe(6);
    expect(side.squadrons[n].crews).toBe(6);
  });

  it('an offer accepted by a LAN client replays the same on the host', () => {
    const host = startCampaign({ seed: 'o4', mode: 'lan' });
    const client = deserialize(serialize(redactFor(host, 1)));
    host.sides[1].offers = { week: host.turn, cards: [{ kind: 'ace', tier: 2, param: `${host.sides[1].squadrons[0].id}|77` }] };
    client.sides[1].offers = JSON.parse(JSON.stringify(host.sides[1].offers));
    expect(applyCommand(client, 1, { k: 'offer', i: 0 }).ok).toBe(true);
    expect(applyCommand(host, 1, { k: 'offer', i: 0 }).ok).toBe(true);
    expect(client.sides[1].squadrons[0].leader.name).toBe(host.sides[1].squadrons[0].leader.name);
    expect(host.sides[1].squadrons[0].leader.trait).toBe('ace');
  });

  it('the enemy\'s offers are not shown to a LAN player', () => {
    const s = startCampaign({ seed: 'o5', mode: 'lan' });
    expect(redactFor(s, 0).sides[1].offers).toBeUndefined();
    expect(redactFor(s, 0).sides[0].offers).toBeDefined();
  });
});

describe('field modifications', () => {
  it('cost supplies, take a slot each, and rare ones must be released first', () => {
    const s = startCampaign({ seed: 'm1' });
    const side = s.sides[0];
    const sq = side.squadrons.find((q) => q.kind === 'fighter')!;
    const before = side.resources.supplies;
    expect(fitMod(side, sq.id, 'extraGuns').ok).toBe(true);
    expect(side.resources.supplies).toBe(before - 25);
    expect(fitMod(side, sq.id, 'aiRadar').ok).toBe(false);
    side.modsUnlocked = ['aiRadar'];
    expect(fitMod(side, sq.id, 'aiRadar').ok).toBe(true);
    expect(fitMod(side, sq.id, 'leanMix').ok).toBe(false);
    expect(fitMod(side, sq.id, 'bombBay').ok).toBe(false);
  });

  it('extra plate mounts carry more plate, and it comes off again with them', () => {
    const s = startCampaign({ seed: 'm2' });
    const side = s.sides[0];
    const sq = side.squadrons.find((q) => q.kind === 'medium')!;
    const base = armorBudget(sq);
    expect(applyCommand(s, 0, { k: 'mod', sq: sq.id, mod: 'plateMounts', on: true }).ok).toBe(true);
    expect(armorBudget(sq)).toBe(base + 2);
    while (armorUsed(sq) < armorBudget(sq)) {
      const z = ZONES.find((x) => sq.armor[x] < 3)!;
      expect(applyCommand(s, 0, { k: 'armor', sq: sq.id, zone: z, value: sq.armor[z] + 1 }).ok).toBe(true);
    }
    expect(applyCommand(s, 0, { k: 'mod', sq: sq.id, mod: 'plateMounts', on: false }).ok).toBe(true);
    expect(armorUsed(sq)).toBe(base);
  });

  it('lean mixture saves stores; fitting a whole type is all or nothing', () => {
    const s = startCampaign({ seed: 'm3' });
    const side = s.sides[0];
    const bombers = side.squadrons.filter((q) => q.kind === 'medium');
    const plan = { ...emptyPlan(), raid: { target: 'support' as const, squadronIds: bombers.map((q) => q.id) } };
    const full = planCost(side, plan).stores;
    expect(applyCommand(s, 0, { k: 'mod', sq: bombers[0].id, mod: 'leanMix', on: true, all: true }).ok).toBe(true);
    expect(bombers.every((q) => q.mods?.includes('leanMix'))).toBe(true);
    expect(planCost(side, plan).stores).toBeLessThan(full * 0.8);
    side.resources.supplies = 30;
    expect(applyCommand(s, 0, { k: 'mod', sq: bombers[0].id, mod: 'extraGuns', on: true, all: true }).ok).toBe(false);
    expect(side.resources.supplies).toBe(30);
    expect(bombers.some((q) => q.mods?.includes('extraGuns'))).toBe(false);
  });
});

describe('supplies beyond High Command\'s confidence', () => {
  it('the Supply Office and captured works bring supplies every week', () => {
    const s = startCampaign({ seed: 'e1' });
    const side = s.sides[0];
    const base = weeklyIncome(s, side).supplies;
    expect(applyCommand(s, 0, { k: 'upgrade', what: 'office' }).ok).toBe(true);
    expect(weeklyIncome(s, side).supplies).toBe(base + OFFICE_SUPPLIES);
    const site = s.theater.sites.find((x) => x.owner === 1)!;
    site.owner = 0;
    expect(capturedSites(s, 0)).toContain(site);
    expect(weeklyIncome(s, side).supplies).toBe(base + OFFICE_SUPPLIES + CAPTURED_SUPPLIES);
  });

  it('version 5 saves load', () => {
    const s = startCampaign({ seed: 'e2' });
    const old = JSON.parse(serialize(s));
    old.version = 5;
    for (const side of old.sides) delete side.offers;
    expect(deserialize(JSON.stringify(old)).version).toBe(6);
  });
});
