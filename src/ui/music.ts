/**
 * Procedural score, written note by note and played through WebAudio. Nothing is sampled
 * or recorded: the "band" is oscillators and filtered noise, so the game still ships
 * without audio assets or licences. All tunes are original.
 *
 * The style follows the war-game scores of the early 2000s: heroic themes in minor for
 * brass over galloping strings, timpani and a snare that never stops, with a wink of
 * comedy (bassoon and pizzicato) in the planning room. Each mood is a short piece in
 * bars; a scheduler queues the next bar a little ahead of time and moods crossfade when
 * the screen changes.
 */
import { musicOut, musicVolume, onAudioWake } from './audio';

export type Mood = 'title' | 'plan' | 'radio' | 'dawn' | 'none';

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Rig {
  c: AudioContext;
  /** Into the mood's own gain (dry and through the hall). */
  out: GainNode;
}

// ——— Instruments ———

function osc(r: Rig, type: OscillatorType, f: number, t: number, end: number, into: AudioNode, detune = 0): OscillatorNode {
  const o = r.c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.connect(into);
  o.start(t);
  o.stop(end);
  return o;
}

function gainEnv(r: Rig, t: number, a: number, peak: number, hold: number, rel: number): GainNode {
  const g = r.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.linearRampToValueAtTime(0.0001, t + a + hold + rel);
  return g;
}

/** Band brass (cornet, trumpet): two bright saws, the filter opening on each note's blare. */
function brass(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.025, vol, Math.max(0.02, dur - 0.06), 0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(3200, t + 0.04);
  lp.frequency.exponentialRampToValueAtTime(1600, t + Math.max(0.1, dur));
  lp.connect(g).connect(r.out);
  const end = t + dur + 0.12;
  const a = osc(r, 'sawtooth', hz(m), t, end, lp, -5);
  const b = osc(r, 'sawtooth', hz(m), t, end, lp, 5);
  // A held note gets a little vibrato, as a bandsman would give it.
  if (dur > 0.5) {
    const vib = c.createOscillator();
    vib.frequency.value = 5.5;
    const vd = c.createGain();
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(0, t + 0.3);
    vd.gain.linearRampToValueAtTime(10, t + dur);
    vib.connect(vd);
    vd.connect(a.detune);
    vd.connect(b.detune);
    vib.start(t);
    vib.stop(end);
  }
}

/** The tuba's "oom". */
function tuba(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.02, vol, Math.max(0.02, dur - 0.08), 0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(380, t + 0.15);
  lp.connect(g).connect(r.out);
  osc(r, 'sawtooth', hz(m), t, t + dur + 0.1, lp);
  osc(r, 'sine', hz(m), t, t + dur + 0.1, g);
}

/** Pizzicato strings: a plucked note that dies at once. */
function pizz(r: Rig, m: number, t: number, vol: number) {
  const { c } = r;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2400, t);
  lp.frequency.exponentialRampToValueAtTime(500, t + 0.2);
  lp.connect(g).connect(r.out);
  osc(r, 'triangle', hz(m), t, t + 0.4, lp);
  osc(r, 'sawtooth', hz(m), t, t + 0.4, lp, 4);
}

/** Bassoon: a reedy, nasal low voice, for the tune that sneaks about. */
function bassoon(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.02, vol, Math.max(0.02, dur - 0.04), 0.05);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 520;
  bp.Q.value = 1.2;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1800;
  bp.connect(lp).connect(g).connect(r.out);
  osc(r, 'square', hz(m), t, t + dur + 0.08, bp);
  osc(r, 'sawtooth', hz(m), t, t + dur + 0.08, bp, 6);
}

/** Short bowed strings (spiccato) for the radio room's running eighths. */
function spic(r: Rig, notes: number[], t: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.01, vol, 0.06, 0.1);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1000;
  lp.connect(g).connect(r.out);
  for (const m of notes) osc(r, 'sawtooth', hz(m), t, t + 0.2, lp, (Math.random() - 0.5) * 10);
}

