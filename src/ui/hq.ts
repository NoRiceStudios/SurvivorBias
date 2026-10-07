/**
 * The HQ: top bar, four tabs (War Room, Squadrons, Works, Intelligence) and the
 * readiness bar. Old tab names (briefing, operations, hangar, …) still work and
 * lead to the tab that now holds them.
 */
import { REPAIR_COST } from '../core/actions';
import { APPROACH_LABEL } from '../core/data';
import { CRIPPLED, facilityEffects } from '../core/effects';
import { countedSites, facilityCondition, SECTOR_PRESSURE, SECTORS, THEATERS, WEATHER_LABEL } from '../core/theaters';
import { STORES_CAP } from '../core/turn';
import type { FighterApproach, Memo, SideId, SideState } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h, pct } from './dom';
import { icon } from './icons';
import { readinessBar } from './readiness';
import { squadronsScreen } from './squadronsui';
import { believed } from './theaterui';
import { tip } from './tip';
import { dedupeMemos, warRoom } from './warroom';
import { panel } from './widgets';
import { worksScreen } from './works';

export { missionLabel } from './widgets';

const TABS: [string, string, string][] = [
  ['war', 'War Room', 'Map, orders for the week, requests and mail'],
  ['squadrons', 'Squadrons', 'Leaders, doctrine, armor and aircraft'],
  ['works', 'Works', 'Factory, training school and development'],
  ['intel', 'Intelligence', 'What we believe about the enemy, and the files'],
];

/** Old tab names lead to the tab that now holds them. */
export const TAB_ALIAS: Record<string, string> = { briefing: 'war', operations: 'war', hangar: 'squadrons', factory: 'works', training: 'works', research: 'works' };

/** Resource values last shown, per side, so a change can flash with its delta. */
const lastShown = new Map<string, number>();

export function topBar(app: App, side: SideState, debriefWeek?: number, what = 'debrief'): HTMLElement {
  const st = app.state!;
  const r = side.resources;
  const front = side.perceived.front;
  const held = side.id === 0 ? st.theater.held0 : SECTORS - st.theater.held0;
  const res = (name: string, v: number, shown: string, label: string, title: string, effect?: string, cls = '') => {
    const key = `${st.seed}:${side.id}:${name}`;
    const before = lastShown.get(key);
    lastShown.set(key, v);
    const delta = before === undefined ? 0 : v - before;
    return h('div', { class: `res ${cls} ${delta ? 'changed' : ''}`, ...tip({ head: label, text: title, effect }) }, icon(name, 18),
      h('div', { class: 'res-v' }, h('b', null, shown), h('small', null, label)),
      delta ? h('span', { class: `res-delta ${delta > 0 ? 'up' : 'down'}` }, `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`) : null);
  };
  const lan = app.lan;
  const lanChip = lan
    ? h('div', { class: `lan-chip ${lan.connected ? 'on' : 'off'}`, ...tip(lan.status || 'LAN game') },
      lan.role === 'host'
        ? `LAN host ${lan.addresses[0] ?? ''}:${lan.port} · ${lan.connected ? (lan.opponentSealed ? 'opponent sealed' : 'opponent planning') : 'waiting for opponent'}`
        : `LAN · ${lan.connected ? (lan.opponentSealed ? 'host sealed' : 'host planning') : 'disconnected'}`)
    : null;
  return h('header', { class: 'topbar' },
    h('div', { class: `crest side${side.id}` }, h('div', { class: 'crest-name' }, side.id === 0 ? 'No. 7 Composite Wing' : 'Kampfgeschwader Nord'), h('div', { class: 'crest-sub' }, side.name)),
    h('div', { class: 'week' }, icon('week', 18),
      h('span', null, debriefWeek !== undefined ? `Week ${debriefWeek} ${what}` : `Week ${st.turn}`),
      debriefWeek !== undefined ? null : h('span', { class: 'forecast', ...tip({ head: 'Forecast', text: 'Meteorological Office forecast for the coming operation. Usually right. Storms spoil bombing and interceptions; cloud hides results.' }) }, `${WEATHER_LABEL[st.forecast[side.id]]}`)),
    lanChip,
    h('div', { class: 'resources' },
      res('supplies', r.supplies, String(r.supplies), 'supplies', 'Pay for armor, aircraft, training, research and repairs. Delivered every week; more when High Command trusts you.'),
      res('fuel', r.stores, String(r.stores), 'stores', `Fuel, bombs and ammunition. Every aircraft that flies uses them. Depots hold at most ${STORES_CAP}; wrecked fuel depots cut deliveries.`),
      res('crew', r.replacements, String(r.replacements), 'recruits', 'Replacement aircrew waiting for a place at the training school.'),
      res('trust', side.trust, String(side.trust), 'confidence', 'High Command\'s confidence in you (0-100). It rises with the results you report, not the results you get. Deliveries grow with it; at 0 you are relieved of command.', undefined, side.trust < 25 ? 'bad' : ''),
      res('front', front, `${held}/${SECTORS} ${front >= 0 ? '▲' : '▼'}${Math.abs(front)}`, 'sectors · pressure', `Sectors we hold of ${SECTORS}, and the pressure on the front as the Army reports it. A sector usually falls at about ±${SECTOR_PRESSURE}.`, undefined, front >= 0 ? 'good' : 'bad'),
    ),
  );
}

