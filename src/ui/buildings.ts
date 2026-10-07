/**
 * Side-on pixel scenes of the training school and the aircraft works. They grow
 * with each upgrade and show what the commander has set: syllabus, pupils,
 * the build queue, QC policy and bomb damage. Drawn at an integer scale and
 * lightly animated (smoke, propellers, flags, walkers) until detached.
 */
import { look, nationAt } from './nation';
import { AIRCRAFT } from '../core/data';
import type { AircraftKind, NationId, SideId, SideState } from '../core/types';
import { h } from './dom';

const S = 3;
const H = 52;
/** Width the composition is laid out for; wider scenes add countryside at the edges. */
const BASE = 360;
/** Ground line the back row of buildings stands on. */
const GY = 37;
const K = '#16171a';

type G = CanvasRenderingContext2D;

interface Pal {
  sky: string[];
  cloud: [string, string];
  hill: string;
  trees: [string, string];
  grass: [string, string, string];
  wall: [string, string, string];
  roof: [string, string, string];
  iron: [string, string, string];
  render: [string, string];
  conc: [string, string];
  glass: [string, string];
  flag: string[];
  uniform: string;
  trainer: [string, string, string];
  camo: [string, string, string];
  id?: SideId;
}

/** Fin flash and small insignia: [upper, lower]. */
const FLAG: Record<NationId, [string, string]> = { aldmere: ['#2c4672', '#a8332a'], directorate: ['#1a1a1a', '#d8b040'], varn: ['#2f5a3a', '#e8e4d4'] };

const PALS: Record<SideId, Pal> = {
  0: {
    sky: ['#8796a0', '#94a2a6', '#a3adaa', '#b2b7ad', '#c0bfae'],
    cloud: ['#d8d6c8', '#b4b6ac'],
    hill: '#6c7862',
    trees: ['#34402c', '#46553a'],
    grass: ['#5f6f47', '#53623d', '#6d7d52'],
    wall: ['#9a5a42', '#7e4634', '#62362a'],
    roof: ['#5e6266', '#4a4e52', '#3a3d40'],
    iron: ['#6e7660', '#5c6450', '#4a5040'],
    render: ['#d6ceb6', '#b8ae94'],
    conc: ['#8e8a7a', '#7a7668'],
    glass: ['#a8c0c8', '#6a8894'],
    flag: ['#2c4672', '#e8e4d4', '#a8332a'],
    uniform: '#4f5f78',
    trainer: ['#ecc858', '#d8b040', '#a8862a'],
    camo: ['#5f6f47', '#4b5a39', '#36412b'],
  },
  1: {
    sky: ['#7a8894', '#87949c', '#95a0a4', '#a3aaab', '#b1b5b2'],
    cloud: ['#d0d2cc', '#a8acaa'],
    hill: '#606b6a',
    trees: ['#2c3630', '#3c4a41'],
    grass: ['#58654a', '#4c5841', '#66735a'],
    wall: ['#9a9c94', '#7e8079', '#62645f'],
    roof: ['#4c5450', '#3c4440', '#2e3532'],
    iron: ['#6c7276', '#5a6064', '#484d50'],
    render: ['#c8c8c0', '#a8a8a0'],
    conc: ['#86888a', '#727476'],
    glass: ['#a0b4bc', '#647c88'],
    flag: ['#d8b040', '#1a1a1a', '#d8b040'],
    uniform: '#4a4f58',
    trainer: ['#b8bcb4', '#a0a49c', '#7c8078'],
    camo: ['#68737f', '#535d68', '#3c434c'],
  },
};

/* ---------------- Drawing helpers ---------------- */

function R(g: G, x: number, y: number, w: number, hh: number, c: string) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, hh);
}

/** Deterministic 0..1 hash for scatter and texture. */
function hash(a: number, b: number, c = 0): number {
  let v = (a * 374761393 + b * 668265263 + c * 2246822519) | 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

/** Filled box with a dark outline, a lit left/top edge and a shaded right edge. */
function box(g: G, x: number, y: number, w: number, hh: number, [lt, base, dk]: [string, string, string]) {
  R(g, x - 1, y - 1, w + 2, hh + 2, K);
  R(g, x, y, w, hh, base);
  R(g, x, y, 1, hh, lt);
  R(g, x + w - 1, y, 1, hh, dk);
}

/** Small sprite canvas built pixel by pixel, outlined automatically. */
function sprite(w: number, hh: number, draw: (p: (x: number, y: number, c: string) => void) => void, outline = true): HTMLCanvasElement {
  const pad = outline ? 1 : 0;
  const cells: (string | null)[] = new Array((w + 2 * pad) * (hh + 2 * pad)).fill(null);
  const W = w + 2 * pad;
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < w && y < hh) cells[(y + pad) * W + x + pad] = c;
  };
  draw(set);
  if (outline) {
    const add: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) continue;
      const x = i % W;
      const y = Math.floor(i / W);
      if ((x > 0 && cells[i - 1]) || (x < W - 1 && cells[i + 1]) || (y > 0 && cells[i - W]) || cells[i + W]) add.push(i);
    }
    for (const i of add) cells[i] = K;
  }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = hh + 2 * pad;
  const g = c.getContext('2d')!;
  cells.forEach((col, i) => {
    if (col) R(g, i % W, Math.floor(i / W), 1, 1, col);
  });
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) cache.set(key, (c = make()));
  return c;
}

/* ---------------- Sprites ---------------- */

/** Biplane trainer, side view facing left. 18x9 (+outline). */
function biplane(side: SideId, prop: number): HTMLCanvasElement {
  return cached(`bi${nationAt(side).id}${prop}`, () => {
    const [lt, base, dk] = PALS[look(side)].trainer;
    return sprite(18, 9, (p) => {
      for (let x = 4; x <= 13; x++) p(x, 1, x === 4 ? lt : base);
      for (let x = 2; x <= 14; x++) {
        p(x, 3, x < 6 ? lt : base);
        p(x, 4, dk);
      }
      for (let x = 15; x <= 16; x++) p(x, 3, base);
      p(16, 1, base); p(15, 2, base); p(16, 2, dk); p(17, 1, dk); p(17, 2, dk); p(17, 3, dk);
      p(15, 4, dk); p(16, 4, dk);
      p(1, 3, '#3a3d40'); p(1, 4, '#2e3130');
      p(6, 2, '#2e3130'); p(11, 2, '#2e3130'); p(6, 4, '#2e3130');
      p(9, 2, '#6a8894'); p(10, 2, '#5a3a22');
      for (let x = 5; x <= 13; x++) p(x, 5, dk);
      p(5, 6, '#2e3130'); p(4, 7, '#1a1a1a'); p(5, 7, '#1a1a1a');
      p(16, 5, '#2e3130');
      // Markings.
      { const [a, b] = FLAG[nationAt(side).id]; p(12, 3, a); p(12, 4, b); }
      // Propeller: blades up/down, or a blur when turning.
      if (prop === 0) { p(0, 1, '#8d9398'); p(0, 2, '#8d9398'); p(0, 5, '#8d9398'); p(0, 6, '#8d9398'); }
      else if (prop === 1) { p(0, 2, '#c9ced2'); p(0, 5, '#8d9398'); }
      else { p(0, 1, '#8d9398'); p(0, 6, '#c9ced2'); }
      p(0, 3, '#c9ced2'); p(0, 4, '#8d9398');
    });
  });
}

