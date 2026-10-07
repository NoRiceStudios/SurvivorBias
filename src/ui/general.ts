/**
 * Dispatches: a small animated officer delivers messages in a card anchored
 * bottom-right. Cards queue and show one at a time. Only the card itself takes
 * pointer events, so the rest of the screen (and automation) stays usable.
 */
import type { Leader, Memo, SideId, SideState } from '../core/types';
import { sfxClick, sfxKey } from './audio';
import { h } from './dom';

export type Speaker = 'general' | 'adjutant' | 'ministry';

/**
 * One page of a dispatch: plain text, or text with a stamp and a sender line.
 * A page may show a photograph (e.g. a leader's portrait) in place of the speaker,
 * with a caption; `mourning` prints it in sepia with a black band.
 */
export type DispatchLine = string | { text: string; stamp?: string; kind?: string; from?: string; portrait?: HTMLCanvasElement; caption?: string; mourning?: boolean };

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
  /** Take the whole screen. High Command always does, unless told otherwise. */
  fullscreen?: boolean;
  /** Heading above a fullscreen card, e.g. "Signal from High Command". */
  heading?: string;
}

const isFullscreen = (d: Dispatch) => d.fullscreen ?? d.speaker === 'general';

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

let els: { text: HTMLElement; meta: HTMLElement; page: HTMLElement; btn: HTMLButtonElement; canvas: HTMLCanvasElement; photo: HTMLElement; plate: HTMLElement; plateText: string } | null = null;

