/**
 * Dispatches: a small animated officer delivers messages in a card anchored
 * bottom-right. Cards queue and show one at a time. Only the card itself takes
 * pointer events, so the rest of the screen (and automation) stays usable.
 */
import type { Memo, SideId, SideState } from '../core/types';
import { sfxClick, sfxKey } from './audio';
import { h } from './dom';

export type Speaker = 'general' | 'adjutant' | 'ministry';

/** One page of a dispatch: plain text, or text with a stamp and a sender line. */
export type DispatchLine = string | { text: string; stamp?: string; kind?: string; from?: string };

export interface Dispatch {
  speaker: Speaker;
  /** Whose officer speaks: 0 Aldmere (default), 1 the Directorate. */
  side?: SideId;
  name: string;
  title: string;
  /** Pages, typed out one at a time. Keep each to about three lines. */
  lines: DispatchLine[];
  /** Called once when the dispatch is read to the end or dismissed with Esc. */
  onClose?: () => void;
  /** Keep the card when the player changes screen (tutorials). Handovers always clear it. */
  persist?: boolean;
  /** Label of the last page's button (default "Understood"). */
  doneLabel?: string;
}

/** Anything with a `covered` flag (the App): keys are ignored while the hotseat cover is up. */
interface Host {
  covered?: boolean;
}

const queue: { host: Host | null; d: Dispatch }[] = [];
let card: HTMLElement | null = null;
let current: { host: Host | null; d: Dispatch; page: number; shown: number; text: string; done: boolean } | null = null;
let timer = 0;
let raf = 0;
let keysBound = false;

/** Queue a dispatch; it shows when the ones before it are read. */
export function showDispatch(app: Host | null, d: Dispatch) {
  if (!d.lines.length) return;
  queue.push({ host: app, d });
  bindKeys();
  if (!current) next();
}

/** True while a dispatch card is on screen or queued. */
export function dispatchesOpen(): boolean {
  return !!current || queue.length > 0;
}

/** Remove every dispatch without calling onClose. With `keepPersistent`, tutorial cards survive. */
export function clearDispatches(keepPersistent = false) {
  const keep = keepPersistent ? queue.filter((q) => q.d.persist) : [];
  queue.length = 0;
  queue.push(...keep);
  if (current && !(keepPersistent && current.d.persist)) {
    current = null;
    teardown();
    if (queue.length) next();
  }
}

function next() {
  const item = queue.shift();
  teardown();
  if (!item) {
    current = null;
    return;
  }
  current = { ...item, page: 0, shown: 0, text: '', done: false };
  build();
  startPage();
}

function teardown() {
  window.clearInterval(timer);
  cancelAnimationFrame(raf);
  card?.remove();
  card = null;
}

/** Click, Enter or Space: finish typing, then turn the page. */
function advance() {
  const c = current;
  if (!c) return;
  if (!c.done) {
    c.shown = c.text.length;
    c.done = true;
    paintText();
    return;
  }
  sfxClick();
  if (c.page + 1 < c.d.lines.length) {
    c.page++;
    startPage();
  } else close();
}

/** Close the current dispatch (all its pages) and show the next one. */
function close() {
  const c = current;
  if (!c) return;
  current = null;
  card?.classList.add('leaving');
  const old = card;
  card = null;
  window.clearInterval(timer);
  cancelAnimationFrame(raf);
  window.setTimeout(() => old?.remove(), 160);
  c.d.onClose?.();
  if (!current) next();
}

function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  // Capture phase: runs before the HQ's own Esc (folder cover) handler.
  window.addEventListener('keydown', (e) => {
    if (!current || current.host?.covered) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      sfxClick();
      close();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopImmediatePropagation();
      advance();
    }
  }, true);
}

/* ---------------- Card ---------------- */

let els: { text: HTMLElement; meta: HTMLElement; page: HTMLElement; btn: HTMLButtonElement; canvas: HTMLCanvasElement } | null = null;

