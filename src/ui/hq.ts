/**
 * The HQ: top bar, four tabs (War Room, Squadrons, Works, Intelligence) and the
 * readiness bar. Old tab names (briefing, operations, hangar, …) still work and
 * lead to the tab that now holds them.
 */
import { REPAIR_COST } from '../core/actions';
import { APPROACH_LABEL } from '../core/data';
import { CRIPPLED, facilityEffects } from '../core/effects';
import { countedSites, facilityCondition, SECTOR_PRESSURE, SECTORS, THEATERS, WEATHER_LABEL } from '../core/theaters';
import { storesCap } from '../core/factions';
import { nationAt, nationTip } from './nation';
import type { FighterApproach, Memo, SideId, SideState } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h, pct } from './dom';
import { icon } from './icons';
import { readinessBar } from './readiness';
import { squadronsScreen } from './squadronsui';
import { believed } from './theaterui';
import { tip } from './tip';
import { soundButton } from './soundui';
import { toggleManual } from './manual';
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
const lastText = new Map<string, string>();

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
    // The digits that changed roll over, like a tote board.
    const prev = lastText.get(key);
    lastText.set(key, shown);
    const digits = [...shown.replace(/ /g, '\u00a0')].map((ch, i) => h('span', { class: `dg ${delta && prev !== undefined && prev[i - shown.length + prev.length] !== ch ? 'rolling' : ''}` }, ch));
    return h('div', { class: `res ${cls} ${delta ? 'changed' : ''}`, ...tip({ head: label, text: title, effect }) }, icon(name, 18),
      h('div', { class: 'res-v' }, h('b', null, digits), h('small', null, label)),
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
    h('div', { class: `crest nation-${nationAt(side.id).id}`, ...tip(nationTip(side)) }, h('div', { class: 'crest-name' }, nationAt(side.id).wing), h('div', { class: 'crest-sub' }, side.name)),
    h('div', { class: 'slate' },
      h('b', null, debriefWeek !== undefined ? `Week ${debriefWeek} ${what}` : `Week ${st.turn}`),
      debriefWeek !== undefined ? h('span', null, THEATERS[st.theater.index].name) : h('span', tip({ head: 'Forecast', text: 'Meteorological Office forecast for the coming operation. Usually right. Storms spoil bombing and interceptions; cloud hides results.' }), `${THEATERS[st.theater.index].name} · ${WEATHER_LABEL[st.forecast[side.id]]}`)),
    lanChip,
    h('div', { class: 'resources' },
      res('supplies', r.supplies, String(r.supplies), 'supplies', 'Pay for armor, aircraft, training, research and repairs. Delivered every week; more when High Command trusts you.'),
      res('fuel', r.stores, String(r.stores), 'stores', `Fuel, bombs and ammunition. Every aircraft that flies uses them. Rationed by the wing's strength: about two thirds of a full effort a week. Depots hold at most ${storesCap(side)}; wrecked fuel depots cut deliveries.`),
      res('crew', r.replacements, String(r.replacements), 'recruits', 'Replacement aircrew waiting for a place at the training school.'),
      res('trust', side.trust, String(side.trust), 'confidence', 'High Command\'s confidence in you (0-100). It rises with the results you report, not the results you get. Deliveries grow with it; at 0 you are relieved of command.', undefined, side.trust < 25 ? 'bad' : ''),
      res('front', front, `${held}/${SECTORS} ${front >= 0 ? '▲' : '▼'}${Math.abs(front)}`, 'sectors · pressure', `Sectors we hold of ${SECTORS}, and the pressure on the front as the Army reports it. A sector usually falls at about ±${SECTOR_PRESSURE}.`, undefined, front >= 0 ? 'good' : 'bad'),
    ),
    soundButton(),
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
      return h('button', { class: `tab ${tab === id ? 'active' : ''}`, 'data-tab': id, ...tip(hint), onclick: () => { sfxClick(); app.go({ kind: 'hq', side: sideId, tab: id }); } }, label, b ? h('span', { class: 'badge', ...tip(b === '★' ? 'A squadron has a new commanding officer to confirm this week.' : `${b} request${b === '1' ? '' : 's'} from the squadrons waiting for an answer.`) }, b) : null);
    }),
    h('div', { class: 'tabs-spacer' }),
    h('div', { class: 'quiet-links' },
      h('button', { class: 'quiet-link', ...tip('What every term means'), onclick: () => toggleManual(() => app.render()) }, 'F1 Manual'),
      app.state!.mode !== 'single' ? h('button', { class: 'quiet-link', ...tip('Hide the screen (Esc)'), onclick: () => app.toggleCover() }, 'Close folder') : null,
      app.lan?.role === 'client' ? null : h('button', { class: 'quiet-link', onclick: () => { void app.save(`week${app.state!.turn}`).then(() => app.toast('Campaign saved')); } }, 'Save'),
      h('button', { class: 'quiet-link', onclick: () => { void app.save().then(() => { app.endLan(); app.go({ kind: 'title' }); }); } }, 'Leave')),
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
  const bar = (v: number, crippled: boolean, est: boolean) => h('span', { class: `fx-bar ${crippled ? 'crippled' : ''} ${est ? 'est' : ''}` },
    h('i', { style: `width:${v}%` }), h('span', { class: 'fx-tick', style: `left:${CRIPPLED}%` }), h('em', null, `${est ? '≈' : ''}${v}%`));
  const row = (label: string, type: 'airfield' | 'fuel' | 'industry', effA: string, effB: string) =>
    h('div', { class: 'fx-row' },
      h('div', { class: 'fx-label' }, label),
      h('div', { class: 'fx-side' }, bar(ours[type], eo.crippled[type], false), h('div', { class: 'small muted' }, effA),
        ours[type] < 100 ? h('button', { class: 'btn tiny', disabled: !!side.repaired?.includes(type) || side.resources.supplies < REPAIR_COST, ...tip({ text: 'Work gangs patch up every site of this type we hold. Once a week per type.', effect: `+20% for ${REPAIR_COST} supplies` }), onclick: () => app.cmd(side.id, { k: 'repair', what: type }) }, side.repaired?.includes(type) ? 'Repaired' : `Repair (${REPAIR_COST})`) : null),
      h('div', { class: 'fx-side' }, bar(theirs[type], et.crippled[type], true), h('div', { class: 'small muted' }, effB)));
  return panel('Effect of the bombing',
    h('div', { class: 'fx-head' }, h('span', null, ''), h('span', null, 'Ours (known)'), h('span', { ...tip({ text: 'Built from our crews\' bombing reports and photographs.', source: 'crew reports, photographs' }) }, 'Theirs (our estimate)')),
    row('Airfields', 'airfield', eo.grounded > 0 ? `${pc(eo.grounded)} of each operation grounded` : 'all aircraft can take off', et.grounded > 0 ? `≈${pc(et.grounded)} of theirs grounded` : 'no effect yet'),
    row('Fuel depots', 'fuel', `stores deliveries ${pc(eo.stores)}`, `their stores ≈${pc(et.stores)}`),
    row('Aircraft works', 'industry', `production ${pc(eo.production)}`, `their production ≈${pc(et.production)}`),
    h('p', { class: 'small muted' }, `The tick marks ${CRIPPLED}%: below it a type of works is crippled and the effect jumps. Only works within two sectors of the front count.`, ' ',
      h('span', { class: 'dotted', ...tip(`Their works that count: ${(['airfield', 'fuel', 'industry'] as const).map((k) => countedSites(t, enemy, k).map((x) => x.name).join(', ')).filter(Boolean).join('; ') || 'none'}. A side with no works of a type left counts as 40%.`) }, 'Which works count?')),
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
      panel('Enemy order of battle (our estimate)',
        h('div', { class: 'kv' },
          h('span', tip({ text: 'Fighters the enemy can put up, as our crews and the Y-Service count them.', source: officer ? 'Intelligence Section cross-check' : 'crew reports' }), 'Enemy fighters'), h('b', null, officer ? `${Math.max(0, p.enemyFighters - p.enemyFightersSd)}–${p.enemyFighters + p.enemyFightersSd}` : `≈${p.enemyFighters}`),
          h('span', null, 'Claimed destroyed so far'), h('b', null, `${p.claimedKillsTotal}`)),
        officer ? null : h('p', { class: 'small muted' }, 'An Intelligence Section (Works › Development) shows how uncertain these figures are.')),
      panel('How enemy fighters attack',
        (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) => h('div', { class: 'bar-row' }, h('span', null, APPROACH_LABEL[k]), h('span', { class: 'bar' }, h('i', { style: `width:${Math.round(app2[k] * 100)}%` })), h('span', null, pct(app2[k])))),
        h('p', { class: 'small muted' }, 'As reported by returning crews. Only crews who survive an attack can describe it.')),
      panel('Our crews\' claims per week',
        claims.length ? h('div', { class: 'chart' }, claims.map((c, i) => h('div', { class: 'col-bar', ...tip(`Week ${i + 1}: ${c} claimed`) }, h('em', null, String(c)), h('i', { style: `height:${Math.round((c / maxC) * 80)}%` }), h('span', null, `w${i + 1}`)))) : h('p', { class: 'empty-state' }, 'The first claims arrive after your first operation.'),
        claims.length ? h('p', { class: 'small muted' }, 'Unverified. The truth is in the archives, after the war.') : null),
    ),
    h('div', { class: 'col' },
      strategicPanel(app, side),
      panel('Enemy sites (our estimate)',
        st.archive.length ? null : h('p', { class: 'empty-state' }, 'No reports yet: every site is assumed intact until our crews or cameras say otherwise.'),
        st.theater.sites.filter((x) => x.owner !== side.id).map((x) => {
          const b = believed(st, side.id, x);
          return h('div', { class: 'bar-row wide' }, h('span', null, x.name), h('span', { class: 'bar est' }, h('i', { style: `width:${b}%` })), h('span', null, `${b}%${p.photographed.includes(x.id) ? ' 📷' : ''}`));
        }),
        h('p', { class: 'small muted' }, 'From crews\' bombing reports; 📷 marks figures from photographs.')),
      correspondence(app, side),
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
