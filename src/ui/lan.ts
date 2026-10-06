/**
 * LAN / direct-IP play. The host runs the authoritative game; the joining
 * player (always the Directorate, side 1) receives only their own view
 * (redactFor), plans locally, and sends sealed orders plus the management
 * commands they made. The host replays those commands under the same rules,
 * resolves the week when both are sealed, and sends back the results.
 *
 * Messages (newline-delimited JSON over TCP, via the Electron main process):
 *   client → host  hello { v, name } · seal { plan, commands } · unseal { turn }
 *   host → client  welcome { state, plan, phase, opponent } · results { state, plan }
 *                  opponent-sealed · opponent-unsealed · unsealed · error { reason, state, plan } · reject { reason }
 *
 * A seal carries only the commands made since the last seal: when a commander takes
 * sealed orders back to amend them, the host keeps the changes it has already applied.
 */
import { applyCommands, type Command } from '../core/commands';
import { carryPlan, defaultPlan } from '../core/plans';
import { redactFor } from '../core/redact';
import { SAVE_VERSION } from '../core/setup';
import { resolveTurn } from '../core/turn';
import type { GameState, SideId, TurnPlan } from '../core/types';
import type { App } from './app';
import type { LanApi, LanStatus } from './storage';

export const DEFAULT_PORT = 41414;
export const LAN_SAVE = 'lan-autosave';

type Msg =
  | { t: 'hello'; v: number; name: string }
  | { t: 'seal'; plan: TurnPlan; commands: Command[] }
  | { t: 'welcome'; state: GameState; plan: TurnPlan; phase: 'plan' | 'sealed'; opponent: string }
  | { t: 'results'; state: GameState; plan: TurnPlan }
  | { t: 'opponent-sealed' }
  | { t: 'unseal'; turn: number }
  | { t: 'unsealed' }
  | { t: 'opponent-unsealed' }
  | { t: 'error'; reason: string; state: GameState; plan: TurnPlan }
  | { t: 'reject'; reason: string };

export class LanSession {
  connected = false;
  opponentSealed = false;
  /** Host only: the address(es) to give the other player. */
  addresses: string[] = [];
  status = '';
  /** Client: commands already sent to the host with an earlier seal this week. */
  sentCommands = 0;
  /** Client: asked the host for our orders back, waiting for the answer. */
  unsealing = false;

  constructor(public app: App, public role: 'host' | 'client', public api: LanApi, public port = DEFAULT_PORT) {
    api.onMessage((m) => this.receive(m as Msg));
    api.onStatus((s) => this.onStatus(s));
  }

  get mySide(): SideId {
    return this.role === 'host' ? 0 : 1;
  }

  private send(m: Msg) {
    this.api.send(m);
  }

  private onStatus(s: LanStatus) {
    const was = this.connected;
    this.connected = s.connected;
    if (!s.connected && was) {
      this.status = 'Connection lost.';
      this.app.toast(this.role === 'host' ? 'The other commander has disconnected. The game waits for them to rejoin.' : 'Connection to the host lost.', true);
    }
    if (s.connected) this.status = this.role === 'host' ? 'Opponent connected.' : 'Connected to host.';
    this.app.render();
  }

  /* ---------------- Host ---------------- */

  async host(): Promise<boolean> {
    const r = await this.api.host(this.port);
    if (!r.ok) {
      this.app.toast(`Could not open port ${this.port}: ${r.error}`, true);
      return false;
    }
    this.addresses = r.addresses ?? [];
    this.status = 'Waiting for the other commander to join…';
    return true;
  }

  private welcome() {
    const st = this.app.state!;
    this.send({ t: 'welcome', state: redactFor(st, 1), plan: st.sealed[1] ?? this.app.plans[1], phase: st.sealed[1] ? 'sealed' : 'plan', opponent: st.sides[0].commander });
    if (st.sealed[0]) this.send({ t: 'opponent-sealed' });
  }

  /** Host: our own orders are sealed (called by App.launch). */
  async hostSealed() {
    const st = this.app.state!;
    if (st.sealed[1]) await this.resolve();
    else {
      this.send({ t: 'opponent-sealed' });
      this.app.go({ kind: 'lanWait', side: 0 });
    }
  }

  private async resolve() {
    const app = this.app;
    const st = app.state!;
    resolveTurn(st, [st.sealed[0]!, st.sealed[1]!]);
    app.plans = [carryPlan(st, 0, app.plans[0]), carryPlan(st, 1, app.plans[1])];
    app.pendingCommands = [[], []];
    this.opponentSealed = false;
    await app.save(LAN_SAVE);
    this.send({ t: 'results', state: redactFor(st, 1), plan: app.plans[1] });
    app.go({ kind: 'radio', side: 0 });
  }

  /* ---------------- Client ---------------- */

