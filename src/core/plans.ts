/** Default and carried-over plans, shared by the UI and the text interface. */
import { depthFor, reachableSites } from './theaters';
import type { GameState, SideId, TurnPlan } from './types';

export function defaultPlan(state: GameState, side: SideId): TurnPlan {
  const s = state.sides[side];
  const fighters = s.squadrons.filter((q) => q.kind === 'fighter');
  const bombers = s.squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy');
  const site = reachableSites(state, side, 'medium').find((x) => depthFor(state.theater.held0, side, x.sector) === 1);
  const squadronIds = [...bombers.map((q) => q.id), ...fighters.slice(1, 2).map((q) => q.id)];
  return {
    raid: site ? { target: site.type, siteId: site.id, squadronIds } : { target: 'support', squadronIds },
    defense: fighters.slice(0, 1).map((q) => q.id),
    cover: {},
    recon: null,
    feint: null,
    embellish: 0,
  };
}

/** Keep the previous plan's assignments, dropping squadrons that no longer exist. */
export function carryPlan(state: GameState, side: SideId, prev: TurnPlan): TurnPlan {
  const ids = new Set(state.sides[side].squadrons.map((q) => q.id));
  const t = state.theater;
  const enemySite = (id?: string) => t.sites.find((x) => x.id === id && x.owner !== side);
  let raid = prev.raid ? { ...prev.raid, squadronIds: prev.raid.squadronIds.filter((i) => ids.has(i)) } : null;
  // A target that changed hands (or a new theater) falls back to the default target.
  if (raid && raid.target !== 'support' && raid.target !== 'sweep' && !enemySite(raid.siteId)) {
    const d = defaultPlan(state, side).raid!;
    raid = { ...d, squadronIds: raid.squadronIds };
  }
  const cover = Object.fromEntries(Object.entries(prev.cover).filter(([id, sec]) => ids.has(id) && (sec < t.held0 ? 0 : 1) === side));
  return {
    raid,
    defense: prev.defense.filter((i) => ids.has(i)),
    cover,
    recon: prev.recon && ids.has(prev.recon.squadronId) && enemySite(prev.recon.siteId) ? prev.recon : null,
    // Feints are planned week by week.
    feint: null,
    embellish: prev.embellish,
  };
}

