import { FOLDER_TAB, look, nationAt, setSeats } from './nation';
import { aiPlan } from '../core/ai';
import { emptyPlan, validatePlan } from '../core/actions';
import { deserialize, serialize, startCampaign } from '../core/game';
import { resolveTurn } from '../core/turn';
import { applyCommand, type Command } from '../core/commands';
import { carryPlan, defaultPlan, fitPlanToStores } from '../core/plans';
import type { GameState, NationId, SideId, TurnPlan } from '../core/types';
import { sfxClick, sfxPaper, sfxStamp, sfxStatic, stopDrone } from './audio';
import { animOn, clear, h } from './dom';
import { clearDispatches, memoDispatch, showDispatch, type Dispatch } from './general';
import { renderEnd } from './end';
import { renderHq, TAB_ALIAS } from './hq';
import { renderLetter } from './letter';
import { DEBRIEF_ALIAS } from './battle';
import { renderDebrief, renderRadio } from './battle';
import { renderTitle } from './title';
import { renderTheaterChange } from './theaterui';
import { LAN_SAVE, LanSession } from './lan';
import { renderLanSetup, renderLanWait } from './lanscreens';
import { renderSealed } from './orders';
import { storage } from './storage';
import { renderTutorial } from './tutorial';
import { manualOverlay } from './manual';

export type Screen =
  | { kind: 'title' }
  | { kind: 'hq'; side: SideId; tab: string }
  | { kind: 'handover'; side: SideId; next: Screen; phase: string; note?: string }
  | { kind: 'radio'; side: SideId }
  | { kind: 'debrief'; side: SideId; tab: string }
  | { kind: 'end'; side: SideId; tab: string }
  | { kind: 'theater'; side: SideId; next: Screen }
  | { kind: 'lanSetup' }
  | { kind: 'lanWait'; side: SideId }
  | { kind: 'sealed'; side: SideId }
  | { kind: 'letter'; side: SideId; mode: 'returns' | 'week' };

export const AUTOSAVE = 'autosave';

export class App {
  state: GameState | null = null;
  screen: Screen = { kind: 'title' };
  plans: [TurnPlan, TurnPlan] = [emptyPlan(), emptyPlan()];
  /** Squadron selected in the hangar / squadron views. */
  selected: string | null = null;
  toastTimer = 0;
  /** Active LAN session, if this is a LAN game. */
  lan: LanSession | null = null;

  constructor(public root: HTMLElement) {}

  /** The side this machine commands in a LAN game. */
  get lanSide(): SideId {
    return this.lan?.mySide ?? 0;
  }

  endLan() {
    this.lan?.close();
    this.lan = null;
  }

  go(screen: Screen) {
    // Old tab names lead to the tab that now holds them.
    if (screen.kind === 'hq' && TAB_ALIAS[screen.tab]) screen = { ...screen, tab: TAB_ALIAS[screen.tab] };
    if (screen.kind === 'debrief' && DEBRIEF_ALIAS[screen.tab]) screen = { ...screen, tab: DEBRIEF_ALIAS[screen.tab] };
    document.getElementById('toast')?.classList.remove('show', 'bad');
    const prev = this.screen;
    if (prev.kind === 'radio' && screen.kind !== 'radio') stopDrone();
    if (this.covered) this.toggleCover();
    // Dispatches belong to the commander who opened them: a handover clears every card,
    // any other change of screen only the cards not marked persistent.
    const prevSide = 'side' in prev ? prev.side : null;
    const nextSide = 'side' in screen ? screen.side : null;
    if (['handover', 'title', 'lanSetup', 'lanWait'].includes(screen.kind) || prevSide !== nextSide) clearDispatches();
    else if (JSON.stringify(prev) !== JSON.stringify(screen)) clearDispatches(true);
    this.entering = JSON.stringify(prev) !== JSON.stringify(screen);
    this.screen = screen;
    this.render();
    if (screen.kind === 'hq' && screen.tab === 'war' && prev.kind !== 'hq' && prev.kind !== 'letter') this.announceWeek(screen.side);
  }

