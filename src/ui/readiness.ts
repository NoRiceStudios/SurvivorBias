/**
 * The readiness bar at the foot of the HQ: this week's plan in one sentence,
 * the adjutant's warnings as chips (click one to go to the problem), and the
 * button that seals the orders. A blocking problem disables the button and says why.
 */
import { AIRCRAFT } from '../core/data';
import { CONVOY, planCost, validatePlan } from '../core/actions';
import { flyable } from '../core/sim';
import { frontSector, THEATERS } from '../core/theaters';
import { STORES_CAP } from '../core/turn';
import type { AircraftKind, SideId, SideState, Squadron } from '../core/types';
import type { App } from './app';
import { h, plural } from './dom';
import { missionLabel } from './hq';
import { believed } from './theaterui';
import { bestTarget, strikeAt } from './warroom';
import { tip } from './tip';

export interface Chip {
  label: string;
  level: 'block' | 'warn' | 'info';
  /** HQ tab to open, and an element to pulse there. */
  tab: string;
  focus?: string;
  detail: string;
  /** Fix it in one click instead of going there. */
  act?: () => void;
}

/** Show every chip instead of the first few. */
let showAll = false;

/** Everything that needs the commander's attention before sealing, most urgent first. */
export function readinessChips(app: App, side: SideState): Chip[] {
  const st = app.state!;
  const plan = app.plans[side.id];
  const chips: Chip[] = [];
  const v = validatePlan(side, plan, st);
  if (!v.ok && !/stores/i.test(v.reason)) chips.push({ label: v.reason.split(/[.:]/)[0], level: 'block', tab: 'war', focus: '.orders-col', detail: v.reason });
  const c = planCost(side, plan);
  if (c.stores > side.resources.stores) chips.push({ label: `Stores short by ${c.stores - side.resources.stores}`, level: 'block', tab: 'war', focus: '.orders-col', detail: `This plan needs ${c.stores} stores and we hold ${side.resources.stores}. Stand a squadron down, drop maximum effort, fly a smaller operation, use "Fit to stores" or buy a convoy (${CONVOY.supplies} supplies for ${CONVOY.stores} stores).` });
  // Striking a site our own crews believe is already wrecked.
  const tgt = plan.raid?.siteId ? st.theater.sites.find((x) => x.id === plan.raid!.siteId) : undefined;
  if (tgt && tgt.owner !== side.id && believed(st, side.id, tgt) <= 20) {
    const alt = bestTarget(app, side);
    const better = alt && alt.id !== tgt.id && believed(st, side.id, alt) > 20 ? alt : undefined;
    chips.push({ label: `Target ≈${believed(st, side.id, tgt)}%: already wrecked?${better ? ` Strike ${better.name}` : ''}`, level: 'warn', tab: 'war', focus: '.orders-col',
      detail: `Our crews believe ${tgt.name} is down to ≈${believed(st, side.id, tgt)}%. Another raid may add little.${better ? ` Click to strike ${better.name} instead${side.orders.some((o) => o.siteId === better.id) ? ' (named in a standing order)' : ''}.` : ''}`,
      act: better ? () => strikeAt(app, side, better) : undefined });
  }
  if (side.requests.length) chips.push({ label: plural(side.requests.length, 'request'), level: 'warn', tab: 'war', focus: '.intray', detail: 'Squadron leaders are waiting for an answer. Unanswered requests lapse at the end of the week.' });
  const raidIds = plan.raid?.squadronIds ?? [];
  const kindIn = (k: AircraftKind[]) => raidIds.some((id) => k.includes(side.squadrons.find((q) => q.id === id)?.kind ?? 'recon'));
  if (plan.raid && plan.raid.target !== 'sweep' && kindIn(['medium', 'heavy']) && !kindIn(['fighter'])) chips.push({ label: 'Bombers unescorted', level: 'warn', tab: 'war', focus: '.orders-col', detail: 'No fighters fly with the bombers this week. Enemy fighters will have them to themselves.' });
  const tired = side.squadrons.filter((q) => q.fatigue >= 0.7 && q.airframes.length > 0);
  if (tired.length) chips.push({ label: tired.length <= 2 ? `${tired.map((q) => q.name.replace(/^No\. \d+ |^Staffel /, '').replace(/"/g, '')).join(', ')} exhausted` : `${tired.length} squadrons exhausted`, level: 'warn', tab: 'war', focus: '.orders-col', detail: `${tired.map((q) => q.name).join(', ')}: tired crews shoot and fly worse and their morale slides. Each week standing down takes off about a third of it.` });
  const low = side.squadrons.filter((q) => q.morale <= 0.25 && q.airframes.length > 0);
  if (low.length) chips.push({ label: 'Morale very low', level: 'warn', tab: 'squadrons', detail: `${low.map((q) => q.name).join(', ')}. If the whole wing's morale stays this low for three weeks, the crews will refuse to fly.` });
  const thin = raidIds.map((id) => side.squadrons.find((q) => q.id === id)).filter((q): q is Squadron => !!q && flyable(q).length > 0 && flyable(q).length <= 2);
  if (thin.length) chips.push({ label: `${thin.map((q) => q.name.replace(/^No\. \d+ |^Staffel /, '').replace(/"/g, '')).join(', ')}: ${thin.map((q) => flyable(q).length).join('–')} aircraft, easy prey`, level: 'warn', tab: 'war', detail: `${thin.map((q) => `${q.name} can put up only ${flyable(q).length}`).join('; ')}. A handful flying alone is easy prey.` });
  const busy = new Set([...raidIds, ...plan.defense, ...(plan.feint?.squadronIds ?? []), plan.recon?.squadronId, ...(plan.rested ?? []).map((r) => r.id)]);
  const idle = side.squadrons.filter((q) => !busy.has(q.id) && flyable(q).length > 0 && q.fatigue < 0.5);
  if (idle.length) chips.push({ label: `${plural(idle.length, 'squadron')} idle`, level: 'info', tab: 'war', focus: '.orders-col', detail: `${idle.map((q) => q.name).join(', ')} ${idle.length > 1 ? 'have' : 'has'} no task. Unassigned squadrons rest but do not fight.` });
  const choosing = side.squadrons.filter((q) => q.candidate && q.candidateWeek === st.turn);
  if (choosing.length) chips.push({ label: 'New CO to confirm', level: 'warn', tab: 'squadrons', detail: `${choosing.map((q) => q.name).join(', ')}: you may appoint the other flight commander instead, this week only.` });
  for (const kind of ['medium', 'heavy', 'fighter'] as const) {
    const have = side.squadrons.filter((q) => q.kind === kind).reduce((a, q) => a + q.airframes.length, 0);
    const onOrder = side.factory.queue.filter((k) => k === kind).length;
    if (have > 0 && have <= 6 && onOrder === 0) chips.push({ label: `${AIRCRAFT[kind].name[side.id]} running out`, level: 'warn', tab: 'works', detail: `Only ${have} left and none on order. Crews follow the aircraft.` });
  }
  if (!side.researching && side.resources.supplies >= 70) chips.push({ label: 'Engineers idle', level: 'info', tab: 'works', focus: '.works-research', detail: 'No development project is funded. One at a time; each takes a few weeks.' });
  if (side.facilities.industry < 50) chips.push({ label: `Works damaged: ${side.facilities.industry}%`, level: 'warn', tab: 'intel', detail: 'Enemy bombing has cut our aircraft production. Emergency repairs are under Intelligence, Effect of the bombing.' });
  if (side.factory.queue.length === 0 && side.resources.supplies >= 60) chips.push({ label: 'Factory idle', level: 'info', tab: 'works', focus: '.works-factory', detail: 'Nothing is on order at the aircraft works.' });
  if (c.stores <= side.resources.stores && side.resources.stores >= STORES_CAP - 5) chips.push({ label: 'Depots full', level: 'info', tab: 'war', detail: `Deliveries beyond ${STORES_CAP} stores are lost: we can afford a bigger effort.` });
  return chips;
}

