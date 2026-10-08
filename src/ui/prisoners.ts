/**
 * Prisoners of war: the interrogation reports at the debrief (one form per
 * man, with the interrogator's pencil in the margin), the running file under
 * Intelligence, and what they really knew once the archives open.
 */
import { TEMPER_LABEL, TEMPER_NOTE } from '../core/interrogation';
import { theaterDef } from '../core/theaters';
import type { Debrief, Interrogation, SideId, SideState, Statement } from '../core/types';
import type { App } from './app';
import { sfxPaper } from './audio';
import { h, plural } from './dom';
import { leaderPortrait } from './general';
import { nationAt } from './nation';
import { tip } from './tip';
import { patrolSector, sqLabel } from './warroom';

/** This week's prisoners, for the debrief. */
export function weekPrisoners(side: SideState, week: number): Interrogation[] {
  return (side.prisoners ?? []).filter((p) => p.week === week);
}

/** The interrogation form on top of the pile, per week and side. */
const top = new Map<string, string>();

const face = (p: Interrogation, scale = 2) => leaderPortrait({ name: p.name, rank: p.rank, archetype: p.archetype }, p.side, scale);

function patrolButton(app: App, side: SideState, s: Statement): HTMLElement | null {
  if (s.sector === undefined) return null;
  const name = theaterDef(app.state!).sectors[s.sector];
  const plan = app.plans[side.id];
  const covered = Object.values(plan.cover).includes(s.sector);
  return covered ? h('span', { class: 'small good' }, `✓ ${name} patrolled`) : h('button', { class: 'btn small', onclick: (e: MouseEvent) => { e.stopPropagation(); patrolSector(app, side, s.sector!); } }, `Patrol ${name} ▸`);
}

function form(app: App, side: SideState, p: Interrogation, truth = false): HTMLElement {
  const enemy = nationAt(p.side);
  return h('article', { class: 'paper report pow' },
    h('div', { class: 'form-head' }, h('span', null, 'INTERROGATION REPORT — A.I.1(K)'), h('span', { class: 'stamp reprimand' }, p.leader ? 'P.O.W. · SQUADRON LEADER' : 'PRISONER OF WAR')),
    h('div', { class: 'form-grid' },
      h('span', null, 'Name'), h('b', null, p.name),
      h('span', null, 'Rank'), h('b', null, p.rank || '—'),
      h('span', null, 'Unit'), h('b', null, `${p.unit}${p.leader ? ' (commanding)' : ''}`),
      h('span', null, 'Aircraft'), h('b', null, `${enemy.aircraft[p.kind]} ${p.serial}`),
      h('span', null, 'Taken'), h('b', null, `week ${p.week}, over our lines`)),
    h('div', { class: 'qa-list' }, p.statements.map((s) => h('div', { class: 'qa' },
      h('div', { class: 'qa-q' }, h('span', null, 'Q.'), s.q),
      h('div', { class: 'qa-a typed' }, h('span', null, 'A.'), s.a),
      s.note || s.sector !== undefined ? h('div', { class: 'qa-note' }, s.note ? h('span', { class: 'handwritten' }, s.note) : null, truth ? null : patrolButton(app, side, s)) : null,
      truth && s.truth ? h('div', { class: 'qa-truth' }, h('span', { class: 'stamp notice' }, 'IN TRUTH'), ' ', s.truth) : null))),
    h('div', { class: 'remarks' }, h('span', null, 'Remarks:'), h('div', { class: 'handwritten' }, p.remark)),
    h('div', { class: 'report-corner' }, face(p, 1), h('span', { class: 'trait', ...tip({ head: 'The interrogator\'s read', text: `${TEMPER_NOTE[p.seemed]} Interrogators are not always right.${truth ? ` In truth: ${TEMPER_LABEL[p.temper].toLowerCase()}.` : ''}` }) }, TEMPER_LABEL[p.seemed])),
    h('div', { class: 'margin-note handwritten' }, `Int.: ${TEMPER_NOTE[p.seemed]}`));
}

