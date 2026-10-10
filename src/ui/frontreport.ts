/**
 * The front report: the Army liaison's pressure figure with its worst case,
 * the trend, what falls with the sector and what moved the line last week.
 * Self-contained so it can sit wherever the War Room puts it.
 */
import { frontOutlook } from '../core/frontline';
import type { SideState, Site } from '../core/types';
import type { App } from './app';
import { h } from './dom';
import { pressureGauge } from './theaterui';
import { tip } from './tip';

const SITE_ICON: Record<Site['type'], string> = { airfield: '✈', industry: '▙', fuel: '◘' };

export function frontReport(app: App, side: SideState, actions: { hold?: () => void; push?: () => void } = {}): HTMLElement {
  const st = app.state!;
  const o = frontOutlook(st, side);
  const d = st.lastDebriefs[side.id];
  const drivers = (d?.pressure ?? []).filter((p) => p.sign !== 0 && p.label !== 'Overall this week');
  const sites = (list: Site[]) => list.map((s) => `${SITE_ICON[s.type]} ${s.name.replace(/^\S+( Sands)?\s/, '')}`).join(' · ');
  const alarm = { steady: 'STEADY', strained: 'UNDER STRAIN', critical: 'CRITICAL' }[o.level];
  const trend = o.trend === null ? null
    : h('span', { class: o.trend > 0 ? 'good' : o.trend < 0 ? 'bad' : 'muted' }, o.trend === 0 ? 'unchanged this week' : `${o.trend > 0 ? '▲' : '▼'} ${Math.abs(o.trend)} this week`);
  return h('div', { class: `front-report ${o.level}${o.chance && o.level === 'steady' ? ' chance' : ''}` },
    h('div', { class: 'fr-head' },
      h('span', { class: `stamp ${o.level === 'steady' ? (o.chance ? 'notice' : 'order') : 'reprimand'}`, ...tip({ head: 'Front alarm', text: 'Judged on the worst case: the liaison runs optimistic, so the line may stand up to six points lower than he says. Critical means a bad week could take the sector; Under strain means two bad weeks could.' }) }, o.chance && o.level === 'steady' ? 'CHANCE' : alarm),
      h('b', { class: 'fr-headline' }, o.headline), trend),
    pressureGauge(o.value, { band: o.range }),
    h('div', { class: 'fr-detail small' },
      o.level !== 'steady' && o.atStake?.sites.length ? h('div', null, h('b', null, 'Falls with it: '), sites(o.atStake.sites)) : null,
      o.level === 'steady' && o.chance && o.prize?.sites.length ? h('div', null, h('b', null, 'Ours if it breaks: '), sites(o.prize.sites)) : null,
      drivers.length ? h('div', { class: 'fr-drivers' }, h('b', null, 'Last week: '), drivers.map((p) => h('span', { class: `chip ${p.sign > 0 ? 'good' : 'bad'}` }, `${p.sign > 0 ? '▲' : '▼'} ${p.label.replace(/ \(.*\)$/, '')}`))) : null),
    (o.level !== 'steady' && actions.hold) || (o.chance && o.level === 'steady' && actions.push)
      ? h('div', { class: 'fr-actions' },
        o.level !== 'steady' && actions.hold ? h('button', { class: 'btn small', onclick: actions.hold, ...tip({ head: 'Hold the line', text: 'Send the bombers to close support in the Hold stance: they soak up the pressure the enemy gains this week, up to about nine points.' }) }, 'Hold the line ▸') : null,
        o.chance && o.level === 'steady' && actions.push ? h('button', { class: 'btn small', onclick: actions.push, ...tip({ head: 'Press the attack', text: 'Send the bombers to close support in the Push stance, to break the wavering line.' }) }, 'Press the attack ▸') : null)
      : null,
  );
}