/** "Strike Kesselspitze Airfield · 20 aircraft · defence 8 · stores 108/220". */
function planSentence(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const plan = app.plans[side.id];
  const n = (ids: string[]) => ids.reduce((a, id) => { const q = side.squadrons.find((s) => s.id === id); return a + (q ? flyable(q).length : 0); }, 0);
  const c = planCost(side, plan);
  const go = () => app.go({ kind: 'hq', side: side.id, tab: 'war' });
  const def = THEATERS[st.theater.index];
  const op = plan.raid && plan.raid.squadronIds.length
    ? `${plan.raid.target === 'support' ? 'Close support' : plan.raid.target === 'sweep' ? 'Sweep' : 'Strike'} ${plan.raid.target === 'support' || plan.raid.target === 'sweep' ? `over ${def.sectors[frontSector(st.theater, side.id)]}` : missionLabel(app, plan.raid)}`
    : 'No operation';
  return h('div', { class: 'plan-sentence' },
    h('a', { class: 'jump', onclick: go }, op),
    plan.raid ? [' · ', h('b', null, String(n(plan.raid.squadronIds))), ' aircraft'] : null,
    ' · defence ', h('b', null, String(n(plan.defense))),
    plan.feint ? [' · feint ', h('b', null, String(n(plan.feint.squadronIds)))] : null,
    ' · ', h('span', { class: c.stores > side.resources.stores ? 'bad' : '', ...tip({ head: 'Stores', text: 'Fuel, bombs and ammunition. Every aircraft that flies uses them.' }) }, `stores ${c.stores}/${side.resources.stores}`),
  );
}