  /** The screen changed since the last render: the new sheet animates in. */
  entering = false;

  /** Element to pulse after the next render (a readiness chip pointing at a problem). */
  pulse: string | null = null;

  /** Go to an HQ tab and draw the eye to the thing that needs attention. */
  jump(side: SideId, tab: string, focus?: string) {
    sfxClick();
    this.pulse = focus ?? null;
    this.go({ kind: 'hq', side, tab });
  }

  /** Weeks whose High Command memos were already read out ("seed:side:turn"). */
  announced = new Set<string>();

  /** Have the general read out this week's memos when a commander opens the briefing. */
  announceWeek(side: SideId) {
    const st = this.state;
    const key = `${st?.seed}:${side}:${st?.turn}`;
    // The tutorial's adjutant has the floor in a tutorial campaign.
    if (!st || st.outcome || (st as { tutorial?: number }).tutorial !== undefined || this.announced.has(key)) return;
    this.announced.add(key);
    // High Command writes in person only when there is something weighty: new orders, praise or blame.
    if (memoDispatch(st.sides[side], st.turn)) this.go({ kind: 'letter', side, mode: 'week' });
  }

  /** Show a dispatch card (queued behind any already open). */
  dispatch(d: Dispatch) {
    showDispatch(this, d);
  }

  render() {
    setSeats(this.state);
    const scrollers = [...this.root.querySelectorAll<HTMLElement>('[data-keep-scroll]')].map((e) => [e.dataset.keepScroll!, e.scrollTop] as const);
    clear(this.root);
    const s = this.screen;
    let view: HTMLElement;
    switch (s.kind) {
      case 'title':
        view = renderTitle(this);
        break;
      case 'hq':
        view = renderHq(this, s.side, s.tab);
        break;
      case 'handover':
        view = this.renderHandover(s);
        break;
      case 'radio':
        view = renderRadio(this, s.side);
        break;
      case 'debrief':
        view = renderDebrief(this, s.side, s.tab);
        break;
      case 'end':
        view = renderEnd(this, s.side, s.tab);
        break;
      case 'theater':
        view = renderTheaterChange(this, s.side, s.next);
        break;
      case 'lanSetup':
        view = renderLanSetup(this);
        break;
      case 'lanWait':
        view = renderLanWait(this, s.side);
        break;
      case 'sealed':
        view = renderSealed(this, s.side);
        break;
      case 'letter':
        view = renderLetter(this, s.side, s.mode);
        break;
    }
    this.root.append(view);
    // A new sheet is laid on the desk: it rises into place with the sound of paper.
    if (this.entering) {
      view.classList.add('entering');
      if (s.kind === 'hq' || s.kind === 'debrief' || s.kind === 'end') sfxPaper();
      this.entering = false;
    }
    // Evening while planning, night in the radio room, dawn at the debrief.
    document.body.dataset.phase = { title: 'night', radio: 'night', debrief: 'dawn', letter: 'letter', theater: 'letter', end: 'letter' }[s.kind as string] ?? 'plan';
    const manual = manualOverlay(() => this.render());
    if (manual) this.root.append(manual);
    for (const [key, top] of scrollers) {
      const el = this.root.querySelector<HTMLElement>(`[data-keep-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
    if (this.pulse) {
      const el = this.root.querySelector<HTMLElement>(this.pulse);
      this.pulse = null;
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        el.classList.add('pulse');
        setTimeout(() => el.classList.remove('pulse'), 1600);
      }
    }
    renderTutorial(this);
  }

  toast(msg: string, bad = false) {
    let t = document.getElementById('toast');
    if (!t) {
      t = h('div', { id: 'toast' });
      document.body.append(t);
    }
    t.textContent = msg;
    t.className = bad ? 'show bad' : 'show';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t!.className = ''), 2600);
  }

  /** Management commands applied this week, per side (sent with sealed orders in LAN games). */
  pendingCommands: [Command[], Command[]] = [[], []];

  /** Apply a management command for a side, remember it, re-render. */
  cmd(side: SideId, c: Command) {
    const r = applyCommand(this.state!, side, c, this.plans[side]);
    if (!r.ok) {
      this.toast(r.reason, true);
      return;
    }
    this.pendingCommands[side].push(c);
    sfxClick();
    this.render();
  }

  /** Run an action against game state, re-render, toast failures. */
  act(fn: () => { ok: boolean; reason?: string } | void) {
    const r = fn();
    if (r && !r.ok) {
      this.toast(r.reason ?? 'Not possible', true);
      return;
    }
    sfxClick();
    this.render();
  }

  /** Pass the machine to a commander (hotseat only). */
  handover(side: SideId, next: Screen, phase: string, note?: string) {
    this.covered = false;
    this.go({ kind: 'handover', side, next, phase, note });
  }

  planning(side: SideId) {
    const st = this.state!;
    if (st.mode !== 'hotseat') return this.go({ kind: 'hq', side, tab: 'war' });
    const other = st.sides[(1 - side) as SideId];
    this.handover(side, { kind: 'hq', side, tab: 'war' }, `Week ${st.turn} — Planning`, side === 1 && st.sealed[0] ? `${other.commander} has sealed their orders.` : undefined);
  }

  newGame(mode: 'single' | 'hotseat', insight = 0.4, commanders?: [string, string], factions?: [NationId, NationId]) {
    this.state = startCampaign({ mode, aiInsight: insight, seed: `${Date.now()}`, commanders, factions });
    this.plans = [defaultPlan(this.state, 0), defaultPlan(this.state, 1)];
    this.selected = null;
    this.announced.clear();
    if (mode === 'hotseat') {
      this.planning(0);
    } else {
      this.go({ kind: 'hq', side: 0, tab: 'war' });
    }
  }

  /** A Green campaign with the adjutant explaining each step. */
  newTutorial() {
    this.newGame('single', 0.15);
    this.state!.tutorial = 0;
    // The adjutant has the floor: the general's week-one letter waits for another campaign.
    clearDispatches();
    this.go({ kind: 'hq', side: 0, tab: 'war' });
  }

  async loadSlot(slot: string) {
    const json = await storage.load(slot);
    if (!json) {
      this.toast('No saved campaign found', true);
      return;
    }
    try {
      this.state = deserialize(json);
    } catch (e) {
      this.toast(String((e as Error).message), true);
      return;
    }
    this.plans = [defaultPlan(this.state, 0), defaultPlan(this.state, 1)];
    this.announced.clear();
    if (this.state.sealed[0]) this.plans[0] = this.state.sealed[0];
    if (this.state.sealed[1]) this.plans[1] = this.state.sealed[1];
    if (this.state.mode === 'lan' && !this.state.outcome) {
      // A LAN game resumes as host: reopen the port and wait for the other commander.
      const api = window.sbNative?.lan;
      if (!api) {
        this.toast('LAN games can only be resumed in the desktop version.', true);
        return;
      }
      this.endLan();
      this.lan = new LanSession(this, 'host', api);
      if (!(await this.lan.host())) return;
      this.go(this.state.sealed[0] ? { kind: 'lanWait', side: 0 } : { kind: 'hq', side: 0, tab: 'war' });
      return;
    }
    if (this.state.outcome) this.go({ kind: 'end', side: 0, tab: 'summary' });
    // A hotseat save made after the first commander sealed their orders resumes with the second.
    else if (this.state.mode === 'hotseat') this.planning(this.state.sealed[0] ? 1 : 0);
    else this.go({ kind: 'hq', side: 0, tab: 'war' });
  }

  async save(slot?: string) {
    if (!this.state) return;
    // The joining player of a LAN game holds only a partial view; the host keeps the save.
    if (this.lan?.role === 'client') return;
    await storage.save(slot ?? (this.state.mode === 'lan' ? LAN_SAVE : AUTOSAVE), serialize(this.state));
  }

  /** Shrink this side's plan to what the depots can supply. */
  fitToStores(side: SideId) {
    if (this.state) fitPlanToStores(this.state, side, this.plans[side]);
  }

  /**
   * The Seal Orders button. In a two-commander game the commander sees an overview
   * of the sealed orders and may still amend them; a single-player week is fought at once.
   */
  async seal(side: SideId) {
    const st = this.state!;
    if (st.mode === 'hotseat' && side === 1) {
      const v = validatePlan(st.sides[side], this.plans[side], st);
      if (!v.ok) return this.toast(v.reason, true);
      sfxStamp();
      return this.go({ kind: 'sealed', side });
    }
    return this.launch(side);
  }

  /**
   * The moment the orders go out: "ORDERS ISSUED" is stamped on the sheet in
   * front of the commander, and the sheet slides away into the dark while the
   * next screen comes up underneath. A click skips it.
   */
  ordersIssued() {
    const view = this.root.firstElementChild as HTMLElement | null;
    if (!view || !animOn()) return;
    const clone = view.cloneNode(true) as HTMLElement;
    // A cloned canvas comes without its picture: copy the pixels over.
    const from = view.querySelectorAll('canvas');
    const to = clone.querySelectorAll('canvas');
    from.forEach((c, i) => {
      const d = to[i] as HTMLCanvasElement;
      d.width = c.width;
      d.height = c.height;
      d.getContext('2d')?.drawImage(c, 0, 0);
    });
    const sheet = h('div', { class: 'departing', onclick: () => sheet.remove() }, clone, h('div', { class: 'issued-stamp' }, h('span', { class: 'stamp big' }, 'ORDERS ISSUED')));
    document.body.append(sheet);
    sfxStamp();
    window.setTimeout(() => sfxStatic(0.35), 900);
    window.setTimeout(() => sheet.remove(), 1500);
  }

  /** Take sealed orders back to amend them (before the week is fought). */
  unseal(side: SideId) {
    const st = this.state!;
    if (st.mode === 'lan' && this.lan) {
      this.lan.unseal();
      return;
    }
    if (st.mode === 'hotseat' && side === 0) {
      st.sealed[0] = null;
      void this.save();
    }
    this.go({ kind: 'hq', side, tab: 'operations' });
  }

  /** Player confirms orders for a side. */
  async launch(side: SideId) {
    const st = this.state!;
    const v = validatePlan(st.sides[side], this.plans[side], st);
    if (!v.ok) {
      this.toast(v.reason, true);
      return;
    }
    sfxStamp();
    if (st.mode === 'lan' && this.lan) {
      if (this.lan.role === 'host') {
        st.sealed[0] = JSON.parse(JSON.stringify(this.plans[0])) as TurnPlan;
        await this.save();
        await this.lan.hostSealed();
      } else {
        this.lan.clientSealed(JSON.parse(JSON.stringify(this.plans[1])), this.pendingCommands[1]);
      }
      return;
    }
    if (st.mode === 'hotseat' && side === 0) {
      st.sealed[0] = JSON.parse(JSON.stringify(this.plans[0])) as TurnPlan;
      await this.save();
      this.go({ kind: 'sealed', side: 0 });
      return;
    }
    const plans: [TurnPlan, TurnPlan] = st.mode === 'single' ? [this.plans[0], aiPlan(st, 1)] : [st.sealed[0] ?? this.plans[0], this.plans[1]];
    this.ordersIssued();
    resolveTurn(st, plans);
    this.pendingCommands = [[], []];
    // Carry standing orders (assignments, returns policy) into the next turn.
    this.plans = [carryPlan(st, 0, this.plans[0]), carryPlan(st, 1, this.plans[1])];
    await this.save();
    if (st.mode === 'hotseat') {
      this.handover(0, { kind: 'radio', side: 0 }, `Week ${st.turn - (st.outcome ? 0 : 1)} — Operations report`);
    } else {
      this.go({ kind: 'radio', side: 0 });
    }
  }

  /** The commander files the debrief: High Command answers in full screen, then the week moves on. */
  fileReports(side: SideId) {
    const st = this.state!;
    const d = st.lastDebriefs[side];
    if (!d) return this.afterDebrief(side);
    // The letter carries this week's memos; the War Room need not read them out again.
    this.announced.add(`${st.seed}:${side}:${st.turn}`);
    this.go({ kind: 'letter', side, mode: 'returns' });
  }

  /** After a side has read its debrief. */
  afterDebrief(side: SideId) {
    const st = this.state!;
    // A theater was decided this week: show the redeployment briefing first.
    const last = st.archive[st.archive.length - 1];
    if (last && last.theater !== st.theater.index && this.screen.kind !== 'theater') {
      const resume = () => this.afterDebriefContinue(side);
      this.continueAfterTheater = resume;
      this.go({ kind: 'theater', side, next: { kind: 'title' } });
      return;
    }
    this.afterDebriefContinue(side);
  }

  continueAfterTheater: (() => void) | null = null;

  afterDebriefContinue(side: SideId) {
    const st = this.state!;
    if (st.mode === 'lan') {
      this.go(st.outcome ? { kind: 'end', side, tab: 'summary' } : { kind: 'hq', side, tab: 'war' });
      return;
    }
    if (st.mode === 'hotseat' && side === 0) {
      this.handover(1, { kind: 'radio', side: 1 }, `Week ${st.turn - (st.outcome ? 0 : 1)} — Operations report`);
      return;
    }
    if (st.outcome) {
      if (st.mode === 'hotseat') this.go({ kind: 'end', side: 0, tab: 'summary' });
      else this.go({ kind: 'end', side: 0, tab: 'summary' });
      return;
    }
    this.planning(0);
  }

  renderHandover(s: Extract<Screen, { kind: 'handover' }>): HTMLElement {
    const side = this.state!.sides[s.side];
    return h(
      'div',
      { class: 'handover' },
      h('div', { class: `handover-card folder paper side${look(s.side)}` },
        h('div', { class: 'folder-tab' }, FOLDER_TAB[nationAt(side.id).id]),
        h('div', { class: 'stamp big' }, 'MOST SECRET'),
        h('div', { class: `crest big nation-${nationAt(s.side).id}` }),
        h('div', { class: 'handover-for' }, 'For the eyes of'),
        h('h1', null, side.commander),
        h('div', { class: 'handover-side' }, `${nationAt(side.id).wing} · ${side.name}`),
        h('div', { class: 'handover-phase' }, s.phase),
        s.note ? h('p', { class: 'handwritten' }, s.note) : null,
        h('p', { class: 'muted' }, 'Hand over the controls. The other commander should look away until this folder is closed again.'),
        h('button', { class: 'btn primary', onclick: () => { sfxStamp(); this.go(s.next); } }, 'Open the folder'),
      ),
    );
  }

  /** Privacy cover for hotseat: hides the screen until clicked. */
  covered = false;
  toggleCover() {
    if (!this.state || !['hq', 'debrief', 'radio', 'sealed', 'lanWait', 'letter'].includes(this.screen.kind)) return;
    this.covered = !this.covered;
    let el = document.getElementById('cover');
    if (this.covered) {
      if (!el) {
        el = h('div', { id: 'cover', onclick: () => this.toggleCover() },
          h('div', { class: 'handover-card paper' }, h('div', { class: 'stamp big' }, 'MOST SECRET'), h('p', null, 'Folder closed. Click or press Esc to open it again.')));
        document.body.append(el);
      }
    } else el?.remove();
  }
}

export { carryPlan, defaultPlan } from '../core/plans';

export function sideOf(app: App, side: SideId) {
  return app.state!.sides[side];
}
