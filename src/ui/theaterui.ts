/**
 * Theater map: a staff map of the theater, drawn procedurally. Coastline, hills,
 * rivers, forest and roads are fixed for each theater; over them go the six
 * sectors, who holds them, the sites, the front line and this week's orders.
 * The sector logic is unchanged: the map is only how the strip of sectors looks.
 */
import { SECTOR_PRESSURE, SECTORS, THEATERS, depthFor } from '../core/theaters';
import type { FacilityType, GameState, SideId, Site, TargetId } from '../core/types';
import type { App } from './app';
import { h } from './dom';
import { setTip, tip as tipAttrs } from './tip';
const tip = tipAttrs;

const FACILITY_WORD: Record<FacilityType, string> = { airfield: 'Airfield', industry: 'Aircraft works', fuel: 'Fuel depot' };

/** Logical size of the map; each logical pixel is drawn as `scale` screen pixels. */
const W = 480;
const H = 264;
const CELL_W = W / SECTORS;

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
  /** The viewer's operation, drawn as a route from home to the target. */
  raid?: { target: TargetId; siteId?: string };
  /** Sites named in standing orders: flagged on the map. */
  ordered?: string[];
  /** Enemy sites our bombers can reach; the others are drawn faded. */
  inRange?: (site: Site) => boolean;
  /** Dashed lines across the map: how far a type can reach past the front (in sectors). */
  rangeLines?: { depth: number; label: string; color: string }[];
  /** Clicking an enemy site calls this (e.g. to choose it as the target). */
  onSite?: (site: Site) => void;
  /** Screen pixels per map pixel (the map also shrinks to fit its column). */
  scale?: number;
}

/** Believed condition the viewer has for a site (truth for own sites). */
export function believed(state: GameState, viewer: SideId, site: Site): number {
  return site.owner === viewer ? site.condition : state.sides[viewer].perceived.sites[site.id] ?? 100;
}

/* ---------------- Terrain ---------------- */

function hash(x: number, y: number, seed: number): number {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  return noise(x / 48, y / 48, seed) * 0.55 + noise(x / 20, y / 20, seed + 1) * 0.3 + noise(x / 8, y / 8, seed + 2) * 0.15;
}

type Ground = 'sea' | 'sand' | 'land' | 'forest' | 'marsh';

interface Terrain {
  ground: Ground[];
  /** 0..1 height of the land. */
  elev: Float32Array;
  river: Uint8Array;
  road: Uint8Array;
}

/** Wiggle of the boundary line between sectors b-1 and b, at height y. */
function boundaryX(b: number, y: number): number {
  return b * CELL_W + Math.round(Math.sin(y / 17 + b * 2.1) * 4 + Math.sin(y / 7 + b) * 1.5);
}

/** Sector of a map pixel, in side-0 coordinates. */
function sectorAt(x: number, y: number): number {
  for (let b = 1; b < SECTORS; b++) if (x < boundaryX(b, y)) return b - 1;
  return SECTORS - 1;
}