/** Monoplane advanced trainer (level 5), side view facing left. */
function monoplane(side: SideId): HTMLCanvasElement {
  return cached(`mono${nationAt(side).id}`, () => {
    const [lt, base, dk] = PALS[look(side)].trainer;
    return sprite(18, 7, (p) => {
      for (let x = 2; x <= 15; x++) { p(x, 2, x < 5 ? lt : base); p(x, 3, base); }
      for (let x = 3; x <= 13; x++) p(x, 4, dk);
      p(16, 2, base); p(16, 0, base); p(16, 1, base); p(17, 0, dk); p(17, 1, dk); p(17, 2, dk);
      p(7, 1, '#a8c0c8'); p(8, 1, '#a8c0c8'); p(9, 1, '#6a8894'); p(10, 1, '#6a8894');
      for (let x = 5; x <= 10; x++) p(x, 4, dk);
      p(1, 2, '#3a3d40'); p(1, 3, '#2e3130');
      p(0, 1, '#8d9398'); p(0, 4, '#8d9398'); p(0, 2, '#c9ced2'); p(0, 3, '#8d9398');
      p(6, 5, '#2e3130'); p(6, 6, '#1a1a1a'); p(15, 4, '#2e3130');
      { const [a, b] = FLAG[nationAt(side).id]; p(12, 2, a); p(12, 3, b); }
    });
  });
}

const KIND_LEN: Record<AircraftKind, number> = { fighter: 15, medium: 21, heavy: 27, recon: 19 };

/**
 * Production aircraft, side view facing left. `paint` 0..1: the share already
 * finished from the nose back; the rest is a bare-metal airframe in its jig.
 */
function warplane(kind: AircraftKind, side: SideId, paint: number): HTMLCanvasElement {
  const steps = Math.round(paint * 6);
  return cached(`wp${kind}${nationAt(side).id}${steps}`, () => {
    const L = KIND_LEN[kind];
    const tall = kind === 'heavy' ? 9 : kind === 'fighter' ? 7 : 8;
    const [cl, cb, cd] = PALS[look(side)].camo;
    const metal: [string, string, string] = ['#c8ccc8', '#a8acaa', '#80847f'];
    const done = (steps / 6) * L;
    return sprite(L, tall, (p) => {
      const col = (x: number, shade: 0 | 1 | 2) => {
        if (x <= done) return [cl, cb, cd][shade];
        return x % 2 ? metal[shade] : metal[Math.min(2, shade + 1) as 0 | 1 | 2];
      };
      const fy = kind === 'heavy' ? 3 : 2;
      const fh = kind === 'heavy' ? 3 : kind === 'fighter' ? 2 : 2;
      // Fuselage, tapering to the tail.
      for (let x = 1; x < L - 2; x++) {
        const taper = x > L * 0.7 ? 1 : 0;
        for (let y = fy + taper; y < fy + fh + (taper ? 0 : 1); y++) p(x, y, col(x, y === fy + taper ? 0 : y === fy + fh ? 2 : 1));
      }
      // Fin and tailplane.
      const fin = kind === 'heavy' ? 4 : 3;
      for (let y = fy - fin + 1; y <= fy; y++) for (let x = L - 4; x < L - 1; x++) if (x - (L - 4) >= (fy - y) / 2) p(x, y, col(x, 1));
      p(L - 3, fy + 1, col(L - 3, 2)); p(L - 2, fy + 1, col(L - 2, 2));
      // Wing seen edge-on, nacelles and wheels.
      const wx = Math.round(L * (kind === 'fighter' ? 0.25 : 0.3));
      const ww = kind === 'fighter' ? 5 : 6;
      for (let x = wx; x < wx + ww; x++) p(x, fy + fh, col(x, 2));
      if (kind !== 'fighter') {
        const nac = kind === 'heavy' ? [wx - 1, wx + 3] : [wx];
        for (const nx of nac) {
          for (let x = nx; x < nx + 4; x++) p(x, fy + fh + 1, col(x, 1));
          p(nx - 1, fy + fh, '#8d9398'); p(nx - 1, fy + fh + 2, '#8d9398'); p(nx - 1, fy + fh + 1, '#c9ced2');
        }
      }
      p(wx + 1, tall - 2, '#2e3130');
      p(wx + 1, tall - 1, '#1a1a1a');
      p(L - 3, fy + fh + 1, '#1a1a1a');
      // Nose: engine and propeller, or glazing.
      if (kind === 'fighter') {
        p(0, fy, '#3a3d40'); p(0, fy + 1, '#3a3d40');
        p(0, fy - 2, '#8d9398'); p(0, fy - 1, '#8d9398'); p(0, fy + 2, '#8d9398'); p(0, fy + 3, '#8d9398');
        p(5, fy - 1, '#a8c0c8'); p(6, fy - 1, '#6a8894');
      } else {
        p(0, fy, '#a8c0c8'); p(0, fy + 1, '#6a8894'); p(1, fy, '#a8c0c8');
        p(4, fy - 1, '#a8c0c8'); p(5, fy - 1, '#6a8894');
        if (kind === 'heavy') { p(12, fy - 1, '#a8c0c8'); p(L - 2, fy, '#6a8894'); }
      }
      // Insignia once painted.
      const ix = Math.round(L * 0.6);
      if (ix <= done) {
        const nation = nationAt(side).id;
        if (nation === 'directorate') { p(ix, fy, '#d8b040'); p(ix, fy + 1, '#1a1a1a'); p(ix + 1, fy, '#1a1a1a'); p(ix + 1, fy + 1, '#d8b040'); }
        else { const [a, b] = FLAG[nation]; p(ix, fy, a); p(ix, fy + 1, b); p(ix + 1, fy, a); p(ix + 1, fy + 1, a); }
      }
    });
  });
}

/** A standing (or walking) figure, 3x6. */
function figure(g: G, x: number, foot: number, body: string, head = '#d9a27a', step = 0, cap?: string) {
  x = Math.round(x);
  const y = foot - 6;
  R(g, x - 1, foot, 4, 1, 'rgba(0,0,0,0.25)');
  R(g, x + 1, y, 1, 1, cap ?? body);
  R(g, x, y, 1, 1, cap ?? body);
  R(g, x, y + 1, 2, 1, head);
  R(g, x - 0.5, y + 2, 3, 2, body);
  R(g, x - 1 + 1, y + 2, 1, 2, shade(body, 1.18));
  R(g, x + 2, y + 2, 1, 2, shade(body, 0.8));
  const leg = shade(body, 0.7);
  if (step % 2) {
    R(g, x, y + 4, 1, 2, leg);
    R(g, x + 1, y + 4, 1, 1, leg);
  } else {
    R(g, x, y + 4, 1, 2, leg);
    R(g, x + 2, y + 4, 1, 2, leg);
  }
}

function shade(c: string, f: number): string {
  const n = parseInt(c.slice(1), 16);
  const v = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f))).toString(16).padStart(2, '0');
  return `#${v(16)}${v(8)}${v(0)}`;
}

/** Flag on a pole; `wave` alternates the fly. */
function flag(g: G, x: number, top: number, side: SideId, wave: number) {
  R(g, x, top, 1, GY - top + 1, '#3a3028');
  R(g, x, top - 1, 1, 1, '#d8b040');
  const P = PALS[look(side)].flag;
  for (let i = 0; i < 7; i++) {
    const dy = (i + wave) % 4 === 0 ? 1 : 0;
    for (let j = 0; j < 5; j++) {
      let c = P[0];
      if (nationAt(side).id === 'varn') {
        // Green field with a white roundel in the fly.
        c = '#3f6a4a';
        if (i < 3 && j < 2) c = '#e8e4d4';
        if (i >= 3 && i <= 5 && j >= 1 && j <= 3) c = i === 4 && j === 2 ? '#2f5a3a' : '#e8e4d4';
      } else if (side === 0 || nationAt(side).id === 'aldmere') {
        // Light blue field with a roundel in the fly.
        c = '#6c8cb4';
        if (i < 3 && j < 2) c = '#2c4672';
        if (i >= 3 && i <= 5 && j >= 1 && j <= 3) c = i === 4 && j === 2 ? '#a8332a' : '#e8e4d4';
      } else {
        c = Math.abs(i - 3) + Math.abs(j - 2) <= 2 ? (Math.abs(i - 3) + Math.abs(j - 2) <= 1 ? '#1a1a1a' : '#d8b040') : '#1a1a1a';
        if (Math.abs(i - 3) + Math.abs(j - 2) > 2) c = '#3a3a3a';
      }
      R(g, x + 1 + i, top + j + dy, 1, 1, c);
    }
  }
}

