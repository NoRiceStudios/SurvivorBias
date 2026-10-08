/**
 * The morning paper. After High Command's letter, the nation's newspaper lands
 * on the desk with the week's returns as headlines: what the public was told,
 * what that did to its mood, and what the war bonds bought. Back issues can be
 * leafed through from the War Room's in-tray.
 */
import { moodLabel } from '../core/press';
import type { Newspaper, SideId, SideState } from '../core/types';
import type { App } from './app';
import { sfxClick, sfxPaper } from './audio';
import { animOn, h } from './dom';
import { nationAt } from './nation';
import { aircraftCanvas } from './sprites';
import { tip } from './tip';

/** The issue a commander would pick up now: the given week's, or the latest. */
export function issue(side: SideState, week?: number): Newspaper | null {
  const papers = side.press?.papers ?? [];
  return (week !== undefined ? papers.find((p) => p.week === week) : undefined) ?? papers[papers.length - 1] ?? null;
}

const MOODS = ['Sullen', 'Uneasy', 'Steady', 'Hopeful', 'Confident', 'Jubilant'];

/** The public's mood as a barometer: the needle where it stands, a ghost where it stood last week. */
export function moodGauge(mood: number, before?: number): HTMLElement {
  return h('div', { class: 'np-gauge', ...tip({ head: 'Public mood', text: 'What the public believes about the war in the air, from what the papers print. A cheerful public buys war bonds (more supplies) but expects more: High Command\'s directives grow with it. It drifts back towards the middle every week.' }) },
    h('div', { class: 'np-scale' }, h('span', null, MOODS[0]), h('span', null, 'Steady'), h('span', null, MOODS[MOODS.length - 1])),
    h('div', { class: 'np-track' },
      before !== undefined && before !== mood ? h('i', { class: 'np-needle ghost', style: `left:${before}%` }) : null,
      h('i', { class: 'np-needle', style: `left:${mood}%` })));
}