/** Held low strings under the radio room. */
function pad(r: Rig, notes: number[], t: number, dur: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, Math.min(0.6, dur * 0.3), vol, dur * 0.6, 0.6);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;
  lp.connect(g).connect(r.out);
  for (const m of notes) for (const d of [-7, 6]) osc(r, 'sawtooth', hz(m), t, t + dur + 0.7, lp, d);
}

let noise: AudioBuffer | null = null;
function noiseBuf(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function hiss(r: Rig, t: number, type: BiquadFilterType, f: number, q: number, vol: number, len: number) {
  const { c } = r;
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c);
  const flt = c.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(flt).connect(g).connect(r.out);
  n.start(t, Math.random() * 0.4, len + 0.02);
}

/** Field snare: the rattle of the wires and the skin's crack. */
function snare(r: Rig, t: number, vol: number) {
  if (vol <= 0) return;
  hiss(r, t, 'bandpass', 3000, 0.7, vol, 0.13);
  const g = r.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  g.connect(r.out);
  osc(r, 'triangle', 200, t, t + 0.07, g);
}

/** A press roll from `v0` to `v1`, in thirty-seconds. */
function roll(r: Rig, t: number, dur: number, b: number, v0: number, v1: number) {
  const step = b / 8;
  const n = Math.round(dur / step);
  for (let k = 0; k < n; k++) snare(r, t + k * step, v0 + ((v1 - v0) * k) / n);
}