function windsock(g: G, x: number, wave: number) {
  R(g, x, GY - 12, 1, 13, '#3a3028');
  const stripes = ['#e07a30', '#e8e4d4', '#e07a30', '#e8e4d4'];
  for (let i = 0; i < 6; i++) {
    const droop = wave ? Math.floor(i / 3) : Math.floor(i / 4);
    const hh = i < 3 ? 3 : 2;
    R(g, x + 1 + i, GY - 12 + droop + (3 - hh), 1, hh, stripes[Math.floor(i / 1.5)]);
  }
}

/* ---------------- Backdrop ---------------- */

function backdrop(g: G, W: number, P: Pal, seed: number) {
  // Sky in dithered bands.
  const band = Math.ceil(GY / P.sky.length);
  for (let y = 0; y < GY; y++) {
    const i = Math.min(P.sky.length - 1, Math.floor(y / band));
    R(g, 0, y, W, 1, P.sky[i]);
    if (y % band === band - 1 && i + 1 < P.sky.length) for (let x = y % 2; x < W; x += 2) R(g, x, y, 1, 1, P.sky[i + 1]);
  }
  // Clouds: flat-bottomed puffs.
  for (let k = 0; k < Math.ceil(W / 90); k++) {
    const cx = Math.floor(hash(k, seed) * W);
    const cy = 5 + Math.floor(hash(k, seed, 1) * 12);
    const len = 14 + Math.floor(hash(k, seed, 2) * 18);
    for (let i = 0; i < len; i++) {
      const hgt = Math.round(Math.sin((i / len) * Math.PI) * (3 + hash(k, 3) * 2) + hash(i, k) * 1.2);
      R(g, cx + i, cy - hgt, 1, hgt, P.cloud[0]);
      R(g, cx + i, cy, 1, 1, P.cloud[1]);
    }
  }
  // Distant hills and a tree line.
  for (let x = 0; x < W; x++) {
    const hy = 27 + Math.round(2.5 * Math.sin(x / 31 + seed) + 1.5 * Math.sin(x / 11 + seed * 2));
    R(g, x, hy, 1, GY - hy, P.hill);
    const ty = 31 + Math.round(1.5 * Math.sin(x / 5 + seed) + hash(x, seed, 7) * 2.2);
    R(g, x, ty, 1, GY - ty, P.trees[0]);
    if (hash(x, seed, 8) > 0.6) R(g, x, ty, 1, 1, P.trees[1]);
  }
  // Grass with tufts.
  R(g, 0, GY, W, H - GY, P.grass[0]);
  for (let y = GY; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = hash(x, y, seed);
      if (v > 0.9) R(g, x, y, 1, 1, P.grass[2]);
      else if (v < 0.08) R(g, x, y, 1, 1, P.grass[1]);
    }
  R(g, 0, GY, W, 1, P.grass[1]);
}

/* ---------------- Scene element ---------------- */

interface SceneDef {
  /** Everything that does not move. `ox` centres the base composition. */
  still(g: G, W: number, ox: number): void;
  /** Moving parts, drawn over the still layer each frame. `t` in seconds. */
  live(g: G, W: number, ox: number, t: number): void;
}

