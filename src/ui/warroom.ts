/**
 * The War Room: Briefing and Operations on one table. The map on the left is
 * where targets are chosen; the orders column on the right holds the mission,
 * the target, every squadron's task and the returns policy; the in-tray under
 * the map holds requests, standing orders and this week's mail.
 */
import { AIRCRAFT, APPROACH_LABEL, ARCHETYPE_INFO, TARGETS } from '../core/data';
import { flyable } from '../core/sim';
import { bomberRange, currentStage, DECISIVE_GAIN, depthFor, escortRange, frontSector, SECTOR_PRESSURE, SECTORS, sectorAtDepth, THEATERS } from '../core/theaters';
import type { FighterApproach, Memo, SideId, SideState, Site, Squadron, TargetId } from '../core/types';
import type { App } from './app';
import { h, pct, slider } from './dom';
import { leaderPortrait } from './general';
import { believed, depthLabel, pressureGauge, theaterMap } from './theaterui';
import { tip } from './tip';
import { countPlanes, pips, seg } from './widgets';
import { aircraftCanvas } from './sprites';

type Role = 'raid' | 'defense' | 'rest' | 'recon' | 'feint';

const STAMP: Record<Memo['kind'], string> = { order: 'DIRECTIVE', intel: 'INTELLIGENCE', supply: 'SUPPLY', reprimand: 'REPRIMAND', commendation: 'COMMENDED', notice: 'NOTICE' };

