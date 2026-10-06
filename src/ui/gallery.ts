// Art QA page: every sprite in every style, side by side.
import { Rng } from '../core/rng';
import { pickZone } from '../core/sim';
import type { AircraftKind, Hit, SideId } from '../core/types';
import { aircraftCanvas } from './sprites';
import { leaderPortrait, portraitCanvas } from './general';
import { schoolScene, worksScene } from './buildings';
import { startCampaign } from '../core/game';
import type { QcPolicy, TrainingFocus } from '../core/types';

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

// Dispatch portraits: every speaker for both sides.
const faces = document.createElement('div');
faces.className = 'gallery-row';
for (const sp of ['general', 'adjutant', 'ministry'] as const)
  for (const side of [0, 1] as SideId[]) {
    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    cell.append(portraitCanvas(sp, side, 4));
    faces.append(cell);
  }
app.prepend(faces);

// Building scenes: every school and works level (gallery.html#school / #works shows only those).
const only = location.hash.slice(1);
if (only === 'school' || only === 'works' || only === 'leaders') {
  while (app.firstChild) app.removeChild(app.firstChild);
}
const state = startCampaign({ mode: 'single', seed: 'gallery' });
const sceneRow = (el: HTMLElement) => {
  const r = document.createElement('div');
  r.className = 'gallery-row';
  r.style.width = '1086px';
  r.style.marginBottom = '10px';
  el.style.width = '100%';
  r.append(el);
  app.append(r);
};
if (only !== 'works' && only !== 'leaders') {
  const focus: TrainingFocus[] = ['balanced', 'gunnery', 'reporting', 'evasion', 'balanced'];
  for (let lv = 1; lv <= 5; lv++) {
    const side = structuredClone(state.sides[lv === 5 ? 1 : 0]);
    side.training = { level: lv, focus: focus[lv - 1], inTraining: lv * 3 - 1 };
    sceneRow(schoolScene(side));
  }
}
if (only !== 'school' && only !== 'leaders') {
  const qc: QcPolicy[] = ['standard', 'rushed', 'strict', 'standard', 'rushed'];
  const cond = [100, 85, 60, 35, 100];
  for (let lv = 1; lv <= 5; lv++) {
    const side = structuredClone(state.sides[lv === 4 ? 1 : 0]);
    side.factory = { level: lv, qc: qc[lv - 1], queue: (['medium', 'fighter', 'heavy', 'medium', 'fighter', 'recon', 'medium'] as const).slice(0, lv + 1) as never, progress: 2 };
    side.facilities.industry = cond[lv - 1];
    side.flak = lv * 0.3;
    sceneRow(worksScene(side));
  }
}

// Squadron leaders: faces come from names; rank and reputation add marks (gallery.html#leaders).
if (!only || only === 'leaders') {
  const traits = [undefined, 'ace', 'lucky', 'steady', 'sharpEyed', 'shaken'] as const;
  for (const side of [0, 1] as SideId[]) {
    const r = document.createElement('div');
    r.className = 'gallery-row';
    r.style.gap = '8px';
    const ranks = side === 0 ? ['Flt Lt', 'Sqn Ldr', 'Wg Cdr'] : ['Hauptmann', 'Major', 'Oberst'];
    const firsts = side === 0 ? ['Hugh', 'Percy', 'Clive', 'Arthur', 'Neville', 'Rupert', 'Giles', 'Edmund', 'Basil', 'Roland', 'Denis', 'Miles'] : ['Kurt', 'Ernst', 'Otto', 'Walter', 'Dieter', 'Hans', 'Lothar', 'Egon', 'Fritz', 'Gerd', 'Rolf', 'Anton'];
    const lasts = side === 0 ? ['Mabey', 'Thorne', 'Dunmore', 'Ashworth', 'Penrose', 'Hale', 'Brackley', 'Carrow', 'Fenwick', 'Lisle', 'Wexford', 'Ridley'] : ['Kessler', 'Brandt', 'Voigt', 'Ahlers', 'Reinke', 'Strahl', 'Lindqvist', 'Haber', 'Ostrow', 'Falkner', 'Merz', 'Rauch'];
    for (let i = 0; i < 12; i++) {
      const leader = { name: `${firsts[i]} ${lasts[i]}`, rank: ranks[i % 3], archetype: 'byTheBook' as const, trait: traits[i % traits.length] };
      const cell = document.createElement('div');
      cell.className = 'leader-cell';
      const caption = document.createElement('div');
      caption.textContent = `${leader.rank} ${lasts[i]}${leader.trait ? ` · ${leader.trait}` : ''}`;
      cell.append(leaderPortrait(leader, side, 4), caption);
      r.append(cell);
    }
    app.append(r);
  }
}
