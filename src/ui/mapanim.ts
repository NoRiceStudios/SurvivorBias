/**
 * The War Room map, alive: this week's orders flown out as little aircraft over
 * the static map. Patrols orbit their sector, the reserve circles the home field,
 * the raid streams out to its target and back with the escort weaving alongside,
 * feints and sweeps circle where they were sent, and resting squadrons sit on the
 * ground. Purely decoration: nothing here touches the game.
 */
import type { AircraftKind } from '../core/types';
import { mapGeo, type MapGeo } from './theaterui';

export type FlightTask = 'patrol' | 'reserve' | 'raid' | 'escort' | 'sweep' | 'feint' | 'recon' | 'rest';

export interface Flight {
  /** Squadron id, so the squadron's row can pick its aircraft out on the map. */
  id: string;
  name: string;
  kind: AircraftKind;
  /** Aircraft ready; a few of them are drawn. */
  ready: number;
  task: FlightTask;
  /** Patrol or feint sector. */
  sector?: number;
  /** Recon: the site being photographed. */
  siteId?: string;
}

/** Squadron whose row the pointer is over: its aircraft are picked out, the others dimmed. */
let hovered: string | null = null;
export function hoverFlight(id: string | null) {
  hovered = id;
}

/* ---------------- Sprites (seen from above, nose up) ---------------- */

const SPRITE: Record<AircraftKind, string[]> = {
  fighter: [
    '...#...',
    '..###..',
    '#######',
    '.#####.',
    '...#...',
    '...#...',
    '..###..',
  ],
  recon: [
    '...#...',
    '...#...',
    '#######',
    '...#...',
    '...#...',
    '..###..',
  ],
  medium: [
    '....#....',
    '..#.#.#..',
    '#########',
    '#########',
    '....#....',
    '....#....',
    '...###...',
  ],
  heavy: [
    '.....#.....',
    '.#.#.#.#.#.',
    '###########',
    '###########',
    '.....#.....',
    '.....#.....',
    '.....#.....',
    '...#####...',
  ],
};

const STEPS = 32;
const rotCache = new Map<string, [number, number][]>();

/** The sprite's pixels turned to a heading (0 = north, clockwise), by sampling back. */
function rotated(kind: AircraftKind, heading: number): [number, number][] {
  const step = ((Math.round((heading / (Math.PI * 2)) * STEPS) % STEPS) + STEPS) % STEPS;
  const key = `${kind}:${step}`;
  const hit = rotCache.get(key);
  if (hit) return hit;
  const rows = SPRITE[kind];
  const sh = rows.length;
  const sw = rows[0].length;
  const cx = (sw - 1) / 2;
  const cy = (sh - 1) / 2;
  const a = (step / STEPS) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r = Math.ceil(Math.hypot(sw, sh) / 2);
  const px: [number, number][] = [];
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const sx = Math.round(x * cos + y * sin + cx);
      const sy = Math.round(-x * sin + y * cos + cy);
      if (rows[sy]?.[sx] === '#') px.push([x, y]);
    }
  rotCache.set(key, px);
  return px;
}

/* ---------------- Paths ---------------- */

type Pt = [number, number];

class Path {
  pts: Pt[] = [];
  len: number[] = [];
  /** Distance after which the path is back over the home field (for the climb and descent). */
  constructor(readonly fromHome: boolean) {}
  add(p: Pt) {
    const last = this.pts[this.pts.length - 1];
    this.len.push(last ? this.len[this.len.length - 1] + Math.hypot(p[0] - last[0], p[1] - last[1]) : 0);
    this.pts.push(p);
    return this;
  }
  line(to: Pt) {
    const from = this.pts[this.pts.length - 1] ?? to;
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 2));
    for (let i = 1; i <= n; i++) this.add([from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
    return this;
  }
  /** Circle an ellipse round c, starting at angle a0, for `turns` turns (negative: anticlockwise). */
  orbit(c: Pt, rx: number, ry: number, a0: number, turns: number) {
    const n = Math.ceil(Math.abs(turns) * 48);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (turns * Math.PI * 2 * i) / n;
      this.add([c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry]);
    }
    return this;
  }
  get total() {
    return this.len[this.len.length - 1] || 1;
  }
  /** Position and heading at distance d along the (closed) path. */
  at(d: number): { x: number; y: number; heading: number; alt: number } {
    const L = this.total;
    const dd = ((d % L) + L) % L;
    let lo = 0;
    let hi = this.len.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.len[mid] < dd) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.len[i] - this.len[i - 1] || 1;
    const f = (dd - this.len[i - 1]) / seg;
    const x = a[0] + (b[0] - a[0]) * f;
    const y = a[1] + (b[1] - a[1]) * f;
    const heading = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
    // Climbing out from the field and letting down on the way back in.
    const alt = this.fromHome ? Math.min(1, dd / 24, (L - dd) / 24) : 1;
    return { x, y, heading, alt };
  }
}

/** Point a little to one side of the line a→b (lanes, so out and back do not overlap). */
function aside(a: Pt, b: Pt, by: number): [Pt, Pt] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len;
  const ny = (b[0] - a[0]) / len;
  return [[a[0] + nx * by, a[1] + ny * by], [b[0] + nx * by, b[1] + ny * by]];
}