/** Memos with repeats removed: only the latest of each sender and subject. */
export function dedupeMemos(memos: Memo[]): Memo[] {
  const seen = new Set<string>();
  return memos.filter((m) => {
    const k = `${m.from}|${m.subject}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function warRoom(app: App, side: SideState): HTMLElement {
  return h('div', { class: 'warroom' },
    h('div', { class: 'wr-left' }, mapCard(app, side), inTray(app, side)),
    h('div', { class: 'wr-right' }, ordersColumn(app, side)),
  );
}

/* ---------------- Planning helpers ---------------- */

function planner(app: App, side: SideState) {
  const st = app.state!;
  const t = st.theater;
  const plan = app.plans[side.id];
  const bombers = side.squadrons.filter((q) => q.kind === 'medium' || q.kind === 'heavy');
  const longest = Math.max(0, ...bombers.map((q) => bomberRange(q.kind)));
  const enemySites = t.sites.filter((x) => x.owner !== side.id).sort((a, b) => depthFor(t.held0, side.id, a.sector) - depthFor(t.held0, side.id, b.sector));
  const inRange = (x: Site) => depthFor(t.held0, side.id, x.sector) <= longest;
  const pick = (target: TargetId, siteId?: string) => app.act(() => {
    let ids = plan.raid?.squadronIds ?? [];
    // Coming from "no operation", put the ready squadrons back on the job.
    if (!plan.raid || ids.length === 0) {
      ids = side.squadrons.filter((q) => (target === 'sweep' ? q.kind === 'fighter' && !plan.defense.includes(q.id) : q.kind === 'medium' || q.kind === 'heavy') && flyable(q).length > 0 && !plan.feint?.squadronIds.includes(q.id)).map((q) => q.id);
    }
    plan.raid = { target, siteId, squadronIds: target === 'sweep' ? ids.filter((id) => side.squadrons.find((q) => q.id === id)?.kind === 'fighter') : ids };
  });
  const mainSector = plan.raid ? (plan.raid.siteId ? t.sites.find((x) => x.id === plan.raid!.siteId)?.sector : frontSector(t, side.id)) : undefined;
  const feintSectors = [1, 2].map((d) => sectorAtDepth(t.held0, (1 - side.id) as SideId, d)).filter((sec) => sec >= 0 && sec < SECTORS);
  const assign = (sq: Squadron, role: Role) => {
    plan.defense = plan.defense.filter((i) => i !== sq.id);
    delete plan.cover[sq.id];
    if (plan.raid) plan.raid.squadronIds = plan.raid.squadronIds.filter((i) => i !== sq.id);
    if (plan.recon?.squadronId === sq.id) plan.recon = null;
    if (plan.feint) {
      plan.feint.squadronIds = plan.feint.squadronIds.filter((i) => i !== sq.id);
      if (plan.feint.squadronIds.length === 0) plan.feint = null;
    }
    if (role === 'feint') {
      const sector = plan.feint?.sector ?? feintSectors.find((x) => x !== mainSector);
      if (sector === undefined) return { ok: false, reason: 'No sector left to feint at' };
      plan.feint = { squadronIds: [...(plan.feint?.squadronIds ?? []), sq.id], sector };
    }
    if (role === 'raid') {
      if (!plan.raid) plan.raid = sq.kind === 'fighter' ? { target: 'sweep', squadronIds: [] } : { target: 'support', squadronIds: [] };
      if (plan.raid.target === 'sweep' && sq.kind !== 'fighter') return { ok: false, reason: 'Only fighters fly sweeps. Choose a strike or close support first.' };
      plan.raid.squadronIds.push(sq.id);
    }
    if (role === 'defense') plan.defense.push(sq.id);
    if (role === 'recon') plan.recon = { squadronId: sq.id, siteId: plan.raid?.siteId ?? enemySites[0].id };
    return { ok: true };
  };
  const roleOf = (sq: Squadron): Role => plan.raid?.squadronIds.includes(sq.id) ? 'raid' : plan.defense.includes(sq.id) ? 'defense' : plan.recon?.squadronId === sq.id ? 'recon' : plan.feint?.squadronIds.includes(sq.id) ? 'feint' : 'rest';
  return { st, t, plan, longest, enemySites, inRange, pick, assign, roleOf, mainSector, feintSectors };
}

/* ---------------- Map card ---------------- */

function mapCard(app: App, side: SideState): HTMLElement {
  const { st, t, plan, longest, inRange, pick } = planner(app, side);
  const def = THEATERS[t.index];
  const stage = currentStage(st);
  const gain = side.id === 0 ? t.held0 - t.start0 : t.start0 - t.held0;
  const obj = t.objectives.find((o) => o.side === side.id)!;
  const objStatus = { open: 'OPEN', claimed: 'CLAIMED', confirmed: 'CONFIRMED', discredited: 'DISCREDITED', overrun: 'TAKEN INTACT' }[obj.status];
  const reach = escortRange(side);
  const flags = Array.from({ length: DECISIVE_GAIN }, (_, i) => h('i', { class: `flag ${i < gain ? 'on' : ''}` }));
  const warn = side.perceived.warning;
  return h('section', { class: 'paper panel map-card' },
    h('div', { class: 'map-head' },
      h('div', null,
        h('h2', null, `${def.name} · week ${t.week + 1} of ${def.weeks}`),
        h('div', { class: 'small muted' }, `${def.season} · Stage: `, h('span', { class: 'dotted', ...tip({ head: stage.title, text: stage.text }) }, stage.title))),
      h('div', { class: 'objective', ...tip({ head: 'Primary objective', text: `Take ${DECISIVE_GAIN} sectors to win the theater outright. If nobody breaks through by week ${def.weeks}, it goes to whoever holds the advantage, but only if they have taken at least one sector.` }) },
        h('span', { class: 'small' }, 'Sectors taken'), h('span', { class: 'flags' }, flags), h('b', { class: gain > 0 ? 'good' : gain < 0 ? 'bad' : '' }, `${gain >= 0 ? '+' : ''}${gain} / ${DECISIVE_GAIN}`)),
    ),
    warn ? h('div', { class: 'warning-line' }, h('span', { class: 'stamp intel' }, 'Y-SERVICE'), ' ', warn.text, h('span', { class: 'muted small' }, warn.sector !== undefined ? ' Patrols over that sector would meet it. It may be wrong.' : ' It may be wrong.')) : null,
    theaterMap(st, {
      viewer: side.id, selected: plan.raid?.siteId, patrols: Object.values(plan.cover), feint: plan.feint?.sector, raid: plan.raid ?? undefined, scale: 3, inRange,
      rangeLines: [{ depth: longest, label: 'BOMBER RANGE', color: '#8a5a1a' }, ...(reach < longest ? [{ depth: reach, label: 'ESCORT RANGE', color: '#2c4672' }] : [])],
      onSite: (site) => {
        if (!inRange(site)) return app.toast(`${site.name} is out of range of our bombers`, true);
        pick(site.type, site.id);
      },
    }),
    pressureGauge(side.perceived.front, { band: side.perceived.frontBand }),
    h('div', { class: 'map-foot small' },
      h('span', tip({ head: 'Secondary objective', text: obj.text }), h('b', null, 'Secondary: '), obj.text, ' ', h('span', { class: `stamp ${obj.status === 'discredited' || obj.status === 'overrun' ? 'reprimand' : obj.status === 'open' ? 'order' : 'notice'}` }, objStatus)),
      h('span', { class: 'theater-mini' }, THEATERS.map((th, i) => {
        const r = st.theaterResults.find((x) => x.index === i);
        const cls = r ? (r.winner === side.id ? 'won' : r.winner === null ? 'drawn' : 'lost') : i === t.index ? 'current' : '';
        return h('span', { class: `tm ${cls}`, ...tip({ head: th.name, text: `${th.season}. ${r ? (r.winner === side.id ? 'Won.' : r.winner === null ? 'Drawn.' : 'Lost.') : i === t.index ? 'In progress.' : 'To come.'} ${th.blurb}` }) }, `${i + 1}`);
      })),
    ),
  );
}

/* ---------------- Orders column ---------------- */

function ordersColumn(app: App, side: SideState): HTMLElement {
  const P = planner(app, side);
  const { st, t, plan, enemySites, inRange, pick, assign, roleOf, mainSector, feintSectors } = P;
  const def = THEATERS[t.index];
  const mission = !plan.raid ? 'none' : plan.raid.target === 'support' || plan.raid.target === 'sweep' ? plan.raid.target : 'strike';
  const firstTarget = enemySites.find((x) => x.id === plan.raid?.siteId && inRange(x)) ?? enemySites.find(inRange);
  const missionSeg = seg<string>([
    { value: 'strike', label: 'Strike', tip: { head: 'Strike a site', text: 'Bomb an enemy airfield, works or depot. Wrecked works cut the enemy\'s output and add pressure on the front, week after week.' }, disabled: !firstTarget },
    { value: 'support', label: 'Close support', tip: { head: TARGETS.support.name, text: TARGETS.support.desc } },
    { value: 'sweep', label: 'Sweep', tip: { head: TARGETS.sweep.name, text: TARGETS.sweep.desc } },
    { value: 'none', label: 'Stand down', tip: { head: 'No operation', text: 'A defensive week. Bombers rest; fighters may still patrol.' } },
  ], mission, (m) => {
    if (m === 'none') app.act(() => { plan.raid = null; });
    else if (m === 'strike') pick(firstTarget!.type, firstTarget!.id);
    else pick(m as TargetId);
  }, 'mission-seg');

  // Target card.
  let target: HTMLElement;
  if (mission === 'strike' && plan.raid?.siteId) {
    const site = t.sites.find((x) => x.id === plan.raid!.siteId)!;
    const cond = believed(st, side.id, site);
    const depth = depthFor(t.held0, side.id, site.sector);
    const order = side.orders.find((o) => o.text.includes(site.name));
    target = h('div', { class: 'target-box' },
      h('div', { class: 'tb-name' }, site.name, order ? h('span', { class: 'stamp order' }, 'ORDERED') : null),
      h('div', { class: 'small muted' }, `${def.sectors[site.sector]} · ${depthLabel(st, side.id, site)} · ${depth > escortRange(side) ? 'beyond escort range' : 'escorts can stay with the bombers'}`),
      h('div', { class: 'cond-row', ...tip({ head: 'Believed condition', text: 'How much of the site still works, as far as we know.', source: side.perceived.photographed.includes(site.id) ? 'photographs' : 'crews\' bombing reports (often optimistic)' }) },
        h('span', { class: 'cond-bar' }, h('i', { style: `width:${cond}%` })), h('b', null, `≈${cond}%`), side.perceived.photographed.includes(site.id) ? ' 📷' : ''),
      h('div', { class: 'site-chips' }, h('span', { class: 'small muted' }, 'In range: '),
        enemySites.filter(inRange).map((x) => h('button', { class: `site-chip ${x.id === site.id ? 'on' : ''}`, ...tip(`${x.name}, ${depthLabel(st, side.id, x).toLowerCase()}, ≈${believed(st, side.id, x)}%`), onclick: () => pick(x.type, x.id) }, `${x.name.split(' ')[0]} ${x.type === 'airfield' ? '✈' : x.type === 'industry' ? '▙' : '◘'}`))),
    );
  } else if (mission === 'support' || mission === 'sweep') {
    target = h('div', { class: 'target-box' }, h('div', { class: 'tb-name' }, `${TARGETS[mission].name} over ${def.sectors[frontSector(t, side.id)]}`), h('div', { class: 'small muted' }, TARGETS[mission].desc));
  } else {
    target = h('div', { class: 'target-box' }, h('div', { class: 'small muted' }, 'No operation this week. Bombers rest; fighters may still defend. Click a site on the map to strike it.'));
  }

  const ownSectors = Array.from({ length: SECTORS }, (_, i) => i).filter((i) => (i < t.held0 ? 0 : 1) === side.id)
    .sort((a, b) => depthFor(t.held0, (1 - side.id) as SideId, a) - depthFor(t.held0, (1 - side.id) as SideId, b)).slice(0, 3);
  const rows = side.squadrons.filter((q) => q.airframes.length > 0).map((sq) => {
    const role = roleOf(sq);
    const ready = flyable(sq).length;
    const cost = ready * AIRCRAFT[sq.kind].storesCost;
    const roles: { value: Role; label: string; tip: string }[] =
      sq.kind === 'fighter' ? [
        { value: 'raid', label: plan.raid?.target === 'sweep' ? 'Sweep' : 'Escort', tip: plan.raid?.target === 'sweep' ? 'Hunt enemy fighters over the front.' : 'Fly with the bombers and tie up the interceptors.' },
        { value: 'defense', label: 'Defend', tip: 'Stay home and intercept enemy raids.' },
        { value: 'feint', label: 'Feint', tip: 'Fly over another sector first to draw the enemy reserve away.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down. Fatigue falls by about a third.' }]
      : sq.kind === 'recon' ? [
        { value: 'recon', label: 'Photograph', tip: 'Photograph an enemy site: its true condition, give or take.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down.' }]
      : [
        { value: 'raid', label: 'Bomb', tip: 'Fly the operation.' },
        { value: 'feint', label: 'Feint', tip: 'Fly over another sector first to draw the enemy reserve away.' },
        { value: 'rest', label: 'Rest', tip: 'Stand down. Fatigue falls by about a third.' }];
    const extra = role === 'defense'
      ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Patrol '),
        seg<number>([{ value: -1, label: 'Reserve', tip: 'Central reserve: meets most raids, given warning.' }, ...ownSectors.map((sec) => ({ value: sec, label: def.sectors[sec], tip: 'Patrol this sector: almost sure to meet a raid there, rarely anywhere else.' }))],
          plan.cover[sq.id] ?? -1, (v) => app.act(() => { if (v < 0) delete plan.cover[sq.id]; else plan.cover[sq.id] = v; }), 'mini'))
      : role === 'feint' && plan.feint
        ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Feint over '),
          seg<number>(feintSectors.map((sec) => ({ value: sec, label: def.sectors[sec], disabled: sec === mainSector })), plan.feint.sector, (v) => app.act(() => { plan.feint!.sector = v; }), 'mini'))
        : role === 'recon' && plan.recon
          ? h('div', { class: 'sq-extra' }, h('span', { class: 'small muted' }, 'Photograph '),
            (() => {
              const sel = h('select', { class: 'sel', onchange: (e: Event) => app.act(() => { plan.recon!.siteId = (e.target as HTMLSelectElement).value; }) },
                enemySites.map((x) => h('option', { value: x.id, selected: plan.recon!.siteId === x.id }, `${x.name} (≈${believed(st, side.id, x)}%)`)));
              return sel;
            })())
          : null;
    const info = ARCHETYPE_INFO[sq.leader.archetype];
    return h('div', { class: `sq-row ${role !== 'rest' ? 'active' : ''}`, 'data-sq': sq.id },
      h('div', { class: 'sq-id', ...tip({ head: `${sq.name} — ${AIRCRAFT[sq.kind].name[side.id]}`, text: `${sq.leader.rank} ${sq.leader.name} (${info.label}): ${info.blurb}`, effect: `${ready} ready of ${sq.airframes.length}. Flying costs ${cost} stores.` }) },
        h('div', { class: 'sq-face' }, leaderPortrait(sq.leader, side.id, 1)),
        h('div', null,
          h('div', { class: 'sq-name' }, sq.name.replace(/^No\. \d+ /, '')),
          h('div', { class: 'small muted' }, h('span', { class: 'sq-type' }, aircraftCanvas(sq.kind, { side: side.id, seed: sq.insignia }, 1)), `${ready}/${sq.airframes.length} · `,
            h('span', tip({ head: 'Fatigue', text: 'Rises each week a squadron flies, falls when it rests. Tired crews shoot and fly worse; above 6/10 their morale slides.' }), 'fat ', pips(sq.fatigue, 6, 0.6)),
            ' ', h('span', tip({ head: 'Morale', text: 'Falls with losses. If the whole wing stays very low for three weeks, the crews refuse to fly.' }), 'mor ', pips(sq.morale, 6, 0.3, true))))),
      seg<Role>(roles.map((r) => ({ ...r, disabled: ready === 0 && r.value !== 'rest', tip: { text: r.tip, effect: r.value === 'rest' ? undefined : `− ${cost} stores` } })), role, (r) => app.act(() => assign(sq, r)), 'roles-seg'),
      extra,
    );
  });

  const appr = side.approach;
  const setAppr = (k: FighterApproach, v: number) => app.cmd(side.id, { k: 'approach', w: { ...appr, [k]: Math.max(0.01, v) } });
  return h('section', { class: 'paper panel orders-col' },
    h('h2', null, 'Orders for the week'),
    missionSeg,
    target,
    h('div', { class: 'sq-rows' }, rows),
    h('div', { class: 'policy-row' },
      h('span', { class: 'small', ...tip({ head: 'Returns policy', text: 'How your adjutant presents results to High Command. Optimistic returns raise confidence, until someone checks: photographs and the observers can catch you out.' }) }, 'Returns to HQ'),
      seg<number>([{ value: 0, label: 'Accurate' }, { value: 0.4, label: 'Optimistic' }, { value: 0.9, label: 'Creative' }],
        [0, 0.4, 0.9].find((v) => Math.abs(plan.embellish - v) < 0.05), (v) => app.act(() => { plan.embellish = v; }), 'mini')),
    h('details', { class: 'tactics' },
      h('summary', null, 'Interceptor tactics (all fighters)'),
      h('p', { class: 'small muted' }, 'How our fighters are briefed to attack bombers. Gunners cover the tail best; a head-on pass is brief but meets fewer guns.'),
      (Object.keys(APPROACH_LABEL) as FighterApproach[]).map((k) => h('div', { class: 'appr-row' }, h('span', { class: 'appr-label' }, APPROACH_LABEL[k]), slider(appr[k], (v) => setAppr(k, v), '', pct(appr[k]))))),
  );
}

/* ---------------- In-tray ---------------- */

function inTray(app: App, side: SideState): HTMLElement {
  const st = app.state!;
  const fresh = dedupeMemos(side.memos.filter((m) => m.turn >= st.turn && m.kind !== 'supply'));
  const supply = side.memos.find((m) => m.kind === 'supply' && m.turn >= st.turn);
  return h('section', { class: 'paper panel intray' },
    h('div', { class: 'intray-cols' },
      h('div', null,
        h('h3', null, 'Requests'),
        side.requests.length ? side.requests.map((r) => h('div', { class: 'request' },
          h('div', { class: 'request-text' }, r.text),
          h('div', { class: 'request-effect small' }, h('b', null, 'If approved: '), r.effect),
          h('div', { class: 'request-actions' },
            h('button', { class: 'btn small', onclick: () => app.cmd(side.id, { k: 'approve', id: r.id }) }, r.cost ? `Approve (${r.cost})` : 'Approve'),
            h('button', { class: 'btn choice small', onclick: () => app.cmd(side.id, { k: 'decline', id: r.id }) }, 'Decline')))) : h('p', { class: 'small muted' }, 'No requests this week.'),
        h('h3', null, 'Standing orders'),
        side.orders.length ? h('ul', { class: 'orders' }, side.orders.map((o) => h('li', { class: 'order-item' },
          h('span', { class: 'order-text' }, o.text),
          h('span', { class: `order-due ${o.deadline <= st.turn ? 'now' : ''}` }, o.graced ? `wk ${o.deadline}: awaiting photographs` : o.deadline <= st.turn ? 'DUE THIS WEEK' : `due wk ${o.deadline}`)))) : h('p', { class: 'small muted' }, 'No outstanding directives.')),
      h('div', null,
        h('h3', null, 'This week\'s mail'),
        supply ? h('div', { class: 'small muted' }, supply.body) : null,
        fresh.length ? fresh.map((m) => h('details', { class: `slip memo-${m.kind}` },
          h('summary', null, h('span', { class: `stamp ${m.kind}` }, STAMP[m.kind]), ' ', h('b', null, m.subject), h('span', { class: 'small muted' }, ` · ${m.from}`)),
          h('div', { class: 'memo-body' }, m.body))) : h('p', { class: 'small muted' }, 'Nothing new. Older correspondence is filed under Intelligence.')),
    ));
}