/** The debrief sheet: who was brought in, their forms, and what it adds up to. */
export function prisonersSheet(app: App, d: Debrief): HTMLElement {
  const st = app.state!;
  const side = st.sides[d.side];
  const men = weekPrisoners(side, d.turn);
  const key = `${st.seed}:${d.side}:${d.turn}`;
  const sel = men.find((p) => p.id === top.get(key)) ?? men[0];
  const pick = (id: string) => { top.set(key, id); sfxPaper(); app.render(); };
  const said = men.flatMap((p) => p.statements.map((s) => ({ p, s })));
  const strength = said.filter((x) => x.s.figure !== undefined);
  const targets = said.filter((x) => x.s.topic === 'target' && x.s.sector !== undefined);
  return h('div', { class: 'reports-sheet' },
    h('div', { class: 'col' },
      h('div', { class: 'sheet-sub' }, h('b', null, 'Interrogation · '), `${plural(men.length, 'enemy airman', 'enemy airmen')} taken prisoner over our lines this week. `, h('span', { class: 'muted' }, 'Prisoners talk through their pride, their shock or their orders.')),
      h('div', { class: 'forms' },
        h('table', { class: 'ledger compare' },
          h('thead', null, h('tr', null, ['', 'Prisoner', 'Unit', 'Aircraft', 'Interrogator\'s read'].map((x) => h('th', null, x)))),
          h('tbody', null, men.map((p) => h('tr', { class: p === sel ? 'on' : '', onclick: () => pick(p.id) },
            h('td', { class: 'pow-face' }, face(p, 1)),
            h('td', null, `${p.rank} ${p.name}`),
            h('td', null, sqLabel(p.unit)),
            h('td', null, nationAt(p.side).aircraft[p.kind]),
            h('td', null, h('span', { class: 'trait' }, TEMPER_LABEL[p.seemed])))))),
        h('div', { class: 'stack' },
          h('div', { class: 'stack-edges' }, men.filter((p) => p !== sel).map((p, i) => h('button', { class: 'stack-edge', style: `transform: rotate(${i % 2 ? 0.4 : -0.4}deg)`, onclick: () => pick(p.id) }, `${p.rank} ${p.name}`))),
          form(app, side, sel)))),
    h('div', { class: 'col' },
      h('section', { class: 'paper panel' },
        h('h2', null, 'What the prisoners say'),
        strength.length ? h('div', { class: 'kv' },
          ...strength.flatMap(({ p, s }) => [h('span', null, `Enemy fighters, says ${p.rank} ${p.name.split(' ').slice(-1)[0]}`), h('b', null, String(s.figure))]),
          h('span', { class: 'muted' }, 'Our own estimate'), h('b', { class: 'muted' }, `≈${side.perceived.enemyFighters}`)) : null,
        targets.length ? h('div', { class: 'pow-targets' }, targets.map(({ p, s }) => h('div', { class: 'pow-target' },
          h('span', null, h('b', null, `${p.name.split(' ').slice(-1)[0]}: `), s.a), patrolButton(app, side, s)))) : null,
        !strength.length && !targets.length ? h('p', { class: 'muted' }, 'Nothing of use this week. The interrogators will keep trying.') : null,
        h('p', { class: 'small muted' }, 'Kept on file under Intelligence. What they really knew is only known after the war.')),
      side.perceived.warning ? h('section', { class: 'paper panel' }, h('h2', null, 'For comparison: the Y-Service'), h('p', null, side.perceived.warning.text)) : null,
    ),
  );
}

/** The Intelligence tab's file: every statement taken, latest first. */
export function prisonerFile(app: App, side: SideState): HTMLElement | null {
  const men = [...(side.prisoners ?? [])].reverse().slice(0, 12);
  if (!men.length) return null;
  return h('section', { class: 'paper panel pow-file' },
    h('h2', null, 'Prisoners of war: statements on file'),
    men.map((p) => h('details', { class: 'slip' },
      h('summary', null, h('span', { class: 'pow-face' }, face(p, 1)), h('b', null, ` ${p.rank} ${p.name}`), h('span', { class: 'small muted' }, ` · ${p.unit} · wk ${p.week} · ${TEMPER_LABEL[p.seemed].toLowerCase()}`)),
      p.statements.map((s) => h('div', { class: 'qa small' }, h('div', { class: 'qa-q' }, s.q), h('div', { class: 'qa-a typed' }, s.a)))),
    ),
    h('p', { class: 'small muted' }, 'As the prisoners gave it. Unverified.'));
}

/** After the war: what each prisoner said, and what was really so. */
export function prisonerArchive(app: App, sideId: SideId): HTMLElement | null {
  const side = app.state!.sides[sideId];
  const men = side.prisoners ?? [];
  if (!men.length) return null;
  const lies = men.filter((p) => p.temper === 'false' || p.temper === 'proud').length;
  const misread = men.filter((p) => p.seemed !== p.temper).length;
  return h('section', { class: 'paper panel declass' },
    h('h2', null, 'What the prisoners said, and what was so'),
    h('p', null, `${plural(men.length, 'prisoner')} questioned. ${lies ? `${lies} of them lied or boasted. ` : ''}The interrogators misread ${misread === 0 ? 'none of them' : misread === 1 ? 'one' : misread}.`),
    h('div', { class: 'pow-archive' }, men.map((p) => form(app, side, p, true))));
}
