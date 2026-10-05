/** Theater map: a strip of sectors with sites, ownership and the front line. */
import { SECTOR_PRESSURE, SECTORS, THEATERS, depthFor } from '../core/theaters';
import type { FacilityType, GameState, SideId, Site } from '../core/types';
import type { App } from './app';
import { sfxStamp } from './audio';
import { h } from './dom';

const CELL_W = 96;
const H = 74;

const ICON: Record<FacilityType, string[]> = {
  airfield: [
    '...k...',
    '...k...',
    'kkkkkkk',
    '...k...',
    '...k...',
    '..kkk..',
    '.......',
  ],
  industry: [
    'k......',
    'k...k..',
    'k...k..',
    'kk.kkk.',
    'kkkkkkk',
    'kkkkkkk',
    '.......',
  ],
  fuel: [
    '.kkkkk.',
    'kk...kk',
    'k.....k',
    'kkkkkkk',
    'k.....k',
    'kkkkkkk',
    '.......',
  ],
};

export interface MapOpts {
  viewer: SideId;
  /** Highlight a site (selected target). */
  selected?: string;
  /** Sectors patrolled by the viewer's fighters. */
  patrols?: number[];
  /** Sector the viewer is feinting at. */
  feint?: number;
  /** Show the viewer's believed condition for enemy sites rather than the truth. */
  scale?: number;
}

/** Believed condition the viewer has for a site (truth for own sites). */
export function believed(state: GameState, viewer: SideId, site: Site): number {
  return site.owner === viewer ? site.condition : state.sides[viewer].perceived.sites[site.id] ?? 100;
}

export function theaterMap(state: GameState, opts: MapOpts): HTMLCanvasElement {
  const t = state.theater;
  const def = THEATERS[t.index];
  const W = CELL_W * SECTORS;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const scale = opts.scale ?? 2;
  c.style.width = `${W * scale}px`;
  c.style.height = `${H * scale}px`;
  c.className = 'pix theater-map';
  const g = c.getContext('2d')!;
  // Draw from the viewer's side: own territory on the left.
  const col = (sector: number) => (opts.viewer === 0 ? sector : SECTORS - 1 - sector);
  for (let s = 0; s < SECTORS; s++) {
    const x0 = col(s) * CELL_W;
    const mine = (s < t.held0 ? 0 : 1) === opts.viewer;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < CELL_W; x++) {
        const n = ((x * 7 + y * 13 + s * 31) % 17) / 17;
        g.fillStyle = mine ? (n > 0.85 ? '#cdbf96' : '#d8cca6') : n > 0.85 ? '#b3a684' : '#bdb08c';
        g.fillRect(x0 + x, y, 1, 1);
      }
    // Sector boundary
    g.fillStyle = 'rgba(42,38,32,0.35)';
    for (let y = 0; y < H; y += 3) g.fillRect(x0, y, 1, 1);
    if (opts.patrols?.includes(s)) {
      g.strokeStyle = '#2c4672';
      g.lineWidth = 1;
      g.setLineDash([2, 2]);
      g.strokeRect(x0 + 3.5, 3.5, CELL_W - 7, H - 7);
      g.setLineDash([]);
    }
    if (opts.feint === s) {
      g.fillStyle = '#b0302a';
      for (let k = 4; k < CELL_W - 4; k += 4) { g.fillRect(x0 + k, 4, 2, 1); g.fillRect(x0 + k, H - 16, 2, 1); }
      g.font = '8px monospace';
      g.fillText('FEINT', x0 + CELL_W - 30, 12);
    }
    // Sector name
    g.fillStyle = '#2a2620';
    g.font = '8px monospace';
    g.fillText(def.sectors[s].slice(0, 15), x0 + 4, H - 5);
  }
  // Sites
  for (const site of t.sites) {
    const idx = t.sites.filter((x) => x.sector === site.sector).indexOf(site);
    const x = col(site.sector) * CELL_W + 14 + idx * 34;
    const y = 18 + (idx % 2) * 14;
    const cond = believed(state, opts.viewer, site);
    const color = cond > 66 ? '#2a2620' : cond > 33 ? '#8a5a1a' : '#b0302a';
    if (site.id === opts.selected) {
      g.fillStyle = '#b0302a';
      g.fillRect(x - 3, y - 3, 13, 13);
      g.fillStyle = '#e9dfc4';
      g.fillRect(x - 2, y - 2, 11, 11);
    }
    ICON[site.type].forEach((row, ry) =>
      [...row].forEach((ch, rx) => {
        if (ch !== 'k') return;
        g.fillStyle = color;
        g.fillRect(x + rx, y + ry, 1, 1);
      }),
    );
    // Condition pips
    for (let k = 0; k < 5; k++) {
      g.fillStyle = k < Math.round(cond / 20) ? color : 'rgba(42,38,32,0.2)';
      g.fillRect(x + k * 2 - 1, y + 9, 1, 2);
    }
  }
  // Front line, displaced by the reported pressure.
  const boundary = opts.viewer === 0 ? t.held0 : SECTORS - t.held0;
  const press = state.sides[opts.viewer].perceived.front / SECTOR_PRESSURE;
  const fx = boundary * CELL_W + Math.round(Math.max(-0.9, Math.min(0.9, press)) * CELL_W * 0.35);
  for (let y = 0; y < H; y++) {
    const wob = Math.round(Math.sin(y / 5) * 2);
    g.fillStyle = '#b0302a';
    g.fillRect(fx + wob, y, 2, 1);
  }
  // Pressure arrow
  const dir = press >= 0 ? 1 : -1;
  g.fillStyle = '#b0302a';
  const ay = 8;
  for (let i = 0; i < 4; i++) g.fillRect(fx + dir * (4 + i), ay - (3 - i), 1, (3 - i) * 2 + 1);
  return c;
}

