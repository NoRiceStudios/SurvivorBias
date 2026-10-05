/**
 * Deterministic, serializable PRNG (mulberry32). All game randomness flows
 * through an Rng so battles can be replayed and verified across machines.
 */
export interface RngState {
  s: number;
}

export class Rng {
  constructor(public state: RngState) {}

  static fromSeed(seed: number | string): Rng {
    return new Rng({ s: hashSeed(seed) });
  }

  /** Derive an independent child stream (e.g. one per battle). */
  fork(label: string | number): Rng {
    return new Rng({ s: hashSeed(`${this.state.s}:${label}`) });
  }

  next(): number {
    let t = (this.state.s = (this.state.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Pick a key from a weight table. */
  weighted<K extends string>(weights: Partial<Record<K, number>>): K {
    const entries = Object.entries(weights) as [K, number][];
    const total = entries.reduce((a, [, w]) => a + Math.max(0, w), 0);
    let r = this.next() * total;
    for (const [k, w] of entries) {
      r -= Math.max(0, w);
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  /** Approximately normal noise (Irwin-Hall), mean 0, given std dev. */
  gauss(sd = 1): number {
    let s = 0;
    for (let i = 0; i < 6; i++) s += this.next();
    return (s - 3) * sd * Math.SQRT2;
  }

  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + this.gauss(Math.sqrt(lambda))));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

export function hashSeed(seed: number | string): number {
  const str = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
