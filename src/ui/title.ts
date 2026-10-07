import type { App } from './app';
import { AUTOSAVE } from './app';
import { isMuted, setMuted, sfxClick } from './audio';
import { animOn, h, setAnim } from './dom';
import { titleScene } from './scene';
import { storage } from './storage';
import { FACTION_IDS, FACTIONS } from '../core/factions';
import type { FactionId } from '../core/types';

let menu: 'main' | 'faction' | 'new' | 'load' | 'hotseat' = 'main';
/** The air force chosen for a new single-player campaign. */
let chosen: FactionId | 'random' = 'random';

/** A drop-down of the air forces, with what each is good and bad at as its tooltip. */
export function factionSelect(): HTMLSelectElement {
  return h('select', { class: 'faction-select' },
    h('option', { value: 'random' }, 'Air force: drawn by lot'),
    FACTION_IDS.map((id) => h('option', { value: id, title: `${FACTIONS[id].strengths.join('; ')}. But: ${FACTIONS[id].weaknesses.join('; ')}.` }, `${FACTIONS[id].name}: ${FACTIONS[id].motto}`))) as HTMLSelectElement;
}
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
    if (menu === 'faction') {
      return [
        h('div', { class: 'menu-head' }, 'Choose your air force'),
        ...FACTION_IDS.flatMap((id) => [
          btn(FACTIONS[id].name, () => { chosen = id; menu = 'new'; refresh(); }),
          h('div', { class: 'menu-note faction-note' }, h('i', null, FACTIONS[id].motto), ' ', h('span', { class: 'good' }, `+ ${FACTIONS[id].strengths.join(' · ')}`), h('br'), h('span', { class: 'bad' }, `− ${FACTIONS[id].weaknesses.join(' · ')}`)),
        ]),
        btn('Drawn by lot', () => { chosen = 'random'; menu = 'new'; refresh(); }, 'small'),
        btn('Back', () => { menu = 'main'; refresh(); }, 'small'),
      ];
    }
    if (menu === 'new') {
      const f: [FactionId | 'random', 'random'] = [chosen, 'random'];
      return [
        h('div', { class: 'menu-head' }, 'Select the enemy'),
        h('div', { class: 'menu-note' }, `Your air force: ${chosen === 'random' ? 'drawn by lot' : FACTIONS[chosen].name}. The enemy's is drawn by lot.`),
        btn('Green', () => { menu = 'main'; app.newGame('single', 0.15, undefined, f); }),
        h('div', { class: 'menu-note' }, 'Enemy staff armor what their survivors show them.'),
        btn('Seasoned', () => { menu = 'main'; app.newGame('single', 0.45, undefined, f); }),
        h('div', { class: 'menu-note' }, 'Enemy staff are learning to read their losses.'),
        btn('Wald', () => { menu = 'main'; app.newGame('single', 0.9, undefined, f); }),
        h('div', { class: 'menu-note' }, 'The enemy has a statistician. Good luck.'),
        btn('Back', () => { menu = 'faction'; refresh(); }, 'small'),
      ];
    }
    if (menu === 'hotseat') {
      const n0 = h('input', { class: 'name-input', maxlength: '40', placeholder: 'Air Commodore …', value: '' }) as HTMLInputElement;
      const n1 = h('input', { class: 'name-input', maxlength: '40', placeholder: 'Oberst …', value: '' }) as HTMLInputElement;
      const f0 = factionSelect();
      const f1 = factionSelect();
      return [
        h('div', { class: 'menu-head' }, 'Two commanders, one table'),
        h('label', { class: 'menu-note' }, 'Commanding the Aldmere wing:'), n0, f0,
        h('label', { class: 'menu-note' }, 'Commanding the Directorate wing:'), n1, f1,
        h('div', { class: 'menu-note' }, 'You plan in turn behind closed folders; the battle is fought once both orders are sealed. Press Esc at any time to close your folder.'),
        btn('Begin the war', () => { menu = 'main'; app.newGame('hotseat', 0.4, [n0.value || 'Air Commodore', n1.value || 'Oberst'], [f0.value as FactionId | 'random', f1.value as FactionId | 'random']); }, 'primary'),
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
      btn('New Campaign', () => { menu = 'faction'; refresh(); }, hasSave ? '' : 'primary'),
      btn('Tutorial', () => { menu = 'main'; app.newTutorial(); }),
      btn('Hotseat: two commanders', () => { menu = 'hotseat'; refresh(); }),
      btn('LAN / Direct IP', () => app.go({ kind: 'lanSetup' })),
    ];
    if (hasSave) items.unshift(btn('Continue', () => void app.loadSlot(AUTOSAVE), 'primary'));
    items.push(btn('Load Campaign', () => { menu = 'load'; refresh(); }));
    items.push(btn(isMuted() ? 'Sound: Off' : 'Sound: On', () => { setMuted(!isMuted()); refresh(); }, 'small'));
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
