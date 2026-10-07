/**
 * Procedural sound effects via WebAudio. No audio assets ship with the game.
 *
 * Everything runs through two buses, effects and music, each with its own volume,
 * into a master gain. The volumes and the mute switch are kept in this browser.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let muted = load('sb-muted', 0) === 1;
let sfxVol = load('sb-vol-sfx', 0.8);
let musicVol = load('sb-vol-music', 0.5);
/** Called when the context first exists or sound is switched back on (the music restarts). */
const wakeHooks: (() => void)[] = [];

function load(key: string, dflt: number): number {
  try {
    const v = localStorage.getItem(key);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt;
  } catch {
    return dflt;
  }
}
function save(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* private window: the choice lasts for this session only */
  }
}

/** Volume slider position (0..1) to gain: a squared curve sounds even across the slider. */
const curve = (v: number) => v * v;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.7;
      // A gentle limiter so stacked effects and music never clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      master.connect(comp).connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = curve(sfxVol);
      sfxBus.connect(master);
      musicBus = ctx.createGain();
      musicBus.gain.value = curve(musicVol);
      musicBus.connect(master);
      // Browsers hold sound back until the player first touches the page.
      const unlock = () => {
        if (ctx?.state === 'suspended' && !muted) void ctx.resume();
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
      wakeHooks.forEach((f) => f());
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** The context and music bus, for the music module (null while muted or unavailable). */
export function musicOut(): { c: AudioContext; out: GainNode } | null {
  const c = ac();
  return c && musicBus ? { c, out: musicBus } : null;
}
export function onAudioWake(f: () => void) {
  wakeHooks.push(f);
}

export function setMuted(m: boolean) {
  muted = m;
  save('sb-muted', m ? 1 : 0);
  if (m && ctx) void ctx.suspend();
  if (!m) {
    ac();
    wakeHooks.forEach((f) => f());
  }
}
export function isMuted() {
  return muted;
}

export function sfxVolume() {
  return sfxVol;
}
export function musicVolume() {
  return musicVol;
}
export function setSfxVolume(v: number) {
  sfxVol = v;
  save('sb-vol-sfx', v);
  if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(curve(v), ctx.currentTime, 0.05);
}
export function setMusicVolume(v: number) {
  musicVol = v;
  save('sb-vol-music', v);
  if (ctx && musicBus) musicBus.gain.setTargetAtTime(curve(v), ctx.currentTime, 0.05);
}

const noiseCache = new Map<number, AudioBuffer>();
/** White noise; buffers are cached by length so a typed message does not allocate per key. */
function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const hit = noiseCache.get(len);
  if (hit) return hit;
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(len, b);
  return b;
}

function env(c: AudioContext, g: GainNode, a: number, peak: number, d: number, at = c.currentTime) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + a);
  g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
}

function noise(c: AudioContext, dur: number, type: BiquadFilterType, freq: number, q: number, a: number, peak: number, at = c.currentTime): AudioBufferSourceNode {
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, dur);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  env(c, g, a, peak, Math.max(0.005, dur - a), at);
  n.connect(f).connect(g).connect(sfxBus!);
  n.start(at);
  return n;
}

function tone(c: AudioContext, type: OscillatorType, f0: number, f1: number, a: number, peak: number, d: number, at = c.currentTime) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + a + d);
  const g = c.createGain();
  env(c, g, a, peak, d, at);
  o.connect(g).connect(sfxBus!);
  o.start(at);
  o.stop(at + a + d + 0.02);
}

/** Single typewriter key strike: the type bar's snap and the platen's thud. */
export function sfxKey() {
  const c = ac();
  if (!c || !sfxBus) return;
  noise(c, 0.03, 'bandpass', 2800 + Math.random() * 1400, 2.5, 0.001, 0.2);
  tone(c, 'sine', 210 + Math.random() * 40, 120, 0.001, 0.12, 0.03);
}

/** Rubber stamp: a heavy thump on a desk, a little wood in it. */
export function sfxStamp() {
  const c = ac();
  if (!c || !sfxBus) return;
  tone(c, 'sine', 150, 48, 0.002, 0.75, 0.16);
  tone(c, 'triangle', 320, 260, 0.001, 0.12, 0.06);
  noise(c, 0.07, 'lowpass', 1100, 0.7, 0.001, 0.4);
}

