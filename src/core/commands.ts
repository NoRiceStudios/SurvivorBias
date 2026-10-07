/**
 * Every management change a commander can make, as plain data. The UI applies
 * commands locally; in a LAN game the joining player's commands are sent with
 * their sealed orders and replayed by the host under the same rules, so the
 * host never has to trust a client's copy of the game.
 */
import {
  appointLeader,
  buyConvoy,
  mergeSquadrons,
  restLeader,
  requestCrews,
  cancelQueued,
  copyArmor,
  emergencyRepair,
  queueAircraft,
  setApproach,
  setArmor,
  setDoctrine,
  setQc,
  setTrainingFocus,
  setLiveFire,
  startResearch,
  upgradeFactory,
  upgradeFlak,
  upgradeTraining,
  type ActionResult,
} from './actions';
import { approveRequest, declineRequest } from './requests';
import type {
  AircraftKind,
  Doctrine,
  FacilityType,
  FighterApproach,
  GameState,
  QcPolicy,
  SideId,
  TrainingFocus,
  TurnPlan,
  ZoneId,
} from './types';

export type Command =
  | { k: 'armor'; sq: string; zone: ZoneId; value: number; all?: boolean }
  | { k: 'armorAll'; sq: string }
  | { k: 'doctrine'; sq: string; d: Partial<Doctrine> }
  | { k: 'approach'; w: Record<FighterApproach, number> }
  | { k: 'upgrade'; what: 'factory' | 'training' | 'flak' }
  | { k: 'qc'; v: QcPolicy }
  | { k: 'focus'; v: TrainingFocus }
  | { k: 'liveFire'; on: boolean }
  | { k: 'build'; kind: AircraftKind }
  | { k: 'cancel'; i: number }
  | { k: 'research'; id: string }
  | { k: 'approve'; id: string }
  | { k: 'decline'; id: string }
  | { k: 'repair'; what: FacilityType }
  | { k: 'convoy' }
  | { k: 'crews'; n: number }
  | { k: 'merge'; from: string; into: string }
  | { k: 'appoint'; sq: string }
  | { k: 'restCO'; sq: string };

export function applyCommand(state: GameState, sideId: SideId, c: Command, plan?: TurnPlan): ActionResult {
  const side = state.sides[sideId];
  switch (c.k) {
    case 'armor': {
      if (!c.all) return setArmor(side, c.sq, c.zone, c.value);
      // The same refit on every squadron of the type, or on none of them.
      const kind = side.squadrons.find((q) => q.id === c.sq)?.kind;
      const before = { supplies: side.resources.supplies, armor: side.squadrons.map((q) => ({ ...q.armor })) };
      const r = setArmor(side, c.sq, c.zone, c.value);
      if (!r.ok || !side.squadrons.some((q) => q.id !== c.sq && q.kind === kind)) return r;
      const r2 = copyArmor(side, c.sq);
      if (!r2.ok) {
        side.resources.supplies = before.supplies;
        side.squadrons.forEach((q, i) => { q.armor = before.armor[i]; });
      }
      return r2;
    }
    case 'armorAll': return copyArmor(side, c.sq);
    case 'doctrine': return setDoctrine(side, c.sq, c.d);
    case 'approach': return setApproach(side, c.w);
    case 'upgrade': return c.what === 'factory' ? upgradeFactory(side) : c.what === 'training' ? upgradeTraining(side) : upgradeFlak(side);
    case 'qc': return setQc(side, c.v);
    case 'focus': return setTrainingFocus(side, c.v);
    case 'liveFire': return setLiveFire(side, c.on);
    case 'build': return queueAircraft(side, c.kind);
    case 'cancel': return cancelQueued(side, c.i);
    case 'research': return startResearch(side, c.id);
    case 'approve': return approveRequest(side, c.id, plan);
    case 'decline':
      declineRequest(side, c.id);
      return { ok: true };
    case 'repair': return emergencyRepair(state, side, c.what);
    case 'convoy': return buyConvoy(state, side);
    case 'crews': return requestCrews(side, c.n);
    case 'merge': return mergeSquadrons(state, side, c.from, c.into, plan);
    case 'appoint': return appointLeader(state, side, c.sq);
    case 'restCO': return restLeader(state, side, c.sq);
  }
}

/** Replay a list of commands; stops at the first that fails. */
export function applyCommands(state: GameState, sideId: SideId, cmds: Command[], plan?: TurnPlan): ActionResult {
  for (const c of cmds) {
    const r = applyCommand(state, sideId, c, plan);
    if (!r.ok) return { ok: false, reason: `${c.k}: ${r.reason}` };
  }
  return { ok: true };
}