  async join(address: string, name: string): Promise<boolean> {
    const r = await this.api.join(address, this.port);
    if (!r.ok) {
      this.app.toast(`Could not reach ${address}:${this.port}: ${r.error}`, true);
      return false;
    }
    this.status = 'Connected. Waiting for the host…';
    this.send({ t: 'hello', v: SAVE_VERSION, name });
    return true;
  }

  /** Client: send our sealed orders and the changes we made since the last seal. */
  clientSealed(plan: TurnPlan, commands: Command[]) {
    this.send({ t: 'seal', plan, commands: commands.slice(this.sentCommands) });
    this.sentCommands = commands.length;
    this.app.go({ kind: 'lanWait', side: 1 });
  }

  /** Take our sealed orders back to amend them, if the week has not been fought yet. */
  unseal() {
    const app = this.app;
    const st = app.state!;
    if (this.role === 'host') {
      if (!st.sealed[0]) return;
      st.sealed[0] = null;
      void app.save(LAN_SAVE);
      this.send({ t: 'opponent-unsealed' });
      app.go({ kind: 'hq', side: 0, tab: 'operations' });
      return;
    }
    if (!this.connected) {
      app.toast('Not connected to the host.', true);
      return;
    }
    this.unsealing = true;
    this.send({ t: 'unseal', turn: st.turn });
    app.render();
  }

  /* ---------------- Both ---------------- */

  private async receive(m: Msg) {
    const app = this.app;
    switch (m.t) {
      case 'hello': {
        if (this.role !== 'host') return;
        if (m.v !== SAVE_VERSION) {
          this.send({ t: 'reject', reason: `Version mismatch: the host runs save version ${SAVE_VERSION}, you run ${m.v}.` });
          return;
        }
        const st = app.state!;
        if (st.archive.length === 0 && m.name.trim()) st.sides[1].commander = m.name.trim().slice(0, 40);
        this.status = `${st.sides[1].commander} has joined.`;
        app.toast(`${st.sides[1].commander} has joined the game.`);
        this.welcome();
        app.render();
        return;
      }
      case 'seal': {
        if (this.role !== 'host') return;
        const st = app.state!;
        if (st.sealed[1]) return;
        // Replay the client's changes on the authoritative state; any failure means we disagree.
        const plan = JSON.parse(JSON.stringify(m.plan)) as TurnPlan;
        const snapshot = JSON.stringify(st.sides[1]);
        const r = applyCommands(st, 1, m.commands, plan);
        if (!r.ok) {
          st.sides[1] = JSON.parse(snapshot);
          this.send({ t: 'error', reason: `The host could not apply your orders (${r.reason}). Please plan again.`, state: redactFor(st, 1), plan: app.plans[1] });
          return;
        }
        app.plans[1] = plan;
        st.sealed[1] = plan;
        this.opponentSealed = true;
        await app.save(LAN_SAVE);
        if (st.sealed[0]) await this.resolve();
        else {
          app.toast(`${st.sides[1].commander} has sealed their orders.`);
          app.render();
        }
        return;
      }
      case 'unseal': {
        if (this.role !== 'host') return;
        const st = app.state!;
        // Too late if the week has already been fought: the client will have the results.
        if (!st.sealed[1] || m.turn !== st.turn) return;
        st.sealed[1] = null;
        this.opponentSealed = false;
        await app.save(LAN_SAVE);
        this.send({ t: 'unsealed' });
        app.toast(`${st.sides[1].commander} has reopened their orders.`);
        app.render();
        return;
      }
      case 'unsealed':
        if (this.role !== 'client') return;
        this.unsealing = false;
        app.go({ kind: 'hq', side: 1, tab: 'operations' });
        return;
      case 'opponent-unsealed':
        this.opponentSealed = false;
        app.toast('The other commander has reopened their orders.');
        app.render();
        return;
      case 'welcome':
      case 'results':
      case 'error': {
        if (this.role !== 'client') return;
        app.state = m.state;
        app.plans = [defaultPlan(m.state, 0), m.plan];
        app.pendingCommands = [[], []];
        this.sentCommands = 0;
        this.unsealing = false;
        this.opponentSealed = false;
        if (m.t === 'error') {
          app.toast(m.reason, true);
          app.go({ kind: 'hq', side: 1, tab: 'briefing' });
        } else if (m.t === 'welcome') {
          this.status = `Playing against ${m.opponent}.`;
          app.go(m.phase === 'sealed' ? { kind: 'lanWait', side: 1 } : m.state.outcome ? { kind: 'end', side: 1, tab: 'summary' } : { kind: 'hq', side: 1, tab: 'briefing' });
        } else {
          app.go({ kind: 'radio', side: 1 });
        }
        return;
      }
      case 'opponent-sealed':
        this.opponentSealed = true;
        app.toast('The other commander has sealed their orders.');
        app.render();
        return;
      case 'reject':
        app.toast(m.reason, true);
        this.api.close();
        app.go({ kind: 'title' });
        return;
    }
  }

  close() {
    this.api.close();
  }
}
