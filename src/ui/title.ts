import type { App } from './app';
import { AUTOSAVE } from './app';
import { sfxClick } from './audio';
import { soundPanel } from './soundui';
import { animOn, h, setAnim } from './dom';
import { titleScene } from './scene';
import { storage } from './storage';
import { chosen, chosenFactions, nationPicker, nationToggle } from './nation';
import { NATIONS } from '../core/factions';

let menu: 'main' | 'new' | 'load' | 'hotseat' | 'sound' = 'main';
let saves: { slot: string; modified: number }[] = [];
/** Names typed for hotseat, kept while the nations are changed. */
const names: [string, string] = ['', ''];

export function renderTitle(app: App): HTMLElement {
  const scene = titleScene();
  const panel = h('div', { class: 'title-menu' });
  const refresh = () => {
    panel.replaceChildren(...menuItems());
  };
  const btn = (label: string, onclick: () => void, cls = '') =>
    h('button', { class: `btn menu ${cls}`, onclick: () => { sfxClick(); onclick(); } }, label);

  const menuItems = (): HTMLElement[] => {
    if (menu === 'new') {
      return [
        h('div', { class: 'menu-head' }, 'Choose the war'),
        ...(chosen.on ? [nationPicker(0, 'Your nation:', refresh), nationPicker(1, 'The enemy:', refresh)] : []),
        nationToggle(refresh),
        h('div', { class: 'menu-head' }, 'Select the enemy staff'),
        btn('Green', () => { menu = 'main'; app.newGame('single', 0.15, undefined, chosenFactions()); }),
        h('div', { class: 'menu-note' }, 'Enemy staff armor what their survivors show them.'),
        btn('Seasoned', () => { menu = 'main'; app.newGame('single', 0.45, undefined, chosenFactions()); }),
        h('div', { class: 'menu-note' }, 'Enemy staff are learning to read their losses.'),
        btn('Wald', () => { menu = 'main'; app.newGame('single', 0.9, undefined, chosenFactions()); }),
        h('div', { class: 'menu-note' }, 'The enemy has a statistician. Good luck.'),
        btn('Back', () => { menu = 'main'; refresh(); }, 'small'),
      ];
    }
    if (menu === 'hotseat') {
      const nat = chosenFactions() ?? ['aldmere', 'directorate'];
      const n0 = h('input', { class: 'name-input', maxlength: '40', placeholder: `${NATIONS[nat[0]].title} …`, value: names[0] }) as HTMLInputElement;
      const n1 = h('input', { class: 'name-input', maxlength: '40', placeholder: `${NATIONS[nat[1]].title} …`, value: names[1] }) as HTMLInputElement;
      n0.oninput = () => { names[0] = n0.value; };
      n1.oninput = () => { names[1] = n1.value; };
      return [
        h('div', { class: 'menu-head' }, 'Two commanders, one table'),
        ...(chosen.on ? [nationPicker(0, 'First commander\'s nation:', refresh)] : []),
        h('label', { class: 'menu-note' }, `Commanding the ${NATIONS[nat[0]].short} wing:`), n0,
        ...(chosen.on ? [nationPicker(1, 'Second commander\'s nation:', refresh)] : []),
        h('label', { class: 'menu-note' }, `Commanding the ${NATIONS[nat[1]].short} wing:`), n1,
        nationToggle(refresh),
        h('div', { class: 'menu-note' }, 'You plan in turn behind closed folders; the battle is fought once both orders are sealed. Press Esc at any time to close your folder.'),
        btn('Begin the war', () => { menu = 'main'; app.newGame('hotseat', 0.4, [n0.value || NATIONS[nat[0]].title, n1.value || NATIONS[nat[1]].title], chosenFactions()); }, 'primary'),
        btn('Back', () => { menu = 'main'; refresh(); }, 'small'),
      ];
    }
    if (menu === 'sound') {
      return [
        h('div', { class: 'menu-head' }, 'Sound & music'),
        soundPanel(),
        btn('Back', () => { menu = 'main'; refresh(); }, 'small'),
      ];
    }
    if (menu === 'load') {
      const items: HTMLElement[] = [h('div', { class: 'menu-head' }, 'Saved campaigns')];
      if (saves.length === 0) items.push(h('div', { class: 'menu-note' }, 'No saved campaigns.'));
      for (const s of saves.slice(0, 6)) {
        items.push(btn(`${s.slot === AUTOSAVE ? 'Autosave' : s.slot} — ${s.modified ? new Date(s.modified).toLocaleString() : ''}`, () => { menu = 'main'; void app.loadSlot(s.slot); }, 'small'));
      }
      items.push(btn('Back', () => { menu = 'main'; refresh(); }, 'small'));
      return items;
    }
    const hasSave = saves.some((s) => s.slot === AUTOSAVE);
    const items = [
      btn('New Campaign', () => { menu = 'new'; refresh(); }, hasSave ? '' : 'primary'),
      btn('Tutorial', () => { menu = 'main'; app.newTutorial(); }),
      btn('Hotseat: two commanders', () => { menu = 'hotseat'; refresh(); }),
      btn('LAN / Direct IP', () => app.go({ kind: 'lanSetup' })),
    ];
    if (hasSave) items.unshift(btn('Continue', () => void app.loadSlot(AUTOSAVE), 'primary'));
    items.push(btn('Load Campaign', () => { menu = 'load'; refresh(); }));
    items.push(btn('Sound & music', () => { menu = 'sound'; refresh(); }, 'small'));
    items.push(btn(animOn() ? 'Animations: On' : 'Animations: Off', () => { setAnim(!animOn()); refresh(); }, 'small'));
    if (window.sbNative) items.push(btn('Quit to Desktop', () => window.sbNative!.quit(), 'small'));
    return items;
  };

  void storage.list().then((s) => {
    saves = s;
    refresh();
  });
  refresh();

  return h(
    'div',
    { class: 'title-screen' },
    scene,
    h('div', { class: 'title-overlay' },
      h('div', { class: 'title-col' },
        h('div', { class: 'logo' },
          h('div', { class: 'logo-small' }, 'A war fought on paper'),
          h('h1', { class: 'logo-main' }, 'SURVIVOR', h('br'), 'BIAS'),
          h('div', { class: 'logo-quote' }, '"Armor the places where the returning aircraft were not hit."'),
        ),
        panel),
    ),
    h('div', { class: 'title-foot' }, 'v0.1 · NoRiceStudios · F11 fullscreen'),
  );
}