/** Chips for the warnings; `readOnly` when the orders are sealed and cannot be changed from here. */
export function chipRow(app: App, sideId: SideId, chips: Chip[], max = 3, readOnly = false): HTMLElement {
  const shown = showAll ? chips : chips.slice(0, max);
  return h('div', { class: 'chips' },
    shown.map((c) => h('button', {
      class: `chip ${c.level}`,
      ...tip({ head: c.label, text: c.detail }),
      onclick: readOnly ? undefined : () => (c.act ? c.act() : app.jump(sideId, c.tab, c.focus)),
    }, c.level === 'block' ? '⛔ ' : c.level === 'warn' ? '⚠ ' : '· ', c.label)),
    chips.length > max ? h('button', { class: 'chip more', onclick: () => { showAll = !showAll; app.render(); } }, showAll ? '− fewer' : `+${chips.length - max} more`) : null);
}

export function readinessBar(app: App, sideId: SideId): HTMLElement {
  const st = app.state!;
  const side = st.sides[sideId];
  const chips = readinessChips(app, side);
  const blocked = chips.find((c) => c.level === 'block');
  const c = planCost(side, app.plans[sideId]);
  const label = st.mode !== 'single' ? 'Seal Orders ▸' : 'Launch Operation ▸';
  return h('div', { class: 'launchbar readiness' },
    h('div', { class: 'launch-summary' },
      planSentence(app, side),
      chipRow(app, sideId, chips.filter((c) => c !== blocked), 3),
    ),
    h('div', { class: 'launch-actions' },
      c.stores > side.resources.stores ? h('button', { class: 'btn small choice', ...tip('Drop maximum effort and the feint, then escorts and squadrons from the raid, until the plan fits the stores we hold.'), onclick: () => app.act(() => app.fitToStores(sideId)) }, 'Fit to stores') : null,
      h('button', { class: 'btn small', disabled: side.convoyWeek === st.turn || side.resources.supplies < CONVOY.supplies, ...tip(`Buy a stores convoy: ${CONVOY.supplies} supplies for ${CONVOY.stores} stores, once a week.`), onclick: () => app.cmd(sideId, { k: 'convoy' }) }, side.convoyWeek === st.turn ? 'Convoy bought' : `Convoy +${CONVOY.stores}`),
      h('div', { class: 'cta' },
        h('button', { class: 'btn primary launch', disabled: !!blocked, onclick: () => void app.seal(sideId) }, label),
        blocked ? h('div', { class: 'cta-why' }, blocked.label) : null),
    ),
  );
}
