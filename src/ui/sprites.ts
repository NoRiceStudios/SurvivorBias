/**
 * Procedural pixel-art aircraft. Each sprite is rasterised from simple shapes
 * tagged with a hit zone, so damage can be placed exactly where it landed.
 */
import { nationAt, ROUNDEL } from './nation';
import type { AircraftKind, Hit, NationId, SideId, ZoneId } from '../core/types';
import { ZONES } from '../core/types';

export const PAL = {
  outline: '#16171a',
  ink: '#2a2620',
  paper: '#e9dfc4',
  paperDark: '#d6c8a2',
  paperShade: '#c4b48a',
  stamp: '#b0302a',
  glass: '#5f8ea0',
  glassHi: '#b4d6e0',
  glassLo: '#3c5c6a',
  engine: '#2e3130',
  engineHi: '#4a4f4d',
  prop: '#8d9398',
  propHi: '#c9ced2',
  hole: '#0b0b0c',
  torn: '#c9c1ae',
  scorch: '#3a3028',
  scorch2: '#5a4a3a',
  patch: '#8a8a6a',
  red: '#a8332a',
  blue: '#2c4672',
  white: '#e8e4d4',
  yellow: '#d8b040',
  black: '#1a1a1a',
};

const CAMO: Record<NationId, { a: string[]; b: string[]; under: string }> = {
  // [shadow, base, light, highlight]
  aldmere: { a: ['#36412b', '#4b5a39', '#5f6f47', '#7c8a5a'], b: ['#4a3d2a', '#64523a', '#7a674a', '#94805e'], under: '#8f9a8a' },
  varn: { a: ['#2f3d44', '#43555e', '#586c75', '#73878f'], b: ['#3a4636', '#4e5c48', '#62715a', '#7d8c72'], under: '#9aa6a8' },
  directorate: { a: ['#3c434c', '#535d68', '#68737f', '#87929c'], b: ['#2f3a33', '#42504a', '#55645c', '#6f7f76'], under: '#a3aab0' },
};

type Mat = 'skin' | 'glass' | 'engine' | 'prop' | 'metal';
const MAT_ID: Record<Mat, number> = { skin: 1, glass: 2, engine: 3, prop: 4, metal: 5 };

export interface SpriteDef {
  w: number;
  h: number;
  /** material per pixel (0 empty) */
  mat: Uint8Array;
  /** zone index per pixel (-1 none) */
  zone: Int8Array;
  /** insignia centres */
  insignia: [number, number, number][];
  /** pixel lists per zone for damage placement */
  zonePixels: Record<ZoneId, number[]>;
}

class Raster {
  mat: Uint8Array;
  zone: Int8Array;
  insignia: [number, number, number][] = [];
  constructor(public w: number, public h: number) {
    this.mat = new Uint8Array(w * h);
    this.zone = new Int8Array(w * h).fill(-1);
  }
  set(x: number, y: number, z: ZoneId | null, m: Mat) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return;
    const i = y * this.w + x;
    this.mat[i] = MAT_ID[m];
    if (z) this.zone[i] = ZONES.indexOf(z);
  }
  poly(pts: [number, number][], z: ZoneId | null, m: Mat, mirror = true) {
    const fill = (p: [number, number][]) => {
      const minY = Math.floor(Math.min(...p.map((q) => q[1])));
      const maxY = Math.ceil(Math.max(...p.map((q) => q[1])));
      const minX = Math.floor(Math.min(...p.map((q) => q[0])));
      const maxX = Math.ceil(Math.max(...p.map((q) => q[0])));
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) if (inside(x + 0.5, y + 0.5, p)) this.set(x, y, z, m);
    };
    fill(pts);
    if (mirror) fill(pts.map(([x, y]) => [this.w - x, y]));
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, z: ZoneId | null, m: Mat, mirror = false) {
    const one = (ccx: number) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(ccx - rx); x <= Math.ceil(ccx + rx); x++) {
          const dx = (x + 0.5 - ccx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) this.set(x, y, z, m);
        }
    };
    one(cx);
    if (mirror) one(this.w - cx);
  }
  rect(x0: number, y0: number, x1: number, y1: number, z: ZoneId | null, m: Mat, mirror = false) {
    this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z, m, mirror);
  }
  /** Re-tag already-filled pixels inside a polygon with a zone (no material change). */
  tag(pts: [number, number][], z: ZoneId, mirror = true) {
    const doTag = (p: [number, number][]) => {
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++) {
          const i = y * this.w + x;
          if (this.mat[i] === MAT_ID.skin && inside(x + 0.5, y + 0.5, p)) this.zone[i] = ZONES.indexOf(z);
        }
    };
    doTag(pts);
    if (mirror) doTag(pts.map(([x, y]) => [this.w - x, y]));
  }
  done(): SpriteDef {
    const zonePixels = Object.fromEntries(ZONES.map((z) => [z, [] as number[]])) as Record<ZoneId, number[]>;
    for (let i = 0; i < this.mat.length; i++) if (this.zone[i] >= 0 && this.mat[i] !== MAT_ID.prop) zonePixels[ZONES[this.zone[i]]].push(i);
    return { w: this.w, h: this.h, mat: this.mat, zone: this.zone, insignia: this.insignia, zonePixels };
  }
}