/** A sheet of paper slid across the desk: noise sweeping up then settling. */
export function sfxPaper() {
  const c = ac();
  if (!c || !sfxBus) return;
  const t = c.currentTime;
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.22);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1400, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + 0.12);
  bp.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
  g.gain.setValueAtTime(0.09, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  n.connect(bp).connect(g).connect(sfxBus);
  n.start(t);
}

/** The field telephone: two British double rings from a real bell, not a beeper. */
export function sfxRing() {
  const c = ac();
  if (!c || !sfxBus) return;
  const t0 = c.currentTime + 0.05;
  for (const start of [0, 0.6, 2.0, 2.6]) {
    // The clapper strikes the bell about 18 times a second while the ring lasts.
    for (let k = 0; k < 7; k++) {
      const at = t0 + start + k * 0.055;
      for (const [f, p] of [[1180, 0.05], [2950, 0.018], [4100, 0.008]] as const) tone(c, 'sine', f, f, 0.002, p, 0.12, at);
    }
  }
}

/** A switch or button: a short dry tick, not a beep. */
export function sfxClick() {
  const c = ac();
  if (!c || !sfxBus) return;
  noise(c, 0.018, 'highpass', 2200, 0.8, 0.0008, 0.12);
  tone(c, 'sine', 1900, 1300, 0.0008, 0.035, 0.018);
}

// ——— The R/T set ———
// Crews come through a valve VHF set: a press-to-talk thump, a carrier that hisses and
// whistles while the voice is on, then the squelch closes with a short rush.

let distCurve: Float32Array<ArrayBuffer> | null = null;
function crush(c: AudioContext): WaveShaperNode {
  const w = c.createWaveShaper();
  if (!distCurve) {
    distCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      distCurve[i] = Math.tanh(x * 3.2);
    }
  }
  w.curve = distCurve;
  return w;
}

/** The narrow telephone band of the R/T set, through a little valve overdrive. */
function radioBand(c: AudioContext): { input: AudioNode; output: GainNode } {
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 420;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  lp.Q.value = 1.4;
  const out = c.createGain();
  hp.connect(crush(c)).connect(lp).connect(out).connect(sfxBus!);
  return { input: hp, output: out };
}

/** The press-to-talk relay: a low clunk and a click of the carrier coming up. */
function pttClick(c: AudioContext, at: number, peak = 1) {
  tone(c, 'square', 95, 70, 0.001, 0.07 * peak, 0.035, at);
  noise(c, 0.012, 'bandpass', 3200, 1.5, 0.0005, 0.14 * peak, at);
}

/** The squelch closing: a short rush of hiss that cuts off. */
function squelch(c: AudioContext, at: number, peak = 0.12) {
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.16);
  const band = radioBand(c);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  g.gain.setValueAtTime(peak, at + 0.11);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
  n.connect(g).connect(band.input);
  n.start(at);
}

let channel: { stop: (trouble: boolean) => void } | null = null;

/**
 * A crew comes on the air. The channel stays open, hissing, with the warble of a
 * voice under the static, until `radioOff` closes it. A crew in trouble comes through
 * louder and rougher, the carrier unsteady.
 */
