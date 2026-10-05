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
  | { kind: 'handover'; side: SideId; next: Screen; phase: string; note?: string }
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
    if (this.covered) this.toggleCover();
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

  /** Pass the machine to a commander (hotseat only). */
  handover(side: SideId, next: Screen, phase: string, note?: string) {
    this.covered = false;
    this.go({ kind: 'handover', side, next, phase, note });
  }

  planning(side: SideId) {
    const st = this.state!;
    if (st.mode !== 'hotseat') return this.go({ kind: 'hq', side, tab: 'briefing' });
    const other = st.sides[(1 - side) as SideId];
    this.handover(side, { kind: 'hq', side, tab: 'briefing' }, `Week ${st.turn} — Planning`, side === 1 && st.sealed[0] ? `${other.commander} has sealed their orders.` : undefined);
  }

  newGame(mode: 'single' | 'hotseat', insight = 0.4, commanders?: [string, string]) {
    this.state = startCampaign({ mode, aiInsight: insight, seed: `${Date.now()}`, commanders });
    this.plans = [defaultPlan(this.state, 0), defaultPlan(this.state, 1)];
    this.selected = null;
    if (mode === 'hotseat') {
      this.planning(0);
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
    if (this.state.sealed[0]) this.plans[0] = this.state.sealed[0];
    if (this.state.outcome) this.go({ kind: 'end', side: 0, tab: 'summary' });
    // A hotseat save made after the first commander sealed their orders resumes with the second.
    else if (this.state.mode === 'hotseat') this.planning(this.state.sealed[0] ? 1 : 0);
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
      st.sealed[0] = JSON.parse(JSON.stringify(this.plans[0])) as TurnPlan;
      await this.save();
      this.planning(1);
      return;
    }
    const plans: [TurnPlan, TurnPlan] = st.mode === 'single' ? [this.plans[0], aiPlan(st, 1)] : [st.sealed[0] ?? this.plans[0], this.plans[1]];
    resolveTurn(st, plans);
    // Carry standing orders (assignments, returns policy) into the next turn.
    this.plans = [carryPlan(st, 0, this.plans[0]), carryPlan(st, 1, this.plans[1])];
    await this.save();
    if (st.mode === 'hotseat') {
      this.handover(0, { kind: 'radio', side: 0 }, `Week ${st.turn - (st.outcome ? 0 : 1)} — Operations report`);
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
      h('div', { class: `handover-card paper side${s.side}` },
        h('div', { class: 'stamp big' }, 'MOST SECRET'),
        h('div', { class: `crest big side${s.side}` }),
        h('div', { class: 'handover-for' }, 'For the eyes of'),
        h('h1', null, side.commander),
        h('div', { class: 'handover-side' }, side.id === 0 ? `No. 7 Composite Wing · ${side.name}` : `Kampfgeschwader Nord · ${side.name}`),
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
    if (!this.state || !['hq', 'debrief', 'radio'].includes(this.screen.kind)) return;
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

export function sideOf(app: App, side: SideId) {
  return app.state!.sides[side];
}
