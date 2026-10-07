/** LAN setup (host or join) and the "waiting for the other commander" screen. */
import { startCampaign } from '../core/game';
import type { FactionId } from '../core/types';
import { factionSelect } from './title';
import { defaultPlan } from '../core/plans';
import type { SideId } from '../core/types';
import type { App } from './app';
import { sfxClick, sfxStamp } from './audio';
import { h } from './dom';
import { DEFAULT_PORT, LanSession } from './lan';
import { topBar } from './hq';
import { ordersOverview } from './orders';

let connecting = false;

export function renderLanSetup(app: App): HTMLElement {
  const api = window.sbNative?.lan;
  const back = h('button', { class: 'btn small', onclick: () => { app.endLan(); connecting = false; app.go({ kind: 'title' }); } }, 'Back');
  if (!api) {
    return h('div', { class: 'handover' }, h('div', { class: 'handover-card paper' },
      h('h1', null, 'LAN / Direct IP'),
      h('p', null, 'Network play needs the desktop version of the game.'),
      back));
  }
  const hostName = h('input', { class: 'name-input', maxlength: '40', placeholder: 'Air Commodore …' }) as HTMLInputElement;
  const hostFaction = factionSelect();
  const hostPort = h('input', { class: 'name-input port', value: String(DEFAULT_PORT), inputmode: 'numeric' }) as HTMLInputElement;
  const joinName = h('input', { class: 'name-input', maxlength: '40', placeholder: 'Oberst …' }) as HTMLInputElement;
  const joinAddr = h('input', { class: 'name-input', placeholder: '192.168.1.20', value: '' }) as HTMLInputElement;
  const joinPort = h('input', { class: 'name-input port', value: String(DEFAULT_PORT), inputmode: 'numeric' }) as HTMLInputElement;

  const doHost = async () => {
    sfxClick();
    app.endLan();
    const session = new LanSession(app, 'host', api, Number(hostPort.value) || DEFAULT_PORT);
    if (!(await session.host())) return;
    app.lan = session;
    app.state = startCampaign({ mode: 'lan', seed: `${Date.now()}`, commanders: [hostName.value || 'Air Commodore', 'Oberst'], factions: [hostFaction.value as FactionId | 'random', 'random'] });
    app.plans = [defaultPlan(app.state, 0), defaultPlan(app.state, 1)];
    app.pendingCommands = [[], []];
    await app.save();
    sfxStamp();
    app.go({ kind: 'hq', side: 0, tab: 'briefing' });
  };
  const doJoin = async () => {
    sfxClick();
    if (!joinAddr.value.trim()) {
      app.toast('Enter the host\'s address', true);
      return;
    }
    app.endLan();
    const session = new LanSession(app, 'client', api, Number(joinPort.value) || DEFAULT_PORT);
    app.lan = session;
    connecting = true;
    app.render();
    if (!(await session.join(joinAddr.value.trim(), joinName.value || 'Oberst'))) {
      app.endLan();
      connecting = false;
      app.render();
    }
    // The host's welcome message moves us on to the briefing.
  };

  return h('div', { class: 'handover' },
    h('div', { class: 'handover-card paper lan-setup' },
      h('div', { class: 'stamp big' }, 'MOST SECRET'),
      h('h1', null, 'Two commanders, two tables'),
      h('p', { class: 'muted' }, 'One player hosts and commands the Aldmere wing; the other joins over the network and commands the Directorate. You plan at the same time; the week is fought when both have sealed their orders.'),
      connecting && app.lan?.role === 'client'
        ? h('p', { class: 'handwritten' }, app.lan.status || 'Connecting…')
        : h('div', { class: 'grid2 lan-forms' },
          h('div', { class: 'col' },
            h('h2', null, 'Host a game'),
            h('label', { class: 'small' }, 'Your name (Aldmere)'), hostName, hostFaction,
            h('label', { class: 'small' }, 'Port'), hostPort,
            h('button', { class: 'btn primary', onclick: () => void doHost() }, 'Host'),
            h('p', { class: 'muted small' }, 'The other player needs your address and port. Both are shown at the top of your screen once the game starts. Over the internet the port must be forwarded on your router.'),
          ),
          h('div', { class: 'col' },
            h('h2', null, 'Join a game'),
            h('label', { class: 'small' }, 'Your name (Directorate)'), joinName,
            h('label', { class: 'small' }, 'Host address'), joinAddr,
            h('label', { class: 'small' }, 'Port'), joinPort,
            h('button', { class: 'btn primary', onclick: () => void doJoin() }, 'Join'),
          ),
        ),
      back,
    ),
  );
}

export function renderLanWait(app: App, side: SideId): HTMLElement {
  const st = app.state!;
  const other = st.sides[(1 - side) as SideId];
  const lan = app.lan;
  const canAmend = !!lan && (lan.role === 'host' || (lan.connected && !lan.unsealing));
  return h('div', { class: 'hq sealed-screen' },
    topBar(app, st.sides[side]),
    h('main', { class: 'content sealed-body', 'data-keep-scroll': 'lanwait' },
      h('section', { class: 'paper panel' },
        h('div', { class: 'sealed-title' }, h('span', { class: 'stamp big' }, 'ORDERS SEALED'), h('h1', null, `Week ${st.turn}: your orders`)),
        h('p', { class: 'handwritten' }, lan?.unsealing
          ? 'Asking the host to return your orders…'
          : lan?.connected
            ? `Waiting for ${other.commander} to seal their orders. The week will be fought as soon as they do; until then you can still amend yours.`
            : lan?.role === 'host'
              ? `Waiting for the other commander to connect${lan.addresses.length ? ` to ${lan.addresses.join(' or ')}:${lan.port}` : ''}.`
              : 'The connection to the host has been lost. Return to the menu and join again; your sealed orders are safe with the host.'),
        lan?.status ? h('p', { class: 'muted small' }, lan.status) : null,
        ordersOverview(app, side),
      ),
    ),
    h('div', { class: 'launchbar' },
      h('div', { class: 'launch-summary' }, h('button', { class: 'btn', disabled: !canAmend, onclick: () => { sfxClick(); app.unseal(side); } }, '◂ Amend orders')),
      h('button', { class: 'btn small', onclick: () => { void app.save().then(() => { app.endLan(); app.go({ kind: 'title' }); }); } }, 'Main Menu'),
    ),
  );
}