/** Geography of each theater, in side-0 coordinates (Aldmere's rear on the left). */
function shape(index: number, x: number, y: number): { water: number; elev: number; forest: number; marsh: number } {
  const seed = 11 + index * 101;
  const n = fbm(x, y, seed);
  if (index === 0) {
    // The Narrow Sea: open water to the north, and the Narrows themselves, an estuary
    // running down between the two coasts to the crossing in the south.
    const coast = 46 + (fbm(x * 1.5, 0, seed + 5) - 0.5) * 50;
    const channel = Math.abs(x - (W / 2 + Math.sin(y / 30) * 10)) - (34 - y * 0.13);
    const water = Math.max(coast - y, y < 196 ? -channel : -99) + (n - 0.5) * 14;
    return { water, elev: n * 0.8, forest: fbm(x, y, seed + 9) - 0.62, marsh: water > -6 && water < 0 ? 1 : 0 };
  }
  if (index === 1) {
    // The Kessel Basin: a ring of hills around a long industrial valley.
    const rim = Math.pow(Math.abs(y - H * 0.52) / (H * 0.5), 1.6) + Math.pow(Math.abs(x - W / 2) / (W * 0.62), 4);
    const lake = 9 - Math.hypot((x - W * 0.58) / 1.6, y - H * 0.36);
    return { water: lake + (n - 0.5) * 8, elev: Math.min(1, rim * 0.9 + n * 0.45), forest: fbm(x, y, seed + 9) - 0.6 + rim * 0.2, marsh: 0 };
  }
  if (index === 2) {
    // The Northern Approaches: a fjord coast to the north-east, forest, and Wendover Ridge.
    const coast = 30 + (x / W) * 40 + Math.sin(x / 9) * 9 * (x / W) + (fbm(x * 2, 3, seed + 5) - 0.5) * 40;
    const ridge = 1 - Math.min(1, Math.abs(x - CELL_W * 1.5 - (y - H / 2) * 0.25) / 26);
    return { water: coast - y + (n - 0.5) * 10, elev: Math.min(1, n * 0.7 + ridge * 0.55), forest: fbm(x, y, seed + 9) - 0.5, marsh: 0 };
  }
  if (index === 3) {
    // The Saltpan Desert: dry lakebeds in the north, low dunes, scrub in the wadis.
    const pan = Math.max(20 - Math.hypot((x - W * 0.3) / 2.4, y - 24), 15 - Math.hypot((x - W * 0.8) / 2, y - 30));
    const dunes = 0.3 + Math.sin(x / 9 + y / 14 + n * 4) * 0.12 + n * 0.3;
    return { water: pan + (n - 0.5) * 6, elev: dunes, forest: fbm(x, y, seed + 9) - 0.66, marsh: 0 };
  }
  if (index === 4) {
    // The Sundered Highlands: ridges across the strip, a tarn, forest in the valleys.
    const range = Math.abs(Math.sin(x / 41 + y / 70 + n * 2.2));
    const tarn = 8 - Math.hypot((x - W * 0.3) / 1.6, y - 52);
    return { water: tarn + (n - 0.5) * 4, elev: Math.min(1, 0.25 + n * 0.5 + range * 0.5), forest: fbm(x, y, seed + 9) - 0.58 - range * 0.3, marsh: 0 };
  }
  // The Sundered Isles: one island to a sector in a warm sea, with reefs in between.
  let d = 9;
  for (let s2 = 0; s2 < SECTORS; s2++) d = Math.min(d, Math.hypot((x - (s2 * CELL_W + CELL_W / 2)) / (CELL_W * 0.52), (y - H * 0.58) / (H * 0.36)));
  return { water: (d - 1) * 14 + (n - 0.5) * 12, elev: Math.max(0, 0.6 - d * 0.35 + n * 0.3), forest: fbm(x, y, seed + 9) - 0.5 - d * 0.15, marsh: 0 };
}

/** The main river of each theater, as a y (or x) for every column. */
function riverPath(index: number): (x: number, y: number) => boolean {
  if (index === 0) return (x, y) => Math.abs(y - (150 + Math.sin(x / 23) * 14 + Math.sin(x / 7) * 3)) < 1.2 && x < W / 2 - 40;
  if (index === 1) return (x, y) => Math.abs(y - (H * 0.56 + Math.sin(x / 29) * 16 + Math.sin(x / 9) * 4)) < 1.4;
  if (index === 3) return (x, y) => Math.abs(y - (H * 0.52 + Math.sin(x / 40) * 22 + Math.sin(x / 11) * 3)) < 0.8 && x % 5 !== 0;
  if (index === 4) return (x, y) => Math.abs(y - (H * 0.62 + Math.sin(x / 25) * 18 + Math.sin(x / 8) * 3)) < 1.4;
  if (index === 5) return () => false;
  return (x, y) => Math.abs(x - (CELL_W * 3.3 + Math.sin(y / 19) * 12 + (y - H / 2) * 0.35)) < 1.3;
}

/** Roads: two lines across the theater through the site rows, and a link in each sector. */
function roadPath(x: number, y: number): boolean {
  const r1 = Math.abs(y - (H * 0.44 + Math.sin(x / 31) * 9));
  const r2 = Math.abs(y - (H * 0.72 + Math.sin(x / 37 + 1) * 8));
  const s = Math.floor(x / CELL_W);
  const link = Math.abs(x - (s * CELL_W + CELL_W / 2 + Math.sin(y / 13 + s) * 3)) < 0.6 && y > H * 0.44 && y < H * 0.72;
  return r1 < 0.6 || r2 < 0.6 || link;
}

const terrainCache = new Map<number, Terrain>();