function sceneEl(cls: string, label: (string | HTMLElement)[], def: SceneDef): HTMLElement {
  const canvas = h('canvas', { class: 'pix bscene-canvas' });
  const view = h('div', { class: 'bscene-view' }, canvas);
  const wrap = h('div', { class: `bscene ${cls}` }, view, h('div', { class: 'bscene-label' }, label));
  const g = canvas.getContext('2d')!;
  let W = 0;
  let still: HTMLCanvasElement | null = null;
  let ox = 0;
  const resize = (w: number) => {
    W = w;
    // Centred: a narrow view crops both edges evenly rather than the right side only.
    ox = Math.floor((W - BASE) / 2);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * S}px`;
    canvas.style.height = `${H * S}px`;
    still = document.createElement('canvas');
    still.width = W;
    still.height = H;
    def.still(still.getContext('2d')!, W, ox);
  };
  const paint = (t: number) => {
    g.drawImage(still!, 0, 0);
    def.live(g, W, ox, t);
  };
  resize(BASE);
  paint(0);
  let last = 0;
  let waited = 0;
  const frame = (now: number) => {
    if (!canvas.isConnected) {
      // Not attached yet (first frames) or gone: give up after a short wait.
      if (++waited < 10) requestAnimationFrame(frame);
      return;
    }
    waited = 10;
    requestAnimationFrame(frame);
    const w = Math.max(200, Math.floor(view.clientWidth / S));
    if (w !== W) {
      resize(w);
      last = 0;
    }
    if (now - last < 110) return; // ~9 fps: chunky, like the title scene.
    last = now;
    paint(now / 1000);
  };
  requestAnimationFrame(frame);
  return wrap;
}

/** Drifting smoke from a chimney top. Dark smoke for a rushed or burning works. */
function smoke(g: G, x: number, y: number, t: number, dark: boolean, n = 6, rise = 24, seed = 0) {
  const cols = dark ? ['#4a4642', '#3a3632', '#2e2b28'] : ['#c4c2ba', '#aaa9a2', '#94948e'];
  for (let i = 0; i < n; i++) {
    const ph = (t * 0.2 + i / n + seed * 0.37) % 1;
    const px = Math.round(x + ph * (dark ? 18 : 26) + Math.sin(ph * 6 + seed) * 1.5);
    const py = Math.round(y - ph * rise);
    const r = 1 + Math.floor(ph * (dark ? 4.5 : 3.5));
    g.globalAlpha = ph < 0.55 ? 0.95 : ph < 0.8 ? 0.7 : 0.4;
    for (let dy = -r; dy <= r; dy++) {
      const hw = Math.round(Math.sqrt(r * r - dy * dy));
      R(g, px - hw, py + dy, hw * 2 + 1, 1, dy < 0 ? cols[0] : cols[1]);
    }
    R(g, px - Math.max(0, r - 1), py - r + 1, 1, 1, dark ? '#5a5652' : '#d8d6ce');
  }
  g.globalAlpha = 1;
}

function flames(g: G, x: number, y: number, w: number, t: number, seed: number) {
  const f = Math.floor(t * 9);
  for (let i = 0; i < w; i++) {
    const hgt = 2 + Math.floor(hash(i + seed, f) * 4) + (i > 0 && i < w - 1 ? 1 : 0);
    R(g, x + i, y - hgt, 1, hgt, '#b03020');
    R(g, x + i, y - hgt + 1, 1, Math.max(0, hgt - 2), '#e08030');
    if (hgt > 3) R(g, x + i, y - hgt + 2, 1, hgt - 3, '#f0d060');
  }
}

/* ======================================================================
 * Operational Training Unit
 * ==================================================================== */

/** Nissen hut, side elevation. */
function nissen(g: G, x: number, P: Pal) {
  const w = 30;
  const top = GY - 10;
  for (let y = top; y < GY; y++) {
    const inset = y === top ? 4 : y === top + 1 ? 2 : y === top + 2 ? 1 : 0;
    R(g, x + inset - 1, y, w - 2 * inset + 2, 1, K);
  }
  R(g, x - 1, top - 1, 0, 0, K);
  R(g, x + 3, top - 1, w - 6, 1, K);
  for (let y = top; y < GY; y++) {
    const inset = y === top ? 4 : y === top + 1 ? 2 : y === top + 2 ? 1 : 0;
    for (let xx = x + inset; xx < x + w - inset; xx++) {
      const c = y < top + 2 ? P.iron[0] : (xx - x) % 2 ? P.iron[1] : P.iron[2];
      R(g, xx, y, 1, 1, c);
    }
  }
  // Door, windows and a stove pipe.
  box(g, x + 4, GY - 6, 4, 6, ['#6a4a2e', '#5a3a22', '#4a2e1a']);
  for (const wx of [x + 12, x + 19]) {
    box(g, wx, GY - 6, 3, 3, [P.glass[0], P.glass[0], P.glass[1]]);
  }
  R(g, x + 7, top - 3, 1, 4, '#2e3130');
  R(g, x + 6, top - 4, 3, 1, '#2e3130');
}

/** Hangar with doors open; a trainer stands inside. */
function hangar(g: G, x: number, P: Pal, side: SideId, w = 46) {
  const wallTop = GY - 15;
  // Shallow gabled roof.
  for (let i = 0; i <= 4; i++) R(g, x + i * 3 - 1, wallTop - 4 + i - 1, w - i * 6 + 2, 1, K);
  for (let i = 0; i < 4; i++) R(g, x + (3 - i) * 3, wallTop - 4 + (3 - i) + 1 - 1, w - (3 - i) * 6, 1, i % 2 ? P.roof[1] : P.roof[0]);
  for (let y = wallTop - 4; y < wallTop; y++) {
    const inset = (wallTop - y) * 3;
    R(g, x + inset, y, w - inset * 2, 1, y % 2 ? P.roof[1] : P.roof[0]);
  }
  R(g, x - 1, wallTop - 1, w + 2, 1, P.roof[2]);
  box(g, x, wallTop, w, GY - wallTop, P.iron);
  // Camouflage blotches on the cladding.
  for (let k = 0; k < 7; k++) {
    const bx = x + 2 + Math.floor(hash(k, x) * (w - 8));
    const by = wallTop + 1 + Math.floor(hash(k, x, 1) * 8);
    R(g, bx, by, 4 + Math.floor(hash(k, 2) * 4), 3, side === 0 ? '#5a5038' : '#5a6064');
  }
  for (let xx = x + 1; xx < x + w - 1; xx += 2) R(g, xx, wallTop, 1, GY - wallTop, 'rgba(0,0,0,0.12)');
  // Open doors: dark interior, slid-back door leaves, a machine inside.
  const dx = x + 8;
  const dw = w - 16;
  R(g, dx - 1, wallTop + 3, dw + 2, GY - wallTop - 3, K);
  R(g, dx, wallTop + 4, dw, GY - wallTop - 4, '#26241f');
  R(g, dx, wallTop + 4, dw, 1, '#3a3630');
  for (const lx of [dx + 4, dx + dw - 6]) R(g, lx, wallTop + 5, 2, 1, '#e8d890');
  g.globalAlpha = 0.55;
  g.drawImage(biplane(side, 0), dx + Math.floor(dw / 2) - 9, GY - 10);
  g.globalAlpha = 1;
  R(g, dx - 4, wallTop + 3, 3, GY - wallTop - 3, P.iron[2]);
  R(g, dx + dw + 1, wallTop + 3, 3, GY - wallTop - 3, P.iron[2]);
}

/** Two-storey classroom block. */
function classroom(g: G, x: number, P: Pal) {
  const w = 40;
  const top = GY - 16;
  // Hipped slate roof.
  for (let i = 0; i < 4; i++) {
    R(g, x + i * 2 - 2, top - 4 + (3 - i) - 1 + 1, w - i * 4 + 4, 1, K);
  }
  for (let i = 0; i < 4; i++) R(g, x - 1 + (3 - i) * 2, top - 4 + i, w + 2 - (3 - i) * 4, 1, i % 2 ? P.roof[1] : P.roof[0]);
  R(g, x + 6, top - 7, 3, 3, P.wall[1]);
  R(g, x + 31, top - 7, 3, 3, P.wall[1]);
  R(g, x + 5, top - 8, 5, 1, K);
  R(g, x + 30, top - 8, 5, 1, K);
  box(g, x, top, w, GY - top, P.wall);
  // Brick courses.
  for (let y = top + 1; y < GY; y += 2) for (let xx = x + 1 + (y % 4 === 1 ? 0 : 2); xx < x + w - 1; xx += 4) R(g, xx, y, 1, 1, P.wall[2]);
  R(g, x, top + 7, w, 1, P.render[1]);
  // Windows, two floors.
  for (const wy of [top + 2, top + 9]) {
    for (let i = 0; i < 6; i++) {
      const wx = x + 3 + i * 6;
      if (wy > top + 5 && i === 3) continue;
      R(g, wx - 1, wy - 1, 5, 5, P.render[0]);
      R(g, wx, wy, 3, 3, P.glass[0]);
      R(g, wx + 1, wy, 1, 3, P.render[0]);
      R(g, wx, wy + 1, 3, 1, P.render[1]);
      R(g, wx + 2, wy + 2, 1, 1, P.glass[1]);
    }
  }
  // Door with steps.
  box(g, x + 19, GY - 6, 4, 6, ['#4a3a2a', '#3a2c1e', '#2a2016']);
  R(g, x + 17, GY - 1, 8, 1, P.conc[0]);
  R(g, x + 18, GY - 7, 6, 1, P.render[0]);
}

/** Watch office: control tower with railings, a mast and the signals board. */
function tower(g: G, x: number, P: Pal) {
  const w = 16;
  const top = GY - 18;
  box(g, x, top, w, GY - top, [P.render[0], P.render[0], P.render[1]]);
  // Glazed upper floor.
  R(g, x + 1, top + 2, w - 2, 5, '#3a3d40');
  for (let i = 0; i < 4; i++) R(g, x + 2 + i * 3.5, top + 3, 2, 3, P.glass[0]);
  R(g, x + 1, top + 5, w - 2, 1, P.glass[1]);
  R(g, x - 2, top + 8, w + 4, 1, K);
  R(g, x - 2, top + 7, 1, 1, K);
  R(g, x + w + 1, top + 7, 1, 1, K);
  // Ground-floor windows and door.
  R(g, x + 2, top + 11, 3, 3, P.glass[1]);
  R(g, x + 11, top + 11, 3, 3, P.glass[1]);
  box(g, x + 7, GY - 5, 3, 5, ['#4a3a2a', '#3a2c1e', '#2a2016']);
  // Roof railing and mast.
  R(g, x - 1, top - 1, w + 2, 1, K);
  for (let xx = x - 1; xx <= x + w; xx += 2) R(g, xx, top - 3, 1, 2, '#2e3130');
  R(g, x - 1, top - 3, w + 2, 1, '#2e3130');
  R(g, x + 12, top - 12, 1, 10, '#2e3130');
  R(g, x + 10, top - 10, 5, 1, '#2e3130');
  // Chequered signals board.
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) R(g, x + w + 3 + i, GY - 4 + j, 1, 1, (i + j) % 2 ? '#d8b040' : '#1a1a1a');
  R(g, x + w + 3, GY - 1, 1, 2, '#2e3130');
  R(g, x + w + 6, GY - 1, 1, 2, '#2e3130');
}

/** Headquarters with a pediment clock (level 5). */
function headquarters(g: G, x: number, P: Pal) {
  const w = 34;
  const top = GY - 14;
  box(g, x, top, w, GY - top, [P.render[0], P.render[0], P.render[1]]);
  // Roof and pediment.
  R(g, x - 2, top - 2, w + 4, 2, P.roof[1]);
  R(g, x - 2, top - 3, w + 4, 1, K);
  for (let i = 0; i < 6; i++) R(g, x + 9 + i, top - 3 - i, w - 18 - 2 * i, 1, i === 0 ? P.render[1] : P.render[0]);
  for (let i = 0; i < 7; i++) {
    R(g, x + 8 + i, top - 3 - i, 1, 1, K);
    R(g, x + w - 9 - i, top - 3 - i, 1, 1, K);
  }
  R(g, x + 15, top - 10, 4, 1, K);
  // Clock.
  R(g, x + 15, top - 7, 4, 4, '#e8e4d4');
  R(g, x + 14, top - 6, 1, 2, K);
  R(g, x + 19, top - 6, 1, 2, K);
  R(g, x + 15, top - 8, 4, 1, K);
  R(g, x + 15, top - 3, 4, 1, K);
  R(g, x + 16, top - 6, 1, 2, K);
  R(g, x + 17, top - 5, 1, 1, K);
  // Columns, windows, door.
  for (let i = 0; i < 4; i++) {
    R(g, x + 11 + i * 4, top + 1, 1, GY - top - 2, '#f0ece0');
    R(g, x + 12 + i * 4, top + 1, 1, GY - top - 2, P.render[1]);
  }
  for (const wx of [x + 2, x + 6, x + 25, x + 29]) for (const wy of [top + 2, top + 8]) {
    R(g, wx, wy, 3, 4, P.glass[0]);
    R(g, wx + 1, wy, 1, 4, P.render[0]);
    R(g, wx, wy + 3, 3, 1, P.glass[1]);
  }
  R(g, x + 16, GY - 6, 3, 6, '#3a2c1e');
  R(g, x + 9, GY - 1, 17, 1, P.conc[0]);
}

/** Gunnery butts: earth bank with targets; small = a lone target board. */
function range(g: G, x: number, P: Pal, small: boolean) {
  if (small) {
    R(g, x + 3, GY - 2, 1, 4, '#3a3028');
    R(g, x + 7, GY - 2, 1, 4, '#3a3028');
    target(g, x + 2, GY - 9);
    R(g, x - 2, GY + 1, 16, 2, '#6a5a3a');
    return;
  }
  const w = 64;
  for (let y = 0; y < 9; y++) {
    const inset = Math.floor((8 - y) * 1.6);
    R(g, x + inset, GY - 9 + y + 1, w - inset * 2, 1, y < 2 ? P.grass[2] : y < 4 ? P.grass[0] : '#6a5a3a');
  }
  for (let i = 0; i < 18; i++) R(g, x + 6 + Math.floor(hash(i, 4) * (w - 12)), GY - 5 + Math.floor(hash(i, 5) * 5), 1, 1, '#54462c');
  for (let i = 0; i < 4; i++) {
    const tx = x + 12 + i * 11;
    R(g, tx + 2, GY - 3, 1, 3, '#3a3028');
    target(g, tx, GY - 10);
  }
}

function target(g: G, x: number, y: number) {
  R(g, x - 1, y - 1, 7, 7, K);
  R(g, x, y, 5, 5, '#e8e4d4');
  R(g, x + 1, y + 1, 3, 3, '#1a1a1a');
  R(g, x + 2, y + 2, 1, 1, '#a8332a');
}

/** Blackboard on an easel, for the reporting syllabus. */
function blackboard(g: G, x: number) {
  R(g, x + 1, GY + 2, 1, 7, '#5a3a22');
  R(g, x + 9, GY + 2, 1, 7, '#5a3a22');
  R(g, x - 1, GY - 5, 12, 9, '#5a3a22');
  R(g, x, GY - 4, 10, 7, '#2a3a30');
  // Chalk: an aircraft outline with hits marked.
  R(g, x + 2, GY - 2, 6, 1, '#d8d6c8');
  R(g, x + 4, GY - 3, 1, 3, '#d8d6c8');
  R(g, x + 3, GY + 1, 3, 1, '#d8d6c8');
  R(g, x + 6, GY - 1, 1, 1, '#c86a5a');
  R(g, x + 2, GY, 1, 1, '#c86a5a');
}

interface SchoolLayout {
  hut: number; pole: number; hangarA: number; classroom: number; tower: number; hangarB: number; hq: number; range: number; sock: number;
}
const SL: SchoolLayout = { sock: 4, hut: 14, pole: 48, hangarA: 60, classroom: 116, tower: 162, hangarB: 190, hq: 244, range: 290 };

export function schoolScene(side: SideState): HTMLElement {
  const P = PALS[look(side.id)];
  const t = side.training;
  const lv = Math.max(1, Math.min(5, t.level));
  const pupils = Math.min(t.inTraining, 18);
  const focus = t.focus;
  const parked: { x: number; mono?: boolean }[] = [{ x: 92 }];
  if (lv >= 2) parked.push({ x: 128 });
  if (lv >= 3) parked.push({ x: 174 });
  if (lv >= 4) parked.push({ x: 222 });
  if (lv >= 5) parked.push({ x: 262, mono: true });
  const showRange = lv >= 4 || focus === 'gunnery';
  const def: SceneDef = {
    still(g, W, ox) {
      backdrop(g, W, P, 3 + side.id);
      // A grass runway strip and perimeter track.
      R(g, 0, GY + 3, W, 1, P.grass[1]);
      R(g, 0, H - 4, W, 2, P.grass[2]);
      for (let x = 0; x < W; x += 6) R(g, x, H - 4, 3, 1, '#c8c0a0');
      const X = (n: number) => ox + n;
      nissen(g, X(SL.hut), P);
      if (lv >= 2) hangar(g, X(SL.hangarA), P, side.id);
      if (lv >= 3) {
        classroom(g, X(SL.classroom), P);
        tower(g, X(SL.tower), P);
      }
      if (lv >= 4) hangar(g, X(SL.hangarB), P, side.id, 48);
      if (lv >= 5) headquarters(g, X(SL.hq), P);
      if (showRange) range(g, lv >= 4 ? X(SL.range) : X(SL.range + 34), P, lv < 4);
      if (focus === 'reporting') blackboard(g, X(SL.hut + 40));
      // Hedge at the far edges of a wide scene.
      for (let x = 0; x < ox; x++) R(g, x, GY - 2 - Math.floor(hash(x, 9) * 2), 1, 3, P.trees[0]);
      for (let x = ox + BASE; x < W; x++) R(g, x, GY - 2 - Math.floor(hash(x, 9) * 2), 1, 3, P.trees[0]);
    },
    live(g, W, ox, time) {
      const f = Math.floor(time * 9);
      const X = (n: number) => ox + n;
      windsock(g, X(SL.sock), Math.floor(time * 2) % 2);
      flag(g, X(SL.pole), GY - 20, side.id, Math.floor(time * 3));
      if (lv >= 5) {
        flag(g, X(SL.hq - 4), GY - 18, side.id, Math.floor(time * 3) + 1);
        flag(g, X(SL.hq + 37), GY - 18, side.id, Math.floor(time * 3) + 2);
      }
      // Stove smoke from the hut.
      smoke(g, X(SL.hut + 7), GY - 15, time, false, 4, 10, 1);
      // Parked trainers; the first runs up its engine.
      parked.forEach((p, i) => {
        const spr = p.mono ? monoplane(side.id) : biplane(side.id, i === 0 ? 1 + (f % 2) : 0);
        g.drawImage(spr, X(p.x), GY + 2);
        if (i === 0) figure(g, X(p.x) + 21, GY + 11, '#5a3a22', '#d9a27a', 0);
      });
      // Pupils: a squad paraded in front of the hut, an instructor out front.
      const reporting = focus === 'reporting';
      const sx = reporting ? X(SL.hut + 35) : X(SL.hut + 2);
      for (let i = 0; i < pupils; i++) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        const x = reporting ? sx - col * 4 - row * 2 : sx + col * 4 + row * 2;
        const foot = GY + 9 + row * 4;
        if (reporting) {
          // Seated, facing the blackboard.
          R(g, x, foot - 4, 2, 1, P.uniform);
          R(g, x, foot - 3, 2, 1, '#d9a27a');
          R(g, x - 0.5, foot - 2, 3, 2, P.uniform);
          R(g, x - 1, foot, 4, 1, 'rgba(0,0,0,0.25)');
        } else figure(g, x, foot, P.uniform, '#d9a27a', 0, shade(P.uniform, 0.7));
      }
      if (pupils > 0) figure(g, reporting ? X(SL.hut + 53) : sx + 26, GY + 11, '#6a4a2e', '#d9a27a', f % 4 < 2 ? 0 : 1);
      // Two pupils walking the perimeter track.
      if (pupils > 2) {
        const span = lv >= 3 ? 160 : 70;
        const p = (time * 4) % (span * 2);
        const wx = p < span ? p : span * 2 - p;
        figure(g, X(SL.hut + 40) + wx, H - 5, P.uniform, '#d9a27a', f, shade(P.uniform, 0.7));
        figure(g, X(SL.hut + 44) + wx, H - 5, P.uniform, '#d9a27a', f + 1, shade(P.uniform, 0.7));
      }
      // Gunnery: a gun on a post firing at the butts.
      if (focus === 'gunnery') {
        const gx = lv >= 4 ? X(SL.range - 18) : X(SL.range + 20);
        R(g, gx, GY + 2, 1, 6, '#2e3130');
        R(g, gx - 1, GY + 1, 5, 1, '#2e3130');
        R(g, gx + 4, GY, 2, 1, '#2e3130');
        figure(g, gx - 3, GY + 9, P.uniform, '#d9a27a', 0, shade(P.uniform, 0.7));
        if (f % 3 === 0) {
          R(g, gx + 6, GY - 1, 2, 2, '#f0d060');
          R(g, gx + 8, GY, 1, 1, '#e08030');
          const hit = lv >= 4 ? X(SL.range + 14 + (f % 4) * 11) : X(SL.range + 38);
          R(g, hit, GY - 3 - (f % 2), 1, 1, '#c8b890');
          R(g, hit + 1, GY - 4, 1, 1, '#a8987a');
        }
      }
      // A trainer in the circuit; on the evasion syllabus it loops and rolls.
      if (focus === 'evasion' || lv >= 3) {
        const spr = biplane(side.id, 1 + (f % 2));
        let x: number;
        let y: number;
        if (focus === 'evasion') {
          const a = time * 1.3;
          x = X(300) + Math.cos(a) * 24;
          y = 9 + Math.sin(a) * 6;
          // Smoke trail dots.
          for (let k = 1; k < 7; k++) {
            const b = a - k * 0.35;
            R(g, Math.round(X(300) + Math.cos(b) * 24 + 9), Math.round(9 + Math.sin(b) * 6 + 4), 1, 1, k < 3 ? '#e8e4d4' : '#c8c8c0');
          }
        } else {
          const p = (time * 14) % (W + 60);
          x = W + 20 - p;
          y = 9 + Math.sin(time) * 1.5;
        }
        g.drawImage(spr, Math.round(x), Math.round(y));
      }
    },
  };
  const label = [
    h('b', null, `Training school · level ${lv} of 5`),
    h('span', null, `${t.inTraining ? `${t.inTraining} pupils` : 'No pupils'} · syllabus: ${focus}`),
  ];
  return sceneEl(`bscene-school side${side.id}`, label, def);
}

/* ======================================================================
 * Aircraft works
 * ==================================================================== */

/** Brick shed with a north-light sawtooth roof. Returns the open door rect. */
function sawtooth(g: G, x: number, w: number, P: Pal, holes: number, seed: number): [number, number, number, number] {
  const top = GY - 12;
  const teeth = Math.floor(w / 10);
  for (let i = 0; i < teeth; i++) {
    const tx = x + i * 10;
    for (let j = 0; j < 10; j++) {
      const hgt = Math.max(0, 5 - Math.floor(j / 2));
      if (j === 0) {
        R(g, tx, top - 6, 1, 6, K);
        R(g, tx + 1, top - 6, 1, 6, P.glass[0]);
        continue;
      }
      R(g, tx + j, top - hgt - 1, 1, 1, K);
      R(g, tx + j, top - hgt, 1, hgt, j < 3 ? P.glass[1] : P.roof[j % 2]);
      if (j < 3) R(g, tx + j, top - hgt, 1, 1, P.roof[0]);
    }
    R(g, tx + 1, top - 7, 9, 0, K);
  }
  R(g, x - 1, top - 1, w + 2, 1, P.roof[2]);
  box(g, x, top, w, GY - top, P.wall);
  for (let y = top + 1; y < GY; y += 2) for (let xx = x + 1 + (y % 4 === 1 ? 0 : 2); xx < x + w - 1; xx += 4) R(g, xx, y, 1, 1, P.wall[2]);
  for (let i = 0; i < Math.floor((w - 18) / 6); i++) {
    const wx = x + 3 + i * 6;
    R(g, wx, top + 2, 3, 5, P.glass[1]);
    R(g, wx, top + 2, 3, 1, P.render[0]);
    R(g, wx + 1, top + 3, 1, 4, P.glass[0]);
  }
  // Roof damage: holes show the dark interior, broken glazing.
  for (let k = 0; k < holes; k++) {
    const hx = x + 4 + Math.floor(hash(k, seed) * (w - 10));
    R(g, hx, top - 4, 4, 4, '#1e1c19');
    R(g, hx + 1, top - 5, 2, 1, '#1e1c19');
    R(g, hx + 4, top - 3, 1, 1, P.roof[2]);
  }
  const door: [number, number, number, number] = [x + w - 15, top + 2, 13, GY - top - 2];
  R(g, door[0] - 1, door[1] - 1, door[2] + 2, door[3] + 1, K);
  R(g, door[0], door[1], door[2], door[3], '#24221e');
  R(g, door[0] + 2, door[1] + 1, 2, 1, '#e8d890');
  R(g, door[0] + 8, door[1] + 1, 2, 1, '#e8d890');
  return door;
}

/** Chimney stack; a broken one is shorter with a jagged top. Returns the top y. */
function chimney(g: G, x: number, P: Pal, tall: number, broken: boolean): number {
  const top = GY - (broken ? Math.floor(tall * 0.55) : tall);
  box(g, x, top, 4, GY - top, P.wall);
  for (let y = top + 2; y < GY; y += 3) R(g, x, y, 4, 1, P.wall[2]);
  if (broken) {
    R(g, x, top - 1, 1, 1, P.wall[1]);
    R(g, x + 2, top - 2, 1, 2, P.wall[1]);
    R(g, x + 1, top, 1, 1, K);
  } else {
    R(g, x - 1, top, 6, 2, '#2e3130');
    R(g, x - 2, top - 1, 8, 1, K);
  }
  return top - 1;
}

/** Barrel-roofed assembly hall with the doors open on the line. Returns the doorway. */
function assemblyHall(g: G, x: number, w: number, P: Pal, holes: number, seed: number): [number, number, number, number] {
  const wallTop = GY - 15;
  const rise = 7;
  for (let i = 0; i <= w; i++) {
    const u = (i / w) * 2 - 1;
    const hgt = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * rise);
    R(g, x + i - 1, wallTop - hgt - 1, 1, 1, K);
    R(g, x + i - 1, wallTop - hgt, 1, hgt, i < w / 3 ? P.roof[0] : i < (2 * w) / 3 ? P.roof[1] : P.roof[2]);
    if (i % 4 === 0) R(g, x + i - 1, wallTop - hgt, 1, hgt, P.roof[2]);
  }
  for (let k = 0; k < holes; k++) {
    const hx = x + 8 + Math.floor(hash(k, seed) * (w - 20));
    R(g, hx, wallTop - 5, 5, 4, '#1e1c19');
    R(g, hx + 1, wallTop - 6, 2, 1, '#1e1c19');
  }
  box(g, x, wallTop, w, GY - wallTop, [P.render[0], P.render[0], P.render[1]]);
  R(g, x, wallTop + 1, w, 1, P.render[1]);
  // Camouflage paint.
  for (let k = 0; k < 6; k++) {
    const bx = x + 2 + Math.floor(hash(k, seed, 3) * (w - 10));
    R(g, bx, wallTop + 2 + Math.floor(hash(k, seed, 4) * 6), 6 + Math.floor(hash(k, 5) * 6), 3, P.id === 0 ? '#8a8060' : '#7c8078');
  }
  const door: [number, number, number, number] = [x + 6, wallTop + 3, w - 12, GY - wallTop - 3];
  R(g, door[0] - 1, door[1] - 1, door[2] + 2, door[3] + 1, K);
  R(g, door[0], door[1], door[2], door[3], '#24221e');
  R(g, door[0], door[1], door[2], 1, '#34312b');
  for (let lx = door[0] + 4; lx < door[0] + door[2] - 2; lx += 9) {
    R(g, lx, door[1] + 1, 2, 1, '#e8d890');
    g.globalAlpha = 0.12;
    R(g, lx - 2, door[1] + 2, 6, door[3] - 2, '#e8d890');
    g.globalAlpha = 1;
  }
  return door;
}

function waterTower(g: G, x: number, P: Pal) {
  for (const lx of [x + 1, x + 8]) R(g, lx, GY - 16, 1, 17, '#2e3130');
  for (let y = GY - 14; y < GY; y += 4) R(g, x + 1, y, 8, 1, '#3a3d40');
  box(g, x, GY - 23, 10, 7, P.iron);
  R(g, x - 1, GY - 25, 12, 1, K);
  R(g, x, GY - 24, 10, 1, P.roof[1]);
}

function gantry(g: G, x: number, w: number) {
  R(g, x, GY - 20, 2, 26, '#7a5a28');
  R(g, x + w - 2, GY - 20, 2, 26, '#7a5a28');
  R(g, x - 1, GY - 22, w + 2, 3, K);
  R(g, x, GY - 21, w, 1, '#d8b040');
  for (let i = 0; i < w; i += 3) R(g, x + i, GY - 21, 1, 1, '#1a1a1a');
}

function flakPit(g: G, x: number, y: number, t: number) {
  for (let i = 0; i < 9; i++) R(g, x + i, y - (i === 0 || i === 8 ? 1 : 2), 1, i === 0 || i === 8 ? 1 : 2, i % 2 ? '#a8986a' : '#8a7a52');
  R(g, x, y, 9, 1, '#6a5a3a');
  // Barrel swings slowly.
  const a = -0.9 + Math.sin(t * 0.4) * 0.25;
  for (let k = 0; k < 7; k++) R(g, Math.round(x + 4 + Math.cos(a) * k), Math.round(y - 3 + Math.sin(a) * k), 1, 1, '#2e3130');
  R(g, x + 3, y - 4, 3, 2, '#3a3d40');
}

/** Railway siding with wagons carrying airframe parts (level 5). */
function siding(g: G, W: number, P: Pal, ox: number) {
  R(g, 0, H - 3, W, 1, '#6a5a44');
  for (let x = 0; x < W; x += 3) R(g, x, H - 2, 2, 1, '#4a3a2a');
  R(g, 0, H - 3, W, 1, '#8d9398');
  for (let i = 0; i < 3; i++) {
    const wx = ox + 200 + i * 16;
    box(g, wx, H - 8, 14, 4, ['#6a4a34', '#5a3a28', '#4a2e1e']);
    R(g, wx + 2, H - 4, 2, 2, '#1a1a1a');
    R(g, wx + 10, H - 4, 2, 2, '#1a1a1a');
    R(g, wx + 2, H - 10, 10, 2, i === 1 ? P.camo[1] : '#a8acaa');
    R(g, wx + 2, H - 10, 10, 1, i === 1 ? P.camo[0] : '#c8ccc8');
  }
}

/** A works lorry with a crate on the flatbed. */
function lorry(g: G, x: number, foot: number, P: Pal) {
  const body: [string, string, string] = P.id === 1 ? ['#6c7276', '#5a6064', '#484d50'] : ['#5f6f47', '#4b5a39', '#36412b'];
  box(g, x, foot - 6, 6, 4, body);
  R(g, x + 1, foot - 5, 3, 2, P.glass[0]);
  box(g, x + 7, foot - 3, 14, 1, body);
  box(g, x + 9, foot - 8, 8, 4, ['#a88a5a', '#8a6e46', '#6a5434']);
  R(g, x + 12, foot - 8, 1, 4, '#6a5434');
  for (const wx of [x + 2, x + 15, x + 18]) {
    R(g, wx, foot - 2, 3, 2, '#1a1a1a');
    R(g, wx + 1, foot - 2, 1, 1, '#5a5a5a');
  }
}

function crater(g: G, x: number, y: number, r: number) {
  for (let dy = -r; dy <= r; dy++) {
    const hw = Math.round(Math.sqrt(r * r - dy * dy) * 2);
    R(g, x - hw, y + Math.round(dy / 2), hw * 2 + 1, 1, dy < 0 ? '#3a3020' : '#2a2418');
  }
  R(g, x - r * 2 - 1, y, 2, 1, '#7a6a4a');
  R(g, x + r * 2, y, 2, 1, '#7a6a4a');
  R(g, x - r, y - Math.ceil(r / 2) - 1, r * 2, 1, '#6a5a3a');
}

function rubble(g: G, x: number, y: number, P: Pal, seed: number) {
  for (let i = 0; i < 14; i++) {
    const rx = x + Math.floor(hash(i, seed) * 10);
    const ry = y - Math.floor(hash(i, seed, 1) * (4 - Math.abs(rx - x - 5) / 2));
    R(g, rx, ry, 2, 1, hash(i, seed, 2) > 0.5 ? P.wall[1] : P.wall[2]);
  }
}

export function worksScene(side: SideState): HTMLElement {
  const P: Pal = { ...PALS[look(side.id)], id: look(side.id) };
  const f = side.factory;
  const lv = Math.max(1, Math.min(5, f.level));
  const cond = side.facilities.industry;
  const hit = cond < 70;
  const burning = cond < 40;
  const holes = burning ? 2 : hit ? 1 : 0;
  const queue = f.queue;
  const first = queue[0];
  const frac = first ? Math.max(0, Math.min(0.95, f.progress / AIRCRAFT[first].build)) : 0;
  type Slot = { x: number; y: number; clip?: [number, number, number, number] };
  const slots: Slot[] = [];
  const chimneys: { x: number; top: number }[] = [];
  const fires: { x: number; y: number; w: number }[] = [];
  const craters: [number, number, number][] = [];
  if (hit) craters.push([110, GY + 7, 2], [250, GY + 10, 3]);
  if (burning) craters.push([40, GY + 12, 3], [182, GY + 13, 2], [320, GY + 6, 2]);
  const def: SceneDef = {
    still(g, W, ox) {
      slots.length = 0;
      chimneys.length = 0;
      fires.length = 0;
      backdrop(g, W, P, 11 + side.id);
      const X = (n: number) => ox + n;
      // Works yard: concrete apron and a fence along the road.
      R(g, 0, GY + 1, W, 9, P.conc[0]);
      for (let x = 0; x < W; x += 7) R(g, x, GY + 1 + (x % 14 ? 3 : 6), 6, 1, P.conc[1]);
      R(g, 0, GY + 10, W, 1, P.conc[1]);
      for (let x = 0; x < W; x += 4) R(g, x, GY + 12, 1, 3, '#3a3d40');
      R(g, 0, GY + 12, W, 1, '#4a4e52');
      R(g, X(150), GY + 11, 14, 4, P.grass[0]);
      chimneys.push({ x: X(66) + 2, top: chimney(g, X(66), P, 30, hit) });
      const dA = sawtooth(g, X(14), 48, P, lv >= 2 ? 0 : holes, 1);
      slots.push({ x: dA[0] + 1, y: GY - 1, clip: dA });
      if (lv >= 2) {
        const dB = sawtooth(g, X(76), 48, P, holes, 2);
        slots.push({ x: dB[0] + 1, y: GY - 1, clip: dB });
        chimneys.push({ x: X(128) + 2, top: chimney(g, X(128), P, 26, false) });
      }
      if (lv >= 3) {
        const d = assemblyHall(g, X(138), 78, P, holes, 3);
        slots.unshift({ x: d[0] + 4, y: GY - 1, clip: d }, { x: d[0] + 36, y: GY - 1, clip: d });
        waterTower(g, X(220), P);
      }
      if (lv >= 4) {
        chimneys.push({ x: X(236) + 2, top: chimney(g, X(236), P, 34, burning) });
        const d = sawtooth(g, X(246), 50, P, holes, 4);
        slots.push({ x: d[0] + 1, y: GY - 1, clip: d });
      }
      if (lv < 3) lorry(g, X(196), GY + 8, P);
      // Yard slot: an airframe out on the apron awaiting its engines.
      slots.push({ x: X(lv >= 4 ? 300 : lv >= 3 ? 218 : 130), y: GY + 9 });
      if (lv >= 4) gantry(g, X(296), 34);
      if (lv >= 5) siding(g, W, P, ox);
      // Damage.
      if (cond < 90) for (let i = 0; i < 6; i++) R(g, X(20 + i * 3), GY - 15 - (i % 2), 2, 1, '#8a8e92');
      for (const [cx, cy, r] of craters) crater(g, X(cx), cy, r);
      if (hit) {
        rubble(g, X(60), GY + 2, P, 1);
        rubble(g, X(200), GY + 3, P, 2);
      }
      if (burning) {
        rubble(g, X(30), GY + 4, P, 3);
        rubble(g, X(124), GY + 2, P, 4);
        fires.push({ x: X(22), y: GY - 12, w: 6 }, { x: X(lv >= 3 ? 170 : 90), y: GY - (lv >= 3 ? 16 : 12), w: 7 });
        if (lv >= 4) fires.push({ x: X(262), y: GY - 12, w: 5 });
      }
      // Hedge at the edges of a wide scene.
      for (let x = 0; x < ox; x++) R(g, x, GY - 2 - Math.floor(hash(x, 9) * 2), 1, 3, P.trees[0]);
      for (let x = ox + BASE; x < W; x++) R(g, x, GY - 2 - Math.floor(hash(x, 9) * 2), 1, 3, P.trees[0]);
    },
    live(g, W, ox, time) {
      const fr = Math.floor(time * 9);
      const X = (n: number) => ox + n;
      // Aircraft on the line: the first is being finished, the rest are bare airframes.
      slots.forEach((s, i) => {
        const kind = queue[i];
        g.save();
        if (s.clip) {
          g.beginPath();
          g.rect(s.clip[0], s.clip[1], s.clip[2], s.clip[3]);
          g.clip();
        }
        if (kind) {
          const spr = warplane(kind, side.id, i === 0 ? frac : 0);
          g.drawImage(spr, s.x, s.y - spr.height + 1);
          // QC on the line.
          const mid = s.x + Math.floor(spr.width / 2);
          if (f.qc === 'rushed' && (fr + i) % 3 !== 0) {
            const sx = mid + ((fr * 3 + i * 5) % 7) - 3;
            R(g, sx, s.y - 4, 1, 1, '#fff8c0');
            R(g, sx + 1, s.y - 5 + (fr % 2), 1, 1, '#f0b040');
            R(g, sx - 1, s.y - 2, 1, 1, '#f0d060');
          }
          if (f.qc === 'strict') figure(g, s.x + spr.width - 2, s.y + 1, '#e8e4d4', '#d9a27a', 0, '#2e3130');
          else figure(g, s.x + spr.width - 2, s.y + 1, '#2c4672', '#d9a27a', fr % 6 < 3 ? 0 : 1);
        } else if (i < 2) {
          // An empty jig.
          R(g, s.x + 2, s.y - 6, 1, 7, '#6a5a3a');
          R(g, s.x + 12, s.y - 6, 1, 7, '#6a5a3a');
          R(g, s.x + 1, s.y - 6, 13, 1, '#7a6a4a');
        }
        g.restore();
      });
      // Chimney smoke, heavier for a rushed or burning works.
      chimneys.forEach((c, i) => smoke(g, c.x, c.top, time, f.qc === 'rushed' || burning, 7, 14, i));
      for (const [i, fi] of fires.entries()) {
        smoke(g, fi.x + 2, fi.y - 4, time * 1.3, true, 7, 30, i + 5);
        flames(g, fi.x, fi.y, fi.w, time, i * 13);
      }
      // A crane trolley shuttling along the gantry.
      if (lv >= 4) {
        const tx = X(298) + Math.round((Math.sin(time * 0.5) + 1) * 13);
        R(g, tx, GY - 19, 4, 2, '#3a3d40');
        R(g, tx + 1, GY - 17, 1, 9, '#2e3130');
        R(g, tx, GY - 8, 3, 1, '#2e3130');
      }
      // Flak pits, one per battery level.
      const pits = Math.max(0, Math.min(3, Math.round(side.flak * 2)));
      [X(4), X(340), X(232)].slice(0, pits).forEach((x, i) => flakPit(g, x, GY + 9, time + i));
      // Workers crossing the yard; inspectors with clipboards on a strict line.
      const p = (time * 5) % 200;
      const wx = p < 100 ? p : 200 - p;
      figure(g, X(30) + wx * 1.4, GY + 8, '#2c4672', '#d9a27a', fr);
      if (lv >= 3) figure(g, X(250) - wx, GY + 9, f.qc === 'strict' ? '#e8e4d4' : '#2c4672', '#d9a27a', fr + 1, f.qc === 'strict' ? '#2e3130' : undefined);
      if (lv >= 5) {
        // A finished machine on the flight-test apron, engines running.
        const fin = warplane('fighter', side.id, 1);
        g.drawImage(fin, X(330), GY + 1);
        R(g, X(329), GY + 2 + (fr % 2) * 2, 1, 2, '#c9ced2');
      }
    },
  };
  const label = [
    h('b', null, `Aircraft works · level ${lv} of 5`),
    h('span', null, `${queue.length ? `${queue.length} on the line` : 'Line idle'} · QC ${f.qc} · condition ${Math.round(cond)}%`),
  ];
  return sceneEl(`bscene-works side${side.id}`, label, def);
}
