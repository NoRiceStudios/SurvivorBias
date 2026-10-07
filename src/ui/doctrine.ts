/**
 * Squadron doctrine: the sliders, what the current settings do, what a change
 * would do (previewed live while a slider is dragged), and two small drawings:
 * the formation from above and the bombing height from the side.
 */
import { AIRCRAFT } from '../core/data';
import { altitudeFeet, doctrineEffects, doctrineKeys, doctrineSummary, type DoctrineEffect, type DoctrineKey } from '../core/doctrine';
import { flyable } from '../core/sim';
import type { Doctrine, SideState, Squadron } from '../core/types';
import type { App } from './app';
import { h, slider } from './dom';
import { tip } from './tip';

const LABEL: Record<DoctrineKey, [string, string, string]> = {
  formation: ['Formation', 'Loose', 'Tight box'],
  altitude: ['Altitude', 'Low', 'High'],
  aggression: ['Aggression', 'Preserve', 'Press on'],
  breakOff: ['Break off at', '10% lost', 'Never'],
};

export function doctrinePanel(app: App, side: SideState, sq: Squadron): HTMLElement {
  const keys = doctrineKeys(sq.kind);
  if (!keys.length) return h('div', { class: 'doctrine' }, h('h3', null, 'Doctrine'), h('p', { class: 'muted small' }, 'Photographic aircraft fly alone, high and fast, and avoid a fight. There is nothing to set.'));
  const now = sq.doctrine;
  let preview: Doctrine = { ...now };
  let active: DoctrineKey | null = null;
  const effects = h('div', { class: 'doc-effects' });
  const pictures = h('div', { class: 'doc-pictures' });
  const summaries = {} as Record<DoctrineKey, HTMLElement>;
  const paint = () => {
    effects.replaceChildren(effectsTable(sq, now, preview, active));
    pictures.replaceChildren(
      ...(keys.includes('formation') ? [figure('Formation, seen from above', formationCanvas(sq, preview.formation))] : []),
      figure(`Height over the target: ${altitudeFeet(preview.altitude).toLocaleString('en-GB')} ft`, altitudeCanvas(sq, preview.altitude)),
    );
    for (const k of keys) summaries[k].textContent = doctrineSummary(sq.kind, k, preview[k]);
  };
  const rows = keys.map((k) => {
    summaries[k] = h('div', { class: 'doc-sum small muted' });
    const [label, lo, hi] = LABEL[k];
    return h('div', { class: 'doc-row2' },
      h('span', { class: 'doc-label' }, label),
      slider(now[k], (v) => app.cmd(side.id, { k: 'doctrine', sq: sq.id, d: { [k]: v } }), lo, hi, 0.05, (v) => {
        preview = { ...preview, [k]: v };
        active = k;
        paint();
      }),
      summaries[k]);
  });
  paint();
  return h('div', { class: 'doctrine' },
    h('h3', null, 'Doctrine'),
    h('div', { class: 'doc-sliders' }, rows),
    pictures,
    h('details', { class: 'doc-details', open: true },
      h('summary', null, 'What these settings do'),
      effects,
      h('p', { class: 'muted small' }, 'Drag a slider to see the change before you let go. Hover a row for why.')),
  );
}

function figure(caption: string, c: HTMLCanvasElement): HTMLElement {
  return h('figure', { class: 'doc-figure' }, c, h('figcaption', { class: 'small muted' }, caption));
}

