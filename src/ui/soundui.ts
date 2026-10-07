import { isMuted, musicVolume, setMusicVolume, setMuted, setSfxVolume, sfxClick, sfxVolume } from './audio';
import { h, slider } from './dom';
import { tip } from './tip';

/** Music and effects volume, and the switch that silences both. */
export function soundPanel(onChange?: () => void): HTMLElement {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const row = (label: string, get: () => number, set: (v: number) => void, test?: () => void) => {
    const val = h('span', { class: 'snd-val' }, pct(get()));
    const s = slider(get(), (v) => { set(v); test?.(); }, '', '', 0.05, (v) => { set(v); val.textContent = pct(v); });
    return h('div', { class: 'snd-row' }, h('span', { class: 'snd-lbl' }, label), s, val);
  };
  const mute = h('button', { class: 'btn small snd-mute', onclick: () => { setMuted(!isMuted()); if (!isMuted()) sfxClick(); mute.textContent = isMuted() ? 'Sound: Off' : 'Sound: On'; onChange?.(); } }, isMuted() ? 'Sound: Off' : 'Sound: On');
  return h('div', { class: 'snd-panel' },
    row('Music', musicVolume, setMusicVolume),
    row('Effects', sfxVolume, setSfxVolume, sfxClick),
    mute);
}

/** A small speaker button for the top bar that opens the volume controls. */
export function soundButton(): HTMLElement {
  const wrap = h('div', { class: 'snd-wrap' });
  const pop = h('div', { class: 'snd-pop' }, soundPanel(() => btn.classList.toggle('off', isMuted())));
  const btn = h('button', { class: `snd-btn ${isMuted() ? 'off' : ''}`, ...tip({ head: 'Sound', text: 'Music and effects volume.' }), onclick: (e: Event) => { e.stopPropagation(); wrap.classList.toggle('open'); } }, '♪');
  // Close when the player clicks anywhere else.
  const close = (e: Event) => {
    if (!wrap.isConnected) return document.removeEventListener('pointerdown', close);
    if (!wrap.contains(e.target as Node)) wrap.classList.remove('open');
  };
  document.addEventListener('pointerdown', close);
  wrap.append(btn, pop);
  return wrap;
}
