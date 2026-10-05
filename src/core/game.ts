import { aiPlan } from './ai';
import { emptyPlan } from './actions';
import { Rng } from './rng';
import { newGame, SAVE_VERSION, type NewGameOptions } from './setup';
import { DEFAULT_LETHALITY } from './lethality';
import { depthFor } from './theaters';
import { resolveTurn, STORES_CAP } from './turn';
import type { GameState, SideId, TurnPlan } from './types';

/** Create a new campaign with opening orders and memos. */
export function startCampaign(opts: NewGameOptions & { commanders?: [string, string] } = {}): GameState {
  const state = newGame(opts);
  const rng = new Rng(state.rng);
  if (opts.commanders) opts.commanders.forEach((c, i) => { if (c.trim()) state.sides[i].commander = c.trim().slice(0, 40); });
  for (const side of state.sides) {
    const enemy = state.sides[(1 - side.id) as SideId];
    const t = state.theater;
    const first = t.sites.find((x) => x.owner !== side.id && depthFor(t.held0, side.id, x.sector) === 1)!;
    side.orders.push({
      id: `o${state.nextId++}`,
      kind: 'strike',
      target: first.type,
      siteId: first.id,
      amount: 12,
      deadline: 2,
      text: `Inflict at least 12% damage on the ${first.name} by week 2.`,
    });
    side.memos.push(
      {
        turn: 1,
        from: 'Air Ministry',
        kind: 'order',
        subject: 'Assumption of command',
        body: `You are hereby appointed to command the ${side.id === 0 ? 'No. 7 Composite Wing' : 'Kampfgeschwader Nord'}. The war will be fought across three theaters, beginning with ${state.theater.id === 'narrow-sea' ? 'the Narrow Sea' : 'the front'}. The ${enemy.short} air force is of unknown strength. Returns are to be submitted after every operation. Accuracy is expected.`,
      },
      {
        turn: 1,
        from: 'Air Intelligence',
        kind: 'intel',
        subject: 'Enemy order of battle',
        body: 'Little is known of the enemy order of battle. Your crews are your eyes. Debrief them carefully.',
      },
      {
        turn: 1,
        from: 'Operational Research Section',
        kind: 'intel',
        subject: 'Battle damage: a caution',
        body: 'Every type is built differently, and every war is flown with new marks of aircraft against new enemy guns. What proved true for one type, or in one war, may not hold for the next. Judge each on its own evidence.',
      },
    );
  }
  state.rng = rng.state;
  return state;
}

/** Single player: resolve the player's plan against the AI. */
export function endTurnSingle(state: GameState, playerPlan: TurnPlan) {
  const ai = state.sides[1].isAI ? aiPlan(state, 1) : emptyPlan();
  return resolveTurn(state, [playerPlan, ai]);
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (!s || typeof s !== 'object' || !Array.isArray(s.sides)) throw new Error('Not a Survivor Bias save file');
  // Version 2 saves predate feints, commander names and sealed hotseat orders.
  if (s.version === 2) {
    s.sealed = [null, null];
    for (const side of s.sides) side.commander ??= side.id === 0 ? 'Air Commodore' : 'Oberst';
    s.version = 3;
  }
  // Version 3 saves predate per-campaign lethality profiles: they keep the original fixed one.
  if (s.version === 3) {
    s.lethality = JSON.parse(JSON.stringify(DEFAULT_LETHALITY));
    for (const side of s.sides) side.perceived.survivorHitsByKind ??= {};
    s.version = 4;
  }
  // Version 4 saves keep fuel and munitions apart; version 5 holds them as one stock of stores.
  if (s.version === 4) {
    for (const side of s.sides) {
      const r = side.resources as unknown as { fuel?: number; munitions?: number; stores?: number };
      r.stores = Math.min(STORES_CAP, Math.round(((r.fuel ?? 0) + (r.munitions ?? 0)) * 0.75));
      delete r.fuel;
      delete r.munitions;
    }
    s.version = 5;
  }
  if (s.version !== SAVE_VERSION) throw new Error(`Save version ${s.version} is not supported (expected ${SAVE_VERSION})`);
  for (const p of s.sealed) if (p) p.feint ??= null;
  for (const side of s.sides) {
    side.observed ??= { feints: 0, support: 0 };
    side.requests ??= [];
  }
  return s;
}