export function renderHq(app: App, sideId: SideId, tabIn: string): HTMLElement {
  const tab = TAB_ALIAS[tabIn] ?? tabIn;
  const side = app.state!.sides[sideId];
  const badge = (id: string) => {
    if (id === 'war' && side.requests.length) return String(side.requests.length);
    if (id === 'squadrons' && side.squadrons.some((q) => q.candidate && q.candidateWeek === app.state!.turn)) return '★';
    return null;
  };
  const nav = h('nav', { class: 'tabs' },
    TABS.map(([id, label, hint]) => {
      const b = badge(id);
      return h('button', { class: `tab ${tab === id ? 'active' : ''}`, 'data-tab': id, ...tip(hint), onclick: () => { sfxClick(); app.go({ kind: 'hq', side: sideId, tab: id }); } }, label, b ? h('span', { class: 'badge' }, b) : null);
    }),
    h('div', { class: 'tabs-spacer' }),
    app.state!.mode !== 'single' ? h('button', { class: 'tab small', ...tip('Hide the screen (Esc)'), onclick: () => app.toggleCover() }, 'Close folder') : null,
    app.lan?.role === 'client' ? null : h('button', { class: 'tab small', onclick: () => { void app.save(`week${app.state!.turn}`).then(() => app.toast('Campaign saved')); } }, 'Save'),
    h('button', { class: 'tab small', onclick: () => { void app.save().then(() => { app.endLan(); app.go({ kind: 'title' }); }); } }, 'Main Menu'),
  );
  let body: HTMLElement;
  switch (tab) {
    case 'squadrons': body = squadronsScreen(app, side); break;
    case 'works': body = worksScreen(app, side); break;
    case 'intel': body = intel(app, side); break;
    default: body = warRoom(app, side);
  }
  return h('div', { class: 'hq' }, topBar(app, side), h('div', { class: 'hq-body' }, nav, h('main', { class: `content tab-${tab}`, 'data-keep-scroll': `hq-${tab}` }, body)), readinessBar(app, sideId));
}