function bassDrum(r: Rig, t: number, vol: number) {
  const g = r.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  g.connect(r.out);
  const o = osc(r, 'sine', 95, t, t + 0.4, g);
  o.frequency.setValueAtTime(95, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
}

function cymbal(r: Rig, t: number, vol: number) {
  hiss(r, t, 'highpass', 6000, 0.5, vol, 1.6);
  hiss(r, t, 'bandpass', 3500, 2, vol * 0.5, 0.8);
}

/** Timpani for the radio room. */
function timp(r: Rig, m: number, t: number, vol: number) {
  const g = r.c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  g.connect(r.out);
  const o = osc(r, 'sine', hz(m) * 1.04, t, t + 1.3, g);
  o.frequency.exponentialRampToValueAtTime(hz(m), t + 0.08);
  hiss(r, t, 'lowpass', 400, 0.7, vol * 0.4, 0.1);
}

// ——— The pieces ———

/** A melody: [MIDI note, beats]; 0 is a rest. */
type Tune = [number, number][];
type Bar = { chord: number[]; root: number; fifth: number; tune: Tune };

function play(tune: Tune, t: number, b: number, f: (m: number, at: number, dur: number) => void) {
  let at = t;
  for (const [m, beats] of tune) {
    if (m) f(m, at, beats * b);
    at += beats * b;
  }
}

/** One bar of a snare cadence: sixteen sixteenths, each a velocity (0 = silent). */
function cadence(r: Rig, pattern: number[], t: number, b: number, vol: number) {
  pattern.forEach((v, k) => snare(r, t + (k * b) / 4, v * vol));
}

/** The galloping strings under a war film: two sixteenths and an eighth on every beat. */
function gallop(r: Rig, root: number, t: number, b: number, vol: number) {
  for (let k = 0; k < 4; k++) {
    const at = t + k * b;
    spic(r, [root + 12, root + 24], at, vol * 1.2);
    spic(r, [root + 12, root + 24], at + b / 4, vol * 0.7);
    spic(r, [root + 12, root + 24], at + b / 2, vol * 0.9);
  }
}

// D minor. D4 = 62.
const Dm = [62, 65, 69], Bb = [62, 65, 70], C = [60, 64, 67], F = [60, 65, 69], Gm = [62, 67, 70], A = [61, 64, 69];

/** "Hold the Line": the title theme. Heroic, in minor, over galloping strings. */
const HOLD: Bar[] = [
  { chord: Dm, root: 38, fifth: 45, tune: [[62, 0.75], [62, 0.25], [69, 1.5], [67, 0.5], [65, 1]] },
  { chord: Bb, root: 34, fifth: 41, tune: [[65, 0.75], [67, 0.25], [70, 1.5], [69, 0.5], [67, 1]] },
  { chord: C, root: 36, fifth: 43, tune: [[67, 0.75], [64, 0.25], [72, 2], [70, 0.5], [69, 0.5]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[69, 3], [0, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[62, 0.75], [62, 0.25], [69, 1.5], [67, 0.5], [65, 1]] },
  { chord: F, root: 41, fifth: 36, tune: [[65, 0.75], [69, 0.25], [72, 1.5], [74, 0.5], [72, 1]] },
  { chord: Gm, root: 43, fifth: 38, tune: [[70, 0.75], [69, 0.25], [67, 1], [70, 1], [74, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[73, 2], [69, 1], [64, 1]] },
];
const WAR_SNARE = [1, 0, 0.3, 0.3, 0.6, 0, 0.3, 0.3, 1, 0, 0.3, 0.3, 0.6, 0.3, 0.6, 0.3];

/** "Paperwork": planning. Sneaking about in minor on bassoon and pizzicato, a wink at the absurd. */
const PAPERWORK: Bar[] = [
  { chord: Dm, root: 38, fifth: 45, tune: [[62, 0.5], [0, 0.5], [65, 0.5], [0, 0.5], [69, 0.5], [68, 0.5], [69, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[70, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [64, 1], [0, 1]] },
  { chord: Gm, root: 43, fifth: 38, tune: [[67, 0.5], [0, 0.5], [70, 0.5], [0, 0.5], [74, 0.5], [73, 0.5], [74, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[73, 0.5], [76, 0.5], [79, 0.5], [76, 0.5], [73, 1], [0, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[62, 0.5], [0, 0.5], [65, 0.5], [0, 0.5], [69, 0.5], [68, 0.5], [69, 1]] },
  { chord: Bb, root: 34, fifth: 41, tune: [[70, 0.5], [69, 0.5], [67, 0.5], [65, 0.5], [62, 1], [0, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[67, 0.5], [65, 0.5], [64, 0.5], [61, 0.5], [64, 1], [69, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[62, 1], [57, 1], [62, 1], [0, 1]] },
];

/** "Roll of Honour": the debrief. A slow march, proud and grim. */
const HONOUR: Bar[] = [
  { chord: Dm, root: 38, fifth: 45, tune: [[69, 2], [74, 1.5], [72, 0.5]] },
  { chord: Bb, root: 34, fifth: 41, tune: [[70, 2], [65, 2]] },
  { chord: F, root: 41, fifth: 36, tune: [[69, 1.5], [67, 0.5], [65, 1], [69, 1]] },
  { chord: C, root: 36, fifth: 43, tune: [[67, 3], [0, 1]] },
  { chord: Gm, root: 43, fifth: 38, tune: [[67, 2], [70, 1.5], [69, 0.5]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[69, 2], [65, 1], [62, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[64, 1.5], [65, 0.5], [67, 1], [73, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[74, 4]] },
];

/** The radio room: a running ostinato in the low strings, for every chord a bar. */
const WATCH: { notes: number[]; bass: number }[] = [
  { notes: [50, 50, 53, 50, 52, 50, 48, 50], bass: 38 },
  { notes: [46, 46, 50, 46, 48, 46, 45, 46], bass: 34 },
  { notes: [43, 43, 46, 43, 45, 43, 46, 50], bass: 43 },
  { notes: [45, 45, 49, 45, 52, 49, 45, 44], bass: 45 },
];
const WATCH_PAD = [[50, 57], [46, 53], [43, 50], [45, 52]];

interface Piece {
  bpm: number;
  bar: (r: Rig, t: number, i: number, beat: number) => void;
}

const PIECES: Record<Exclude<Mood, 'none'>, Piece> = {
  title: {
    bpm: 104,
    bar: (r, t, i, b) => {
      const n = i % HOLD.length;
      const bar = HOLD[n];
      // First the horns state the theme; then trumpets take it up high over trombones.
      const pass = Math.floor(i / HOLD.length) % 2;
      gallop(r, bar.root, t, b, 0.026);
      pad(r, bar.chord.map((m) => m - 12), t, b * 4, pass ? 0.012 : 0.008);
      timp(r, bar.root + 12, t, 0.16);
      timp(r, bar.fifth + 12 > 52 ? bar.fifth : bar.fifth + 12, t + 2 * b, 0.1);
      if (n === 3 || n === 7) {
        cadence(r, WAR_SNARE.slice(0, 8), t, b, 0.05);
        roll(r, t + 2 * b, 2 * b, b, 0.015, 0.08);
      } else cadence(r, WAR_SNARE, t, b, 0.045);
      if (n === 0) cymbal(r, t, pass ? 0.06 : 0.04);
      if (pass === 0) {
        play(bar.tune, t, b, (m, at, d) => brass(r, m, at, d * 0.92, 0.045));
      } else {
        play(bar.tune, t, b, (m, at, d) => brass(r, m + 12, at, d * 0.92, 0.034));
        play(bar.tune, t, b, (m, at, d) => brass(r, m - 12, at, d * 0.92, 0.04));
      }
    },
  },
  plan: {
    bpm: 112,
    bar: (r, t, i, b) => {
      const n = i % PAPERWORK.length;
      const bar = PAPERWORK[n];
      // The accompaniment tiptoes on; the tune comes and goes so long planning is not one jingle.
      const pass = Math.floor(i / PAPERWORK.length) % 4;
      for (let k = 0; k < 4; k++) {
        if (k % 2 === 0) tuba(r, k ? bar.fifth : bar.root, t + k * b, b * 0.35, 0.07);
        else for (const m of bar.chord) pizz(r, m - 12, t + k * b, 0.03);
      }
      for (let k = 0; k < 4; k++) snare(r, t + k * b + b / 2, 0.016);
      if (n === 7) roll(r, t + 3 * b, b, b, 0.01, 0.04);
      if (pass === 0) play(bar.tune, t, b, (m, at, d) => bassoon(r, m - 12, at, d * 0.6, 0.05));
      else if (pass === 1) play(bar.tune, t, b, (m, at) => pizz(r, m + 12, at, 0.06));
      else if (pass === 2) {
        play(bar.tune, t, b, (m, at, d) => bassoon(r, m - 12, at, d * 0.6, 0.04));
        play(bar.tune, t, b, (m, at) => pizz(r, m + 12, at, 0.04));
      } else if (n % 4 === 0) pad(r, bar.chord, t, b * 4, 0.007);
    },
  },
  radio: {
    bpm: 126,
    bar: (r, t, i, b) => {
      const n = i % WATCH.length;
      const w = WATCH[n];
      pad(r, WATCH_PAD[n], t, b * 4, 0.012);
      w.notes.forEach((m, k) => spic(r, [m, m + 12], t + (k * b) / 2, k % 2 ? 0.014 : 0.022));
      timp(r, w.bass, t, 0.14);
      bassDrum(r, t + 2 * b, 0.1);
      // A side drum ticking like a clock, and a roll that swells into every fourth bar.
      for (let k = 0; k < 4; k++) snare(r, t + k * b + b / 2, 0.018);
      if (n === 3) roll(r, t + 2 * b, 2 * b, b, 0.01, 0.06);
      if (n === 0 && i % 8 === 0) for (const [k, m] of [[0, 62], [0.75, 62], [1, 65]] as const) brass(r, m, t + k * b, k === 1 ? b * 1.8 : b * 0.2, 0.02);
    },
  },
  dawn: {
    bpm: 84,
    bar: (r, t, i, b) => {
      const n = i % HONOUR.length;
      const bar = HONOUR[n];
      const pass = Math.floor(i / HONOUR.length) % 2;
      pad(r, bar.chord.map((m) => m - 12), t, b * 4, 0.012);
      tuba(r, bar.root, t, b * 1.5, 0.06);
      tuba(r, bar.fifth, t + 2 * b, b * 1.5, 0.05);
      timp(r, bar.root + 12, t, 0.12);
      // A slow march: a ruff into every other beat.
      for (let k = 0; k < 4; k++) {
        snare(r, t + k * b, k % 2 ? 0.02 : 0.035);
        if (k === 3) roll(r, t + k * b + b / 2, b / 2, b, 0.015, 0.04);
      }
      if (n === 7) cymbal(r, t, 0.05);
      play(bar.tune, t, b, (m, at, d) => brass(r, pass ? m : m - 12, at, d * 0.94, 0.032));
      if (pass) play(bar.tune, t, b, (m, at, d) => brass(r, m - 12, at, d * 0.94, 0.018));
    },
  },
};

// ——— Scheduler ———

let hall: { c: AudioContext; input: GainNode } | null = null;

/** A parade ground with buildings round it: a generated impulse response, so the band rings a little. */
function hallFor(c: AudioContext, out: GainNode): GainNode {
  if (hall && hall.c === c) return hall.input;
  const len = Math.floor(c.sampleRate * 1.8);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  const input = c.createGain();
  // The voices are written quiet so chords do not stack into clipping; lift the whole band here.
  input.gain.value = 3;
  const wet = c.createGain();
  wet.gain.value = 0.2;
  // Old recordings: the top is rolled off.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5500;
  input.connect(tone);
  tone.connect(out);
  tone.connect(conv).connect(wet).connect(out);
  hall = { c, input };
  return input;
}

let wanted: Mood = 'none';
let playing: { mood: Mood; gain: GainNode; rig: Rig; next: number; bar: number } | null = null;
let timer = 0;

function fadeOut(p: NonNullable<typeof playing>) {
  const { c } = p.rig;
  p.gain.gain.cancelScheduledValues(c.currentTime);
  p.gain.gain.setValueAtTime(p.gain.gain.value, c.currentTime);
  p.gain.gain.linearRampToValueAtTime(0, c.currentTime + 2.5);
  window.setTimeout(() => p.gain.disconnect(), 6000);
}

function tick() {
  const io = musicOut();
  if (!io) {
    // Muted: forget the bar we were on; the piece starts again when sound returns.
    playing = null;
    return;
  }
  if (playing && (playing.mood !== wanted || playing.rig.c !== io.c)) {
    fadeOut(playing);
    playing = null;
  }
  if (wanted === 'none') return;
  const { c } = io;
  if (!playing) {
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + 3);
    gain.connect(hallFor(c, io.out));
    playing = { mood: wanted, gain, rig: { c, out: gain }, next: c.currentTime + 0.3, bar: 0 };
  }
  const piece = PIECES[wanted];
  const beat = 60 / piece.bpm;
  // Fell far behind (the window was hidden): pick up from now rather than catch up.
  if (playing.next < c.currentTime - 1) playing.next = c.currentTime + 0.1;
  while (playing.next < c.currentTime + 1.2) {
    if (musicVolume() > 0) piece.bar(playing.rig, playing.next, playing.bar, beat);
    playing.next += beat * 4;
    playing.bar++;
  }
}

/** Choose the music for the current screen; the old piece fades as the new one begins. */
export function setMood(m: Mood) {
  if (m === wanted) return;
  wanted = m;
  if (!timer) timer = window.setInterval(tick, 250);
  tick();
}

onAudioWake(() => tick());

/** The music that belongs to each screen. */
export function moodFor(screen: string): Mood {
  switch (screen) {
    case 'title':
    case 'theater':
    case 'end':
      return 'title';
    case 'radio':
      return 'radio';
    case 'debrief':
      return 'dawn';
    default:
      return 'plan';
  }
}
