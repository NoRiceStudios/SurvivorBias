/** Default and carried-over plans, shared by the UI and the text interface. */
import { planCost } from './actions';
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

/** Keep the previous plan's assignments, dropping squadrons that no longer exist or have no aircraft left. */
export function carryPlan(state: GameState, side: SideId, prev: TurnPlan): TurnPlan {
  const ids = new Set(state.sides[side].squadrons.filter((q) => q.airframes.length > 0).map((q) => q.id));
  const t = state.theater;
  const enemySite = (id?: string) => t.sites.find((x) => x.id === id && x.owner !== side);
  let raid = prev.raid ? { ...prev.raid, squadronIds: prev.raid.squadronIds.filter((i) => ids.has(i)) } : null;
  // A target that changed hands (or a new theater) falls back to the default target.
  if (raid && raid.target !== 'support' && raid.target !== 'sweep' && !enemySite(raid.siteId)) {
    const d = defaultPlan(state, side).raid!;
    raid = { ...d, squadronIds: raid.squadronIds };
  }
  const cover: Record<string, number> = Object.fromEntries(Object.entries(prev.cover).filter(([id, sec]) => ids.has(id) && (sec < t.held0 ? 0 : 1) === side));
  const defense = prev.defense.filter((i) => ids.has(i));
  // Squadrons stood down last week go back to the duties they had before (a feint is planned afresh).
  for (const r of prev.rested ?? []) {
    if (!ids.has(r.id)) continue;
    if (r.raid && raid && !raid.squadronIds.includes(r.id)) raid.squadronIds.push(r.id);
    if (r.defense && !defense.includes(r.id)) {
      defense.push(r.id);
      if (r.cover !== undefined && (r.cover < t.held0 ? 0 : 1) === side) cover[r.id] = r.cover;
    }
  }
  return {
    raid,
    defense,
    cover,
    recon: prev.recon && ids.has(prev.recon.squadronId) && enemySite(prev.recon.siteId) ? prev.recon : null,
    // Feints are planned week by week.
    feint: null,
    embellish: prev.embellish,
    sorties: prev.sorties ? Object.fromEntries(Object.entries(prev.sorties).filter(([id]) => ids.has(id))) : undefined,
  };
}


/**
 * Shrink a plan until the wing can afford it: maximum effort goes first, then the feint, then bomber
 * squadrons together with a matching escort, so the raid keeps its cover for as
 * long as possible. Patrols go last.
 */
export function fitPlanToStores(state: GameState, side: SideId, plan: TurnPlan): TurnPlan {
  const s = state.sides[side];
  const over = () => planCost(s, plan).stores > s.resources.stores;
  // The extra load goes before any squadron does.
  if (over() && plan.raid?.maxEffort) plan.raid.maxEffort = undefined;
  if (over() && plan.feint) plan.feint = null;
  if (over() && plan.recon) plan.recon = null;
  const kindOf = (id: string) => s.squadrons.find((q) => q.id === id)?.kind;
  while (over() && plan.raid && plan.raid.squadronIds.length > 1) {
    const ids = plan.raid.squadronIds;
    const bombers = ids.filter((id) => kindOf(id) === 'medium' || kindOf(id) === 'heavy');
    const fighters = ids.filter((id) => kindOf(id) === 'fighter');
    if (bombers.length >= 2) {
      ids.splice(ids.lastIndexOf(bombers[bombers.length - 1]), 1);
      if (fighters.length > bombers.length - 1 && fighters.length > 1) ids.splice(ids.lastIndexOf(fighters[fighters.length - 1]), 1);
    } else if (fighters.length > 1 || bombers.length === 0) ids.splice(ids.lastIndexOf(fighters[fighters.length - 1]), 1);
    else break; // one bomber squadron and its escort: fly both or neither
  }
  if (over() && plan.raid) plan.raid = null;
  while (over() && plan.defense.length) {
    const id = plan.defense.pop()!;
    delete plan.cover[id];
  }
  return plan;
}