function terrain(index: number): Terrain {
  const hit = terrainCache.get(index);
  if (hit) return hit;
  const ground: Ground[] = new Array(W * H);
  const elev = new Float32Array(W * H);
  const river = new Uint8Array(W * H);
  const road = new Uint8Array(W * H);
  const onRiver = riverPath(index);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const f = shape(index, x, y);
      elev[i] = f.elev;
      ground[i] = f.water > 0 ? 'sea' : f.water > -4 ? 'sand' : f.marsh ? 'marsh' : f.forest > 0 ? 'forest' : 'land';
      if (ground[i] !== 'sea' && ground[i] !== 'sand') {
        if (onRiver(x, y)) river[i] = 1;
        else if (roadPath(x, y)) road[i] = 1;
      }
    }
  const t = { ground, elev, river, road };
  terrainCache.set(index, t);
  return t;
}

/** Where a site sits on the map (side-0 coordinates): on land, in its sector, near a road. */
function sitePos(index: number, site: Site, k: number): [number, number] {
  const t = terrain(index);
  const j = hash(site.sector, k, index + 3);
  let x = Math.round(site.sector * CELL_W + CELL_W / 2 + (k === 0 ? -14 : 14) + (j - 0.5) * 12);
  let y = Math.round((k === 0 ? H * 0.44 : H * 0.72) - 6 + (hash(k, site.sector, index) - 0.5) * 10);
  // Off the water: walk down (south) until there is land.
  for (let tries = 0; tries < 80 && (t.ground[y * W + x] === 'sea' || t.ground[y * W + x] === 'sand'); tries++) {
    y = Math.min(H - 30, y + 3);
    if (y >= H - 30) x += k === 0 ? 2 : -2;
  }
  return [x, y];
}

type Palette = Record<'sea' | 'seaLine' | 'sand' | 'land' | 'land2' | 'forest' | 'tree' | 'marsh' | 'contour' | 'river' | 'road', number[]> & { snow?: number[] };

const BASE_PAL: Palette = {
  sea: [159, 180, 184], seaLine: [138, 161, 166], sand: [217, 204, 156], land: [216, 204, 166], land2: [205, 191, 150],
  forest: [190, 186, 140], tree: [118, 128, 84], marsh: [196, 196, 160], contour: [168, 149, 106], river: [110, 138, 150], road: [138, 90, 58],
};

/** Each theater is coloured for its season and climate. */
const PALETTES: Record<number, Palette> = {
  0: BASE_PAL,
  // Kessel Basin: winter, grey stone, frozen lake.
  1: { ...BASE_PAL, sea: [178, 192, 198], seaLine: [158, 174, 182], sand: [232, 232, 226], land: [224, 224, 218], land2: [210, 211, 206], forest: [186, 196, 186], tree: [96, 112, 98], marsh: [208, 210, 206], contour: [150, 150, 150], river: [130, 150, 162], road: [104, 98, 92] },
  // Northern Approaches: spring green.
  2: { ...BASE_PAL, sea: [150, 176, 186], land: [208, 216, 164], land2: [194, 205, 148], forest: [172, 190, 126], tree: [90, 122, 68], contour: [150, 160, 110] },
  // Saltpan Desert: white pans, ochre sand, dry beds.
  3: { ...BASE_PAL, sea: [238, 234, 222], seaLine: [220, 212, 190], sand: [230, 206, 150], land: [228, 202, 142], land2: [214, 186, 122], forest: [204, 184, 124], tree: [140, 120, 70], marsh: [220, 200, 150], contour: [184, 142, 86], river: [176, 134, 92], road: [150, 100, 60] },
  // Sundered Highlands: grey rock, snow on the peaks, dark pine.
  4: { ...BASE_PAL, sea: [150, 172, 190], seaLine: [130, 154, 174], sand: [214, 210, 196], land: [206, 204, 188], land2: [190, 188, 170], forest: [160, 180, 146], tree: [76, 102, 72], contour: [138, 138, 136], river: [112, 140, 160], road: [120, 100, 80], snow: [240, 242, 246] },
  // Sundered Isles: turquoise sea, white beaches, lush green.
  5: { ...BASE_PAL, sea: [112, 170, 186], seaLine: [92, 150, 168], sand: [240, 226, 172], land: [170, 202, 122], land2: [154, 190, 108], forest: [118, 164, 94], tree: [62, 112, 62], contour: [120, 160, 90], river: [100, 150, 170], road: [150, 120, 80] },
};