function effectsTable(sq: Squadron, now: Doctrine, preview: Doctrine, active: DoctrineKey | null): HTMLElement {
  const mid = doctrineEffects(sq.kind, { aggression: 0.5, formation: 0.5, altitude: 0.5, breakOff: 0.5 }, sq.skill);
  const a = doctrineEffects(sq.kind, now, sq.skill);
  const b = doctrineEffects(sq.kind, preview, sq.skill);
  const changed = a.some((e, i) => e.value !== b[i].value);
  // Every effect as a change against the standard setting: green where it helps us, red where it hurts, grey when neutral.
  const delta = (e: DoctrineEffect, i: number) => e.raw - (e.unit === '%' ? 0 : mid[i].raw);
  const fmt = (e: DoctrineEffect, i: number) => {
    if (e.good === 0) return e.value;
    const d = Math.round(delta(e, i));
    return `${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}${e.unit === '%' ? '%' : ' pts'}`;
  };
  const tone = (e: DoctrineEffect, i: number) => {
    const d = delta(e, i) * e.good;
    return e.good === 0 || Math.abs(delta(e, i)) < 0.5 ? 'neutral' : d > 0 ? 'good' : 'bad';
  };
  const span = (i: number) => Math.max(8, ...[a[i], b[i]].map((e) => Math.abs(delta(e, i)))) * 1.15;
  const seg = (e: DoctrineEffect, i: number, cls: string) => {
    const d = e.good === 0 ? 0 : delta(e, i);
    const w = Math.min(50, (Math.abs(d) / span(i)) * 50);
    return h('i', { class: `${cls} ${tone(e, i)}`, style: `left:${d < 0 ? 50 - w : 50}%;width:${w}%` });
  };
  return h('table', { class: 'doc-table' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num', colspan: '2' }, 'vs. standard'), changed ? h('th', { class: 'num' }, 'after change') : null)),
    h('tbody', null, a.map((e, i) => {
      const f = b[i];
      const better = e.good !== 0 && f.raw !== e.raw && (f.raw > e.raw) === (e.good > 0);
      const worse = e.good !== 0 && f.raw !== e.raw && !better;
      return h('tr', { class: active && e.keys.includes(active) ? 'hot' : '', ...tip({ head: e.label, text: `${e.why} Now: ${e.value}${e.unit === 'pts' && e.good !== 0 ? '' : ' against standard'}.` }) },
        h('td', null, e.label),
        h('td', { class: 'barcell' }, h('span', { class: 'div-bar' }, h('span', { class: 'div-mid' }), changed ? seg(e, i, 'ghost') : null, seg(changed ? f : e, i, 'val'))),
        h('td', { class: `num ${tone(e, i)}` }, fmt(e, i)),
        changed ? h('td', { class: `num ${better ? 'good' : worse ? 'bad' : ''}` }, f.value === e.value ? '—' : `${better ? '▲' : worse ? '▼' : '•'} ${fmt(f, i)}`) : null);
    })));
}

/* ---------------- Drawings ---------------- */

const INK = '#2a2620';
const PAPER = '#e3d7b6';

function canvas(w: number, h0: number, scale = 2): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h0;
  c.className = 'pix doc-canvas';
  c.style.width = `${w * scale}px`;
  c.style.height = `${h0 * scale}px`;
  const g = c.getContext('2d')!;
  return [c, g];
}

/** A bomber seen from above, 7 px wide, pointing up. */
function topPlane(g: CanvasRenderingContext2D, x: number, y: number, col: string) {
  g.fillStyle = col;
  g.fillRect(x, y - 3, 1, 7); // fuselage
  g.fillRect(x - 3, y - 1, 7, 1); // wing
  g.fillRect(x - 1, y + 3, 3, 1); // tail
}

/** Positions of a squadron in formation: a vee of vees, closing up as `tight` rises. */
function formationPositions(n: number, tight: number): [number, number][] {
  const gap = 20 - tight * 13;
  const out: [number, number][] = [];
  // Three elements of three: lead, left, right; each a small vee.
  const elements: [number, number][] = [[0, 0], [-1.6, 1.2], [1.6, 1.2], [0, 2.5]];
  for (let i = 0; out.length < n && i < elements.length; i++) {
    const [ex, ey] = elements[i];
    const vee: [number, number][] = [[0, 0], [-0.55, 0.5], [0.55, 0.5]];
    for (const [vx, vy] of vee) {
      if (out.length >= n) break;
      // A loose formation also wanders out of station.
      const wob = (1 - tight) * (((out.length * 37) % 7) - 3) * 0.8;
      out.push([(ex + vx) * gap + wob, (ey + vy) * gap + wob * 0.6]);
    }
  }
  return out;
}

function formationCanvas(sq: Squadron, tight: number): HTMLCanvasElement {
  const W = 120;
  const H = 84;
  const [c, g] = canvas(W, H);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 6) for (let y = 0; y < H; y += 6) { g.fillStyle = 'rgba(42,38,32,0.08)'; g.fillRect(x, y, 1, 1); }
  const n = Math.max(3, Math.min(12, flyable(sq).length || sq.airframes.length || 6));
  const pos = formationPositions(n, tight);
  const minX = Math.min(...pos.map((p) => p[0]));
  const maxX = Math.max(...pos.map((p) => p[0]));
  const maxY = Math.max(...pos.map((p) => p[1]));
  const ox = Math.round(W / 2 - (minX + maxX) / 2);
  const oy = Math.round(H / 2 - maxY / 2);
  // Gunners' fields of fire: where they overlap, an attacker meets several guns at once.
  const reach = 10;
  const guns = new Uint8Array(W * H);
  for (const [px, py] of pos)
    for (let y = -reach; y <= reach; y++)
      for (let x = -reach; x <= reach; x++) {
        if (x * x + y * y > reach * reach) continue;
        const X = ox + Math.round(px) + x;
        const Y = oy + Math.round(py) + y;
        if (X >= 0 && Y >= 0 && X < W && Y < H) guns[Y * W + X]++;
      }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = guns[y * W + x];
      if (!k) continue;
      g.fillStyle = k >= 3 ? 'rgba(95,111,71,0.55)' : k === 2 ? 'rgba(95,111,71,0.35)' : 'rgba(95,111,71,0.16)';
      g.fillRect(x, y, 1, 1);
    }
  // The attacker goes for whoever sits furthest out of the box.
  let far = 0;
  pos.forEach(([x, y], i) => { if (Math.hypot(x, y - maxY / 2) > Math.hypot(pos[far][0], pos[far][1] - maxY / 2)) far = i; });
  for (const [i, [px, py]] of pos.entries()) topPlane(g, ox + Math.round(px), oy + Math.round(py), i === far && tight < 0.5 ? '#b0302a' : INK);
  const [tx, ty] = [ox + Math.round(pos[far][0]), oy + Math.round(pos[far][1])];
  const fx = tx < W / 2 ? 4 : W - 6;
  const fy = Math.min(H - 6, ty + 18);
  g.fillStyle = '#b0302a';
  for (let k = 0; k < 1; k += 0.08) g.fillRect(Math.round(fx + (tx - fx) * k), Math.round(fy + (ty - fy) * k), 1, 1);
  g.fillRect(fx - 1, fy, 3, 1);
  g.fillRect(fx, fy - 1, 1, 3);
  g.font = '8px monospace';
  g.fillStyle = INK;
  g.fillText(tight >= 0.75 ? 'TIGHT BOX' : tight >= 0.4 ? 'STANDARD' : 'LOOSE', 3, 9);
  g.fillStyle = 'rgba(42,38,32,0.6)';
  g.fillText(`${n} ${AIRCRAFT[sq.kind].name[sq.side].toUpperCase()}`.slice(0, 22), 3, H - 3);
  return c;
}