function build() {
  const c = current!;
  const side = c.d.side ?? 0;
  const canvas = h('canvas', { class: 'pix dispatch-face', width: PW, height: PH });
  const text = h('div', { class: 'dispatch-text' });
  const meta = h('div', { class: 'dispatch-meta' });
  const page = h('span', { class: 'dispatch-page' });
  const btn = h('button', { class: 'btn small primary dispatch-btn', onclick: (e: MouseEvent) => { e.stopPropagation(); advance(); } }, 'Next ▸');
  card = h('div', { class: `dispatch paper side${side} speaker-${c.d.speaker}`, role: 'dialog', 'aria-live': 'polite', onclick: () => advance() },
    h('div', { class: 'dispatch-portrait' }, canvas, h('div', { class: 'dispatch-plate' }, c.d.speaker === 'adjutant' ? 'ADJUTANT' : c.d.speaker === 'ministry' ? 'MINISTRY' : 'HIGH COMMAND')),
    h('div', { class: 'dispatch-main' },
      h('div', { class: 'dispatch-head' }, h('div', { class: 'dispatch-name' }, c.d.name), h('div', { class: 'dispatch-title' }, c.d.title)),
      meta,
      text,
      h('div', { class: 'dispatch-foot' }, page, h('span', { class: 'dispatch-hint' }, 'Enter · Esc'), btn),
    ),
  );
  els = { text, meta, page, btn, canvas };
  document.body.append(card);
  animateFace(canvas, LOOKS[c.d.speaker][side]);
}

function startPage() {
  const c = current!;
  const line = c.d.lines[c.page];
  const obj = typeof line === 'string' ? { text: line } : line;
  c.text = obj.text;
  c.shown = 0;
  c.done = false;
  if (!els) return;
  els.meta.replaceChildren(
    ...(obj.stamp ? [h('span', { class: `stamp ${obj.kind ?? ''}` }, obj.stamp)] : []),
    ...(obj.from ? [h('span', { class: 'dispatch-from' }, obj.from)] : []),
  );
  els.meta.style.display = obj.stamp || obj.from ? '' : 'none';
  const last = c.page + 1 >= c.d.lines.length;
  els.btn.textContent = last ? (c.d.doneLabel ?? 'Understood') : 'Next ▸';
  els.page.textContent = c.d.lines.length > 1 ? `${c.page + 1} / ${c.d.lines.length}` : '';
  paintText();
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    const cc = current;
    if (!cc || cc.done) return window.clearInterval(timer);
    cc.shown = Math.min(cc.text.length, cc.shown + 2);
    const ch = cc.text[cc.shown - 1];
    if (ch && ch !== ' ' && cc.shown % 4 < 2) sfxKey();
    if (cc.shown >= cc.text.length) cc.done = true;
    paintText();
  }, 34);
}

function paintText() {
  const c = current;
  if (!c || !els) return;
  // The full text is laid out invisibly so the card never jumps as it types.
  els.text.replaceChildren(
    document.createTextNode(c.text.slice(0, c.shown)),
    h('span', { class: c.done ? 'caret done' : 'caret' }),
    h('span', { class: 'ghost' }, c.text.slice(c.shown)),
  );
}

/* ---------------- Portraits ---------------- */

const PW = 36;
const PH = 40;
const CX = 18;

interface Look {
  skin: [string, string, string];
  hair: string;
  hat: 'peaked' | 'tall' | 'sideCap' | 'bowler' | 'fedora';
  hatCol: [string, string, string];
  band: string;
  badge: string;
  braid?: boolean;
  tunic: [string, string, string];
  collar: 'open' | 'high' | 'wing';
  shirt: string;
  tie: string;
  tabs?: string;
  tache: 'walrus' | 'pencil' | 'none';
  medals: number;
  monocle?: boolean;
  specs?: boolean;
  aiguillette?: boolean;
  pinstripe?: boolean;
  wall: [string, string, string];
  old?: boolean;
}

const SKIN: [string, string, string] = ['#f0c49a', '#d9a27a', '#b07a58'];
const SKIN_PALE: [string, string, string] = ['#ecc8a8', '#d4a888', '#a87e62'];
const KHAKI: [string, string, string] = ['#958457', '#7a6a46', '#5b4e33'];
const SLATE: [string, string, string] = ['#7a8590', '#59636e', '#3e464f'];
const BLACKCAP: [string, string, string] = ['#4a4d55', '#2c2e34', '#1c1d22'];
const SUIT: [string, string, string] = ['#4e5058', '#36383f', '#25262b'];
const WALL0: [string, string, string] = ['#56603f', '#465034', '#3a432b'];
const WALL1: [string, string, string] = ['#57606a', '#474f58', '#3a4149'];

