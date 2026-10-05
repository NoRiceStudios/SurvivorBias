import { aiPlan } from '../core/ai';
import { emptyPlan, validatePlan } from '../core/actions';
import { deserialize, serialize, startCampaign } from '../core/game';
import { resolveTurn } from '../core/turn';
import { depthFor, reachableSites } from '../core/theaters';
import type { GameState, SideId, TurnPlan } from '../core/types';
import { sfxClick, sfxStamp, stopDrone } from './audio';
import { clear, h } from './dom';
import { renderEnd } from './end';
import { renderHq } from './hq';
import { renderDebrief, renderRadio } from './battle';
import { renderTitle } from './title';
import { renderTheaterChange } from './theaterui';
import { storage } from './storage';

export type Screen =
  | { kind: 'title' }
  | { kind: 'hq'; side: SideId; tab: string }
  | { kind: 'handover'; side: SideId; next: Screen; message: string }
  | { kind: 'radio'; side: SideId }
  | { kind: 'debrief'; side: SideId; tab: string }
  | { kind: 'end'; side: SideId; tab: string }
  | { kind: 'theater'; side: SideId; next: Screen };

export const AUTOSAVE = 'autosave';

export class App {
  state: GameState | null = null;
  screen: Screen = { kind: 'title' };
  plans: [TurnPlan, TurnPlan] = [emptyPlan(), emptyPlan()];
  /** Squadron selected in the hangar / squadron views. */
  selected: string | null = null;
  toastTimer = 0;

  constructor(public root: HTMLElement) {}

  go(screen: Screen) {
    if (this.screen.kind === 'radio' && screen.kind !== 'radio') stopDrone();
    this.screen = screen;
    this.render();
  }

  render() {
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
    }
    this.root.append(view);
    for (const [key, top] of scrollers) {
      const el = this.root.querySelector<HTMLElement>(`[data-keep-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
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

  newGame(mode: 'single' | 'hotseat', insight = 0.4) {
    this.state = startCampaign({ mode, aiInsight: insight, seed: `${Date.now()}` });
    this.plans = [defaultPlan(this.state, 0), defaultPlan(this.state, 1)];
    this.selected = null;
    if (mode === 'hotseat') {
      this.go({ kind: 'handover', side: 0, next: { kind: 'hq', side: 0, tab: 'briefing' }, message: `${this.state.sides[0].name} — Week 1` });
    } else {
      this.go({ kind: 'hq', side: 0, tab: 'briefing' });
    }
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
    if (this.state.outcome) this.go({ kind: 'end', side: 0, tab: 'summary' });
    else if (this.state.mode === 'hotseat')
      this.go({ kind: 'handover', side: 0, next: { kind: 'hq', side: 0, tab: 'briefing' }, message: `${this.state.sides[0].name} — Week ${this.state.turn}` });
    else this.go({ kind: 'hq', side: 0, tab: 'briefing' });
  }

  async save(slot = AUTOSAVE) {
    if (!this.state) return;
    await storage.save(slot, serialize(this.state));
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
    if (st.mode === 'hotseat' && side === 0) {
      this.go({ kind: 'handover', side: 1, next: { kind: 'hq', side: 1, tab: 'briefing' }, message: `${st.sides[1].name} — Week ${st.turn}` });
      return;
    }
    const plans: [TurnPlan, TurnPlan] = st.mode === 'single' ? [this.plans[0], aiPlan(st, 1)] : this.plans;
    resolveTurn(st, plans);
    // Carry standing orders (assignments, returns policy) into the next turn.
    this.plans = [carryPlan(st, 0, this.plans[0]), carryPlan(st, 1, this.plans[1])];
    await this.save();
    if (st.mode === 'hotseat') {
      this.go({ kind: 'handover', side: 0, next: { kind: 'radio', side: 0 }, message: `${st.sides[0].name} — Operations report` });
    } else {
      this.go({ kind: 'radio', side: 0 });
    }
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
    if (st.mode === 'hotseat' && side === 0) {
      this.go({ kind: 'handover', side: 1, next: { kind: 'radio', side: 1 }, message: `${st.sides[1].name} — Operations report` });
      return;
    }
    if (st.outcome) {
      if (st.mode === 'hotseat') this.go({ kind: 'handover', side: 0, next: { kind: 'end', side: 0, tab: 'summary' }, message: 'The war is over' });
      else this.go({ kind: 'end', side: 0, tab: 'summary' });
      return;
    }
    if (st.mode === 'hotseat') this.go({ kind: 'handover', side: 0, next: { kind: 'hq', side: 0, tab: 'briefing' }, message: `${st.sides[0].name} — Week ${st.turn}` });
    else this.go({ kind: 'hq', side: 0, tab: 'briefing' });
  }

  renderHandover(s: Extract<Screen, { kind: 'handover' }>): HTMLElement {
    return h(
      'div',
      { class: 'handover' },
      h('div', { class: 'handover-card paper' },
        h('div', { class: 'stamp big' }, 'MOST SECRET'),
        h('h1', null, s.message),
        h('p', null, 'Hand the controls to the commander named above. The other commander should look away.'),
        h('button', { class: 'btn primary', onclick: () => { sfxStamp(); this.go(s.next); } }, 'I am ready'),
      ),
    );
  }
}

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
    embellish: prev.embellish,
  };
}

export function sideOf(app: App, side: SideId) {
  return app.state!.sides[side];
}
