/**
 * What a development project does to the look of the aircraft. Each mod is a few pixels
 * painted over the sprite (`over`: only where the airframe already is) or added beyond its
 * outline (`extra`: gun barrels, lenses), so the wing sees the research on the apron.
 */
import type { AircraftKind } from '../core/types';
import type { SpriteDef } from './sprites';

export interface Brush {
  def: SpriteDef;
  cx: number;
  /** Paint a pixel (and its mirror image) on the airframe. */
  over(x: number, y: number, c: string): void;
  /** Add a pixel (and its mirror image) next to the airframe. */
  extra(x: number, y: number, c: string): void;
  /** Paint one pixel without the mirror image. */
  overOne(x: number, y: number, c: string): void;
  zone(z: string): number[];
}

interface Mod {
  kinds: AircraftKind[];
  /** One line for the tooltip and the hangar notes. */
  look: string;
  draw(b: Brush, kind: AircraftKind): void;
}

const ALL: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
const BOMBERS: AircraftKind[] = ['medium', 'heavy'];
const DARK = '#23262a';
const STEEL = '#8d9398';
const YELLOW = '#d8b040';
const ALUM = '#c3c9cc';
const GLASS = '#5f8ea0';
const GLASS_HI = '#b4d6e0';

const xy = (def: SpriteDef, i: number): [number, number] => [i % def.w, Math.floor(i / def.w)];

export const LIVERY: Record<string, Mod> = {
  cannon: {
    kinds: ['fighter'],
    look: 'Cannon barrels stick out ahead of the wings.',
    draw: (b) => {
      const x0 = b.cx - 7;
      for (const x of [x0, x0 + 2]) {
        b.extra(x, 9, DARK);
        b.extra(x, 8, DARK);
        b.extra(x, 7, STEEL);
      }
    },
  },
  dropTanks: {
    kinds: ['fighter'],
    look: 'Long slung tanks under the wings.',
    draw: (b) => {
      for (let y = 13; y <= 18; y++) {
        b.over(b.cx - 11, y, y === 13 || y === 18 ? STEEL : ALUM);
        b.over(b.cx - 10, y, y === 13 || y === 18 ? STEEL : '#9aa2a6');
      }
    },
  },
  uprated: {
    kinds: ALL,
    look: 'Yellow bands on the cowlings: uprated engines.',
    draw: (b) => {
      const { def } = b;
      for (let i = 0; i < def.mat.length; i++) {
        if (def.mat[i] === 3 && def.mat[i - def.w] !== 3) {
          const [x, y] = xy(def, i);
          b.overOne(x, y, YELLOW);
        }
      }
    },
  },
  armorAlloy: {
    kinds: ALL,
    look: 'Bare face-hardened steel shows on the cowlings.',
    draw: (b) => {
      for (const i of b.zone('engines')) {
        const [x, y] = xy(b.def, i);
        if (b.def.mat[i] === 1) b.overOne(x, y, (x + y) % 3 === 0 ? '#8b9396' : '#a9b0b3');
      }
    },
  },
  lightPlate: {
    kinds: ALL,
    look: 'Rows of bright rivets where the alloy plate is bolted on.',
    draw: (b) => {
      for (const i of b.zone('wingRoot')) {
        const [x, y] = xy(b.def, i);
        if (b.def.mat[i] === 1 && (x + 2 * y) % 5 === 0) b.overOne(x, y, '#cfd5d8');
      }
    },
  },
  radios: {
    kinds: ALL,
    look: 'An aerial wire runs from the cockpit to the fin.',
    draw: (b) => {
      const cock = b.zone('cockpit');
      const tail = b.zone('tail');
      if (!cock.length || !tail.length) return;
      const y0 = Math.min(...cock.map((i) => Math.floor(i / b.def.w)));
      const y1 = Math.max(...tail.map((i) => Math.floor(i / b.def.w)));
      for (let y = y0; y <= y1; y += 2) b.overOne(b.cx - 1, y, '#1c1e20');
    },
  },
  powerTurrets: {
    kinds: BOMBERS,
    look: 'Glazed power turrets on the back.',
    draw: (b, k) => {
      const y = k === 'medium' ? 19 : 38;
      for (const [dx, dy, c] of [[-1, 0, GLASS_HI], [0, 0, GLASS], [-1, 1, GLASS], [0, 1, '#3c5c6a']] as [number, number, string][]) b.overOne(b.cx + dx, y + dy, c);
    },
  },
  twinTail: {
    kinds: BOMBERS,
    look: 'A tail turret with two guns.',
    draw: (b, k) => {
      const y = k === 'medium' ? 43 : 54;
      b.over(b.cx - 1, y, GLASS_HI);
      b.over(b.cx - 1, y + 1, GLASS);
      const end = k === 'medium' ? 48 : 58;
      b.extra(b.cx - 1, end, DARK);
      b.extra(b.cx - 1, end + 1, STEEL);
    },
  },
  heavyMk2: {
    kinds: ['heavy'],
    look: 'Yellow bands on the wing tips mark the Mk II.',
    draw: (b) => {
      for (const i of b.zone('outerWing')) {
        const [x, y] = xy(b.def, i);
        if (x <= 6 && b.def.mat[i] === 1) b.overOne(x, y, YELLOW);
        else if (x >= b.def.w - 7 && b.def.mat[i] === 1) b.overOne(x, y, YELLOW);
      }
    },
  },
  targetMarkers: {
    kinds: BOMBERS,
    look: 'Yellow bands on the tail: marker carriers.',
    draw: (b) => {
      for (const i of b.zone('tail')) {
        const [x, y] = xy(b.def, i);
        if (b.def.mat[i] === 1 && y % 5 < 2) b.overOne(x, y, YELLOW);
      }
    },
  },
  longLens: {
    kinds: ['recon'],
    look: 'Long camera barrels poke out beside the fuselage.',
    draw: (b) => {
      b.extra(b.cx - 4, 22, DARK);
      b.extra(b.cx - 4, 21, DARK);
      b.extra(b.cx - 4, 20, GLASS_HI);
    },
  },
  airSeaRescue: {
    kinds: BOMBERS,
    look: 'An orange dinghy pack on each wing root.',
    draw: (b, k) => {
      const y = k === 'medium' ? 22 : 24;
      for (const dx of [-6, -5]) for (const dy of [0, 1]) b.over(b.cx + dx, y + dy, '#e0702a');
    },
  },
};

