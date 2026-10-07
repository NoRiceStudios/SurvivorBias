/**
 * Tooltips: a paper slip that follows the pointer. Any element with `data-tip`
 * gets one; `data-tip-head` adds a title line, `data-tip-effect` a green or red
 * effect line ("+" or "-" first), `data-tip-source` says how sure the figure is.
 * Canvases set these attributes as the pointer moves over them.
 */
import { h } from './dom';

let el: HTMLElement | null = null;
let bound = false;

export interface Tip {
  head?: string;
  text: string;
  effect?: string;
  source?: string;
}

/** Attributes for h(): { ...tip({ head, text }) }. */
export function tip(t: Tip | string): Record<string, string> {
  const o = typeof t === 'string' ? { text: t } : t;
  const a: Record<string, string> = { 'data-tip': o.text };
  if (o.head) a['data-tip-head'] = o.head;
  if (o.effect) a['data-tip-effect'] = o.effect;
  if (o.source) a['data-tip-source'] = o.source;
  return a;
}

export function setTip(target: HTMLElement, t: Tip | null) {
  for (const k of ['tip', 'tipHead', 'tipEffect', 'tipSource']) delete target.dataset[k];
  if (!t) return hideTip();
  target.dataset.tip = t.text;
  if (t.head) target.dataset.tipHead = t.head;
  if (t.effect) target.dataset.tipEffect = t.effect;
  if (t.source) target.dataset.tipSource = t.source;
}

function hideTip() {
  if (el) el.style.display = 'none';
}

function show(target: HTMLElement, x: number, y: number) {
  const d = target.dataset;
  if (!d.tip) return hideTip();
  if (!el) {
    el = h('div', { id: 'tip', class: 'tip paper' });
    document.body.append(el);
  }
  const eff = d.tipEffect;
  el.replaceChildren(
    ...(d.tipHead ? [h('div', { class: 'tip-head' }, d.tipHead)] : []),
    h('div', { class: 'tip-text' }, d.tip),
    ...(eff ? [h('div', { class: `tip-effect ${eff.startsWith('-') || eff.startsWith('−') ? 'bad' : 'good'}` }, `Effect: ${eff.replace(/^[+-]\s*/, '')}`)] : []),
    ...(d.tipSource ? [h('div', { class: 'tip-source' }, `Source: ${d.tipSource}`)] : []),
  );
  el.style.display = 'block';
  const r = el.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 16);
  const top = y + 18 + r.height > window.innerHeight ? y - r.height - 10 : y + 18;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

/** Install the global listeners once. */
export function bindTips() {
  if (bound) return;
  bound = true;
  document.addEventListener('mousemove', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (t) show(t, e.clientX, e.clientY);
    else hideTip();
  });
  document.addEventListener('mousedown', hideTip);
  document.addEventListener('scroll', hideTip, true);
}
