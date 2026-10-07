/**
 * Procedural score, written note by note and played through WebAudio. Nothing is sampled
 * or recorded: the "orchestra" is oscillators and filtered noise, so the game still ships
 * without audio assets or licences.
 *
 * Each mood is a short piece in bars; a scheduler queues the next bar a little ahead of
 * time and moods crossfade when the screen changes.
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

/** Bowed strings: two detuned saws per note through a soft filter, slow to speak. */
function strings(r: Rig, notes: number[], t: number, dur: number, vol: number, bright = 1300) {
  const { c } = r;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = bright;
  lp.Q.value = 0.5;
  const g = c.createGain();
  const a = Math.min(0.9, dur * 0.3);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + dur - 0.1);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.9);
  lp.connect(g).connect(r.out);
  for (const m of notes) {
    for (const det of [-7, 6]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 1);
    }
  }
}

/** A muted brass voice for melodies, with vibrato that arrives once the note is held. */
function horn(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = hz(m);
  const vib = c.createOscillator();
  vib.frequency.value = 5.2;
  const vd = c.createGain();
  vd.gain.setValueAtTime(0, t);
  vd.gain.linearRampToValueAtTime(0, t + Math.min(0.35, dur * 0.4));
  vd.gain.linearRampToValueAtTime(9, t + Math.min(0.8, dur));
  vib.connect(vd).connect(o.detune);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1;
  lp.frequency.setValueAtTime(500, t);
  lp.frequency.linearRampToValueAtTime(1500, t + 0.12);
  lp.frequency.linearRampToValueAtTime(1100, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.08);
  g.gain.setValueAtTime(vol * 0.85, t + Math.max(0.1, dur - 0.08));
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
  o.connect(lp).connect(g).connect(r.out);
  o.start(t);
  vib.start(t);
  o.stop(t + dur + 0.3);
  vib.stop(t + dur + 0.3);
}

/** An upright piano in the mess: a struck tone that dies away. */
function piano(r: Rig, m: number, t: number, vol: number, len = 2.4) {
  const { c } = r;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
  lp.connect(g).connect(r.out);
  for (const [mul, type, lvl] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]] as const) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = hz(m) * mul;
    // A slightly out-of-tune piano, as every piano in a mess hut is.
    o.detune.value = (Math.random() - 0.5) * 8;
    const og = c.createGain();
    og.gain.value = lvl;
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + len + 0.05);
  }
}

function bass(r: Rig, m: number, t: number, dur: number, vol: number) {
  const { c } = r;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = hz(m);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.05);
  g.gain.setValueAtTime(vol, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
  o.connect(g).connect(r.out);
  o.start(t);
  o.stop(t + dur + 0.25);
}

let noise: AudioBuffer | null = null;
function noiseBuf(c: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === c.sampleRate) return noise;
  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

/** Timpani: a tuned drum with a soft mallet. */
function timp(r: Rig, m: number, t: number, vol: number) {
  const { c } = r;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(hz(m) * 1.04, t);
  o.frequency.exponentialRampToValueAtTime(hz(m), t + 0.08);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
  o.connect(g).connect(r.out);
  o.start(t);
  o.stop(t + 1.7);
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 400;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.004);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  n.connect(lp).connect(ng).connect(r.out);
  n.start(t, Math.random() * 0.5, 0.15);
}

/** A field drum played with brushes, far back. */
function snare(r: Rig, t: number, vol: number) {
  const { c } = r;
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 0.6;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  n.connect(bp).connect(g).connect(r.out);
  n.start(t, Math.random() * 0.5, 0.13);
}

// ——— The pieces ———

/** Bar contents: chord for the strings (MIDI), bass note, melody as [note, beats] (0 = rest). */
type Bar = { chord: number[]; bass: number; tune?: [number, number][] };

// D minor. D4 = 62.
/** "Those who came back": a slow hymn for the title and the end of a theatre. */
const HYMN: Bar[] = [
  { chord: [50, 57, 62, 65], bass: 38, tune: [[69, 2], [74, 1], [72, 1]] },
  { chord: [50, 58, 62, 65], bass: 34, tune: [[70, 2], [69, 1], [67, 1]] },
  { chord: [48, 57, 60, 65], bass: 41, tune: [[69, 3], [65, 1]] },
  { chord: [48, 55, 60, 64], bass: 36, tune: [[67, 2], [64, 1], [72, 1]] },
  { chord: [50, 55, 58, 62], bass: 43, tune: [[70, 2], [74, 1], [70, 1]] },
  { chord: [50, 57, 62, 65], bass: 45, tune: [[69, 2], [65, 1], [64, 1]] },
  { chord: [49, 57, 61, 64], bass: 45, tune: [[64, 1], [69, 1], [73, 2]] },
  { chord: [50, 57, 62, 65], bass: 38, tune: [[74, 4]] },
];

/** Planning: the same key, opened out; a piano thinking aloud over held strings. */
const STUDY: Bar[] = [
  { chord: [50, 57, 64, 65], bass: 38 },
  { chord: [46, 53, 57, 62], bass: 34 },
  { chord: [43, 53, 58, 62], bass: 43 },
  { chord: [45, 52, 57, 62], bass: 45 },
  { chord: [50, 57, 60, 65], bass: 38 },
  { chord: [48, 55, 60, 64], bass: 36 },
  { chord: [46, 53, 58, 62], bass: 34 },
  { chord: [45, 52, 57, 61], bass: 45 },
];
/** A lonely horn call that answers itself every few bars of planning. */
const CALLS: [number, number][][] = [
  [[69, 1.5], [67, 0.5], [65, 2]],
  [[62, 1], [65, 1], [69, 2]],
  [[72, 1.5], [70, 0.5], [69, 2]],
];