/** Out to a point, circle it, and home again in a separate lane. */
function sortie(home: Pt, to: Pt, rx: number, ry: number, turns: number): Path {
  const [o0, o1] = aside(home, to, 4);
  const [r0, r1] = aside(to, home, 4);
  const p = new Path(true).add(home).line(o0).line(o1);
  const a0 = Math.atan2((o1[1] - to[1]) / ry, (o1[0] - to[0]) / rx);
  p.orbit(to, rx, ry, a0, turns);
  return p.line(r0).line(r1).line(home);
}

/* ---------------- Drawing ---------------- */

const SPEED: Record<AircraftKind, number> = { fighter: 20, recon: 26, medium: 13, heavy: 11 };
const INK: Record<AircraftKind, string> = { fighter: '#2c4672', recon: '#3e5a2c', medium: '#2a2620', heavy: '#2a2620' };

interface Plot {
  flight: Flight;
  path: Path | null;
  speed: number;
  /** Distance along the path at t = 0. */
  start: number;
  /** Escorts: how far off the bombers' track they fly, and which side. */
  weave?: number;
  count: number;
}

function plots(geo: MapGeo, flights: Flight[]): Plot[] {
  const home = geo.home;
  const out: Plot[] = [];
  const raid = flights.filter((f) => f.task === 'raid');
  const bomberSpeed = Math.min(...raid.map((f) => SPEED[f.kind]), SPEED.medium);
  const raidPath = raid.length ? sortie(home, geo.raidTo, 7, 5, 1) : null;
  const sweepAt: Pt = [geo.frontX(geo.h * 0.5) + geo.toward * 22, geo.h * 0.5];
  const sweepPath = sortie(home, sweepAt, 18, 10, 2);
  const seen: Record<string, number> = {};
  const nth = (k: string) => (seen[k] = (seen[k] ?? -1) + 1);
  for (const f of flights) {
    const count = Math.max(1, Math.min(f.ready, f.kind === 'fighter' ? 4 : 3));
    const p: Plot = { flight: f, path: null, speed: SPEED[f.kind], start: 0, count };
    if (f.task === 'patrol' && f.sector !== undefined) {
      const k = nth(`patrol${f.sector}`);
      p.path = new Path(false).orbit([geo.sectorX(f.sector), geo.h * 0.3], 24, 11, 0, 1);
      p.start = k * p.path.total * 0.5;
    } else if (f.task === 'reserve') {
      const k = nth('reserve');
      p.path = new Path(false).orbit([home[0], home[1] - 16 - k * 5], 13, 7, 0, -1);
      p.start = k * 20;
    } else if (f.task === 'raid' && raidPath) {
      // A bomber stream: one squadron behind the other, at the slowest bomber's pace.
      p.path = raidPath;
      p.speed = bomberSpeed;
      p.start = -nth('raid') * 16;
    } else if (f.task === 'escort' && raidPath) {
      const k = nth('escort');
      p.path = raidPath;
      p.speed = bomberSpeed;
      p.start = 8 - k * 14;
      p.weave = k % 2 === 0 ? 9 : -9;
    } else if (f.task === 'sweep' || (f.task === 'escort' && !raidPath)) {
      p.path = sweepPath;
      p.start = -nth('sweep') * 22;
    } else if (f.task === 'feint' && f.sector !== undefined) {
      p.path = sortie(home, [geo.sectorX(f.sector), geo.h * 0.2], 12, 7, 2);
      p.start = -nth('feint') * 18;
    } else if (f.task === 'recon') {
      const site = (f.siteId && geo.sites[f.siteId]) || geo.raidTo;
      p.path = sortie(home, [site[0], site[1] - 2], 5, 4, 1);
      p.count = 1;
    }
    out.push(p);
  }
  return out;
}

function drawPlane(g: CanvasRenderingContext2D, kind: AircraftKind, x: number, y: number, heading: number) {
  for (const [dx, dy] of rotated(kind, heading)) g.fillRect(Math.round(x) + dx, Math.round(y) + dy, 1, 1);
}