function inside(x: number, y: number, p: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function buildMedium(): SpriteDef {
  const W = 64;
  const H = 50;
  const r = new Raster(W, H);
  const cx = W / 2;
  // Wings (left half; mirrored)
  r.poly([[3, 22], [cx, 17], [cx, 27], [4, 26]], 'outerWing', 'skin');
  // Tailplane
  r.poly([[cx - 12, 40], [cx, 38], [cx, 44], [cx - 11, 44]], 'tail', 'skin');
  // Fuselage
  r.poly([[cx - 2, 3], [cx - 4, 8], [cx - 4, 26], [cx - 2.5, 40], [cx - 1.5, 47], [cx, 47], [cx, 3]], 'fuselage', 'skin');
  // Zones on the wing
  r.tag([[cx - 13, 16], [cx, 16], [cx, 28], [cx - 13, 28]], 'wingRoot');
  r.tag([[cx - 9, 17], [cx - 4, 17], [cx - 4, 26.5], [cx - 9, 26.5]], 'fuel');
  r.tag([[cx - 3, 37], [cx, 37], [cx, 48], [cx - 3, 48]], 'tail');
  // Fin seen from above
  r.rect(cx - 0.5, 36, cx + 0.5, 47, 'tail', 'metal');
  // Engine nacelles
  r.poly([[cx - 17.5, 14], [cx - 12.5, 14], [cx - 12.5, 30], [cx - 14, 33], [cx - 16, 33], [cx - 17.5, 30]], 'engines', 'skin', true);
  r.rect(cx - 17.5, 13, cx - 12.5, 16, 'engines', 'engine', true);
  r.rect(cx - 21, 12, cx - 9, 13, null, 'prop', true);
  // Nose glazing and cockpit
  r.poly([[cx - 1, 2], [cx - 2.5, 5], [cx, 5.5], [cx, 2]], 'nose', 'glass');
  r.poly([[cx - 2, 10], [cx, 9], [cx, 13], [cx - 2, 13]], 'cockpit', 'glass');
  r.tag([[cx - 4, 5], [cx, 5], [cx, 9], [cx - 4, 9]], 'nose');
  r.insignia.push([12, 23, 2.5], [W - 12, 23, 2.5]);
  return r.done();
}

function buildHeavy(): SpriteDef {
  const W = 84;
  const H = 60;
  const r = new Raster(W, H);
  const cx = W / 2;
  r.poly([[3, 26], [cx, 19], [cx, 31], [4, 30]], 'outerWing', 'skin');
  r.poly([[cx - 15, 49], [cx, 46], [cx, 53], [cx - 14, 53]], 'tail', 'skin');
  r.poly([[cx - 2.5, 3], [cx - 4.5, 9], [cx - 4.5, 30], [cx - 3, 48], [cx - 1.5, 57], [cx, 57], [cx, 3]], 'fuselage', 'skin');
  r.tag([[cx - 17, 18], [cx, 18], [cx, 32], [cx - 17, 32]], 'wingRoot');
  r.tag([[cx - 14, 20], [cx - 5, 20], [cx - 5, 30.5], [cx - 14, 30.5]], 'fuel');
  r.tag([[cx - 4, 45], [cx, 45], [cx, 58], [cx - 4, 58]], 'tail');
  r.rect(cx - 0.5, 44, cx + 0.5, 57, 'tail', 'metal');
  // Two engines per side
  for (const [ex, ey] of [[cx - 16, 17], [cx - 28, 19]]) {
    r.poly([[ex - 2.5, ey], [ex + 2.5, ey], [ex + 2.5, ey + 15], [ex + 1, ey + 18], [ex - 1, ey + 18], [ex - 2.5, ey + 15]], 'engines', 'skin', true);
    r.rect(ex - 2.5, ey - 1, ex + 2.5, ey + 2, 'engines', 'engine', true);
    r.rect(ex - 5.5, ey - 2, ex + 5.5, ey - 1, null, 'prop', true);
  }
  r.poly([[cx - 1.5, 2], [cx - 3, 5], [cx, 5.5], [cx, 2]], 'nose', 'glass');
  r.poly([[cx - 2.5, 10], [cx, 9], [cx, 13], [cx - 2.5, 13]], 'cockpit', 'glass');
  r.tag([[cx - 5, 6], [cx, 6], [cx, 9], [cx - 5, 9]], 'nose');
  // Dorsal turret
  r.ellipse(cx, 20, 1.6, 1.6, 'fuselage', 'glass');
  r.insignia.push([8, 27.5, 2.2], [W - 8, 27.5, 2.2]);
  return r.done();
}

function buildFighter(): SpriteDef {
  const W = 40;
  const H = 34;
  const r = new Raster(W, H);
  const cx = W / 2;
  r.poly([[2, 15], [5, 12], [cx, 10], [cx, 19], [3, 18]], 'outerWing', 'skin');
  r.poly([[cx - 8, 27], [cx - 6, 25], [cx, 24], [cx, 29], [cx - 7, 29]], 'tail', 'skin');
  r.poly([[cx - 2.5, 3], [cx - 3, 8], [cx - 2.5, 22], [cx - 1, 31], [cx, 31], [cx, 3]], 'fuselage', 'skin');
  r.tag([[cx - 8, 9], [cx, 9], [cx, 20], [cx - 8, 20]], 'wingRoot');
  r.tag([[cx - 6, 10.5], [cx - 3, 10.5], [cx - 3, 18], [cx - 6, 18]], 'fuel');
  r.tag([[cx - 3, 3], [cx, 3], [cx, 9], [cx - 3, 9]], 'engines');
  r.tag([[cx - 2, 23], [cx, 23], [cx, 32], [cx - 2, 32]], 'tail');
  r.rect(cx - 0.5, 23, cx + 0.5, 31, 'tail', 'metal');
  r.poly([[cx - 2, 2], [cx, 1.5], [cx, 4], [cx - 2, 4]], 'nose', 'engine');
  r.rect(cx - 6, 1, cx + 6, 2, null, 'prop');
  r.poly([[cx - 1.5, 10], [cx, 9], [cx, 15], [cx - 1.5, 15]], 'cockpit', 'glass');
  r.insignia.push([8, 15, 2], [W - 8, 15, 2]);
  return r.done();
}

function buildRecon(): SpriteDef {
  const W = 46;
  const H = 34;
  const r = new Raster(W, H);
  const cx = W / 2;
  r.poly([[2, 14], [cx, 11], [cx, 18], [3, 17]], 'outerWing', 'skin');
  r.poly([[cx - 7, 28], [cx, 26], [cx, 30], [cx - 6, 30]], 'tail', 'skin');
  r.poly([[cx - 2, 4], [cx - 2.5, 9], [cx - 2, 24], [cx - 1, 32], [cx, 32], [cx, 4]], 'fuselage', 'skin');
  r.tag([[cx - 9, 10], [cx, 10], [cx, 19], [cx - 9, 19]], 'wingRoot');
  r.tag([[cx - 7, 11.5], [cx - 3, 11.5], [cx - 3, 17.5], [cx - 7, 17.5]], 'fuel');
  r.tag([[cx - 2, 25], [cx, 25], [cx, 33], [cx - 2, 33]], 'tail');
  r.poly([[cx - 10, 8], [cx - 7, 8], [cx - 7, 20], [cx - 8.5, 22], [cx - 10, 20]], 'engines', 'skin', true);
  r.rect(cx - 10, 7, cx - 7, 9, 'engines', 'engine', true);
  r.rect(cx - 12, 6, cx - 5, 7, null, 'prop', true);
  r.poly([[cx - 1.5, 3], [cx, 2.5], [cx, 5], [cx - 1.5, 5]], 'nose', 'glass');
  r.poly([[cx - 1.5, 8], [cx, 7], [cx, 12], [cx - 1.5, 12]], 'cockpit', 'glass');
  r.insignia.push([7, 14.5, 2], [W - 7, 14.5, 2]);
  return r.done();
}

const DEFS: Partial<Record<AircraftKind, SpriteDef>> = {};
export function spriteDef(kind: AircraftKind): SpriteDef {
  if (!DEFS[kind]) {
    DEFS[kind] = kind === 'medium' ? buildMedium() : kind === 'heavy' ? buildHeavy() : kind === 'fighter' ? buildFighter() : buildRecon();
  }
  return DEFS[kind]!;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cheap deterministic value noise for camouflage blotches. */
function noise(x: number, y: number, seed: number): number {
  const f = (xx: number, yy: number) => {
    let h = (xx * 374761393 + yy * 668265263 + seed * 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const s = 5;
  const gx = Math.floor(x / s);
  const gy = Math.floor(y / s);
  const tx = (x % s) / s;
  const ty = (y % s) / s;
  const a = f(gx, gy);
  const b = f(gx + 1, gy);
  const c = f(gx, gy + 1);
  const d = f(gx + 1, gy + 1);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export type RenderStyle = 'camo' | 'blueprint' | 'silhouette' | 'outline';

export interface RenderOpts {
  side: SideId;
  style?: RenderStyle;
  hits?: Hit[];
  /** visual wear: number of old patched holes */
  patches?: number;
  seed?: number;
  /** highlight zones (blueprint mode) */
  zoneTint?: Partial<Record<ZoneId, string>>;
  /** Armor plates per zone (blueprint mode): the zone is filled in pale steel, paler with more plates. */
  zonePlates?: Partial<Record<ZoneId, number>>;
  /** Line colour for the 'outline' style (a chalk outline on the ground). */
  lineColor?: string;
  /** draw hits as red dots (composite map) */
  dots?: boolean;
  dotColor?: string;
  /** Draw each dot as a small cross, so it can be counted on a big plot. */
  bigDots?: boolean;
  /** Earlier holes, drawn faint underneath the dots. */
  faintHits?: Hit[];
  /** A zone to pick out (blueprint mode): its edge is drawn in yellow, as under the cursor. */
  hover?: ZoneId | null;
}

/** The blueprint palette: Wald's diagram, drawn by a draughtsman. */
export const BLUE = { fill: '#24426a', shade: '#2b4d78', zone: '#6f8fb4', line: '#e3ebf2', plate: '#e3ebf2', faint: '#7f9cc0', hole: '#ff6a3c', pick: '#ffd23c' };
/** Steel fill of a plated zone by number of plates (1..3): the more plate, the paler. */
export const PLATE_FILL = ['', '#93acc8', '#b9cbdd', '#e0e9f1'];

/** Render an aircraft into an ImageData-compatible RGBA buffer. */
export function renderAircraft(kind: AircraftKind, opts: RenderOpts): { w: number; h: number; data: Uint8ClampedArray<ArrayBuffer> } {
  const def = spriteDef(kind);
  const { w, h, mat } = def;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const style = opts.style ?? 'camo';
  const nation = nationAt(opts.side).id;
  const camo = CAMO[nation];
  const seed = opts.seed ?? 7;
  const put = (i: number, c: string, a = 255) => {
    const [r, g, b] = hex(c);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  };
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mat[y * w + x] !== 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = mat[i];
      if (m === 0) {
        // Outline around the silhouette.
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          put(i, style === 'blueprint' ? BLUE.line : style === 'outline' ? opts.lineColor ?? '#e8e4d8' : PAL.outline, 255);
        }
        continue;
      }
      if (style === 'outline') continue;
      if (style === 'silhouette') {
        put(i, PAL.ink);
        continue;
      }
      const lightEdge = !filled(x, y - 1) || !filled(x - 1, y);
      const darkEdge = !filled(x, y + 1) || !filled(x + 1, y);
      if (style === 'blueprint') {
        // A draughtsman's drawing: blue fill, white lines; plated zones in solid pale steel,
        // so armor reads at a glance against the dark blue of bare skin.
        const zi = def.zone[i];
        const tint = zi >= 0 ? opts.zoneTint?.[ZONES[zi]] : undefined;
        const plates = zi >= 0 ? opts.zonePlates?.[ZONES[zi]] ?? 0 : 0;
        let c = tint ?? (m === MAT_ID.glass || m === MAT_ID.engine || m === MAT_ID.prop ? BLUE.shade : BLUE.fill);
        if (plates > 0) c = PLATE_FILL[Math.min(plates, PLATE_FILL.length - 1)];
        // Zone boundaries as fine lines.
        const zr = def.zone[i + 1];
        const zd = def.zone[i + w];
        if (zi >= 0 && ((zr >= 0 && zr !== zi && mat[i + 1]) || (zd >= 0 && zd !== zi && mat[i + w]))) c = BLUE.zone;
        if (opts.hover && zi >= 0 && ZONES[zi] === opts.hover) {
          const other = (j: number, ok: boolean) => !ok || def.zone[j] !== zi || !mat[j];
          if (other(i - 1, x > 0) || other(i + 1, x < w - 1) || other(i - w, y > 0) || other(i + w, y < h - 1)) c = BLUE.pick;
        }
        put(i, c);
        continue;
      }
      if (m === MAT_ID.glass) {
        put(i, lightEdge ? PAL.glassHi : darkEdge ? PAL.glassLo : PAL.glass);
      } else if (m === MAT_ID.engine) {
        put(i, lightEdge ? PAL.engineHi : PAL.engine);
      } else if (m === MAT_ID.prop) {
        put(i, (x + y) % 2 === 0 ? PAL.propHi : PAL.prop, 200);
      } else if (m === MAT_ID.metal) {
        put(i, camo.a[0]);
      } else {
        const n = noise(x, y, seed);
        const ramp = n > 0.55 ? camo.b : camo.a;
        let shade = 1;
        if (lightEdge) shade = 2;
        if (darkEdge) shade = 0;
        put(i, ramp[shade]);
      }
    }
  }

  // Insignia
  if (style === 'camo') {
    for (const [ix, iy, rr] of def.insignia) {
      for (let y = Math.floor(iy - rr - 1); y <= iy + rr + 1; y++)
        for (let x = Math.floor(ix - rr - 1); x <= ix + rr + 1; x++) {
          if (!filled(x, y)) continue;
          const d = Math.hypot(x + 0.5 - ix, y + 0.5 - iy);
          const i = y * w + x;
          if (nation !== 'directorate') {
            const [centre, ring, edge] = ROUNDEL[nation];
            if (d <= rr * 0.45) put(i, centre);
            else if (d <= rr * 0.8) put(i, ring);
            else if (d <= rr + 0.2) put(i, edge);
          } else {
            // Directorate: black diamond edged in yellow.
            const md = Math.abs(x + 0.5 - ix) + Math.abs(y + 0.5 - iy);
            if (md <= rr * 0.7) put(i, PAL.black);
            else if (md <= rr + 0.6) put(i, PAL.yellow);
          }
        }
    }
    // Old patches: slightly mismatched paint squares.
    const patches = Math.min(40, opts.patches ?? 0);
    const skinPx: number[] = [];
    for (let i = 0; i < mat.length; i++) if (mat[i] === MAT_ID.skin) skinPx.push(i);
    for (let k = 0; k < patches; k++) {
      const idx = skinPx[Math.floor(((k * 2654435761 + seed * 97) >>> 0) % skinPx.length)];
      if (idx !== undefined) put(idx, PAL.patch);
    }
  }

  // Earlier holes, faint.
  for (const hit of opts.faintHits ?? []) {
    const px = def.zonePixels[hit.zone];
    if (!px || px.length === 0) continue;
    put(px[Math.floor(hit.u * px.length) % px.length], style === 'blueprint' ? BLUE.faint : '#7d7360');
  }
  const dot = opts.dotColor ?? (style === 'blueprint' ? BLUE.hole : PAL.red);
  // Damage
  for (const hit of opts.hits ?? []) {
    const px = def.zonePixels[hit.zone];
    if (!px || px.length === 0) continue;
    const idx = px[Math.floor(hit.u * px.length) % px.length];
    const x = idx % w;
    const y = Math.floor(idx / w);
    if (opts.dots) {
      if (opts.bigDots) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (filled(x + dx, y + dy)) put((y + dy) * w + x + dx, dot);
      } else put(idx, dot);
      continue;
    }
    if (hit.approach === 'flak') {
      // Jagged flak tear with scorch.
      const ox = hit.v > 0.5 ? 1 : -1;
      for (const [dx, dy, c] of [[0, 0, PAL.hole], [ox, 0, PAL.hole], [0, 1, PAL.scorch], [ox, -1, PAL.scorch2], [-ox, 0, PAL.scorch2], [0, -1, PAL.torn]] as [number, number, string][]) {
        if (filled(x + dx, y + dy)) put((y + dy) * w + x + dx, c);
      }
    } else {
      put(idx, PAL.hole);
      const tx = hit.v > 0.5 ? x + 1 : x - 1;
      if (filled(tx, y)) put(y * w + tx, PAL.torn);
    }
  }
  return { w, h, data };
}

/** Draw an aircraft into an existing canvas at its native size (to redraw it in place). */
export function paintAircraft(c: HTMLCanvasElement, kind: AircraftKind, opts: RenderOpts): { w: number; h: number } {
  const img = renderAircraft(kind, opts);
  if (c.width !== img.w) c.width = img.w;
  if (c.height !== img.h) c.height = img.h;
  c.getContext('2d')!.putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return img;
}

/** Draw an aircraft to a canvas at an integer scale. */
export function aircraftCanvas(kind: AircraftKind, opts: RenderOpts, scale = 3): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const img = paintAircraft(c, kind, opts);
  c.style.width = `${img.w * scale}px`;
  c.style.height = `${img.h * scale}px`;
  c.className = 'pix';
  return c;
}

/** The hit zone under a pixel of a type's sprite (sprite coordinates), or null. */
/** A point inside each zone, near its middle, in sprite pixels: where a label for the zone can sit. */
export function zoneCentre(kind: AircraftKind, z: ZoneId): { x: number; y: number } | null {
  const def = spriteDef(kind);
  const px = def.zonePixels[z];
  if (!px?.length) return null;
  let sx = 0;
  let sy = 0;
  for (const i of px) { sx += i % def.w; sy += Math.floor(i / def.w); }
  const mx = sx / px.length;
  const my = sy / px.length;
  // The zone pixel closest to the mean, so a split zone (two wings) labels a real part of it.
  let best = px[0];
  let bd = Infinity;
  for (const i of px) {
    const d = (i % def.w - mx) ** 2 + (Math.floor(i / def.w) - my) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { x: best % def.w, y: Math.floor(best / def.w) };
}

export function zoneAt(kind: AircraftKind, x: number, y: number): ZoneId | null {
  const def = spriteDef(kind);
  if (x < 0 || y < 0 || x >= def.w || y >= def.h) return null;
  const zi = def.zone[Math.floor(y) * def.w + Math.floor(x)];
  return zi >= 0 ? ZONES[zi] : null;
}