const LOOKS: Record<Speaker, [Look, Look]> = {
  general: [
    { skin: SKIN, hair: '#d8d2c2', hat: 'peaked', hatCol: KHAKI, band: '#a8332a', badge: '#d8b040', braid: true, tunic: KHAKI, collar: 'open', shirt: '#b8a77a', tie: '#5b4e33', tabs: '#a8332a', tache: 'walrus', medals: 3, wall: WALL0, old: true },
    { skin: SKIN_PALE, hair: '#8a8a84', hat: 'tall', hatCol: BLACKCAP, band: '#1c1d22', badge: '#d8b040', braid: true, tunic: SLATE, collar: 'high', shirt: '#e8e4d4', tie: '#1c1d22', tabs: '#d8b040', tache: 'none', medals: 2, monocle: true, wall: WALL1, old: true },
  ],
  adjutant: [
    { skin: SKIN, hair: '#5a3a22', hat: 'sideCap', hatCol: KHAKI, band: '#5b4e33', badge: '#c9a24a', tunic: KHAKI, collar: 'open', shirt: '#b8a77a', tie: '#5b4e33', tache: 'none', medals: 0, aiguillette: true, wall: WALL0 },
    { skin: SKIN_PALE, hair: '#c8a860', hat: 'sideCap', hatCol: SLATE, band: '#3e464f', badge: '#d8b040', tunic: SLATE, collar: 'high', shirt: '#e8e4d4', tie: '#1c1d22', tabs: '#d8b040', tache: 'none', medals: 0, aiguillette: true, wall: WALL1 },
  ],
  ministry: [
    { skin: SKIN_PALE, hair: '#9a9284', hat: 'bowler', hatCol: BLACKCAP, band: '#16171a', badge: '#16171a', tunic: SUIT, collar: 'wing', shirt: '#ece8da', tie: '#7c2a24', tache: 'pencil', medals: 0, specs: true, pinstripe: true, wall: ['#6a5a44', '#584a38', '#483c2e'], old: true },
    { skin: SKIN_PALE, hair: '#6a6258', hat: 'fedora', hatCol: ['#6a6a62', '#4e4e48', '#383834'], band: '#1c1d22', badge: '#1c1d22', tunic: SUIT, collar: 'wing', shirt: '#ece8da', tie: '#2c4672', tache: 'none', medals: 0, specs: true, pinstripe: true, wall: ['#5f6468', '#4c5155', '#3d4145'] },
  ],
};

/** Pixel grid with an automatic dark outline around everything drawn on it. */
class Grid {
  c: (string | null)[];
  constructor(public w: number, public h: number) {
    this.c = new Array(w * h).fill(null);
  }
  px(x: number, y: number, col: string) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.c[y * this.w + x] = col;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.c[y * this.w + x] : null;
  }
  row(y: number, x0: number, x1: number, col: string) {
    for (let x = x0; x <= x1; x++) this.px(x, y, col);
  }
  rect(x: number, y: number, w: number, h: number, col: string) {
    for (let yy = y; yy < y + h; yy++) this.row(yy, x, x + w - 1, col);
  }
  outline(col = '#16171a') {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * this.w + x);
      }
    for (const i of add) this.c[i] = col;
  }
  draw(g: CanvasRenderingContext2D, ox = 0, oy = 0) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const col = this.c[y * this.w + x];
        if (!col) continue;
        g.fillStyle = col;
        g.fillRect(ox + x, oy + y, 1, 1);
      }
  }
}

/** Face half-widths per row, from the crown (row 8) to the chin (row 26). */
const FACE: Record<number, number> = { 8: 5, 9: 6, 10: 7, 26: 3, 25: 4, 24: 5, 23: 6, 22: 6 };
const faceHalf = (y: number) => FACE[y] ?? (y > 10 && y < 22 ? 7 : 0);
const EYE_Y = 16;
const MOUTH_Y = 22;