/** The terrain as pixels, as the viewer sees it (own territory on the left). */
function terrainImage(g: CanvasRenderingContext2D, index: number, viewer: SideId): ImageData {
  const t = terrain(index);
  const PAL = PALETTES[index] ?? BASE_PAL;
  const img = g.createImageData(W, H);
  const put = (i: number, c: number[]) => { img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; };
  for (let y = 0; y < H; y++)
    for (let sx = 0; sx < W; sx++) {
      const x = viewer === 0 ? sx : W - 1 - sx;
      const i = y * W + x;
      const o = y * W + sx;
      const gr = t.ground[i];
      if (gr === 'sea') put(o, (y + Math.round(Math.sin(x / 6) * 1.5)) % 5 === 0 && hash(x, y, 9) > 0.4 ? PAL.seaLine : PAL.sea);
      else if (gr === 'sand') put(o, PAL.sand);
      else if (t.river[i]) put(o, PAL.river);
      else if (t.road[i]) put(o, (x + y) % 4 === 0 ? PAL.land : PAL.road);
      else {
        // Contour lines where the height steps up a band; hatching on the steep bits.
        const e = Math.floor(t.elev[i] * 7);
        const right = x + 1 < W ? Math.floor(t.elev[i + 1] * 7) : e;
        const down = y + 1 < H ? Math.floor(t.elev[i + W] * 7) : e;
        if (PAL.snow && t.elev[i] > 0.9) put(o, (e !== right || e !== down) ? PAL.contour : PAL.snow);
        else if ((e !== right || e !== down) && e >= 3) put(o, PAL.contour);
        else if (gr === 'forest') put(o, hash(x, y, 4) > 0.72 && (x + y * 3) % 3 === 0 ? PAL.tree : PAL.forest);
        else if (gr === 'marsh') put(o, (x * 2 + y) % 5 === 0 ? PAL.seaLine : PAL.marsh);
        else put(o, hash(x, y, 7) > 0.86 || t.elev[i] > 0.62 ? PAL.land2 : PAL.land);
      }
    }
  return img;
}

const imageCache = new Map<string, ImageData>();

/** Where things sit on a drawn map, in its own pixels: what the flight animation flies between. */
export interface MapGeo {
  w: number;
  h: number;
  home: [number, number];
  sites: Record<string, [number, number]>;
  /** Screen x of the middle of a sector. */
  sectorX: (sector: number) => number;
  /** Screen x of the front line at height y. */
  frontX: (y: number) => number;
  /** Where the operation's route ends. */
  raidTo: [number, number];
  /** +1 if the enemy lies to the right. */
  toward: number;
}
export const mapGeo = new WeakMap<HTMLCanvasElement, MapGeo>();