/** Dawn and the debrief: F major, the relief of the morning and its count. */
const DAWN: Bar[] = [
  { chord: [53, 60, 65, 69], bass: 41, tune: [[72, 2], [69, 2]] },
  { chord: [50, 57, 62, 65], bass: 38, tune: [[70, 1], [69, 1], [67, 2]] },
  { chord: [46, 53, 58, 62], bass: 34, tune: [[65, 2], [62, 2]] },
  { chord: [48, 55, 60, 64], bass: 36, tune: [[64, 3], [0, 1]] },
  { chord: [45, 53, 60, 65], bass: 45, tune: [[69, 2], [72, 2]] },
  { chord: [43, 55, 58, 62], bass: 43, tune: [[74, 1], [72, 1], [70, 2]] },
  { chord: [48, 55, 60, 64], bass: 36, tune: [[67, 2], [64, 2]] },
  { chord: [41, 53, 60, 65], bass: 41, tune: [[65, 4]] },
];

/** The radio room: low held cluster, a heartbeat on the drum, a pulse in the bass. */
const VIGIL: Bar[] = [
  { chord: [38, 45, 50, 51], bass: 26 },
  { chord: [38, 45, 50, 51], bass: 26 },
  { chord: [39, 46, 51, 55], bass: 27 },
  { chord: [37, 44, 49, 52], bass: 25 },
];

interface Piece {
  bpm: number;
  bar: (r: Rig, t: number, i: number, beat: number) => void;
}

const PIECES: Record<Exclude<Mood, 'none'>, Piece> = {
  title: {
    bpm: 58,
    bar: (r, t, i, b) => {
      const bar = HYMN[i % HYMN.length];
      const pass = Math.floor(i / HYMN.length) % 3;
      strings(r, bar.chord, t, b * 4, 0.022);
      bass(r, bar.bass, t, b * 4, 0.09);
      if (pass === 1) {
        // Second verse: the piano takes the tune, quieter, the horn rests.
        let at = t;
        for (const [m, beats] of bar.tune ?? []) {
          if (m) piano(r, m, at, 0.07);
          at += beats * b;
        }
      } else {
        let at = t;
        for (const [m, beats] of bar.tune ?? []) {
          if (m) horn(r, pass === 2 ? m - 12 : m, at, beats * b * 0.96, 0.035);
          at += beats * b;
        }
      }
      if (i % HYMN.length === 0) timp(r, 38, t, 0.22);
      // The dominant swells into the last bar with a timpani roll.
      if (i % HYMN.length === 6) for (let k = 0; k < 16; k++) timp(r, 45, t + k * b / 4, 0.03 + k * 0.007);
    },
  },
  plan: {
    bpm: 66,
    bar: (r, t, i, b) => {
      const bar = STUDY[i % STUDY.length];
      strings(r, bar.chord, t, b * 4, 0.012, 900);
      bass(r, bar.bass, t, b * 4, 0.06);
      // The piano picks out the chord, never quite the same way twice.
      const tones = bar.chord.slice(1).map((m) => m + 12);
      for (let k = 0; k < 8; k++) {
        if (Math.random() > (k === 0 ? 0.9 : 0.5)) continue;
        const m = tones[Math.floor(Math.random() * tones.length)] + (Math.random() < 0.25 ? 12 : 0);
        piano(r, m, t + k * b / 2 + (Math.random() - 0.5) * 0.02, 0.035 + Math.random() * 0.02);
      }
      if (i % 8 === 4) {
        let at = t + b;
        for (const [m, beats] of CALLS[Math.floor(i / 8) % CALLS.length]) {
          horn(r, m, at, beats * b * 0.95, 0.02);
          at += beats * b;
        }
      }
    },
  },
  radio: {
    bpm: 72,
    bar: (r, t, i, b) => {
      const bar = VIGIL[i % VIGIL.length];
      strings(r, bar.chord, t, b * 4, 0.014, 500);
      for (let k = 0; k < 8; k++) bass(r, bar.bass + (k === 6 ? 7 : 0), t + k * b / 2, b * 0.3, k % 2 ? 0.035 : 0.06);
      // Heartbeat.
      timp(r, 38, t, 0.12);
      timp(r, 38, t + b * 0.4, 0.07);
      timp(r, 38, t + b * 2, 0.1);
      timp(r, 38, t + b * 2.4, 0.06);
      if (i % 4 === 3) for (let k = 0; k < 4; k++) snare(r, t + b * 3 + k * b / 4, 0.02 + k * 0.006);
    },
  },
  dawn: {
    bpm: 60,
    bar: (r, t, i, b) => {
      const bar = DAWN[i % DAWN.length];
      const pass = Math.floor(i / DAWN.length) % 2;
      strings(r, bar.chord, t, b * 4, 0.016, 1100);
      bass(r, bar.bass, t, b * 4, 0.07);
      let at = t;
      for (const [m, beats] of bar.tune ?? []) {
        if (m) {
          if (pass === 0) piano(r, m, at, 0.06, 3);
          else horn(r, m, at, beats * b * 0.95, 0.025);
        }
        at += beats * b;
      }
    },
  },
};

// ——— Scheduler ———

let hall: { c: AudioContext; input: GainNode } | null = null;

/** A large hall: generated impulse response, so the strings have somewhere to ring. */
function hallFor(c: AudioContext, out: GainNode): GainNode {
  if (hall && hall.c === c) return hall.input;
  const len = Math.floor(c.sampleRate * 2.8);
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
  wet.gain.value = 0.32;
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