/** Whether a development changes how an aircraft type looks. */
export function visibleOn(techId: string, kind: AircraftKind): boolean {
  return !!LIVERY[techId]?.kinds.includes(kind);
}

export interface Livery {
  /** index -> colour of pixels painted over the airframe */
  over: Map<number, string>;
  /** index -> colour of pixels beyond the outline */
  extra: Map<number, string>;
}

/** The pixels a set of developments paints onto an aircraft type. `preview` adds one more. */
export function liveryFor(kind: AircraftKind, def: SpriteDef, research: readonly string[] | undefined, preview?: string): Livery | null {
  const ids = [...(research ?? []), ...(preview ? [preview] : [])].filter((id) => visibleOn(id, kind));
  if (!ids.length) return null;
  const over = new Map<number, string>();
  const extra = new Map<number, string>();
  const { w, h } = def;
  const put = (m: Map<number, string>, x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < w && y < h) m.set(y * w + x, c);
  };
  const brush: Brush = {
    def,
    cx: w / 2,
    over: (x, y, c) => (put(over, x, y, c), put(over, w - 1 - x, y, c)),
    extra: (x, y, c) => (put(extra, x, y, c), put(extra, w - 1 - x, y, c)),
    overOne: (x, y, c) => put(over, x, y, c),
    zone: (z) => def.zonePixels[z as keyof typeof def.zonePixels] ?? [],
  };
  for (const id of ids) LIVERY[id].draw(brush, kind);
  // Paint only where the airframe is; never over the glass or the propeller disc.
  for (const i of [...over.keys()]) if (!def.mat[i] || def.mat[i] === 4) over.delete(i);
  for (const i of [...extra.keys()]) if (def.mat[i]) extra.delete(i);
  return { over, extra };
}
