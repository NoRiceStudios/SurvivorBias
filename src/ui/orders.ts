/**
 * The sealed orders: an overview of what a commander has ordered for the week,
 * shown once the folder is sealed, with the way back to amend it.
 */
import { planCost } from '../core/actions';
import type { Command } from '../core/commands';
import { AIRCRAFT, RESEARCH } from '../core/data';
import { doctrineSummary } from '../core/doctrine';
import { flyable } from '../core/sim';
import { frontSector, THEATERS, WEATHER_LABEL } from '../core/theaters';
import type { SideId, Squadron } from '../core/types';
import type { App } from './app';
import { sfxClick, sfxStamp } from './audio';
import { h, plural } from './dom';
import { missionLabel, topBar } from './hq';
import { theaterMap } from './theaterui';
import { chipRow, readinessChips } from './readiness';

/** Everything this commander has ordered for the coming week, on one sheet. */
export function ordersOverview(app: App, sideId: SideId): HTMLElement {
  const st = app.state!;
  const side = st.sides[sideId];
  const plan = app.plans[sideId];
  const def = THEATERS[st.theater.index];
  const sq = (id: string) => side.squadrons.find((q) => q.id === id);
  const n = (q: Squadron | undefined) => (q ? flyable(q).length : 0);
  const role = (q: Squadron): [string, string] => {
    if (plan.raid?.squadronIds.includes(q.id)) {
      const what = plan.raid.target === 'sweep' ? 'Sweep' : q.kind === 'fighter' ? 'Escort' : plan.raid.target === 'support' ? 'Close support' : 'Bomb';
      return [what, missionLabel(app, plan.raid)];
    }
    if (plan.defense.includes(q.id)) return ['Defend', plan.cover[q.id] === undefined ? 'central reserve' : `patrol over ${def.sectors[plan.cover[q.id]]}`];
    if (plan.feint?.squadronIds.includes(q.id)) return ['Feint', `over ${def.sectors[plan.feint.sector]}`];
    if (plan.recon?.squadronId === q.id) return ['Photograph', st.theater.sites.find((x) => x.id === plan.recon!.siteId)?.name ?? ''];
    if (plan.rested?.some((r) => r.id === q.id)) return ['Rest', 'at the leader\'s request'];
    return ['Stand down', ''];
  };
  const rows = side.squadrons.filter((q) => q.airframes.length > 0).map((q) => {
    const [r, where] = role(q);
    const flying = r !== 'Stand down' && r !== 'Rest';
    const d = q.doctrine;
    return h('tr', { class: flying ? 'active' : 'muted' },
      h('td', null, h('b', null, q.name), h('div', { class: 'small muted' }, AIRCRAFT[q.kind].name[sideId])),
      h('td', null, h('b', null, r), where ? h('div', { class: 'small' }, where) : null),
      h('td', { class: 'num' }, flying ? String(n(q)) : '—'),
      h('td', { class: 'small' }, q.kind === 'recon' ? '' : [
        q.kind !== 'fighter' ? doctrineSummary(q.kind, 'formation', d.formation).split(':')[0].replace(/\.$/, '') : null,
        `${doctrineSummary(q.kind, 'altitude', d.altitude).split('.')[0]}`,
        doctrineSummary(q.kind, 'breakOff', d.breakOff).replace(/\.$/, ''),
      ].filter(Boolean).join(' · ')),
    );
  });
  const raidN = (plan.raid?.squadronIds ?? []).reduce((a, id) => a + n(sq(id)), 0);
  const cost = planCost(side, plan);
  const mission = plan.raid && plan.raid.squadronIds.length
    ? `${missionLabel(app, plan.raid)}${plan.raid.target === 'support' || plan.raid.target === 'sweep' ? ` over ${def.sectors[frontSector(st.theater, sideId)]}` : ''} with ${plural(raidN, 'aircraft', 'aircraft')}`
    : 'No operation: a defensive week';
  const policy = plan.embellish >= 0.65 ? 'Creative' : plan.embellish >= 0.2 ? 'Optimistic' : 'Accurate';
  const changes = describeCommands(app, sideId, app.pendingCommands[sideId]);
  return h('div', { class: 'orders-sheet' },
    h('div', { class: 'grid2' },
      h('div', { class: 'col' },
        h('div', { class: 'orders-head' },
          h('div', null, h('span', { class: 'muted small' }, 'Operation'), h('h2', null, mission)),
          h('div', { class: 'orders-facts' },
            h('span', null, `Defence: ${plural(plan.defense.reduce((a, id) => a + n(sq(id)), 0), 'fighter')}`),
            plan.feint ? h('span', null, `Feint over ${def.sectors[plan.feint.sector]}`) : null,
            h('span', { class: cost.stores > side.resources.stores ? 'bad' : '' }, `Stores ${cost.stores}/${side.resources.stores}`),
            h('span', null, `Returns: ${policy}`),
            h('span', null, `Forecast: ${WEATHER_LABEL[st.forecast[sideId]]}`))),
        h('table', { class: 'sq-table orders-table' },
          h('thead', null, h('tr', null, h('th', null, 'Squadron'), h('th', null, 'Task'), h('th', null, 'A/c'), h('th', null, 'Doctrine'))),
          h('tbody', null, rows)),
      ),
      h('div', { class: 'col' },
        theaterMap(st, { viewer: sideId, selected: plan.raid?.siteId, patrols: Object.values(plan.cover), feint: plan.feint?.sector, raid: plan.raid ?? undefined, scale: 2 }),
        changes.length ? h('div', { class: 'orders-changes' }, h('h3', null, 'Changes made this week'), h('ul', null, changes.map((c) => h('li', { class: 'small' }, c)))) : null,
      ),
    ),
  );
}