export function theaterMap(state: GameState, opts: MapOpts): HTMLCanvasElement {
  const t = state.theater;
  const def = THEATERS[t.index];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const scale = opts.scale ?? 2;
  c.style.width = '100%';
  c.style.maxWidth = `${W * scale}px`;
  c.className = 'pix theater-map';
  const g = c.getContext('2d')!;
  const v = opts.viewer;
  // Screen x for a side-0 x.
  const X = (x: number) => (v === 0 ? x : W - 1 - x);
  const key = `${t.index}:${v}`;
  let img = imageCache.get(key);
  if (!img) {
    img = terrainImage(g, t.index, v);
    imageCache.set(key, img);
  }
  g.putImageData(img, 0, 0);

  // Enemy-held ground is hatched.
  g.fillStyle = 'rgba(176,48,42,0.16)';
  for (let y = 0; y < H; y++)
    for (let x = (y % 6); x < W; x += 6) {
      const wx = v === 0 ? x : W - 1 - x;
      const owner = sectorAt(wx, y) < t.held0 ? 0 : 1;
      if (owner !== v) g.fillRect(x, y, 1, 1);
    }

  // Sector boundaries: dotted lines.
  g.fillStyle = 'rgba(42,38,32,0.45)';
  for (let b = 1; b < SECTORS; b++)
    for (let y = 0; y < H; y += 3) g.fillRect(X(boundaryX(b, y)), y, 1, 2);

  // How far our aircraft reach past the front.
  for (const r of opts.rangeLines ?? []) {
    const b = v === 0 ? t.held0 + r.depth : t.held0 - r.depth;
    if (b <= 0 || b >= SECTORS) continue;
    g.fillStyle = r.color;
    for (let y = 18; y < H - 14; y += 4) g.fillRect(X(boundaryX(b, y)) - 1, y, 2, 2);
    label(g, r.label, X(boundaryX(b, 24)), 26 + (r.depth % 2) * 11, r.color);
  }

  // Patrols: an orbit over the sector.
  for (const s of new Set(opts.patrols ?? [])) {
    const cx = X(s * CELL_W + CELL_W / 2);
    const cy = H * 0.3;
    g.fillStyle = '#2c4672';
    for (let a = 0; a < Math.PI * 2; a += 0.12) if (Math.floor(a / 0.12) % 2 === 0) g.fillRect(Math.round(cx + Math.cos(a) * 24), Math.round(cy + Math.sin(a) * 11), 2, 1);
    g.fillRect(cx - 3, cy, 7, 1);
    g.fillRect(cx, cy - 2, 1, 5);
  }

  // Sites.
  const placed = t.sites.map((site) => {
    const k = t.sites.filter((x) => x.sector === site.sector).indexOf(site);
    const [wx, y] = sitePos(t.index, site, k);
    return { site, x: X(wx), y };
  });
  // Our home airfield: where the routes start.
  const ownFields = placed.filter((p) => p.site.owner === v && p.site.type === 'airfield');
  const home = ownFields.sort((a, b) => depthFor(t.held0, v, a.site.sector) - depthFor(t.held0, v, b.site.sector))[0] ?? { x: X(v === 0 ? 30 : W - 30), y: H * 0.6 };

  const front = (y: number) => X(boundaryX(t.held0, y));
  const press = state.sides[v].perceived.front / SECTOR_PRESSURE;
  const shift = Math.round(Math.max(-0.9, Math.min(0.9, press)) * CELL_W * 0.3);
  const fx = (y: number) => front(y) + shift;

  // Routes: the feint, then the main operation.
  const dashed = (x0: number, y0: number, x1: number, y1: number, col: string, gap = 3) => {
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    g.fillStyle = col;
    for (let d = 0; d < len; d += 1) if (Math.floor(d / gap) % 2 === 0) g.fillRect(Math.round(x0 + ((x1 - x0) * d) / len), Math.round(y0 + ((y1 - y0) * d) / len), 2, 2);
    // Arrowhead.
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    for (let k = 1; k <= 5; k++) {
      g.fillRect(Math.round(x1 - ux * k * 1.4 - uy * k), Math.round(y1 - uy * k * 1.4 + ux * k), 2, 2);
      g.fillRect(Math.round(x1 - ux * k * 1.4 + uy * k), Math.round(y1 - uy * k * 1.4 - ux * k), 2, 2);
    }
  };
  if (opts.feint !== undefined) {
    const tx = X(opts.feint * CELL_W + CELL_W / 2);
    dashed(home.x, home.y, tx, H * 0.2, '#b0302a', 2);
    label(g, 'FEINT', tx, H * 0.2 - 8, '#b0302a');
  }
  {
    // The route out and back: drawn for an operation, and kept on the canvas for the radio room's plot.
    const target = opts.raid ? placed.find((p) => p.site.id === opts.raid!.siteId) : undefined;
    const [tx, ty] = target ? [target.x, target.y + 3] : [X(depthToX(t.held0, v)), H * 0.58];
    if (opts.raid) dashed(home.x, home.y, tx, ty, '#2a2620');
    c.dataset.route = JSON.stringify([home.x, home.y, tx, ty, W, H]);
    mapGeo.set(c, {
      w: W, h: H, home: [home.x, home.y], sites: Object.fromEntries(placed.map((p) => [p.site.id, [p.x, p.y]])),
      sectorX: (s) => X(s * CELL_W + CELL_W / 2), frontX: fx, raidTo: [tx, ty], toward: v === 0 ? 1 : -1,
    });
  }

  // Front line with its teeth pointing at the enemy, displaced by the reported pressure.
  const toward = v === 0 ? 1 : -1;
  for (let y = 0; y < H; y++) {
    g.fillStyle = '#b0302a';
    g.fillRect(fx(y) - 1, y, 3, 1);
    if (y % 10 < 4) g.fillRect(fx(y) + toward * (2 + (y % 10 < 2 ? y % 10 : 3 - (y % 10))), y, 2, 1);
  }
  // Pressure arrow at the top of the line.
  const dir = (press >= 0 ? 1 : -1) * (v === 0 ? 1 : 1);
  const ax = fx(12);
  g.fillStyle = '#b0302a';
  for (let i = 0; i < 6; i++) g.fillRect(ax + dir * (4 + i), 12 - (5 - i), 1, (5 - i) * 2 + 1);
  g.fillRect(dir > 0 ? ax : ax - 4, 11, 4, 3);

  for (const p of placed) {
    const faded = p.site.owner !== v && opts.inRange && !opts.inRange(p.site);
    g.globalAlpha = faded ? 0.4 : 1;
    const cond = believed(state, v, p.site);
    const col = cond > 66 ? '#2a2620' : cond > 33 ? '#8a5a1a' : '#b0302a';
    const x = p.x - 3;
    const y = p.y - 3;
    // A paper plate under the symbol, so it reads on any ground.
    g.fillStyle = p.site.id === opts.selected ? '#b0302a' : 'rgba(42,38,32,0.8)';
    g.fillRect(x - 2, y - 2, 11, 15);
    g.fillStyle = p.site.owner === v ? '#eee5cc' : '#f0d8c8';
    g.fillRect(x - 1, y - 1, 9, 13);
    ICON[p.site.type].forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch !== 'k') return;
      g.fillStyle = col;
      g.fillRect(x + rx, y + ry, 1, 1);
    }));
    for (let k = 0; k < 5; k++) {
      g.fillStyle = k < Math.round(cond / 20) ? col : 'rgba(42,38,32,0.2)';
      g.fillRect(x + k + 1 + (k > 0 ? k : 0) - 1, y + 9, 1, 2);
    }
    // Probably wrecked already: hatch the plate.
    if (p.site.owner !== v && cond <= 20) {
      g.fillStyle = 'rgba(176,48,42,0.6)';
      for (let j = 0; j < 9; j++) { g.fillRect(x - 1 + j, y - 1 + j, 1, 1); g.fillRect(x - 1 + j, y + 3 + j, 1, 1); }
    }
    // A standing order names this site: a red pennant.
    if (opts.ordered?.includes(p.site.id)) {
      g.fillStyle = '#16171a';
      g.fillRect(x + 8, y - 9, 1, 8);
      g.fillStyle = '#b0302a';
      for (let j = 0; j < 4; j++) g.fillRect(x + 9, y - 9 + j, 5 - j, 1);
      for (let j = 0; j < 3; j++) g.fillRect(x + 9, y - 5 + j, 2 + j, 1);
    }
    if (p.site.id === opts.selected) label(g, p.site.name, p.x, p.y + 20, '#b0302a');
  }
  g.globalAlpha = 1;

  // Sector names along the bottom, and the theater's name in a cartouche.
  for (let s = 0; s < SECTORS; s++) label(g, def.sectors[s], X(s * CELL_W + CELL_W / 2), H - 6, '#2a2620');
  g.font = '8px monospace';
  const title = def.name.toUpperCase();
  const tw = Math.ceil(g.measureText(title).width) + 8;
  g.fillStyle = '#16171a';
  g.fillRect(3, 3, tw + 2, 13);
  g.fillStyle = '#e9dfc4';
  g.fillRect(4, 4, tw, 11);
  g.fillStyle = '#2a2620';
  g.fillText(title, 8, 12);
  // North arrow.
  const nx = W - 12;
  g.fillStyle = '#2a2620';
  for (let i = 0; i < 6; i++) g.fillRect(nx - Math.floor(i / 2), 6 + i, Math.floor(i / 2) * 2 + 1, 1);
  g.fillRect(nx, 12, 1, 8);
  g.fillText('N', nx - 2, 28);

  // Hover names the site; clicking an enemy site picks it, if the screen allows that.
  const at = (e: MouseEvent) => {
    const r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    const my = ((e.clientY - r.top) / r.height) * H;
    return placed.find((p) => Math.abs(p.x + 1 - mx) <= 6 && Math.abs(p.y + 3 - my) <= 8) ?? null;
  };
  c.addEventListener('mousemove', (e) => {
    const p = at(e);
    if (!p) {
      setTip(c, null);
      c.style.cursor = '';
      return;
    }
    const ours = p.site.owner === v;
    const reach = ours || !opts.inRange || opts.inRange(p.site);
    setTip(c, {
      head: p.site.name,
      text: `${FACILITY_WORD[p.site.type]} in ${def.sectors[p.site.sector]} (${ours ? 'ours' : depthLabel(state, v, p.site).toLowerCase()}). Condition ${believed(state, v, p.site)}%.${ours ? '' : reach ? (opts.onSite ? ' Click to strike it.' : '') : ' Out of range of our bombers.'}`,
      source: ours ? 'our ground staff' : state.sides[v].perceived.photographed.includes(p.site.id) ? 'photographs' : 'crews\' bombing reports',
    });
    c.style.cursor = opts.onSite && !ours && reach ? 'pointer' : '';
  });
  if (opts.onSite) c.addEventListener('click', (e) => {
    const p = at(e);
    if (p && p.site.owner !== v) opts.onSite!(p.site);
  });
  return c;
}

