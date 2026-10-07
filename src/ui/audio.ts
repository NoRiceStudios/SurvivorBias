/** Procedural sound effects via WebAudio. No audio assets ship with the game. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (m && ctx) void ctx.suspend();
}
export function isMuted() {
  return muted;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function env(c: AudioContext, g: GainNode, a: number, peak: number, d: number) {
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** Single typewriter key strike. */
export function sfxKey() {
  const c = ac();
  if (!c || !master) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.04);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500 + Math.random() * 1500;
  bp.Q.value = 2;
  const g = c.createGain();
  env(c, g, 0.001, 0.25, 0.035);
  src.connect(bp).connect(g).connect(master);
  src.start();
}

/** Rubber stamp thump. */
export function sfxStamp() {
  const c = ac();
  if (!c || !master) return;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.12);
  const g = c.createGain();
  env(c, g, 0.002, 0.7, 0.15);
  o.connect(g).connect(master);
  o.start();
  o.stop(c.currentTime + 0.2);
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.06);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g2 = c.createGain();
  env(c, g2, 0.001, 0.4, 0.05);
  n.connect(lp).connect(g2).connect(master);
  n.start();
}

/** Short burst of radio static with a squelch tail. */
export function sfxStatic(dur = 0.25) {
  const c = ac();
  if (!c || !master) return;
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, dur);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.7;
  const g = c.createGain();
  env(c, g, 0.005, 0.18, dur);
  n.connect(bp).connect(g).connect(master);
  n.start();
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = 1200;
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, c.currentTime + dur);
  g2.gain.exponentialRampToValueAtTime(0.05, c.currentTime + dur + 0.01);
  g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur + 0.07);
  o.connect(g2).connect(master);
  o.start();
  o.stop(c.currentTime + dur + 0.1);
}

/** A sheet of paper slid or turned: a short band of noise. */
export function sfxPaper() {
  const c = ac();
  if (!c || !master) return;
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.08);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2500;
  bp.Q.value = 0.8;
  const g = c.createGain();
  env(c, g, 0.01, 0.12, 0.06);
  n.connect(bp).connect(g).connect(master);
  n.start();
}

/** The field telephone: two British double rings. */
export function sfxRing() {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + 0.05;
  for (const start of [0, 0.6, 2.0, 2.6]) {
    for (const f of [400, 450]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + start + 0.02);
      g.gain.setValueAtTime(0.05, t0 + start + 0.38);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.4);
      o.connect(g).connect(master);
      o.start(t0 + start);
      o.stop(t0 + start + 0.42);
    }
  }
}

export function sfxClick() {
  const c = ac();
  if (!c || !master) return;
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = 520;
  const g = c.createGain();
  env(c, g, 0.001, 0.06, 0.04);
  o.connect(g).connect(master);
  o.start();
  o.stop(c.currentTime + 0.06);
}

let drone: { stop: () => void } | null = null;
/** Low engine drone for the radio room. */
export function startDrone() {
  const c = ac();
  if (!c || !master || drone) return;
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.07, c.currentTime + 2);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 220;
  const oscs = [55, 55.7, 82.4, 83.1].map((f) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
    return o;
  });
  lp.connect(g).connect(master);
  drone = {
    stop: () => {
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.8);
      oscs.forEach((o) => o.stop(c.currentTime + 0.9));
      drone = null;
    },
  };
}
export function stopDrone() {
  drone?.stop();
}
