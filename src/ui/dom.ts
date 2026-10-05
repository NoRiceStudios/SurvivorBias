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

export function slider(value: number, onChange: (v: number) => void, left: string, right: string, step = 0.05): HTMLElement {
  const input = h('input', { type: 'range', min: '0', max: '1', step: String(step), value: String(value) }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(Number(input.value)));
  return h('div', { class: 'slider' }, h('span', { class: 'lbl' }, left), input, h('span', { class: 'lbl' }, right));
}