function figure(L: Look): Grid {
  const g = new Grid(PW, PH);
  const [sh, sb, ss] = L.skin;
  const [th, tb, ts] = L.tunic;
  // Shoulders and tunic.
  const shoulder = [8, 12, 14, 16, 17, 17, 17, 17, 17, 17, 17];
  shoulder.forEach((hw, i) => {
    const y = 29 + i;
    g.row(y, CX - hw, CX + hw - 1, tb);
    g.px(CX - hw, y, th);
    g.px(CX + hw - 1, y, ts);
    if (hw > 13) g.px(CX + hw - 2, y, ts);
  });
  g.row(29, CX - 7, CX + 6, th);
  // Arm seams.
  for (let y = 33; y < PH; y++) {
    g.px(CX - 12, y, ts);
    g.px(CX + 11, y, ts);
  }
  if (L.pinstripe) for (let y = 31; y < PH; y++) for (let x = CX - 16; x < CX + 16; x += 3) if (g.get(x, y) === tb) g.px(x, y, th);
  // Neck.
  for (let y = 25; y <= 29; y++) g.row(y, CX - 3, CX + 2, ss);
  g.px(CX - 3, 27, sb);
  // Collar.
  if (L.collar === 'high') {
    for (let y = 26; y <= 30; y++) g.row(y, CX - 4 - (y - 26 > 2 ? 1 : 0), CX + 3 + (y - 26 > 2 ? 1 : 0), tb);
    g.row(26, CX - 4, CX + 3, th);
    g.px(CX - 1, 27, ts);
    g.px(CX, 27, ts);
    for (let y = 27; y <= 30; y++) g.px(CX - 1, y, ts);
    if (L.tabs) {
      g.rect(CX - 5, 28, 2, 2, L.tabs);
      g.rect(CX + 3, 28, 2, 2, L.tabs);
    }
    // Buttons down the front.
    for (let y = 32; y < PH; y += 3) g.px(CX - 1, y, L.badge === '#16171a' ? th : '#c9ced2');
  } else {
    // Open collar: shirt V and tie.
    for (let i = 0; i < 6; i++) g.row(28 + i, CX - 4 + i, CX + 3 - i, L.shirt);
    if (L.collar === 'wing') {
      g.px(CX - 3, 28, '#ffffff');
      g.px(CX + 2, 28, '#ffffff');
    }
    for (let y = 29; y < PH; y++) {
      g.px(CX - 1, y, L.tie);
      g.px(CX, y, L.tie);
    }
    g.px(CX - 1, 28, L.tie);
    g.px(CX, 28, L.tie);
    // Lapels.
    for (let i = 0; i < 9; i++) {
      g.px(CX - 5 + Math.min(i, 4), 28 + i, ts);
      g.px(CX + 4 - Math.min(i, 4), 28 + i, ts);
    }
    if (L.tabs) {
      g.rect(CX - 8, 29, 2, 3, L.tabs);
      g.rect(CX + 6, 29, 2, 3, L.tabs);
      g.px(CX - 7, 30, '#16171a');
      g.px(CX + 6, 30, '#16171a');
    }
    for (let y = 34; y < PH; y += 3) g.px(CX - 2, y, L.badge);
  }
  if (L.collar === 'wing') {
    // Pocket square.
    g.rect(CX + 7, 33, 3, 1, '#ece8da');
    g.px(CX + 8, 32, '#ece8da');
  }
  // Shoulder boards.
  if (L.braid) {
    g.row(30, CX - 15, CX - 10, L.tabs ?? L.badge);
    g.row(30, CX + 9, CX + 14, L.tabs ?? L.badge);
    g.row(31, CX - 15, CX - 10, ts);
    g.row(31, CX + 9, CX + 14, ts);
  }
  // Medal ribbons on the left breast (viewer's right).
  const RIB = [['#a8332a', '#e8e4d4'], ['#2c4672', '#d8b040'], ['#5f6f47', '#a8332a'], ['#7a2a5a', '#e8e4d4']];
  for (let r = 0; r < Math.min(2, Math.ceil(L.medals / 2)); r++) {
    for (let k = 0; k < 4; k++) {
      const [a, b] = RIB[(k + r * 2) % RIB.length];
      g.px(CX + 4 + k * 2, 33 + r, a);
      g.px(CX + 5 + k * 2, 33 + r, b);
    }
  }
  if (L.medals >= 3) {
    g.px(CX + 7, 35, '#a8332a');
    g.px(CX + 7, 36, '#a8332a');
    g.rect(CX + 6, 37, 3, 2, L.badge);
    g.px(CX + 8, 38, '#a07a28');
    g.px(CX + 11, 35, '#2c4672');
    g.rect(CX + 10, 36, 3, 2, '#c9ced2');
  } else if (L.medals > 0) {
    // A neck order at the throat.
    g.px(CX - 1, 30, L.badge);
    g.px(CX, 30, L.badge);
    g.row(31, CX - 2, CX + 1, L.badge);
    g.px(CX - 1, 32, L.badge);
    g.px(CX, 32, L.badge);
    g.px(CX - 1, 31, '#16171a');
    g.px(CX, 31, '#16171a');
  }
  if (L.aiguillette) {
    // Adjutant's cords looped from the shoulder.
    const cord = '#d8b040';
    for (let i = 0; i < 6; i++) g.px(CX + 10 - i, 31 + i, cord);
    for (let i = 0; i < 5; i++) g.px(CX + 12 - i, 31 + i + 2, cord);
    g.px(CX + 5, 37, '#e8e4d4');
    g.px(CX + 7, 38, '#e8e4d4');
  }
  // Head.
  for (let y = 8; y <= 26; y++) {
    const hw = faceHalf(y);
    if (!hw) continue;
    g.row(y, CX - hw, CX + hw - 1, sb);
    g.px(CX - hw, y, sh);
    g.px(CX + hw - 1, y, ss);
    if (hw > 4) g.px(CX + hw - 2, y, ss);
  }
  g.row(25, CX - 3, CX + 2, ss);
  g.row(26, CX - 2, CX + 1, ss);
  g.row(24, CX - 1, CX + 1, ss);
  // Ears.
  for (let y = 15; y <= 18; y++) {
    g.px(CX - 8, y, y === 15 || y === 18 ? ss : sb);
    g.px(CX + 7, y, ss);
  }
  g.px(CX - 8, 16, sh);
  // Hair at the temples.
  for (let y = 11; y <= 15; y++) {
    g.px(CX - 7, y, L.hair);
    g.px(CX + 6, y, L.hair);
  }
  // Brows, nose, cheek lines.
  const brow = L.old ? L.hair : darker(L.hair);
  g.row(EYE_Y - 2, CX - 6, CX - 3, brow);
  g.row(EYE_Y - 2, CX + 2, CX + 5, brow);
  if (L.old) {
    g.px(CX - 6, EYE_Y - 3, brow);
    g.px(CX + 5, EYE_Y - 3, brow);
    g.px(CX - 6, 19, ss);
    g.px(CX + 5, 19, ss);
    g.px(CX - 5, 20, ss);
  }
  g.px(CX, 17, ss);
  g.px(CX, 18, ss);
  g.px(CX - 1, 17, sh);
  g.row(19, CX - 1, CX + 1, ss);
  g.px(CX - 2, 19, sh);
  drawEyes(g, L, false);
  drawMouth(g, L, 0);
  // Moustache.
  if (L.tache === 'walrus') {
    const m = L.hair;
    const md = darker(L.hair);
    g.row(20, CX - 4, CX + 3, m);
    g.row(21, CX - 5, CX + 4, m);
    g.px(CX - 5, 22, md);
    g.px(CX + 4, 22, md);
    g.px(CX - 6, 22, md);
    g.px(CX + 5, 22, md);
    g.px(CX - 1, 21, md);
    g.px(CX + 2, 21, md);
  } else if (L.tache === 'pencil') {
    g.row(20, CX - 3, CX - 1, L.hair);
    g.row(20, CX, CX + 2, L.hair);
  }
  if (L.monocle) {
    for (const [dx, dy] of [[-6, 15], [-5, 15], [-4, 15], [-7, 16], [-3, 16], [-6, 17], [-5, 17], [-4, 17]]) g.px(CX + dx, dy, '#d8b040');
    g.px(CX - 7, 17, '#d8b040');
    for (let y = 18; y < 28; y++) g.px(CX - 8 - (y > 22 ? 1 : 0), y, y % 2 ? '#d8b040' : '#a07a28');
    // A duelling scar.
    g.px(CX + 4, 18, '#c08a70');
    g.px(CX + 3, 19, '#c08a70');
    g.px(CX + 3, 20, '#c08a70');
  }
  if (L.specs) {
    const rim = '#b0a070';
    for (const ex of [CX - 5, CX + 2]) {
      g.row(EYE_Y - 1, ex, ex + 1, rim);
      g.row(EYE_Y + 1, ex, ex + 1, rim);
      g.px(ex - 1, EYE_Y, rim);
      g.px(ex + 2, EYE_Y, rim);
    }
    g.row(EYE_Y, CX - 2, CX + 1, rim);
    g.px(CX - 7, EYE_Y, rim);
    g.px(CX + 6, EYE_Y, rim);
  }
  hat(g, L);
  g.outline();
  return g;
}

