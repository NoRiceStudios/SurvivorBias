/**
 * The development board: the wing's aircraft on the apron as they look today, and under them one
 * tree per branch. Projects are cards joined by lines to the project they build on; a tag marks the
 * ones that change how the aircraft look, and pointing at one shows the change on the apron.
 */
import { researchCost } from '../core/factions';
import { researchTurns } from '../core/actions';
import { BRANCHES, RESEARCH, type Branch, type ResearchItem } from '../core/data';
import type { AircraftKind, SideState } from '../core/types';
import type { App } from './app';
import { h } from './dom';
import { icon } from './icons';
import { LIVERY, visibleOn } from './livery';
import { nationAt } from './nation';
import { aircraftCanvas } from './sprites';
import { tip } from './tip';

const KINDS: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];

interface Placed {
  item: ResearchItem;
  col: number;
  row: number;
  /** rows between this card and its parent (children hang below or level with it) */
  up: number;
}

/** Cards on a grid: a project sits one column right of the one it builds on, extra children go below. */
function layout(branch: Branch): { placed: Placed[]; cols: number; rows: number } {
  const items = RESEARCH.filter((r) => r.branch === branch);
  const placed: Placed[] = [];
  let row = 0;
  const place = (r: ResearchItem, col: number, parentRow: number) => {
    placed.push({ item: r, col, row, up: row - parentRow });
    const here = row;
    items.filter((x) => x.requires === r.id).forEach((k, i) => {
      if (i > 0) row++;
      place(k, col + 1, here);
    });
  };
  for (const r of items.filter((x) => !x.requires)) {
    place(r, 0, row);
    row++;
  }
  return { placed, cols: Math.max(...placed.map((p) => p.col)) + 1, rows: row };
}

/** The apron: today's aircraft, or with one more project fitted. */
function hangar(side: SideState): { el: HTMLElement; show: (preview?: string) => void } {
  const row = h('div', { class: 'hangar-row' });
  const note = h('div', { class: 'hangar-note small muted' });
  const show = (preview?: string) => {
    row.replaceChildren(...KINDS.filter((k) => k !== 'heavy' || side.research.includes('heavyAirframe') || preview === 'heavyMk2').map((k) => {
      const mods = [...side.research, ...(preview ? [preview] : [])].filter((id) => visibleOn(id, k));
      const fresh = !!preview && visibleOn(preview, k);
      return h('figure', { class: `hangar-plane ${fresh ? 'fresh' : ''}` },
        h('div', { class: 'hangar-pad' }, aircraftCanvas(k, { side: side.id, seed: 3, research: side.research, preview }, k === 'heavy' ? 2 : k === 'medium' ? 2 : 3)),
        h('figcaption', null, nationAt(side.id).aircraft[k], h('small', null, mods.length ? ` · ${mods.length} fitted` : ' · as delivered')));
    }));
    const pv = preview ? RESEARCH.find((r) => r.id === preview) : undefined;
    note.textContent = pv && LIVERY[pv.id] ? `${pv.name}: ${LIVERY[pv.id].look}` : pv ? `${pv.name} does not change how the aircraft look.` : 'Point at a project to see what it does to the aircraft.';
  };
  show();
  return { el: h('div', { class: 'hangar' }, row, note), show };
}

export function techTree(app: App, side: SideState): HTMLElement {
  const current = RESEARCH.find((r) => r.id === side.researching);
  const sup = side.resources.supplies;
  const done = RESEARCH.filter((r) => side.research.includes(r.id)).length;
  const bay = hangar(side);

  const card = (p: Placed, hasLook: boolean): HTMLElement => {
    const r = p.item;
    const isDone = side.research.includes(r.id);
    const locked = !!r.requires && !side.research.includes(r.requires);
    const active = side.researching === r.id;
    const need = RESEARCH.find((x) => x.id === r.requires)?.name;
    const cost = researchCost(side, r);
    const can = !isDone && !active && !locked && !side.researching && sup >= cost;
    const state = isDone ? 'done' : active ? 'active' : locked ? 'locked' : can ? 'can' : 'wait';
    const sub = isDone ? '✓ in service' : active ? `${side.researchProgress}/${researchTurns(cost)} weeks` : locked ? `needs ${need}` : sup < cost && !side.researching ? `${cost} · short ${cost - sup}` : `${cost} · ${researchTurns(cost)}w`;
    const effect = isDone ? 'in service' : locked ? `needs ${need}` : `${cost} supplies, ${researchTurns(cost)} weeks`;
    const prog = active ? h('i', { class: 'tn-bar', style: `width:${(side.researchProgress / researchTurns(cost)) * 100}%` }) : null;
    return h('button', {
      class: `tn ${state} ${p.col > 0 ? 'child' : ''}`,
      style: `grid-column:${p.col + 1};grid-row:${p.row + 1};--up:${p.up}`,
      ...tip({ head: r.name, text: hasLook ? `${r.desc} ${LIVERY[r.id].look}` : r.desc, effect }),
      disabled: !can,
      onclick: () => app.cmd(side.id, { k: 'research', id: r.id }),
      onmouseenter: () => bay.show(r.id),
      onmouseleave: () => bay.show(),
      onfocus: () => bay.show(r.id),
      onblur: () => bay.show(),
    },
    h('span', { class: 'tn-medal' }, icon(BRANCHES.find((b) => b.id === r.branch)!.id, 18)),
    h('span', { class: 'tn-text' }, h('span', { class: 'tn-name' }, r.name), h('span', { class: 'tn-sub' }, sub)),
    hasLook ? h('span', { class: 'tn-look', ...tip({ head: 'Visible on the aircraft', text: LIVERY[r.id].look }) }, icon('plane', 14)) : null,
    prog);
  };

  const branch = (b: (typeof BRANCHES)[number]): HTMLElement => {
    const { placed, cols, rows } = layout(b.id);
    const n = placed.filter((p) => side.research.includes(p.item.id)).length;
    return h('div', { class: `tree tree-${b.id}` },
      h('div', { class: 'tree-head' }, icon(b.id, 22), h('span', { class: 'tree-name' }, b.name), h('span', { class: 'tree-count' }, `${n}/${placed.length}`)),
      h('div', { class: 'tree-grid', style: `grid-template-columns:repeat(${cols},minmax(0,1fr));grid-template-rows:repeat(${rows},var(--rh))` },
        placed.map((p) => card(p, !!LIVERY[p.item.id]))));
  };

  return h('section', { class: 'paper panel works-col works-research' },
    h('h2', null, 'Development'),
    current
      ? h('div', { class: 'in-works' }, h('span', { class: 'stamp order' }, 'IN THE WORKS'), ' ', h('b', null, current.name),
        h('div', { class: 'small muted' }, `${side.researchProgress}/${researchTurns(researchCost(side, current))} weeks · ${current.desc}`))
      : h('p', { class: 'small warnc' }, 'Engineers idle: fund one project. One at a time.'),
    h('div', { class: 'small muted' }, `${done} of ${RESEARCH.length} in service.`),
    bay.el,
    h('div', { class: 'trees' }, BRANCHES.map(branch)));
}
