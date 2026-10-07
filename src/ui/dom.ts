/** Tiny DOM helpers. No framework: screens re-render on state change. */

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string; onclick?: (e: MouseEvent) => void };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'style') {
        el.setAttribute('style', String(v));
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Meter rendered as pixel blocks. */
export function meter(value: number, max = 1, cells = 10, cls = ''): HTMLElement {
  const n = Math.round((Math.max(0, Math.min(max, value)) / max) * cells);
  const m = h('span', { class: `meter ${cls}`, title: `${Math.round((value / max) * 100)}%` });
  for (let i = 0; i < cells; i++) m.append(h('i', { class: i < n ? 'on' : '' }));
  return m;
}

/** A 0..1 range input. `onInput` fires while dragging (previews), `onChange` when released. */
export function slider(value: number, onChange: (v: number) => void, left: string, right: string, step = 0.05, onInput?: (v: number) => void): HTMLElement {
  const input = h('input', { type: 'range', min: '0', max: '1', step: String(step), value: String(value) }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(Number(input.value)));
  if (onInput) input.addEventListener('input', () => onInput(Number(input.value)));
  return h('div', { class: 'slider' }, h('span', { class: 'lbl' }, left), input, h('span', { class: 'lbl' }, right));
}

/** "1 hole", "3 holes". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** The player's choice to skip animations (kept in this browser only). */
export function animOn(): boolean {
  try {
    return localStorage.getItem('sb-anim') !== 'off';
  } catch {
    return true;
  }
}

export function setAnim(on: boolean) {
  try {
    localStorage.setItem('sb-anim', on ? 'on' : 'off');
  } catch {
    /* private window: the choice lasts for this session only */
  }
  document.body.classList.toggle('noanim', !on);
}

/**
 * A scrolling region inside a sheet says when there is more below: the holder
 * gets the class "more" (a paper fade and a "more ▾" cue in CSS) until the end
 * is in view. Content that grows (typed text) is checked again as it grows.
 */
export function fadeScroll(scroller: HTMLElement, holder: HTMLElement = scroller): void {
  const check = () => holder.classList.toggle('more', scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 8);
  scroller.addEventListener('scroll', check);
  let waited = 0;
  const timer = window.setInterval(() => {
    if (!scroller.isConnected) {
      if (++waited > 3) window.clearInterval(timer);
      return;
    }
    waited = 0;
    check();
  }, 300);
  setTimeout(check, 0);
}

/** A figure that counts up from 0 after a delay (at once when animations are off). */
export function countUp(value: number, delay = 300, cls = '', duration = 550, onDone?: () => void): HTMLElement {
  const b = h('b', { class: cls }, animOn() ? '0' : String(value));
  if (!animOn()) {
    onDone && setTimeout(onDone, 0);
    return b;
  }
  // Driven by the clock, not by counting timer ticks: a busy page shows the right figure on time.
  const start = performance.now() + delay;
  const frame = (now: number) => {
    const f = Math.max(0, Math.min(1, (now - start) / duration));
    b.textContent = String(Math.round(value * f));
    if (f < 1) requestAnimationFrame(frame);
    else onDone?.();
  };
  requestAnimationFrame(frame);
  return b;
}

/** Which option each segmented control had picked, keyed by its options (and their order on the page). */
export type SegMarks = Map<string, number>;

function segKeys(root: ParentNode): [string, HTMLElement, HTMLElement[]][] {
  const seen = new Map<string, number>();
  return [...root.querySelectorAll<HTMLElement>('.seg')].map((seg) => {
    const btns = [...seg.children].filter((b): b is HTMLElement => b.classList.contains('seg-btn'));
    const base = btns.map((b) => b.textContent).join('|');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return [`${base}#${n}`, seg, btns];
  });
}

export function segMarks(root: ParentNode): SegMarks {
  return new Map(segKeys(root).map(([k, , btns]) => [k, btns.findIndex((b) => b.classList.contains('on'))]));
}

/** After a re-render, the pick in a segmented control slides over from the option it left. */
export function slideSegs(root: ParentNode, before: SegMarks): void {
  if (!animOn()) return;
  for (const [k, seg, btns] of segKeys(root)) {
    const was = before.get(k);
    const now = btns.findIndex((b) => b.classList.contains('on'));
    if (was === undefined || was < 0 || now < 0 || was === now || !btns[was]) continue;
    const from = btns[was];
    const to = btns[now];
    const box = (b: HTMLElement) => `left:${b.offsetLeft}px;top:${b.offsetTop}px;width:${b.offsetWidth}px;height:${b.offsetHeight}px`;
    const ind = h('i', { class: 'seg-ind', style: box(from) });
    seg.append(ind);
    to.classList.add('arriving');
    requestAnimationFrame(() => { ind.style.cssText = box(to); });
    setTimeout(() => { ind.remove(); to.classList.remove('arriving'); }, 130);
  }
}

/** A copy of an element for a parting animation; canvases keep their pictures. */
export function cloneWithCanvases<T extends HTMLElement>(el: T): T {
  const clone = el.cloneNode(true) as T;
  const from = el.querySelectorAll('canvas');
  const to = clone.querySelectorAll('canvas');
  from.forEach((c, i) => {
    const d = to[i] as HTMLCanvasElement;
    d.width = c.width;
    d.height = c.height;
    d.getContext('2d')?.drawImage(c, 0, 0);
  });
  return clone;
}