function hat(g: Grid, L: Look) {
  const [hh, hb, hs] = L.hatCol;
  const span = (y: number, hw: number, c = hb, dx = 0) => {
    g.row(y, CX - hw + dx, CX + hw - 1 + dx, c);
    g.px(CX - hw + dx, y, hh);
    g.px(CX + hw - 1 + dx, y, hs);
  };
  if (L.hat === 'peaked' || L.hat === 'tall') {
    const tall = L.hat === 'tall';
    // Crown: the "saucer" overhangs the band.
    const crown = tall ? [[0, 5], [1, 7], [2, 8], [3, 9], [4, 10], [5, 10], [6, 10], [7, 9], [8, 9]] : [[2, 6], [3, 8], [4, 9], [5, 10], [6, 10], [7, 10], [8, 9]];
    for (const [y, hw] of crown) span(y, hw);
    g.row(crown[0][0], CX - crown[0][1] + 1, CX + crown[0][1] - 3, hh);
    g.row(8, CX - 9, CX + 8, hs);
    if (tall) {
      // Raised front and piping.
      g.row(7, CX - 9, CX + 8, L.badge);
      g.row(0, CX - 3, CX + 2, hh);
    }
    // Band.
    for (let y = 9; y <= 10; y++) g.row(y, CX - 8, CX + 7, L.band);
    if (tall) {
      g.row(9, CX - 8, CX + 7, '#3a3c44');
      g.row(10, CX - 8, CX + 7, L.band);
    }
    // Badge.
    const b = L.badge;
    if (tall) {
      // A diamond over a wreath.
      g.px(CX - 1, 3, b); g.px(CX, 3, b);
      g.row(4, CX - 2, CX + 1, b);
      g.px(CX - 1, 4, '#16171a'); g.px(CX, 4, '#16171a');
      g.px(CX - 1, 5, b); g.px(CX, 5, b);
      g.row(9, CX - 3, CX + 2, '#c9ced2');
      g.px(CX - 1, 9, '#e8e4d4');
    } else {
      // A crown over a lion.
      const d = '#a07a28';
      g.px(CX - 3, 4, b); g.px(CX - 1, 4, b); g.px(CX, 4, b); g.px(CX + 2, 4, b);
      g.row(5, CX - 3, CX + 2, b);
      g.row(6, CX - 2, CX + 1, d);
      g.row(7, CX - 2, CX + 1, b);
      g.px(CX - 1, 7, d);
      g.row(8, CX - 1, CX, b);
    }
    // Peak, with gold braid for a senior officer.
    g.row(11, CX - 8, CX + 7, '#1f1f22');
    g.row(12, CX - 7, CX + 5, '#1f1f22');
    g.row(11, CX - 7, CX - 4, '#3a3a40');
    if (L.braid) for (let x = CX - 7; x <= CX + 6; x += 2) g.px(x, 11, x % 4 ? '#d8b040' : '#a07a28');
    // Shadow under the peak.
    g.row(13, CX - 6, CX + 5, L.skin[2]);
  } else if (L.hat === 'sideCap') {
    // Hair on top, the cap worn tilted to the right.
    for (let y = 8; y <= 12; y++) g.row(y, CX - faceHalf(y), CX + faceHalf(y) - 1, L.hair);
    g.row(12, CX - 7, CX - 3, darker(L.hair));
    g.row(13, CX - 7, CX - 5, L.hair);
    for (let i = 0; i < 6; i++) g.row(3 + i, CX - 3 - i, CX + 7 - Math.max(0, i - 3), i === 0 ? hh : hb);
    g.row(9, CX - 7, CX + 5, hs);
    g.row(8, CX - 8, CX + 5, hb);
    g.px(CX + 7, 4, hs);
    g.px(CX + 6, 5, hs);
    g.rect(CX - 5, 6, 2, 2, L.badge);
    g.px(CX + 3, 7, L.badge);
  } else {
    // Bowler or trilby, grey hair beneath.
    for (let y = 9; y <= 12; y++) {
      g.px(CX - 7, y, L.hair);
      g.px(CX + 6, y, L.hair);
    }
    const fedora = L.hat === 'fedora';
    const dome = fedora ? [[2, 6], [3, 7], [4, 7], [5, 8], [6, 8], [7, 8]] : [[1, 4], [2, 6], [3, 7], [4, 7], [5, 8], [6, 8], [7, 8]];
    for (const [y, hw] of dome) span(y, hw);
    if (fedora) {
      g.px(CX - 1, 2, '#16171a');
      g.px(CX, 2, '#16171a');
      g.px(CX - 1, 3, hs);
    }
    g.row(8, CX - 8, CX + 7, L.band);
    g.row(9, CX - 11, CX + 10, hb);
    g.px(CX - 11, 8, hb);
    g.px(CX + 10, 8, hb);
    g.row(9, CX - 10, CX - 6, hh);
    g.row(10, CX - 9, CX + 8, hs);
    g.row(11, CX - 6, CX + 5, L.skin[2]);
  }
}

