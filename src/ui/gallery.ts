// Art QA page: every sprite in every style, side by side.
import { Rng } from '../core/rng';
import { pickZone } from '../core/sim';
import type { AircraftKind, Hit, SideId } from '../core/types';
import { aircraftCanvas } from './sprites';

function fakeHits(n: number, seed: number, approach: Hit['approach'] = 'tail'): Hit[] {
  const rng = Rng.fromSeed(seed);
  const out: Hit[] = [];
  for (let i = 0; i < n; i++) {
    const a = i % 3 === 0 ? 'flak' : approach;
    out.push({ zone: pickZone(rng, a), u: rng.next(), v: rng.next(), approach: a });
  }
  return out;
}

const app = document.getElementById('app')!;
const kinds: AircraftKind[] = ['fighter', 'medium', 'heavy', 'recon'];
for (const side of [0, 1] as SideId[]) {
  const row = document.createElement('div');
  row.className = 'gallery-row';
  for (const k of kinds) {
    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    cell.append(aircraftCanvas(k, { side, seed: 3 }, 4));
    cell.append(aircraftCanvas(k, { side, seed: 5, hits: fakeHits(9, k.length + side), patches: 6 }, 4));
    row.append(cell);
  }
  app.append(row);
}
const row = document.createElement('div');
row.className = 'gallery-row';
for (const k of kinds) {
  const cell = document.createElement('div');
  cell.className = 'gallery-cell paper';
  cell.append(aircraftCanvas(k, { side: 0, style: 'blueprint', hits: fakeHits(160, 9), dots: true }, 4));
  row.append(cell);
}
app.append(row);
