import { ZONE_LABEL, ZONE_LETHALITY } from '../core/data';
import type { Outcome, SideId } from '../core/types';
import { ZONES } from '../core/types';
import type { App } from './app';
import { sfxClick } from './audio';
import { h } from './dom';
import { aircraftCanvas } from './sprites';

const OUTCOME_TEXT: Record<Outcome, [string, string]> = {
  victory: ['VICTORY', 'The enemy air arm is broken. The war in this sector is over, and you will be remembered as the commander who won it.'],
  pyrrhic: ['PYRRHIC VICTORY', 'The enemy is beaten. Almost nobody who flew with you in the first week is alive to see it.'],
  stalemate: ['ARMISTICE', 'Neither side could break the other. The line on the map is where it was. The cemeteries are not.'],
  relieved: ['RELIEVED OF COMMAND', 'The Air Council has lost confidence in your leadership. You are posted to a training command in the north.'],
  collapse: ['THE FRONT HAS COLLAPSED', 'Enemy armour is on the airfield perimeter. The wing is ordered to withdraw what it can.'],
  mutiny: ['THE CREWS WILL NOT FLY', 'Aircrews have refused to take off. The official term is "lack of moral fibre". The unofficial one is that they have done the arithmetic.'],
  grounded: ['GROUNDED', 'There is nothing left to fly and nothing left to build it with.'],
  defeat: ['DEFEAT', 'The enemy\'s industry outlasted ours. Terms are being discussed.'],
};

export function renderEnd(app: App, sideId: SideId, tab: string): HTMLElement {
  const st = app.state!;
  const outcome = st.outcome![sideId];
  const [title, text] = OUTCOME_TEXT[outcome];
  const other = (1 - sideId) as SideId;
  const nav = h('nav', { class: 'tabs' },
    [['summary', 'Outcome'], ['archive', 'Declassified'], ['ledger', 'The Ledger']].map(([id, label]) =>
      h('button', { class: `tab ${tab === id ? 'active' : ''}`, onclick: () => { sfxClick(); app.go({ kind: 'end', side: sideId, tab: id }); } }, label)),
    st.mode === 'hotseat' ? h('button', { class: 'tab', onclick: () => app.go({ kind: 'end', side: other, tab }) }, `View ${st.sides[other].short}`) : null,
    h('div', { class: 'tabs-spacer' }),
    h('button', { class: 'tab small', onclick: () => app.go({ kind: 'title' }) }, 'Main Menu'),
  );
  const trueLost = st.archive.reduce((a, e) => a + e.trueLosses[sideId], 0);
  const trueKills = st.archive.reduce((a, e) => a + e.trueKills[sideId], 0);
  const claimed = st.archive.reduce((a, e) => a + e.claimed[sideId], 0);
  const toHq = st.archive.reduce((a, e) => a + e.reportedToHq[sideId], 0);
  let body: HTMLElement;
  if (tab === 'archive') {
    const surv = st.archive.flatMap((e) => e.survivorHits[sideId]);
    const lost = st.archive.flatMap((e) => e.lostHits[sideId]);
    const fatal = lost.filter((x) => x.lethal);
    const maxL = Math.max(...Object.values(ZONE_LETHALITY));
    body = h('div', { class: 'col' },
      h('section', { class: 'paper panel declass' },
        h('div', { class: 'stamp big declass-stamp' }, 'DECLASSIFIED'),
        h('h2', null, 'Where the bombers were hit'),
        h('div', { class: 'composite-row three' },
          h('figure', null, aircraftCanvas('medium', { side: sideId, style: 'blueprint', hits: surv, dots: true }, 4), h('figcaption', null, `What you saw: ${surv.length} holes on aircraft that returned.`)),
          h('figure', null, aircraftCanvas('medium', { side: sideId, style: 'blueprint', hits: lost, dots: true, dotColor: '#5a5040' }, 4), h('figcaption', null, `What you never saw: ${lost.length} holes on aircraft that did not return.`)),
          h('figure', null, aircraftCanvas('medium', { side: sideId, style: 'blueprint', hits: fatal, dots: true, dotColor: '#d02020' }, 4), h('figcaption', null, `The ${fatal.length} hits that brought them down.`)),
        ),
      ),
      h('section', { class: 'paper panel' },
        h('h2', null, 'Chance that a single hit brings an aircraft down (unarmored)'),
        ZONES.map((z) => h('div', { class: 'bar-row' }, h('span', null, ZONE_LABEL[z]), h('span', { class: 'bar red' }, h('i', { style: `width:${Math.round((ZONE_LETHALITY[z] / maxL) * 100)}%` })), h('span', null, `${Math.round(ZONE_LETHALITY[z] * 100)}%`))),
        h('p', { class: 'handwritten' }, 'The holes in the returning aircraft show where an aircraft can be hit and still come home.'),
      ),
    );
  } else if (tab === 'ledger') {
    body = h('section', { class: 'paper panel' },
      h('h2', null, 'Claims against the truth, week by week'),
      h('table', { class: 'ledger' },
        h('thead', null, h('tr', null, ['Week', 'Crews claimed', 'Reported to HQ', 'Actually destroyed', 'Our losses', 'Front'].map((x) => h('th', null, x)))),
        h('tbody', null, st.archive.map((e) => h('tr', null,
          h('td', null, String(e.turn)), h('td', null, String(e.claimed[sideId])), h('td', null, String(e.reportedToHq[sideId])),
          h('td', { class: 'truth' }, String(e.trueKills[sideId])), h('td', null, String(e.trueLosses[sideId])),
          h('td', null, String(sideId === 0 ? e.front : -e.front)),
        ))),
      ),
    );
  } else {
    body = h('section', { class: 'paper panel end-summary' },
      h('div', { class: `stamp big outcome ${outcome}` }, title),
      h('p', { class: 'typed big' }, text),
      h('div', { class: 'stats' },
        h('div', null, h('span', null, 'Weeks of operations'), h('b', null, String(st.archive.length))),
        h('div', null, h('span', null, 'Aircraft lost'), h('b', null, String(trueLost))),
        h('div', null, h('span', null, 'Enemy aircraft claimed by crews'), h('b', null, String(claimed))),
        h('div', null, h('span', null, 'Enemy aircraft reported to High Command'), h('b', null, String(toHq))),
        h('div', null, h('span', null, 'Enemy aircraft actually destroyed'), h('b', { class: 'truth' }, String(trueKills))),
      ),
      h('p', { class: 'muted' }, 'The archives are open. See "Declassified" for what your returning aircraft could never tell you.'),
    );
  }
  return h('div', { class: 'hq end' }, h('div', { class: 'hq-body' }, nav, h('main', { class: 'content' }, body)));
}