function darker(c: string): string {
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.72).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

function drawEyes(g: Grid, L: Look, shut: boolean) {
  const [, sb, ss] = L.skin;
  for (const ex of [CX - 5, CX + 2]) {
    if (shut) {
      g.row(EYE_Y, ex, ex + 1, ss);
      g.px(ex, EYE_Y + 1, sb);
      g.px(ex + 1, EYE_Y + 1, sb);
    } else {
      // White, then the pupil looking towards the text.
      g.px(ex, EYE_Y, '#e8e4d4');
      g.px(ex + 1, EYE_Y, '#2a2620');
      g.px(ex + 1, EYE_Y + 1, ss);
      g.px(ex, EYE_Y + 1, sb);
    }
  }
}

/** Mouth frames: 0 closed, 1 ajar, 2 open. */
function drawMouth(g: Grid, L: Look, m: number) {
  const [, sb, ss] = L.skin;
  const lip = '#8a4a3a';
  const dark = '#3a1a18';
  g.row(MOUTH_Y, CX - 2, CX + 1, sb);
  g.row(MOUTH_Y + 1, CX - 2, CX + 1, sb);
  g.px(CX + 1, MOUTH_Y + 1, ss);
  if (m === 0) {
    g.row(MOUTH_Y, CX - 2, CX + 1, lip);
    g.px(CX - 2, MOUTH_Y, ss);
  } else if (m === 1) {
    g.row(MOUTH_Y, CX - 2, CX + 1, dark);
    g.row(MOUTH_Y + 1, CX - 1, CX, lip);
  } else {
    g.row(MOUTH_Y, CX - 2, CX + 1, dark);
    g.row(MOUTH_Y + 1, CX - 2, CX + 1, dark);
    g.px(CX - 1, MOUTH_Y, '#d8d0c0');
    g.px(CX, MOUTH_Y, '#d8d0c0');
  }
}