/** Side-0 x of the middle of the enemy's frontline sector. */
function depthToX(held0: number, attacker: SideId): number {
  const s = attacker === 0 ? held0 : held0 - 1;
  return s * CELL_W + CELL_W / 2;
}

/** A word on a paper plate, centred on x. */
function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, col: string) {
  g.font = '8px monospace';
  const w = Math.ceil(g.measureText(text).width);
  const lx = Math.max(2, Math.min(W - w - 4, Math.round(x - w / 2)));
  g.fillStyle = 'rgba(233,223,196,0.85)';
  g.fillRect(lx - 2, Math.round(y) - 7, w + 4, 9);
  g.fillStyle = col;
  g.fillText(text, lx, Math.round(y));
}

/** Short label for how deep a site lies from the viewer's front. */
export function depthLabel(state: GameState, viewer: SideId, site: Site): string {
  const d = depthFor(state.theater.held0, viewer, site.sector);
  return d === 1 ? 'Frontline' : d === 2 ? 'Second line' : 'Rear area';
}

/**
 * The front as a tug of war: a needle between -SECTOR_PRESSURE (a sector lost)
 * and +SECTOR_PRESSURE (a sector taken). With `from`, the needle swings there first.
 */
export function pressureGauge(value: number, opts: { from?: number; band?: [number, number]; label?: string } = {}): HTMLElement {
  const P = SECTOR_PRESSURE;
  const at = (x: number) => `${50 + (Math.max(-P * 1.2, Math.min(P * 1.2, x)) / (P * 1.2)) * 50}%`;
  const needle = h('i', { class: 'gauge-needle', style: `left:${at(opts.from ?? value)}` });
  const g = h('div', { class: 'gauge', ...tipAttrs({ head: 'Pressure on the front', text: `The Army liaison's estimate of who is winning on the ground. A sector falls at about ±${P}, at most one a week. Losses inflicted, close support and damage to enemy works all push it our way.`, source: 'Army liaison (runs a little optimistic)' }) },
    h('div', { class: 'gauge-track' },
      h('span', { class: 'gauge-zone lose', style: `left:0;width:${at(-P)}` }),
      h('span', { class: 'gauge-zone win', style: `left:${at(P)};right:0` }),
      opts.band ? h('span', { class: 'gauge-band', style: `left:${at(opts.band[0])};width:calc(${at(opts.band[1])} - ${at(opts.band[0])})` }) : null,
      h('span', { class: 'gauge-mid' }),
      needle),
    h('div', { class: 'gauge-scale' }, h('span', null, `◂ sector lost (−${P})`), h('b', { class: value > 0 ? 'good' : value < 0 ? 'bad' : '' }, `${opts.label ?? 'Pressure'} ${value >= 0 ? '+' : ''}${value}`), h('span', null, `sector taken (+${P}) ▸`)));
  if (opts.from !== undefined && opts.from !== value) setTimeout(() => { needle.style.left = at(value); }, 350);
  return g;
}

export function mapLegend(): HTMLElement {
  return h('div', { class: 'map-legend' },
    h('span', null, '✈ Airfield'), h('span', null, '▙ Works'), h('span', null, '◘ Fuel'), h('span', { class: 'muted' }, '▨ Enemy-held'),
    h('span', { class: 'red' }, '|▸ Front (arrow: pressure)'), h('span', null, '╌▸ Our operation'), h('span', { class: 'blue' }, '◌ Our patrols'), h('span', { class: 'red' }, '╌ Feint'),
  );
}