function altitudeCanvas(sq: Squadron, alt: number): HTMLCanvasElement {
  const W = 120;
  const H = 84;
  const [c, g] = canvas(W, H);
  const ground = H - 10;
  // Sky, darkening with height.
  for (let y = 0; y < ground; y++) {
    const f = y / ground;
    g.fillStyle = f < 0.33 ? '#9fb0b4' : f < 0.66 ? '#b5c2be' : '#cbd3c4';
    g.fillRect(0, y, W, 1);
  }
  // Ground with the target.
  g.fillStyle = '#8d8a62';
  g.fillRect(0, ground, W, H - ground);
  g.fillStyle = '#6f6d4c';
  for (let x = 0; x < W; x += 3) g.fillRect(x, ground + 2 + (x % 2), 2, 1);
  const tx = 78;
  g.fillStyle = INK;
  g.fillRect(tx - 5, ground - 4, 10, 4);
  g.fillRect(tx - 2, ground - 7, 3, 3);
  // Flak guns either side, and their bursts: thick low down, thinning out with height.
  for (const gx of [tx - 22, tx + 18, tx - 46]) {
    g.fillRect(gx, ground - 2, 4, 2);
    g.fillRect(gx + 2, ground - 4, 1, 2);
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 90; i++) {
    const y = ground - 6 - rnd() * (ground - 8);
    const height = 1 - y / ground;
    if (rnd() > 1.15 - height * 1.1) continue;
    const x = tx - 40 + rnd() * 70;
    g.fillStyle = 'rgba(42,38,32,0.55)';
    g.fillRect(Math.round(x), Math.round(y), 2, 2);
    g.fillRect(Math.round(x) - 1, Math.round(y) + 1, 1, 1);
  }
  // Height scale on the left.
  g.fillStyle = 'rgba(42,38,32,0.7)';
  g.font = '8px monospace';
  for (const ft of [5000, 15000, 25000]) {
    const y = ground - Math.round(((ft - 2000) / 22000) * (ground - 12)) - 4;
    g.fillRect(0, y, 3, 1);
    g.fillText(`${ft / 1000}k`, 4, y + 3);
  }
  // The bomber, and the spread of its bombs on the ground.
  const by = ground - 4 - Math.round(alt * (ground - 12)) - 4;
  const spread = 3 + alt * 16;
  g.fillStyle = 'rgba(176,48,42,0.18)';
  for (let y = by + 3; y < ground; y++) {
    const w = ((y - by) / (ground - by)) * spread;
    g.fillRect(Math.round(tx - 8 - w), y, Math.round(w * 2) + 1, 1);
  }
  g.fillStyle = '#b0302a';
  g.fillRect(Math.round(tx - 8 - spread), ground - 1, Math.round(spread * 2) + 1, 1);
  const bx = tx - 8;
  g.fillStyle = INK;
  g.fillRect(bx - 5, by, 11, 2); // fuselage
  g.fillRect(bx - 1, by - 1, 3, 1); // wing root
  g.fillRect(bx - 6, by - 2, 2, 2); // tail
  if (sq.kind === 'fighter') g.fillRect(bx + 6, by, 1, 1);
  g.fillText(alt >= 0.7 ? 'HIGH' : alt >= 0.35 ? 'MEDIUM' : 'LOW', W - 40, 10);
  return c;
}