function background(ctx: CanvasRenderingContext2D, L: Look) {
  const [wh, wb, ws] = L.wall;
  ctx.fillStyle = wb;
  ctx.fillRect(0, 0, PW, PH);
  // Wainscot rail and a pinned map behind the shoulder.
  ctx.fillStyle = ws;
  ctx.fillRect(0, 26, PW, PH - 26);
  ctx.fillStyle = wh;
  ctx.fillRect(0, 25, PW, 1);
  // Map: sea, coast, fields and a front line of red pins.
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 2, 11, 17);
  ctx.fillStyle = '#7f98a0';
  ctx.fillRect(0, 3, 10, 15);
  ctx.fillStyle = '#d6c8a2';
  for (const [y, x] of [[3, 6], [4, 5], [5, 5], [6, 4], [7, 4], [8, 3], [9, 4], [10, 3], [11, 2], [12, 2], [13, 3], [14, 2], [15, 1], [16, 1], [17, 2]]) ctx.fillRect(x, y, 10 - x, 1);
  ctx.fillStyle = '#b8b080';
  ctx.fillRect(6, 6, 2, 2);
  ctx.fillRect(4, 12, 3, 2);
  ctx.fillRect(7, 15, 2, 2);
  ctx.fillStyle = '#b0302a';
  for (const [x, y] of [[7, 4], [6, 8], [6, 11], [4, 15]]) ctx.fillRect(x, y, 1, 1);
  // A window's light on the right.
  ctx.fillStyle = wh;
  ctx.fillRect(PW - 6, 3, 6, 18);
  ctx.fillStyle = ws;
  ctx.fillRect(PW - 6, 11, 6, 1);
  ctx.fillRect(PW - 3, 3, 1, 18);
}