/* ---------------- Intelligence ---------------- */
/** What bombing does to works: ours as the ground staff know it, the enemy's as far as we can estimate. */
function strategicPanel(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const t = st.theater;
  const enemy = (1 - side.id) as SideId;
  const est = (type: 'industry' | 'airfield' | 'fuel') => facilityCondition(t, enemy, type, (x) => believed(st, side.id, x));
  const theirs = { industry: est('industry'), airfield: est('airfield'), fuel: est('fuel') };
  const ours = side.facilities;
  const eo = facilityEffects(ours);
  const et = facilityEffects(theirs);
  const pc = (x: number) => `${Math.round(x * 100)}%`;
  const repairBtn = (type: 'airfield' | 'fuel' | 'industry') => ours[type] < 100
    ? h('button', { class: 'btn tiny', disabled: !!side.repaired?.includes(type) || side.resources.supplies < REPAIR_COST, title: 'Work gangs patch up every site of this type we hold: +20% each. Once a week per type.', onclick: () => app.cmd(side.id, { k: 'repair', what: type }) }, side.repaired?.includes(type) ? 'Repaired this week' : `Emergency repairs (${REPAIR_COST} supplies)`)
    : null;
  const badge = (on: boolean) => (on ? h('span', { class: 'stamp reprimand crippled' }, 'CRIPPLED') : null);
  const row = (label: string, type: 'airfield' | 'fuel' | 'industry', a: number, b: number, effA: string, effB: string) =>
    h('tr', null, h('td', null, label),
      h('td', null, `${a}% `, badge(eo.crippled[type]), h('div', { class: 'small muted' }, effA), repairBtn(type)),
      h('td', null, `~${b}% `, badge(et.crippled[type]), h('div', { class: 'small muted' }, effB)));
  return panel('Effect of the bombing',
    h('table', { class: 'ledger effects' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Ours (known)'), h('th', null, 'Theirs (our estimate)'))),
      h('tbody', null,
        row('Airfields', 'airfield', ours.airfield, theirs.airfield,
          (eo.grounded > 0 ? `${pc(eo.grounded)} of each operation stays on the ground` : 'all aircraft can take off') + (eo.crippled.airfield ? '; only about half our fighters can scramble' : ''),
          (et.grounded > 0 ? `~${pc(et.grounded)} of their operations grounded` : 'no effect yet') + (et.crippled.airfield ? '; their fighter cover roughly halved' : '')),
        row('Fuel depots', 'fuel', ours.fuel, theirs.fuel, `stores deliveries at ${pc(eo.stores)}`, `their stores deliveries ~${pc(et.stores)}`),
        row('Aircraft works', 'industry', ours.industry, theirs.industry, `production at ${pc(eo.production)}`, `their production ~${pc(et.production)}`),
      ),
    ),
    h('p', { class: 'muted small' }, `Their works that count (within two sectors of the front): ${(['airfield', 'fuel', 'industry'] as const).map((k) => countedSites(t, enemy, k).map((x) => x.name).join(', ')).filter(Boolean).join('; ') || 'none'}. A side with no works of a type left counts as 40%.`),
    h('p', { class: 'muted small' }, `Below ${CRIPPLED}% a type of works is crippled and the effect jumps: crippled airfields halve fighter cover, crippled depots and works cut deliveries and production by a further 30%. Damage also tells at the front, week after week. The enemy figures are only as good as our crews\' bombing reports and photographs.`),
  );
}

function intel(app: App, side: SideState): HTMLElement {
  const p = side.perceived;
  const st = app.state!;
  const officer = side.research.includes('intelOfficer');
  const app2 = p.enemyApproach;
  const claims = st.archive.map((e) => e.claimed[side.id]);
  const maxC = Math.max(1, ...claims);
  return h('div', { class: 'grid2' },
    h('div', { class: 'col' },
      panel('Enemy Order of Battle (our estimate)',
        h('div', { class: 'stats' },
          h('div', null, h('span', null, 'Enemy fighters'), h('b', null, officer ? `${Math.max(0, p.enemyFighters - p.enemyFightersSd)}–${p.enemyFighters + p.enemyFightersSd}` : `~${p.enemyFighters}`)),
          h('div', null, h('span', null, 'Enemy aircraft claimed destroyed'), h('b', null, `${p.claimedKillsTotal}`)),
        ),
        officer ? h('p', { class: 'muted small' }, 'Intelligence Section: ranges reflect disagreement between squadron reports.') : h('p', { class: 'muted small' }, 'Fund an Intelligence Section to see how uncertain these figures are.'),
      ),
      panel('How enemy fighters attack (as reported by returning crews)',
        (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) => h('div', { class: 'bar-row' }, h('span', null, APPROACH_LABEL[k]), h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(app2[k] * 100)}%` })), h('span', null, pct(app2[k])))),
        h('p', { class: 'muted small' }, 'Only crews who survive an attack can describe it.'),
      ),
    ),
    h('div', { class: 'col' },
      panel('Enemy sites (our estimate)',
        st.theater.sites.filter((x) => x.owner !== side.id).map((x) => {
          const b = believed(st, side.id, x);
          return h('div', { class: 'bar-row wide' }, h('span', null, x.name), h('span', { class: 'bar' }, h('i', { style: `width:${b}%` })), h('span', null, `${b}%${p.photographed.includes(x.id) ? ' 📷' : ''}`));
        }),
        h('p', { class: 'muted small' }, 'Estimates are built from crews\' bombing reports; a camera symbol marks figures from photographs.'),
      ),
      strategicPanel(app, side),
      correspondence(app, side),
      panel('Claims per week',
        claims.length ? h('div', { class: 'chart' }, claims.map((c, i) => h('div', { class: 'col-bar', title: `Week ${i + 1}: ${c} claimed` }, h('em', null, String(c)), h('i', { style: `height:${Math.round((c / maxC) * 80)}%` }), h('span', null, `w${i + 1}`)))) : h('p', { class: 'muted' }, 'No operations flown yet.'),
        claims.length ? h('p', { class: 'muted small' }, 'Enemy aircraft claimed destroyed by our crews, by week (number above each bar).') : null,
      ),
    ),
  );
}

const STAMP: Record<Memo['kind'], string> = { order: 'DIRECTIVE', intel: 'INTELLIGENCE', supply: 'SUPPLY', reprimand: 'REPRIMAND', commendation: 'COMMENDED', notice: 'NOTICE' };

/** Every memo received, latest first, repeats removed. */
function correspondence(app: App, side: SideState): HTMLElement {
  const memos = dedupeMemos(side.memos.filter((m) => m.kind !== 'supply')).slice(0, 30);
  return panel('Correspondence file',
    memos.length ? memos.map((m) => h('details', { class: `slip memo-${m.kind}` },
      h('summary', null, h('span', { class: `stamp ${m.kind}` }, STAMP[m.kind]), ' ', h('b', null, m.subject), h('span', { class: 'small muted' }, ` · ${m.from} · wk ${m.turn}`)),
      h('div', { class: 'memo-body' }, m.body))) : h('p', { class: 'muted' }, 'Nothing on file.'));
}