/** Short label for how deep a site lies from the viewer's front. */
export function depthLabel(state: GameState, viewer: SideId, site: Site): string {
  const d = depthFor(state.theater.held0, viewer, site.sector);
  return d === 1 ? 'Frontline' : d === 2 ? 'Second line' : 'Rear area';
}

export function mapLegend(): HTMLElement {
  return h('div', { class: 'map-legend' },
    h('span', null, '✈ Airfield'), h('span', null, '▙ Works'), h('span', null, '◘ Fuel'),
    h('span', { class: 'red' }, '| Front (arrow: pressure)'), h('span', { class: 'blue' }, '┅ Our patrols'), h('span', { class: 'red' }, '╌ Feint'),
  );
}

/** Shown when a theater is decided and the wing redeploys (or the war ends). */
export function renderTheaterChange(app: App, side: SideId, _next: unknown): HTMLElement {
  const st = app.state!;
  const res = st.theaterResults[st.theaterResults.length - 1];
  const won = res.winner === side;
  const verdict = res.winner === null ? 'DEADLOCK' : won ? 'VICTORY' : 'DEFEAT';
  const nextDef = st.outcome ? null : THEATERS[st.theater.index];
  const obj = st.outcome ? null : st.theater.objectives.find((o) => o.side === side);
  return h('div', { class: 'handover' },
    h('div', { class: 'handover-card paper theater-change' },
      h('div', { class: 'muted' }, `${res.name} · ${res.weeks} weeks`),
      h('div', { class: `stamp big ${won ? 'notice' : res.winner === null ? 'order' : 'reprimand'}` }, verdict),
      h('p', { class: 'typed big' }, res.winner === null
        ? 'Neither air force could break the other. The armies dig in where they stand.'
        : won ? (res.decisive ? 'The enemy front has broken. The Army is through.' : 'The season ends with the advantage ours.')
        : res.decisive ? 'Our front has broken. The Army is falling back.' : 'The season ends with the advantage theirs.'),
      nextDef ? h('div', { class: 'next-theater' },
        h('h2', null, `Redeployment: ${nextDef.name}`),
        h('div', { class: 'muted' }, `${nextDef.season} · ${nextDef.weeks} weeks`),
        h('p', null, nextDef.blurb),
        theaterMap(st, { viewer: side, scale: 2 }),
        obj ? h('p', { class: 'small' }, `Secondary objective: ${obj.text}`) : null,
        h('p', { class: 'muted small' }, 'Aircraft in repair have been made serviceable during the move. Squadrons are rested.'),
      ) : h('p', null, 'This was the last theater of the war.'),
      h('button', { class: 'btn primary', onclick: () => { sfxStamp(); const go = app.continueAfterTheater; app.continueAfterTheater = null; go?.(); } }, 'Continue ▸'),
    ),
  );
}
