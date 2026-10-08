/**
 * The tutorial: the adjutant walks a new commander through the first weeks of
 * a Green campaign. Each step is shown on one screen, points at one element
 * and either waits for "Next" or for the player to do the thing it asks.
 * Progress is kept in the save (state.tutorial), so it survives a reload.
 */
import type { App, Screen } from './app';
import { sfxClick } from './audio';
import { h } from './dom';
import { portraitCanvas } from './general';

interface Step {
  /** The screen this step belongs to. */
  where: (s: Screen) => boolean;
  /** CSS selector of the element to point at. */
  target?: string;
  title: string;
  text: string;
  /** Advance on its own once this is true; otherwise the card shows "Next". */
  done?: (app: App) => boolean;
}

const hq = (tab?: string) => (s: Screen) => s.kind === 'hq' && (!tab || s.tab === tab);
const debrief = (tab?: string) => (s: Screen) => s.kind === 'debrief' && (!tab || s.tab === tab);

const STEPS: Step[] = [
  {
    where: hq('war'),
    title: 'Welcome to No. 7 Wing, sir',
    text: 'You command a wing of bombers and fighters for the rest of the war. Each week you plan one operation, read what your crews say happened, and report to High Command. Be warned: almost nothing you are told is the whole truth.',
  },
  {
    where: hq('war'),
    target: '.map-card',
    title: 'The War Room',
    text: 'This is the theater. Take two sectors from the enemy to win it. The gauge under the map is the pressure on the front: the needle has to reach the end to take a sector. Hover over anything for details.',
  },
  {
    where: hq('war'),
    target: '.orders-col',
    title: 'Orders for the week',
    text: 'Pick a mission at the top: strike a site (or just click one on the map), close support for the army, or a fighter sweep. Below, give every squadron its task. Your first directive asks for a strike, so the target is already picked.',
  },
  {
    where: hq('war'),
    target: '.intray',
    title: 'Requests and directives',
    text: 'Squadron leaders bring requests; approving costs little, but their advice is only as good as they are. High Command sets you directives and judges you on the returns you send in, not on what really happened.',
  },
  {
    where: hq(),
    target: '.resources',
    title: 'Your resources',
    text: 'Supplies pay for armor, aircraft, training and research. Stores (fuel and munitions) are used by every aircraft that flies. When a figure changes, it flashes with the change.',
  },
  {
    where: hq(),
    target: '.readiness',
    title: 'Ready to launch',
    text: 'The bar below shows the plan in one line, and my warnings as chips: click one and I will take you to the problem. When you are ready, launch the operation.',
    done: (app) => app.screen.kind === 'radio',
  },
  {
    where: (s) => s.kind === 'radio',
    target: '.radio-right',
    title: 'The operations room',
    text: 'This is the radio traffic as it was heard. Your old HF sets lose many calls in the static. VHF sets (Works, Development) let you hear far more, including the last words of crews who do not come back. Continue when the log is done.',
    done: (app) => app.screen.kind === 'debrief',
  },
  {
    where: debrief('returns'),
    target: '.damage-hero',
    title: 'The damage board',
    text: 'Every dot is a hole in an aircraft that came back. On the right, the ones that did not: their damage was never recorded. The ground crew will tell you to put armor where the holes are. Before you do, ask yourself which aircraft you are not seeing.',
  },
  {
    where: debrief(),
    target: '[data-tab="reports"]',
    title: 'Squadron reports',
    text: 'Go on to the reports (the button below does the same).',
    done: (app) => app.screen.kind === 'debrief' && app.screen.tab === 'reports',
  },
  {
    where: debrief('reports'),
    target: '.report',
    title: 'Form 541',
    text: 'Each squadron leader reports what his crews believe: kills, damage, the fighters they saw. Some boast, some despair, and frightened crews see double. My note in the margin says how each one tends to report. On the right, the front: how the week moved the needle.',
  },
  {
    where: debrief('reports'),
    title: 'File your reports',
    text: 'When you have read everything, file your reports. High Command will answer them, then the next week begins.',
    done: (app) => app.screen.kind === 'hq' || app.screen.kind === 'letter',
  },
  {
    where: (s) => s.kind === 'paper',
    target: '.np-home',
    title: 'The morning paper',
    text: 'The papers print the returns you send to High Command, never the truth, and our losses are always "light". A cheerful public buys war bonds, which means more supplies, but it also expects more, and High Command asks for it. Fold the paper when you have read it.',
    done: (app) => app.screen.kind === 'hq',
  },
  {
    where: hq(),
    target: '[data-tab="squadrons"]',
    title: 'The squadrons',
    text: 'Open Squadrons.',
    done: (app) => app.screen.kind === 'hq' && app.screen.tab === 'squadrons',
  },
  {
    where: hq('squadrons'),
    target: '.armor-editor',
    title: 'Where to put the armor',
    text: 'Click a part of the aircraft to plate it, right-click to take a plate off. Armor is heavy, so each type carries only a few. Your ground crew and your leaders will have firm opinions about where it belongs. Think about what the red dots can show you, and what they cannot.',
  },
  {
    where: hq('squadrons'),
    target: '.doctrine',
    title: 'Doctrine',
    text: 'How the squadron flies: formation, height, aggression, when to turn back. Drag a slider and the table shows what the change would do before you let go.',
  },
  {
    where: hq(),
    title: 'Carry on, sir',
    text: 'That is the essentials. Works builds aircraft, trains crews and develops new equipment; Intelligence collects what we think we know about the enemy. The war is yours now.',
  },
];

export function tutorialActive(app: App): boolean {
  return app.state?.tutorial !== undefined && app.state.mode === 'single';
}

function finish(app: App) {
  if (app.state) delete app.state.tutorial;
  void app.save();
  app.render();
}

/** Called after every render: advance finished steps, then draw the current one. */
export function renderTutorial(app: App) {
  document.getElementById('tutorial')?.remove();
  for (const el of document.querySelectorAll('.tut-target')) el.classList.remove('tut-target');
  if (!tutorialActive(app)) return;
  const st = app.state!;
  let step = STEPS[st.tutorial!];
  // Steps the player has already done move on by themselves.
  while (step?.done?.(app)) {
    st.tutorial!++;
    step = STEPS[st.tutorial!];
  }
  if (!step) return finish(app);
  if (!step.where(app.screen)) return;
  const target = step.target ? document.querySelector<HTMLElement>(step.target) : null;
  target?.classList.add('tut-target');
  target?.scrollIntoView({ block: 'nearest' });
  const last = st.tutorial === STEPS.length - 1;
  const card = h('div', { id: 'tutorial', class: 'tutorial-card paper' },
    h('div', { class: 'tut-body' },
      portraitCanvas('adjutant', 0, 2),
      h('div', null,
        h('div', { class: 'tut-from' }, `Adjutant · ${st.tutorial! + 1}/${STEPS.length}`),
        h('h3', null, step.title),
        h('p', null, step.text))),
    h('div', { class: 'tut-actions' },
      h('button', { class: 'btn small choice', onclick: () => { sfxClick(); finish(app); } }, 'Skip tutorial'),
      step.done ? h('span', { class: 'muted small' }, 'Waiting for you, sir…') : h('button', { class: 'btn small primary', onclick: () => {
        sfxClick();
        if (last) return finish(app);
        st.tutorial!++;
        app.render();
      } }, last ? 'Dismissed' : 'Next ▸'),
    ),
  );
  document.body.append(card);
}