function build() {
  const c = current!;
  const side = c.d.side ?? 0;
  const canvas = h('canvas', { class: 'pix dispatch-face', width: PW, height: PH });
  const text = h('div', { class: 'dispatch-text' });
  const meta = h('div', { class: 'dispatch-meta' });
  const page = h('span', { class: 'dispatch-page' });
  const btn = h('button', { class: 'btn small primary dispatch-btn', onclick: (e: MouseEvent) => { e.stopPropagation(); advance(); } }, 'Next ▸');
  const plateText = c.d.speaker === 'adjutant' ? 'ADJUTANT' : c.d.speaker === 'ministry' ? 'MINISTRY' : 'HIGH COMMAND';
  const plate = h('div', { class: 'dispatch-plate' }, plateText);
  const photo = h('div', { class: 'dispatch-photo' });
  const full = isFullscreen(c.d);
  const inner = h('div', { class: `dispatch paper side${side} speaker-${c.d.speaker}${full ? ' full' : ''}`, role: 'dialog', 'aria-live': 'polite', onclick: full ? undefined : () => advance() },
    h('div', { class: 'dispatch-portrait' }, canvas, photo, plate),
    h('div', { class: 'dispatch-main' },
      h('div', { class: 'dispatch-head' }, h('div', { class: 'dispatch-name' }, c.d.name), h('div', { class: 'dispatch-title' }, c.d.title)),
      meta,
      text,
      h('div', { class: 'dispatch-foot' }, page, h('span', { class: 'dispatch-hint' }, 'Enter · Esc'), btn),
    ),
  );
  els = { text, meta, page, btn, canvas, photo, plate, plateText };
  // Fullscreen: the card sits alone on a darkened desk, with a heading above it.
  card = full
    ? h('div', { class: `dispatch-veil side${side}`, onclick: () => advance() },
      c.d.heading ? h('div', { class: 'dispatch-heading' }, c.d.heading) : null,
      inner)
    : inner;
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
  // A photograph on this page replaces the speaker until the next page.
  const pic = typeof line === 'string' ? undefined : line.portrait;
  els.photo.replaceChildren(...(pic ? [pic] : []));
  els.photo.className = `dispatch-photo${pic ? ' on' : ''}${pic && typeof line !== 'string' && line.mourning ? ' mourning' : ''}`;
  els.canvas.style.display = pic ? 'none' : '';
  els.plate.textContent = pic && typeof line !== 'string' && line.caption ? line.caption : els.plateText;
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

/* ---------------- Squadron leaders ---------------- */

/** Everything that makes one leader's face his own. Derived from his name, so it never changes. */
interface Face {
  side: SideId;
  skin: [string, string, string];
  hair: string;
  hairStyle: 'short' | 'parted' | 'slick' | 'receding' | 'bald' | 'curly';
  hat: 'none' | 'sideCap' | 'peaked' | 'field';
  tache: 'none' | 'pencil' | 'walrus' | 'handlebar' | 'trim';
  brows: 'thin' | 'bushy' | 'joined' | 'arched';
  nose: 'small' | 'long' | 'broad' | 'hooked';
  jaw: 'round' | 'narrow' | 'square';
  mouth: 'flat' | 'smile' | 'grim';
  ears: boolean;
  outfit: 'tunic' | 'jacket' | 'sweater';
  scarf: boolean;
  scar: boolean;
  eyepatch: boolean;
  specs: boolean;
  freckles: boolean;
  pipe: boolean;
  ribbon: boolean;
  charm: boolean;
  tired: boolean;
  /** 0 Flt Lt / Hauptmann, 1 Sqn Ldr / Major, 2 Wg Cdr / Oberst. */
  rank: number;
}

const SKINS: [string, string, string][] = [
  ['#f0c49a', '#d9a27a', '#b07a58'],
  ['#ecc8a8', '#d4a888', '#a87e62'],
  ['#f2c8a0', '#e0a888', '#b8785e'],
  ['#d8a878', '#bc8a5c', '#94683e'],
  ['#e4b890', '#c89470', '#9e6c4c'],
];
const HAIRS = ['#2a2420', '#4a3424', '#6a4a2e', '#8a5a2a', '#c8a050', '#a04a22', '#3a3a38'];
const BLUEGREY: [string, string, string] = ['#7888a0', '#5a6a84', '#3e4a60'];
const LEATHER: [string, string, string] = ['#8a5a36', '#6a4428', '#4a2e1a'];
const RANK_ORDER: [string[], string[]] = [['Flt Lt', 'Sqn Ldr', 'Wg Cdr'], ['Hauptmann', 'Major', 'Oberst']];

/** FNV-1a hash of a string, then a small deterministic generator (mulberry32). */
function nameRng(name: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < name.length; i++) a = Math.imul(a ^ name.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function faceFor(leader: Leader, side: SideId): Face {
  const r = nameRng(`${side}:${leader.name}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const chance = (p: number) => r() < p;
  const rank = Math.max(0, RANK_ORDER[side].indexOf(leader.rank));
  // Seniority greys the hair and thins it.
  const grey = chance(0.08 + rank * 0.18);
  const hair = grey ? pick(['#9a968c', '#bdb8ac', '#7a7670']) : pick(HAIRS);
  const thinning = chance(0.35);
  const hairStyle = pick<Face['hairStyle']>(rank >= 1 && thinning ? ['receding', 'bald', 'receding'] : ['short', 'parted', 'slick', 'curly', 'short', 'parted']);
  const hat = side === 0 ? pick<Face['hat']>(['none', 'sideCap', 'peaked', 'none', 'sideCap']) : pick<Face['hat']>(['none', 'field', 'peaked', 'field']);
  const skin = pick(SKINS);
  const fair = hair === HAIRS[4] || hair === HAIRS[5];
  const trait = leader.trait;
  return {
    side,
    skin: trait === 'shaken' ? SKINS[1] : skin,
    hair,
    hairStyle,
    hat,
    tache: pick<Face['tache']>(side === 0 ? ['none', 'none', 'pencil', 'walrus', 'handlebar', 'trim'] : ['none', 'none', 'none', 'pencil', 'trim', 'walrus']),
    brows: pick<Face['brows']>(['thin', 'bushy', 'joined', 'arched', 'thin']),
    nose: pick<Face['nose']>(['small', 'long', 'broad', 'hooked', 'small']),
    jaw: pick<Face['jaw']>(['round', 'narrow', 'square']),
    mouth: pick<Face['mouth']>(['flat', 'smile', 'grim', 'flat']),
    ears: chance(0.3),
    outfit: pick<Face['outfit']>(['tunic', 'tunic', 'jacket', side === 0 ? 'sweater' : 'tunic']),
    scarf: chance(0.25),
    scar: chance(0.1),
    eyepatch: chance(0.04),
    specs: chance(0.08),
    freckles: fair && chance(0.6),
    pipe: trait === 'steady',
    ribbon: trait === 'ace',
    charm: trait === 'lucky',
    tired: trait === 'shaken',
    rank,
  };
}

const LEADER_FACE: Record<Face['jaw'], Record<number, number>> = {
  round: FACE,
  narrow: { 8: 5, 9: 6, 10: 7, 21: 6, 22: 6, 23: 5, 24: 4, 25: 3, 26: 2 },
  square: { 8: 5, 9: 6, 10: 7, 22: 7, 23: 7, 24: 6, 25: 5, 26: 4 },
};

function leaderFigure(F: Face): Grid {
  const g = new Grid(PW, PH);
  const [sh, sb, ss] = F.skin;
  const half = (y: number) => LEADER_FACE[F.jaw][y] ?? (y > 10 && y < 22 ? 7 : 0);
  const cloth = F.side === 0 ? BLUEGREY : SLATE;
  const [th, tb, ts] = F.outfit === 'jacket' ? LEATHER : F.outfit === 'sweater' ? ['#ece6d4', '#d8d0b8', '#b0a890'] as [string, string, string] : cloth;
  const gold = '#d8b040';
  // Shoulders.
  [8, 12, 14, 16, 17, 17, 17, 17, 17, 17, 17].forEach((hw, i) => {
    const y = 29 + i;
    g.row(y, CX - hw, CX + hw - 1, tb);
    g.px(CX - hw, y, th);
    g.px(CX + hw - 1, y, ts);
  });
  g.row(29, CX - 7, CX + 6, th);
  if (F.outfit === 'sweater') for (let y = 31; y < PH; y += 2) g.row(y, CX - 15, CX + 14, ts);
  // Neck.
  for (let y = 24; y <= 29; y++) g.row(y, CX - 3, CX + 2, ss);
  // Collar.
  if (F.outfit === 'jacket') {
    // Sheepskin collar turned out over the leather.
    const fleece = ['#efe6cc', '#d6c8a2'];
    for (let i = 0; i < 5; i++) {
      g.row(27 + i, CX - 9 + i, CX - 3 + Math.floor(i / 2), fleece[i % 2]);
      g.row(27 + i, CX + 2 - Math.floor(i / 2), CX + 8 - i, fleece[(i + 1) % 2]);
    }
    for (let y = 32; y < PH; y++) g.px(CX, y, '#4a2e1a');
  } else if (F.outfit === 'sweater') {
    g.rect(CX - 4, 26, 8, 3, '#e4dcc4');
    g.row(28, CX - 4, CX + 3, '#b0a890');
  } else if (F.side === 1) {
    for (let y = 26; y <= 30; y++) g.row(y, CX - 5, CX + 4, tb);
    g.row(26, CX - 5, CX + 4, th);
    for (let y = 27; y <= 30; y++) g.px(CX - 1, y, ts);
    // Collar tabs with a pip for each grade.
    g.rect(CX - 5, 28, 3, 2, gold);
    g.rect(CX + 2, 28, 3, 2, gold);
    for (let k = 0; k <= F.rank; k++) {
      g.px(CX - 5 + k, 28, '#3a3020');
      g.px(CX + 4 - k, 28, '#3a3020');
    }
  } else {
    for (let i = 0; i < 5; i++) g.row(28 + i, CX - 4 + i, CX + 3 - i, '#a8b4c4');
    for (let y = 29; y < PH; y++) g.row(y, CX - 1, CX, '#2a2e38');
    for (let i = 0; i < 7; i++) {
      g.px(CX - 5 + Math.min(i, 4), 28 + i, ts);
      g.px(CX + 4 - Math.min(i, 4), 28 + i, ts);
    }
  }
  if (F.scarf) {
    const silk = F.side === 0 ? '#ece8da' : '#c8b878';
    for (let y = 26; y <= 29; y++) g.row(y, CX - 4, CX + 3, silk);
    g.rect(CX - 2, 30, 3, 4, silk);
    g.px(CX - 1, 31, '#c8c0a8');
    g.px(CX - 3, 27, '#c8c0a8');
  }
  // Rank on the shoulder straps: a ring per grade (side 0) or braid (side 1).
  if (F.outfit === 'tunic') {
    for (const sx of [CX - 15, CX + 10]) {
      g.row(30, sx, sx + 4, ts);
      if (F.side === 0) for (let k = 0; k < F.rank + 2; k++) g.px(sx + k + (k > 1 ? 1 : 0) - (F.rank === 2 ? 1 : 0) + 1, 30, '#c8d0dc');
      else g.row(30, sx + 1, sx + 3, F.rank === 2 ? gold : '#c9ced2');
    }
  }
  // Reputation on the chest.
  if (F.ribbon) {
    const rib = F.side === 0 ? ['#7a3a8a', '#e8e4d4'] : ['#1a1a1a', gold];
    for (let k = 0; k < 4; k++) g.px(CX + 5 + k, 32, rib[k % 2]);
    g.row(31, CX + 5, CX + 8, rib[0]);
  }
  if (F.charm) {
    // A four-leaf clover pinned to the pocket.
    const cl = '#5aa04a';
    g.px(CX - 7, 31, cl); g.px(CX - 6, 32, cl); g.px(CX - 8, 32, cl); g.px(CX - 7, 33, cl);
    g.px(CX - 7, 32, '#d8b040');
  }
  // Head.
  for (let y = 8; y <= 26; y++) {
    const hw = half(y);
    if (!hw) continue;
    g.row(y, CX - hw, CX + hw - 1, sb);
    g.px(CX - hw, y, sh);
    g.px(CX + hw - 1, y, ss);
    if (hw > 4) g.px(CX + hw - 2, y, ss);
  }
  const chin = Object.keys(LEADER_FACE[F.jaw]).map(Number).filter((y) => y > 20).sort((a, b) => b - a)[0] ?? 26;
  g.row(chin, CX - half(chin) + 1, CX + half(chin) - 2, ss);
  // Ears, big or small.
  const ey0 = F.ears ? 14 : 15;
  for (let y = ey0; y <= 18; y++) {
    g.px(CX - 8, y, y === ey0 || y === 18 ? ss : sb);
    g.px(CX + 7, y, ss);
    if (F.ears && y > ey0 && y < 18) {
      g.px(CX - 9, y, sb);
      g.px(CX + 8, y, ss);
    }
  }
  leaderHair(g, F, half);
  // Brows.
  const bc = F.hairStyle === 'bald' && F.hair !== HAIRS[0] ? darker(F.hair) : darker(F.hair);
  const by = EYE_Y - 2;
  if (F.brows === 'bushy') {
    g.row(by, CX - 6, CX - 3, bc); g.row(by, CX + 2, CX + 5, bc);
    g.row(by - 1, CX - 6, CX - 4, bc); g.row(by - 1, CX + 3, CX + 5, bc);
  } else if (F.brows === 'joined') {
    g.row(by, CX - 6, CX + 5, bc);
  } else if (F.brows === 'arched') {
    g.row(by - 1, CX - 5, CX - 4, bc); g.px(CX - 6, by, bc); g.px(CX - 3, by, bc);
    g.row(by - 1, CX + 3, CX + 4, bc); g.px(CX + 2, by, bc); g.px(CX + 5, by, bc);
  } else {
    g.row(by, CX - 6, CX - 4, bc); g.row(by, CX + 3, CX + 5, bc);
  }
  // Eyes; a shaken man's are heavy-lidded with dark rings.
  for (const ex of [CX - 5, CX + 2]) {
    g.px(ex, EYE_Y, '#e8e4d4');
    g.px(ex + 1, EYE_Y, '#2a2620');
    g.px(ex + 1, EYE_Y + 1, ss);
    if (F.tired) {
      g.row(EYE_Y, ex, ex + 1, ss);
      g.px(ex + 1, EYE_Y, '#2a2620');
      g.row(EYE_Y + 1, ex - 1, ex + 2, '#9a7272');
    }
  }
  // Nose.
  g.px(CX, 17, ss);
  g.px(CX, 18, ss);
  g.px(CX - 1, 17, sh);
  if (F.nose === 'long') {
    g.px(CX, 16, ss);
    g.px(CX, 19, ss);
    g.row(20, CX - 1, CX + 1, ss);
  } else if (F.nose === 'broad') {
    g.row(19, CX - 2, CX + 2, ss);
    g.px(CX - 2, 18, sh);
  } else if (F.nose === 'hooked') {
    g.px(CX + 1, 17, ss);
    g.px(CX + 1, 18, ss);
    g.row(19, CX - 1, CX + 1, ss);
  } else g.row(19, CX - 1, CX + 1, ss);
  // Mouth.
  const lip = '#8a4a3a';
  g.row(MOUTH_Y, CX - 2, CX + 1, lip);
  if (F.mouth === 'smile') {
    g.px(CX - 3, MOUTH_Y - 1, lip);
    g.px(CX + 2, MOUTH_Y - 1, lip);
  } else if (F.mouth === 'grim') {
    g.px(CX - 3, MOUTH_Y + 1, ss);
    g.px(CX + 2, MOUTH_Y + 1, ss);
    g.row(MOUTH_Y, CX - 2, CX + 1, '#6a3a2e');
  }
  // Moustache.
  const m = F.hair;
  if (F.tache === 'walrus') {
    g.row(20, CX - 3, CX + 2, m);
    g.row(21, CX - 4, CX + 3, m);
    g.px(CX - 4, 22, darker(m)); g.px(CX + 3, 22, darker(m));
  } else if (F.tache === 'handlebar') {
    g.row(21, CX - 3, CX + 2, m);
    g.px(CX - 4, 20, m); g.px(CX + 3, 20, m);
    g.px(CX - 5, 19, m); g.px(CX + 4, 19, m);
    g.px(CX - 5, 20, darker(m)); g.px(CX + 4, 20, darker(m));
  } else if (F.tache === 'pencil') {
    g.row(21, CX - 3, CX - 1, m); g.row(21, CX, CX + 2, m);
  } else if (F.tache === 'trim') {
    g.row(20, CX - 3, CX + 2, m);
    g.row(21, CX - 3, CX + 2, darker(m));
  }
  if (F.freckles) for (const [x, y] of [[-5, 18], [-4, 19], [3, 18], [4, 19], [-6, 19]]) g.px(CX + x, y, ss);
  if (F.scar) {
    g.px(CX + 4, 18, '#c08a70'); g.px(CX + 3, 19, '#c08a70'); g.px(CX + 4, 20, '#c08a70'); g.px(CX + 5, 17, '#c08a70');
  }
  if (F.specs) {
    const rim = '#3a3028';
    for (const ex of [CX - 5, CX + 2]) {
      g.row(EYE_Y - 1, ex, ex + 1, rim);
      g.row(EYE_Y + 1, ex, ex + 1, rim);
      g.px(ex - 1, EYE_Y, rim);
      g.px(ex + 2, EYE_Y, rim);
    }
    g.row(EYE_Y, CX - 2, CX + 1, rim);
  }
  if (F.eyepatch) {
    g.rect(CX - 6, EYE_Y - 1, 3, 3, '#1a1a1a');
    for (let i = 0; i < 5; i++) g.px(CX - 3 + i, EYE_Y - 2 - Math.floor(i / 2), '#1a1a1a');
    g.px(CX - 7, EYE_Y - 1, '#1a1a1a');
  }
  if (F.pipe) {
    // Briar pipe from the corner of the mouth.
    g.row(MOUTH_Y, CX + 1, CX + 4, '#3a2a1a');
    g.rect(CX + 4, MOUTH_Y - 1, 2, 3, '#6a4428');
    g.px(CX + 4, MOUTH_Y - 1, '#2a1a10');
    g.px(CX + 5, MOUTH_Y - 1, '#2a1a10');
  }
  leaderHat(g, F);
  g.outline();
  return g;
}

function leaderHair(g: Grid, F: Face, half: (y: number) => number) {
  const c = F.hair;
  const d = darker(c);
  const hi = F.hair === HAIRS[0] ? '#4a4440' : shadeHex(c, 1.25);
  // Sideburns and temples show under any cap.
  const side = F.hairStyle === 'bald' ? [13, 16] : [10, 15];
  for (let y = side[0]; y <= side[1]; y++) {
    g.px(CX - 7, y, c);
    g.px(CX + 6, y, c);
  }
  if (F.hat === 'peaked') return;
  // Top of the head: skull shape above row 8.
  const crown: [number, number][] = [[6, 4], [7, 6], [8, 6], [9, 7], [10, 7]];
  if (F.hairStyle === 'bald' || F.hairStyle === 'receding') {
    for (const [y, hw] of crown) g.row(y, CX - hw, CX + hw - 1, F.skin[1]);
    for (const [y, hw] of crown) { g.px(CX - hw, y, F.skin[0]); g.px(CX + hw - 1, y, F.skin[2]); }
    g.row(6, CX - 2, CX - 1, '#ffffff');
    g.px(CX - 3, 7, F.skin[0]);
    if (F.hairStyle === 'receding') {
      for (const y of [8, 9, 10, 11]) { g.row(y, CX - 7, CX - 5, c); g.row(y, CX + 4, CX + 6, c); }
      g.px(CX - 4, 8, d);
      g.px(CX + 3, 8, d);
    } else {
      for (const y of [11, 12]) { g.px(CX - 7, y, c); g.px(CX + 6, y, c); }
    }
    return;
  }
  const top: [number, number][] = F.hairStyle === 'curly' ? [[5, 5], [6, 7], [7, 7], [8, 8], [9, 8], [10, 7]] : [[6, 5], [7, 7], [8, 7], [9, 8], [10, 7]];
  for (const [y, hw] of top) g.row(y, CX - hw, CX + hw - 1, c);
  // Fringe line across the forehead.
  for (let x = CX - 6; x < CX + 6; x++) if ((F.hairStyle === 'slick' ? 1 : x % 3) !== 0) g.px(x, 11, c);
  if (F.hairStyle === 'parted') {
    g.row(6, CX - 3, CX - 3, F.skin[2]);
    g.px(CX - 3, 7, F.skin[2]);
    g.row(7, CX - 2, CX + 4, hi);
    g.row(10, CX - 2, CX + 5, d);
  } else if (F.hairStyle === 'slick') {
    g.row(7, CX - 4, CX + 2, hi);
    g.row(8, CX - 5, CX - 2, hi);
    g.row(10, CX - 6, CX + 5, d);
  } else if (F.hairStyle === 'curly') {
    for (let x = CX - 7; x < CX + 7; x++) if ((x + 5) % 2) g.px(x, 5 + (x % 3 === 0 ? 1 : 0), d);
    for (let y = 6; y <= 10; y++) for (let x = CX - 6; x < CX + 6; x += 3) g.px(x + (y % 2), y, d);
  } else {
    g.row(7, CX - 3, CX + 1, hi);
    g.row(10, CX - 6, CX + 5, d);
  }
  // The head beneath: hair edges meet the face.
  void half;
}

function shadeHex(c: string, f: number): string {
  const n = parseInt(c.slice(1), 16);
  const v = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f))).toString(16).padStart(2, '0');
  return `#${v(16)}${v(8)}${v(0)}`;
}

function leaderHat(g: Grid, F: Face) {
  const gold = '#d8b040';
  if (F.hat === 'none') return;
  if (F.hat === 'peaked') {
    const col: [string, string, string] = F.side === 0 ? BLUEGREY : BLACKCAP;
    for (const [y, hw] of [[3, 7], [4, 9], [5, 10], [6, 10], [7, 9]] as const) {
      g.row(y, CX - hw, CX + hw - 1, col[1]);
      g.px(CX - hw, y, col[0]);
      g.px(CX + hw - 1, y, col[2]);
    }
    g.row(3, CX - 5, CX + 3, col[0]);
    g.row(7, CX - 9, CX + 8, col[2]);
    g.row(8, CX - 8, CX + 7, '#1f1f22');
    g.row(9, CX - 8, CX + 7, '#1f1f22');
    if (F.side === 1) g.row(6, CX - 9, CX + 8, F.rank === 2 ? gold : '#c9ced2');
    // Badge: an eagle (side 0) or the Directorate diamond.
    if (F.side === 0) {
      g.row(8, CX - 3, CX + 2, gold);
      g.px(CX - 1, 7, gold); g.px(CX, 7, gold);
      g.px(CX - 1, 6, '#e8e4d4'); g.px(CX, 6, '#e8e4d4');
    } else {
      g.px(CX - 1, 4, gold); g.px(CX, 4, gold); g.row(5, CX - 2, CX + 1, gold); g.px(CX - 1, 5, '#1a1a1a'); g.px(CX, 5, '#1a1a1a');
      g.row(8, CX - 2, CX + 1, '#c9ced2');
    }
    g.row(10, CX - 8, CX + 7, '#2a2a30');
    g.row(11, CX - 7, CX + 5, '#1f1f22');
    g.row(10, CX - 7, CX - 4, '#4a4a54');
    if (F.rank === 2) for (let x = CX - 6; x <= CX + 5; x += 2) g.px(x, 10, gold);
    g.row(12, CX - 6, CX + 5, F.skin[2]);
  } else if (F.hat === 'sideCap') {
    const [hh, hb, hs] = BLUEGREY;
    for (let i = 0; i < 5; i++) g.row(4 + i, CX - 2 - i, CX + 7 - Math.max(0, i - 2), i === 0 ? hh : hb);
    g.row(8, CX - 7, CX + 5, hs);
    g.px(CX + 7, 5, hs);
    g.rect(CX - 4, 6, 2, 2, gold);
  } else {
    // Directorate field cap: soft crown and a short peak.
    const [hh, hb, hs] = SLATE;
    for (const [y, hw] of [[4, 6], [5, 7], [6, 8], [7, 8], [8, 8]] as const) {
      g.row(y, CX - hw, CX + hw - 1, hb);
      g.px(CX - hw, y, hh);
      g.px(CX + hw - 1, y, hs);
    }
    g.row(4, CX - 5, CX + 4, hh);
    g.row(8, CX - 8, CX + 7, hs);
    g.row(9, CX - 6, CX + 4, '#2a2e34');
    g.row(10, CX - 5, CX + 3, F.skin[2]);
    g.px(CX - 1, 6, gold); g.px(CX, 6, gold); g.px(CX - 1, 5, gold); g.px(CX, 7, gold);
  }
}

/** Crop of the 36x40 portrait that keeps head and shoulders. */
const LX = 3;
const LY = 2;
const LW = 30;
const LH = 32;

/** A squadron leader's own face: stable for his name, marked by rank and reputation. */
export function leaderPortrait(leader: Leader, side: SideId, scale = 2): HTMLCanvasElement {
  const c = h('canvas', { class: 'pix leader-face', width: LW, height: LH, style: `width:${LW * scale}px;height:${LH * scale}px`, title: `${leader.rank} ${leader.name}` });
  const g = c.getContext('2d')!;
  const wall = side === 0 ? ['#7a8478', '#6a7468', '#5a6458'] : ['#767c82', '#666c72', '#565c62'];
  g.fillStyle = wall[2];
  g.fillRect(0, 0, LW, LH);
  // Studio backdrop: a soft light behind the head.
  for (let y = 0; y < LH; y++) {
    const hw = Math.round(Math.max(0, 11 - Math.abs(y - 12) * 0.5));
    g.fillStyle = wall[1];
    g.fillRect(LW / 2 - hw - 3, y, hw * 2 + 6, 1);
    g.fillStyle = wall[0];
    g.fillRect(LW / 2 - hw + 1, y, Math.max(0, hw * 2 - 2), 1);
  }
  leaderFigure(faceFor(leader, side)).draw(g, -LX, -LY);
  return c;
}

/** The leader a memo is about (obituary, return, change of command), if he can be named. */
export function leaderInMemo(side: SideState, m: Memo): Leader | null {
  const s = m.subject;
  const about = /^In memoriam:|is back$|is alive$|presumed killed$|change of command$/i.test(s);
  if (!about) return null;
  if (/change of command$/i.test(s)) {
    const sq = side.squadrons.find((q) => s.startsWith(q.name));
    if (sq) return sq.leader;
  }
  const current = side.squadrons.map((q) => q.leader).find((l) => s.includes(l.name));
  if (current) return current;
  // A man no longer on strength: read his rank and name from the subject.
  for (const rank of [...RANK_ORDER[side.id]].sort((a, b) => b.length - a.length)) {
    const i = s.indexOf(`${rank} `);
    if (i < 0) continue;
    const name = s.slice(i + rank.length + 1).replace(/\s+(is back|is alive|presumed killed)$/i, '').trim();
    if (name) return { name, rank, archetype: 'byTheBook' };
  }
  return null;
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

/** The memos High Command reads out this week (most important first), or [] if nothing weighty came. */
export function letterMemos(side: SideState, turn: number, max = 6): Memo[] {
  // Memos arrive newest first. Everything filed since last week's delivery note is new,
  // including a theater briefing that is dated the week it was decided.
  const fresh: Memo[] = [];
  for (const m of side.memos) {
    if (m.kind === 'supply' && m.turn < turn) break;
    fresh.push(m);
  }
  const memos = fresh.filter((m) => m.turn >= turn - 1 && m.kind !== 'supply');
  // The general only comes in person for something that matters: new orders, praise or blame,
  // and news of the wing's own men. Routine intelligence stays on the briefing.
  const weighty = memos.some((m) => m.kind === 'order' || m.kind === 'reprimand' || m.kind === 'commendation' || leaderInMemo(side, m) || m.from === 'International Red Cross');
  if (!memos.length || !weighty) return [];
  // News of the wing's own leaders ranks just above routine intelligence.
  const rank = (m: Memo) => (leaderInMemo(side, m) ? PRIORITY.indexOf('intel') - 0.5 : PRIORITY.indexOf(m.kind));
  return memos.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

/** This week's important memos for a side as one dispatch, or null if there are none. */
export function memoDispatch(side: SideState, turn: number, maxPages = 4): Dispatch | null {
  const memos = letterMemos(side, turn, maxPages);
  if (!memos.length) return null;
  const hc = HIGH_COMMAND[side.id];
  return {
    speaker: 'general',
    side: side.id,
    name: hc.name,
    title: hc.title,
    lines: memos.map((m) => {
      const who = leaderInMemo(side, m);
      return {
        stamp: STAMP[m.kind],
        kind: m.kind,
        from: `${m.from} — ${m.subject}`,
        // Obituaries, directives and intelligence are read in full: they are the last word on a man, or something to act on.
        text: summarise(m, m.subject.startsWith('In memoriam') || m.kind === 'order' || m.kind === 'intel' ? 600 : 150),
        ...(who ? { portrait: leaderPortrait(who, side.id, 3), caption: `${who.rank} ${who.name.split(' ').slice(-1)[0]}`.toUpperCase(), mourning: /memoriam|presumed killed/i.test(m.subject) } : {}),
      };
    }),
  };
}