function frame(g: CanvasRenderingContext2D, geo: MapGeo, list: Plot[], t: number) {
  g.clearRect(0, 0, geo.w, geo.h);
  type Drawn = { kind: AircraftKind; x: number; y: number; heading: number; alt: number; ink: string; alpha: number };
  const planes: Drawn[] = [];
  const trails: { x: number; y: number; a: number }[] = [];
  const tags: { text: string; x: number; y: number }[] = [];
  let parked = 0;
  for (const p of list) {
    const f = p.flight;
    const dim = hovered && hovered !== f.id ? 0.3 : 1;
    const ink = hovered === f.id ? '#b0302a' : INK[f.kind];
    if (!p.path) {
      // On the ground beside the home field, in a neat line.
      for (let k = 0; k < p.count; k++) {
        const x = geo.home[0] - geo.toward * (10 + parked * 9);
        planes.push({ kind: f.kind, x, y: geo.home[1] + 9, heading: 0, alt: 0, ink, alpha: dim * 0.75 });
        if (k === 0 && hovered === f.id) tags.push({ text: f.name, x, y: geo.home[1] + 2 });
        parked++;
        if (parked > 8) break;
      }
      continue;
    }
    const lead = p.start + t * p.speed;
    const at = (d: number) => {
      const q = p.path!.at(d);
      if (p.weave === undefined) return q;
      // Escorts weave across the bombers' track.
      const side = p.weave + Math.sin((d / 9) + p.weave) * 4;
      return { ...q, x: q.x + Math.cos(q.heading) * side * q.alt, y: q.y + Math.sin(q.heading) * side * q.alt };
    };
    const q = at(lead);
    const spacing = f.kind === 'fighter' || f.kind === 'recon' ? 5 : 7;
    for (let k = 0; k < p.count; k++) {
      // A vic: the leader, then wingmen stepped back to either side.
      const back = Math.ceil(k / 2) * spacing;
      const off = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * spacing;
      const b = at(lead - back);
      const sx = Math.cos(b.heading) * off * b.alt;
      const sy = Math.sin(b.heading) * off * b.alt;
      planes.push({ kind: f.kind, x: b.x + sx, y: b.y + sy, heading: b.heading, alt: b.alt, ink, alpha: dim });
    }
    if (f.task !== 'patrol' && f.task !== 'reserve' && q.alt > 0.5)
      for (let k = 1; k <= 6; k++) {
        const b = at(lead - spacing * Math.ceil((p.count - 1) / 2) - 3 - k * 3);
        trails.push({ x: b.x, y: b.y, a: (0.5 - k * 0.07) * dim });
      }
    if (hovered === f.id) tags.push({ text: f.name, x: q.x, y: q.y - 9 });
  }
  // Flak over the target while the bombers are on their run.
  const [tx, ty] = geo.raidTo;
  if (planes.some((d) => d.kind !== 'fighter' && d.kind !== 'recon' && d.alt > 0.5 && Math.hypot(d.x - tx, d.y - ty) < 16)) {
    for (let i = 0; i < 6; i++) {
      const k = t * 1.4 + i / 6;
      const u = k - Math.floor(k);
      const n = Math.floor(k) * 7 + i * 13;
      const bx = Math.round(tx + (Math.sin(n * 12.9898) * 43758.5453 % 1) * 12);
      const by = Math.round(ty - 4 + (Math.sin(n * 78.233) * 12345.678 % 1) * 9);
      const r = 1 + Math.round(u * 2);
      g.fillStyle = `rgba(42,38,32,${(0.7 * (1 - u)).toFixed(2)})`;
      g.fillRect(bx - r, by - r + 1, r * 2 + 1, r * 2 - 1);
      g.fillRect(bx - r + 1, by - r, r * 2 - 1, r * 2 + 1);
      if (u < 0.15) { g.fillStyle = '#e8a040'; g.fillRect(bx, by, 1, 1); }
    }
  }
  // Shadows on the ground first: the higher the aircraft, the further off.
  g.fillStyle = 'rgba(22,23,26,0.28)';
  for (const d of planes) if (d.alt > 0) drawPlane(g, d.kind, d.x + 1 + d.alt * 3, d.y + 1 + d.alt * 4, d.heading);
  for (const tr of trails) {
    g.fillStyle = `rgba(240,234,214,${Math.max(0, tr.a)})`;
    g.fillRect(Math.round(tr.x), Math.round(tr.y), 1, 1);
  }
  for (const d of planes) {
    g.globalAlpha = d.alpha;
    g.fillStyle = d.ink;
    drawPlane(g, d.kind, d.x, d.y, d.heading);
  }
  g.globalAlpha = 1;
  g.font = '8px monospace';
  for (const tg of tags) {
    const w = Math.ceil(g.measureText(tg.text).width);
    const lx = Math.max(2, Math.min(geo.w - w - 4, Math.round(tg.x - w / 2)));
    const ly = Math.max(9, Math.round(tg.y));
    g.fillStyle = 'rgba(233,223,196,0.9)';
    g.fillRect(lx - 2, ly - 7, w + 4, 9);
    g.fillStyle = '#b0302a';
    g.fillText(tg.text, lx, ly);
  }
}

/** The map with this week's flights moving over it. */
export function animatedMap(base: HTMLCanvasElement, flights: Flight[]): HTMLElement {
  const geo = mapGeo.get(base);
  const wrap = document.createElement('div');
  wrap.className = 'map-anim';
  wrap.appendChild(base);
  if (!geo || !flights.length) return wrap;
  const c = document.createElement('canvas');
  c.width = geo.w;
  c.height = geo.h;
  c.className = 'pix map-anim-layer';
  wrap.appendChild(c);
  const g = c.getContext('2d')!;
  const list = plots(geo, flights);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const born = performance.now();
  const tick = (now: number) => {
    // Shared clock, so a re-render picks the formations up where they were.
    frame(g, geo, list, now / 1000);
    if (still) return;
    // Stop once the map has left the page (the next render builds a new one).
    if (!c.isConnected && now - born > 1000) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return wrap;
}
