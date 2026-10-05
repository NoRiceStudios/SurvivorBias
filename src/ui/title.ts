import type { App } from './app';
import { AUTOSAVE } from './app';
import { isMuted, setMuted, sfxClick } from './audio';
import { h } from './dom';
import { titleScene } from './scene';
import { storage } from './storage';

let menu: 'main' | 'new' | 'load' = 'main';
let saves: { slot: string; modified: number }[] = [];

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
        h('div', { class: 'menu-head' }, 'Select the enemy'),
        btn('Green', () => { menu = 'main'; app.newGame('single', 0.15); }),
        h('div', { class: 'menu-note' }, 'Enemy staff armor what their survivors show them.'),
        btn('Seasoned', () => { menu = 'main'; app.newGame('single', 0.45); }),
        h('div', { class: 'menu-note' }, 'Enemy staff are learning to read their losses.'),
        btn('Wald', () => { menu = 'main'; app.newGame('single', 0.9); }),
        h('div', { class: 'menu-note' }, 'The enemy has a statistician. Good luck.'),
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
    const items = [
      btn('New Campaign', () => { menu = 'new'; refresh(); }),
      btn('Two Commanders (Hotseat)', () => app.newGame('hotseat')),
    ];
    if (saves.some((s) => s.slot === AUTOSAVE)) items.unshift(btn('Continue', () => void app.loadSlot(AUTOSAVE), 'primary'));
    items.push(btn('Load Campaign', () => { menu = 'load'; refresh(); }));
    items.push(btn(isMuted() ? 'Sound: Off' : 'Sound: On', () => { setMuted(!isMuted()); refresh(); }, 'small'));
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
      h('div', { class: 'logo' },
        h('div', { class: 'logo-small' }, 'A war fought on paper'),
        h('h1', { class: 'logo-main' }, 'SURVIVOR', h('br'), 'BIAS'),
        h('div', { class: 'logo-quote' }, '"Armor the places where the returning aircraft were not hit."'),
      ),
      panel,
    ),
    h('div', { class: 'title-foot' }, 'v0.1 · NoRiceStudios · F11 fullscreen'),
  );
}