/** Static portrait, for other screens (e.g. the tutorial or a gallery). */
export function portraitCanvas(speaker: Speaker, side: SideId = 0, scale = 3): HTMLCanvasElement {
  const c = h('canvas', { class: 'pix', width: PW, height: PH, style: `width:${PW * scale}px;height:${PH * scale}px` });
  const g = c.getContext('2d')!;
  const L = LOOKS[speaker][side];
  background(g, L);
  figure(L).draw(g);
  return c;
}

function animateFace(canvas: HTMLCanvasElement, L: Look) {
  const ctx = canvas.getContext('2d')!;
  const base = figure(L);
  // Pre-render the six eye/mouth frames.
  const frames = new Map<string, HTMLCanvasElement>();
  for (const shut of [false, true])
    for (const m of [0, 1, 2]) {
      const f = document.createElement('canvas');
      f.width = PW;
      f.height = PH;
      const fg = f.getContext('2d')!;
      background(fg, L);
      const g = new Grid(PW, PH);
      g.c = base.c.slice();
      drawEyes(g, L, shut);
      drawMouth(g, L, m);
      if (L.tache === 'walrus') {
        // The moustache hides the upper lip.
        g.px(CX - 2, MOUTH_Y, m ? '#3a1a18' : darker(L.hair));
        g.px(CX + 1, MOUTH_Y, m ? '#3a1a18' : darker(L.hair));
      }
      g.draw(fg);
      frames.set(`${shut}${m}`, f);
    }
  let nextBlink = performance.now() + 1800;
  let blinkUntil = 0;
  let mouth = 0;
  let lastMouth = 0;
  let key = '';
  const tick = (now: number) => {
    if (!canvas.isConnected) return;
    raf = requestAnimationFrame(tick);
    if (now > nextBlink) {
      blinkUntil = now + 130;
      nextBlink = now + 2200 + Math.random() * 2600;
    }
    const talking = current && !current.done && /[a-z0-9]/i.test(current.text[current.shown - 1] ?? '');
    if (now - lastMouth > 90) {
      lastMouth = now;
      mouth = talking ? (mouth === 0 ? 1 + Math.round(Math.random()) : Math.random() < 0.6 ? 0 : 1) : 0;
    }
    const k = `${now < blinkUntil}${mouth}`;
    if (k === key) return;
    key = k;
    ctx.clearRect(0, 0, PW, PH);
    ctx.drawImage(frames.get(k)!, 0, 0);
  };
  raf = requestAnimationFrame(tick);
}

/* ---------------- Weekly memos ---------------- */

const STAMP: Record<Memo['kind'], string> = { order: 'DIRECTIVE', intel: 'INTELLIGENCE', supply: 'SUPPLY', reprimand: 'REPRIMAND', commendation: 'COMMENDED', notice: 'NOTICE' };
const PRIORITY: Memo['kind'][] = ['reprimand', 'order', 'commendation', 'intel', 'notice'];

/** The officer who reads each side's mail. */
export const HIGH_COMMAND: [{ name: string; title: string }, { name: string; title: string }] = [
  { name: 'Gen. Sir Hector Pemberton', title: 'Commander-in-Chief, High Command' },
  { name: 'General Ewald Rennecke', title: 'Chief of the Directorate Air Staff' },
];

/** Trim a memo to about three typed lines: subject, then as many whole sentences as fit. */
export function summarise(m: Memo, max = 150): string {
  const sentences = m.body.match(/[^.!?]+[.!?]+["”]?\s*/g) ?? [m.body];
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > max) break;
    out += s;
  }
  out = out.trim();
  if (out.length > max + 20) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
  return out;
}

/** This week's important memos for a side as one dispatch, or null if there are none. */
export function memoDispatch(side: SideState, turn: number, maxPages = 4): Dispatch | null {
  // Memos arrive newest first. Everything filed since last week's delivery note is new,
  // including a theater briefing that is dated the week it was decided.
  const fresh: Memo[] = [];
  for (const m of side.memos) {
    if (m.kind === 'supply' && m.turn < turn) break;
    fresh.push(m);
  }
  const memos = fresh.filter((m) => m.turn >= turn - 1 && m.kind !== 'supply');
  if (!memos.length) return null;
  memos.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const hc = HIGH_COMMAND[side.id];
  return {
    speaker: 'general',
    side: side.id,
    name: hc.name,
    title: hc.title,
    lines: memos.slice(0, maxPages).map((m) => ({
      stamp: STAMP[m.kind],
      kind: m.kind,
      from: `${m.from} — ${m.subject}`,
      text: summarise(m),
    })),
  };
}
