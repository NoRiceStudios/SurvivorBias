/** Small building blocks shared by the HQ screens. */
import { TARGETS } from '../core/data';
import { flyable } from '../core/sim';
import type { SideState, TargetId } from '../core/types';
import type { App } from './app';
import { h } from './dom';
import { tip, type Tip } from './tip';

type Child = Node | string | null | false | undefined | Child[];

export function panel(title: string | null, ...children: Child[]): HTMLElement {
  return h('section', { class: 'paper panel' }, title ? h('h2', null, title) : null, ...children);
}

/** A segmented control: one choice of several, the chosen one filled. */
export function seg<T extends string | number>(options: { value: T; label: string; tip?: Tip | string; disabled?: boolean }[], current: T | undefined, pick: (v: T) => void, cls = ''): HTMLElement {
  return h('div', { class: `seg ${cls}` }, options.map((o) =>
    h('button', {
      class: `seg-btn ${o.value === current ? 'on' : ''}`,
      disabled: o.disabled,
      ...(o.tip ? tip(o.tip) : {}),
      onclick: () => { if (o.value !== current) pick(o.value); },
    }, o.label)));
}

/** Pips for a 0..1 value (e.g. fatigue), red past a threshold. */
export function pips(value: number, n = 10, badAt = 0.7, invert = false): HTMLElement {
  const k = Math.round(Math.max(0, Math.min(1, value)) * n);
  const bad = invert ? value <= 1 - badAt : value >= badAt;
  return h('span', { class: `pips ${bad ? 'bad' : ''}` }, Array.from({ length: n }, (_, i) => h('i', { class: i < k ? 'on' : '' })));
}

export function missionLabel(app: App, raid: { target: TargetId; siteId?: string }): string {
  if (raid.target === 'support' || raid.target === 'sweep') return TARGETS[raid.target].name;
  return app.state!.theater.sites.find((x) => x.id === raid.siteId)?.name ?? TARGETS[raid.target].name;
}

export function countPlanes(side: SideState, ids: string[], plan?: { sorties?: Record<string, number> }): number {
  return ids.reduce((a, id) => {
    const sq = side.squadrons.find((s) => s.id === id);
    return a + (sq ? flyable(sq, plan?.sorties?.[sq.id]).length : 0);
  }, 0);
}
