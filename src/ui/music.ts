/**
 * Procedural score, written note by note and played through WebAudio. Nothing is sampled
 * or recorded: the "band" is oscillators and filtered noise, so the game still ships
 * without audio assets or licences. All tunes are original.
 *
 * The music is a military band that takes itself far too seriously: drums that never
 * stop, oom-pah tubas, brass, a fife and a glockenspiel cheerfully doubling the tune
 * while the wing loses a third of its crews. Each mood is a short march in bars; a
 * scheduler queues the next bar a little ahead of time and moods crossfade when the
 * screen changes.
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

/** The off-beat "pah": a short chord from the horns. */
function stab(r: Rig, chord: number[], t: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.012, vol, 0.07, 0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1300;
  lp.connect(g).connect(r.out);
  for (const m of chord) osc(r, 'sawtooth', hz(m), t, t + 0.2, lp);
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

/** The fife: a breathy, slightly sharp little flute. */
function fife(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const g = gainEnv(r, t, 0.02, vol, Math.max(0.02, dur - 0.05), 0.05);
  g.connect(r.out);
  const o = osc(r, 'triangle', hz(m), t, t + dur + 0.08, g, 8);
  const vib = c.createOscillator();
  vib.frequency.value = 6.5;
  const vd = c.createGain();
  vd.gain.value = 12;
  vib.connect(vd).connect(o.detune);
  vib.start(t);
  vib.stop(t + dur + 0.08);
  // The chiff of breath at the start of each note.
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz(m) * 2;
  bp.Q.value = 4;
  const ng = gainEnv(r, t, 0.005, vol * 0.5, 0.01, 0.04);
  n.connect(bp).connect(ng).connect(r.out);
  n.start(t, Math.random() * 0.5, 0.08);
}

/** Glockenspiel: a bright struck bar with an inharmonic overtone. */
function glock(r: Rig, m: number, t: number, vol: number) {
  const { c } = r;
  for (const [mul, lvl, len] of [[1, 1, 0.9], [2.76, 0.3, 0.3], [5.4, 0.1, 0.12]] as const) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * lvl, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(r.out);
    osc(r, 'sine', hz(m) * mul, t, t + len + 0.02, g);
  }
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

/** The march's engine: tuba on the beat, horns on the off-beat. */
function oomPah(r: Rig, bar: Bar, t: number, b: number, tubaVol: number, stabVol: number) {
  for (let k = 0; k < 4; k++) {
    if (k % 2 === 0) tuba(r, k === 0 ? bar.root : bar.fifth, t + k * b, b * 0.7, tubaVol);
    else stab(r, bar.chord, t + k * b, stabVol);
  }
}

/** One bar of a snare cadence: sixteen sixteenths, each a velocity (0 = silent). */
function cadence(r: Rig, pattern: number[], t: number, b: number, vol: number) {
  pattern.forEach((v, k) => snare(r, t + (k * b) / 4, v * vol));
}

// Chords in D. D4 = 62.
const D = [62, 66, 69], G = [62, 67, 71], A = [61, 64, 69], A7 = [61, 67, 69], Bm = [62, 66, 71];
const Dm = [62, 65, 69], C = [60, 64, 67], Bb = [62, 65, 70], AM = [61, 64, 69];

/** "Forward, Regardless": the title march. Dotted rhythms, full of itself. */
const FORWARD: Bar[] = [
  { chord: D, root: 38, fifth: 45, tune: [[69, 0.75], [69, 0.25], [74, 1], [78, 1], [74, 1]] },
  { chord: D, root: 38, fifth: 45, tune: [[69, 0.75], [69, 0.25], [74, 1], [78, 1.5], [76, 0.5]] },
  { chord: G, root: 43, fifth: 38, tune: [[74, 1], [71, 1], [67, 1], [71, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[69, 2], [76, 1], [73, 1]] },
  { chord: D, root: 38, fifth: 45, tune: [[74, 0.75], [74, 0.25], [78, 1], [81, 1], [78, 1]] },
  { chord: Bm, root: 47, fifth: 42, tune: [[79, 0.75], [78, 0.25], [76, 1], [74, 1], [71, 1]] },
  { chord: A7, root: 45, fifth: 40, tune: [[69, 0.75], [71, 0.25], [73, 1], [76, 1], [73, 1]] },
  { chord: D, root: 38, fifth: 45, tune: [[74, 1], [69, 1], [62, 1], [0, 1]] },
];
const MARCH_SNARE = [1, 0, 0.35, 0.35, 0.7, 0, 0.35, 0, 1, 0, 0.35, 0.35, 0.7, 0.35, 0.35, 0.35];

/** "Requisition Form B": fife and drums for planning, a little too jaunty. */
const REQUISITION: Bar[] = [
  { chord: Dm, root: 38, fifth: 45, tune: [[74, 0.5], [77, 0.5], [81, 1], [81, 0.5], [79, 0.5], [77, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[76, 0.5], [77, 0.5], [74, 1], [69, 2]] },
  { chord: C, root: 36, fifth: 43, tune: [[79, 0.5], [76, 0.5], [72, 1], [76, 0.5], [79, 0.5], [84, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[81, 1.5], [77, 0.5], [74, 2]] },
  { chord: Bb, root: 34, fifth: 41, tune: [[77, 0.5], [77, 0.5], [82, 1], [81, 0.5], [79, 0.5], [77, 1]] },
  { chord: C, root: 36, fifth: 43, tune: [[76, 0.5], [76, 0.5], [79, 1], [77, 0.5], [76, 0.5], [74, 1]] },
  { chord: AM, root: 45, fifth: 40, tune: [[73, 0.5], [76, 0.5], [81, 1], [79, 0.5], [77, 0.5], [76, 1]] },
  { chord: Dm, root: 38, fifth: 45, tune: [[74, 2], [0, 2]] },
];
const FIFE_SNARE = [0.9, 0, 0.3, 0, 0.6, 0.3, 0.3, 0, 0.9, 0, 0.3, 0.3, 0.6, 0, 0.3, 0];

/** "Mentioned in Dispatches": the debrief, triumphant whatever the count. */
const DISPATCHES: Bar[] = [
  { chord: D, root: 38, fifth: 45, tune: [[74, 1.5], [74, 0.5], [78, 1], [81, 1]] },
  { chord: G, root: 43, fifth: 38, tune: [[83, 2], [81, 1], [79, 1]] },
  { chord: D, root: 38, fifth: 45, tune: [[78, 1.5], [76, 0.5], [74, 1], [78, 1]] },
  { chord: A, root: 45, fifth: 40, tune: [[76, 3], [0, 1]] },
  { chord: Bm, root: 47, fifth: 42, tune: [[74, 1.5], [73, 0.5], [71, 1], [74, 1]] },
  { chord: G, root: 43, fifth: 38, tune: [[79, 2], [78, 1], [76, 1]] },
  { chord: A7, root: 45, fifth: 40, tune: [[69, 1], [73, 1], [76, 1], [79, 1]] },
  { chord: D, root: 38, fifth: 45, tune: [[78, 1], [74, 3]] },
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
    bpm: 112,
    bar: (r, t, i, b) => {
      const n = i % FORWARD.length;
      const bar = FORWARD[n];
      // Verses: full band; fife and drums alone for a trio; full band with the tune low and pompous.
      const pass = Math.floor(i / FORWARD.length) % 3;
      if (pass !== 1) oomPah(r, bar, t, b, 0.09, 0.022);
      else for (let k = 0; k < 4; k += 2) tuba(r, k ? bar.fifth : bar.root, t + k * b, b * 0.5, 0.06);
      if (n === 3 || n === 7) {
        cadence(r, MARCH_SNARE.slice(0, 8), t, b, 0.05);
        roll(r, t + 2 * b, 2 * b, b, 0.02, 0.07);
      } else cadence(r, MARCH_SNARE, t, b, 0.05);
      bassDrum(r, t, 0.22);
      bassDrum(r, t + 2 * b, 0.16);
      if (n === 0 && pass !== 1) cymbal(r, t, 0.05);
      if (pass === 0) {
        play(bar.tune, t, b, (m, at, d) => brass(r, m, at, d * 0.9, 0.032));
        play(bar.tune, t, b, (m, at) => glock(r, m + 12, at, 0.05));
      } else if (pass === 1) {
        play(bar.tune, t, b, (m, at, d) => fife(r, m + 12, at, d * 0.85, 0.035));
      } else {
        play(bar.tune, t, b, (m, at, d) => brass(r, m - 12, at, d * 0.9, 0.04));
        play(bar.tune, t, b, (m, at, d) => fife(r, m + 12, at, d * 0.85, 0.02));
      }
    },
  },
  plan: {
    bpm: 108,
    bar: (r, t, i, b) => {
      const n = i % REQUISITION.length;
      const bar = REQUISITION[n];
      // Drums and tuba keep step throughout; the tune comes and goes so a long planning
      // session is not one endless jingle.
      const pass = Math.floor(i / REQUISITION.length) % 4;
      for (let k = 0; k < 4; k++) tuba(r, k % 2 ? bar.fifth : bar.root, t + k * b, b * 0.45, 0.07);
      cadence(r, FIFE_SNARE, t, b, 0.04);
      if (n === 7) roll(r, t + 3 * b, b, b, 0.015, 0.05);
      bassDrum(r, t, 0.14);
      if (pass === 1) play(bar.tune, t, b, (m, at, d) => fife(r, m + 12, at, d * 0.8, 0.03));
      else if (pass === 2) {
        // The tuba has a go at the tune, two octaves down. It is not a tuba's tune.
        play(bar.tune, t, b, (m, at, d) => tuba(r, m - 24, at, d * 0.8, 0.06));
        play(bar.tune, t, b, (m, at) => glock(r, m + 12, at, 0.03));
      } else if (pass === 3) {
        play(bar.tune, t, b, (m, at, d) => fife(r, m + 12, at, d * 0.8, 0.028));
        play(bar.tune, t, b, (m, at) => glock(r, m + 12, at, 0.035));
      } else for (let k = 1; k < 4; k += 2) stab(r, bar.chord, t + k * b, 0.012);
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
    bpm: 96,
    bar: (r, t, i, b) => {
      const n = i % DISPATCHES.length;
      const bar = DISPATCHES[n];
      const pass = Math.floor(i / DISPATCHES.length) % 2;
      oomPah(r, bar, t, b, 0.08, 0.02);
      cadence(r, MARCH_SNARE, t, b, pass ? 0.045 : 0.03);
      bassDrum(r, t, 0.18);
      bassDrum(r, t + 2 * b, 0.12);
      if (n === 0) cymbal(r, t, 0.05);
      if (n === 7) {
        // The big finish, every time.
        cymbal(r, t, 0.07);
        roll(r, t + b, 2 * b, b, 0.02, 0.08);
      }
      play(bar.tune, t, b, (m, at, d) => brass(r, pass ? m : m - 12, at, d * 0.92, 0.035));
      if (pass) play(bar.tune, t, b, (m, at) => glock(r, m + 12, at, 0.04));
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