export function radioOn(trouble = false) {
  const c = ac();
  if (!c || !sfxBus) return;
  channel?.stop(false);
  const t = c.currentTime;
  pttClick(c, t, trouble ? 1.3 : 1);
  const band = radioBand(c);
  band.output.gain.setValueAtTime(0.0001, t);
  band.output.gain.exponentialRampToValueAtTime(1, t + 0.03);

  // Carrier hiss.
  const hiss = c.createBufferSource();
  hiss.buffer = noiseBuffer(c, 2);
  hiss.loop = true;
  const hg = c.createGain();
  hg.gain.value = trouble ? 0.11 : 0.06;
  hiss.connect(hg).connect(band.input);
  hiss.start(t);

  // A voice under the static: band noise opened and closed at the pace of speech.
  const voice = c.createBufferSource();
  voice.buffer = noiseBuffer(c, 2);
  voice.loop = true;
  const formant = c.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.value = 900;
  formant.Q.value = 3;
  const vg = c.createGain();
  vg.gain.value = 0;
  const syl = c.createOscillator();
  syl.type = 'sine';
  syl.frequency.value = trouble ? 7.5 : 5.5;
  const sylDepth = c.createGain();
  sylDepth.gain.value = trouble ? 0.16 : 0.1;
  syl.connect(sylDepth).connect(vg.gain);
  const wob = c.createOscillator();
  wob.frequency.value = 2.3;
  const wobDepth = c.createGain();
  wobDepth.gain.value = 260;
  wob.connect(wobDepth).connect(formant.frequency);
  voice.connect(formant).connect(vg).connect(band.input);
  voice.start(t);
  syl.start(t);
  wob.start(t);

  // Heterodyne whistle: a faint tone drifting off the carrier.
  const het = c.createOscillator();
  het.type = 'sine';
  het.frequency.setValueAtTime(trouble ? 1500 : 1150, t);
  const drift = c.createOscillator();
  drift.frequency.value = trouble ? 3.1 : 0.7;
  const dd = c.createGain();
  dd.gain.value = trouble ? 140 : 25;
  drift.connect(dd).connect(het.frequency);
  const hetG = c.createGain();
  hetG.gain.value = trouble ? 0.03 : 0.012;
  het.connect(hetG).connect(band.input);
  het.start(t);
  drift.start(t);

  // Crackle: random pops on the line, more of them when the set is shot about.
  let alive = true;
  const pop = () => {
    if (!alive) return;
    noise(c, 0.006 + Math.random() * 0.01, 'bandpass', 1200 + Math.random() * 1800, 1, 0.0005, (trouble ? 0.35 : 0.18) * Math.random());
    window.setTimeout(pop, (trouble ? 35 : 70) + Math.random() * (trouble ? 90 : 220));
  };
  window.setTimeout(pop, 40);

  const sources = [hiss, voice, syl, wob, het, drift];
  const self = {
    stop: (hard: boolean) => {
      alive = false;
      const now = c.currentTime;
      band.output.gain.cancelScheduledValues(now);
      band.output.gain.setValueAtTime(band.output.gain.value || 1, now);
      band.output.gain.exponentialRampToValueAtTime(0.0001, now + (hard ? 0.01 : 0.03));
      sources.forEach((s) => s.stop(now + 0.05));
      if (!hard) squelch(c, now + 0.02);
      if (channel === self) channel = null;
    },
  };
  channel = self;
}

/** The crew stops talking: the squelch closes. */
export function radioOff() {
  channel?.stop(false);
}

/** A transmission cut off mid-word: a loud tearing burst, then dead air. */
export function radioCut() {
  const c = ac();
  if (!c || !sfxBus) return;
  channel?.stop(true);
  const t = c.currentTime;
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.2);
  const band = radioBand(c);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.005);
  // Ragged: the burst stutters before it dies.
  for (let k = 1; k < 6; k++) g.gain.setValueAtTime(k % 2 ? 0.06 : 0.28, t + k * 0.025);
  g.gain.setValueAtTime(0.0001, t + 0.16);
  n.connect(g).connect(band.input);
  n.start(t);
  tone(c, 'sawtooth', 1800, 300, 0.002, 0.04, 0.14, t);
}

/** Short burst of R/T: a carrier keyed up and released (orders going out, a call in passing). */
export function sfxStatic(dur = 0.25) {
  const c = ac();
  if (!c || !sfxBus) return;
  radioOn(false);
  window.setTimeout(() => radioOff(), dur * 1000);
}

let drone: { stop: () => void } | null = null;
/** Bomber engines far off over the radio room: slow beating of unsynchronised propellers. */
export function startDrone() {
  const c = ac();
  if (!c || !sfxBus || drone) return;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 3);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  // Engines a few tenths of a hertz apart: the familiar throbbing of a bomber stream.
  const oscs = [55, 55.6, 82.4, 83.3, 110.2].map((f) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
    return o;
  });
  lp.connect(g).connect(sfxBus);
  drone = {
    stop: () => {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.2);
      oscs.forEach((o) => o.stop(c.currentTime + 1.3));
      drone = null;
    },
  };
}
export function stopDrone() {
  drone?.stop();
}