export function renderPaper(app: App, sideId: SideId, week: number | undefined, then: 'debrief' | 'hq'): HTMLElement {
  const side = app.state!.sides[sideId];
  const p = issue(side, week);
  const papers = side.press?.papers ?? [];
  const go = () => {
    sfxClick();
    if (then === 'debrief') app.afterDebrief(sideId);
    else app.go({ kind: 'hq', side: sideId, tab: 'war' });
  };
  if (!p) {
    // Nothing printed yet: straight on.
    return h('div', { class: 'letter-screen' }, h('div', { class: 'letter paper' }, h('p', null, 'The papers have not been delivered yet.'), h('button', { class: 'btn primary', onclick: go }, 'Back ▸')));
  }
  const at = papers.indexOf(p);
  const leaf = (k: number) => { sfxPaper(); app.go({ kind: 'paper', side: sideId, week: papers[k].week, then }); };
  const onKey = (e: KeyboardEvent) => {
    if (!sheet.isConnected) return window.removeEventListener('keydown', onKey);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.removeEventListener('keydown', onKey); go(); }
    else if (e.key === 'ArrowLeft' && at > 0) { window.removeEventListener('keydown', onKey); leaf(at - 1); }
    else if (e.key === 'ArrowRight' && at < papers.length - 1) { window.removeEventListener('keydown', onKey); leaf(at + 1); }
  };
  window.addEventListener('keydown', onKey);
  const delta = p.mood - p.moodBefore;
  const sheet = h('article', { class: `newspaper nation-${nationAt(sideId).id} ${app.entering && animOn() && then === 'debrief' ? 'spin' : ''}` },
    h('header', { class: 'np-mast' },
      h('div', { class: 'np-ear' }, h('b', null, `No. ${p.week}`), h('span', null, `Week ${p.week} of the war`)),
      h('h1', { class: 'np-name' }, p.name),
      h('div', { class: 'np-ear right' }, h('span', { class: 'stamp np-censor' }, 'PASSED BY CENSOR'), h('span', null, p.price)),
      h('div', { class: 'np-motto' }, p.motto)),
    h('h2', { class: 'np-headline' }, p.headline),
    h('p', { class: 'np-deck' }, p.deck),
    h('div', { class: 'np-body' },
      h('div', { class: 'np-main' },
        p.photo ? h('figure', { class: 'np-photo' },
          h('div', { class: 'np-halftone' }, aircraftCanvas(p.photo.kind, { side: sideId, hits: p.photo.hits }, p.photo.kind === 'heavy' ? 3 : 4)),
          h('figcaption', null, p.photo.caption)) : null,
        h('p', { class: 'np-lead' }, p.lead),
        p.lost > p.ministryLosses ? h('div', { class: 'np-pencil handwritten', ...tip({ head: 'Our own count', text: 'The adjutant\'s pencil: our losses as the wing knows them, not as the Ministry gives them to the press.' }) }, `We lost ${p.lost}, not ${p.ministryLosses === 0 ? 'none' : p.ministryLosses}.`) : null),
      h('div', { class: 'np-cols' }, p.columns.map((c) => h('section', { class: `np-col np-${c.kind}` }, h('h3', null, c.head), h('p', null, c.body)))),
      h('aside', { class: 'np-home' },
        h('h3', null, 'The nation\'s mood'),
        h('div', { class: 'np-mood' }, h('b', null, moodLabel(p.mood)), delta ? h('small', { class: delta > 0 ? 'up' : 'down' }, `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`) : null),
        moodGauge(p.mood, p.moodBefore),
        h('div', { class: 'np-fact', ...tip({ head: 'War bonds', text: 'Supplies bought for the wing with this week\'s war bonds, included in the week\'s deliveries. A gloomy public buys fewer than were promised.' }) },
          h('span', null, 'War bonds for the wing'), h('b', { class: p.bonds > 0 ? 'good' : p.bonds < 0 ? 'bad' : '' }, `${p.bonds > 0 ? '+' : p.bonds < 0 ? '−' : '±'}${Math.abs(p.bonds)} supplies`)),
        h('div', { class: 'np-fact', ...tip({ head: 'What the public expects', text: 'While the public expects victories, High Command asks for bigger ones: its new directives are larger, and a failed one costs more confidence.' }) },
          h('span', null, 'The public expects'), h('b', { class: p.expect > 1.05 ? 'bad' : '' }, p.expect > 1.05 ? `directives +${Math.round((p.expect - 1) * 100)}%` : 'nothing special')),
        h('p', { class: 'small np-small' }, 'Printed from the returns you sent to High Command.'))),
    h('footer', { class: 'np-foot' },
      h('div', { class: 'np-issues' },
        h('button', { class: 'quiet-link', disabled: at <= 0, onclick: () => leaf(at - 1) }, '◂ earlier issue'),
        h('span', { class: 'small muted' }, `${at + 1} of ${papers.length}`),
        h('button', { class: 'quiet-link', disabled: at >= papers.length - 1, onclick: () => leaf(at + 1) }, 'later issue ▸')),
      h('button', { class: 'btn primary launch', onclick: go }, then === 'debrief' ? (app.state!.outcome ? 'The war is over ▸' : 'Fold the paper ▸') : 'Back to the War Room ▸')));
  return h('div', { class: 'paper-screen' }, sheet);
}

/** The latest front page in small, for the in-tray, with the way to open it. */
export function paperMini(app: App, side: SideState): HTMLElement {
  const p = issue(side);
  if (!p) return h('p', { class: 'small muted' }, 'The first edition comes out after the first week\'s fighting.');
  const open = (e: MouseEvent) => { e.stopPropagation(); sfxPaper(); app.go({ kind: 'paper', side: side.id, week: p.week, then: 'hq' }); };
  return h('div', { class: `np-mini nation-${nationAt(side.id).id}`, onclick: open },
    h('div', { class: 'np-mini-name' }, h('span', null, p.name, h('small', null, ` · No. ${p.week}`)), h('button', { class: 'btn small', onclick: open }, 'Read ▸')),
    h('div', { class: 'np-mini-head' }, p.headline),
    h('div', { class: 'np-mini-row' },
      h('span', null, 'Public mood: ', h('b', null, moodLabel(p.mood))),
      h('span', null, 'War bonds: ', h('b', null, `${p.bonds >= 0 ? '+' : '−'}${Math.abs(p.bonds)}`)),
      p.expect > 1.05 ? h('span', { class: 'bad' }, `Directives +${Math.round((p.expect - 1) * 100)}%`) : null));
}