/** Group this week's management changes into a few readable lines. */
function describeCommands(app: App, sideId: SideId, cmds: Command[]): string[] {
  const side = app.state!.sides[sideId];
  const name = (id: string) => side.squadrons.find((q) => q.id === id)?.name ?? 'a squadron';
  const out: string[] = [];
  const armor = new Set(cmds.filter((c) => c.k === 'armor').map((c) => name((c as { sq: string }).sq)));
  if (armor.size) out.push(`Armor refitted: ${[...armor].join(', ')}`);
  for (const c of cmds) if (c.k === 'armorAll') out.push(`Armor layout of ${name(c.sq)} copied to its type`);
  const doctrine = new Set(cmds.filter((c) => c.k === 'doctrine').map((c) => name((c as { sq: string }).sq)));
  if (doctrine.size) out.push(`Doctrine changed: ${[...doctrine].join(', ')}`);
  const built = cmds.filter((c) => c.k === 'build').map((c) => AIRCRAFT[(c as { kind: keyof typeof AIRCRAFT }).kind].name[sideId]);
  if (built.length) out.push(`Ordered: ${built.join(', ')}`);
  for (const c of cmds) {
    if (c.k === 'research') out.push(`Development funded: ${RESEARCH.find((r) => r.id === c.id)?.name ?? c.id}`);
    else if (c.k === 'upgrade') out.push(c.what === 'factory' ? 'Aircraft works expanded' : c.what === 'training' ? 'Training school expanded' : 'Flak batteries added');
    else if (c.k === 'convoy') out.push('Stores convoy bought');
    else if (c.k === 'crews') out.push(`${plural(c.n, 'crew')} requested from the Ministry`);
    else if (c.k === 'merge') out.push(`${name(c.from)} merged into ${name(c.into)}`);
    else if (c.k === 'approve') out.push('A squadron request approved');
    else if (c.k === 'repair') out.push(`Emergency repairs: ${c.what}`);
  }
  return out.slice(0, 8);
}

/** Hotseat: the folder is sealed. Check it, amend it, or pass it on. */
export function renderSealed(app: App, sideId: SideId): HTMLElement {
  const st = app.state!;
  const side = st.sides[sideId];
  const other = st.sides[(1 - sideId) as SideId];
  const first = sideId === 0;
  return h('div', { class: 'hq sealed-screen' },
    topBar(app, side),
    h('main', { class: 'content sealed-body', 'data-keep-scroll': 'sealed' },
      h('section', { class: 'paper panel' },
        h('div', { class: 'sealed-title' }, h('span', { class: 'stamp big drop' }, 'ORDERS SEALED'), h('h1', null, `Week ${st.turn}: your orders`)),
        (() => { const c = readinessChips(app, side).filter((x) => x.level !== 'block'); return c.length ? h('div', { class: 'sealed-chips' }, h('span', { class: 'small muted' }, 'Still open: '), chipRow(app, sideId, c, 6, true)) : null; })(),
        ordersOverview(app, sideId),
        h('p', { class: 'muted small' }, first
          ? `Nothing is flown until ${other.commander} has sealed their orders too. Until you pass the folder on, you can still amend yours.`
          : 'The week is fought as soon as you confirm. Until then you can still amend your orders.'),
      ),
    ),
    h('div', { class: 'launchbar' },
      h('div', { class: 'launch-summary' }, h('button', { class: 'btn', onclick: () => { sfxClick(); app.unseal(sideId); } }, '◂ Amend orders')),
      h('button', { class: 'btn primary launch', onclick: () => { sfxStamp(); if (first) app.planning(1); else void app.launch(1); } }, first ? `Pass the folder to ${other.commander} ▸` : 'Fight the week ▸'),
    ),
  );
}
