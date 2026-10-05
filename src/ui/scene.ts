/** Animated top-down pixel scene for the title screen. */
import { Rng } from '../core/rng';
import type { AircraftKind, SideId } from '../core/types';
import { renderAircraft } from './sprites';

const W = 480;
const H = 270;
const FIELD = ['#3b4630', '#46502f', '#4f4a2e', '#3e4a36', '#55553a', '#434d3a', '#4a4330'];

function shadeHex(c: string, f: number): string {
  const n = parseInt(c.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function vnoise(x: number, y: number, seed: number, s: number): number {
  const f = (xx: number, yy: number) => {
    let h = (xx * 374761393 + yy * 668265263 + seed * 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const gx = Math.floor(x / s);
  const gy = Math.floor(y / s);
  const tx = (x / s) - gx;
  const ty = (y / s) - gy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = f(gx, gy), b = f(gx + 1, gy), c = f(gx, gy + 1), d = f(gx + 1, gy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function terrain(rng: Rng, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a4430';
  g.fillRect(0, 0, W, h);
  // Patchwork fields by recursive subdivision.
  const split = (x: number, y: number, w: number, hh: number, depth: number) => {
    if (depth > 4 || (w < 50 && hh < 40) || (depth > 2 && rng.chance(0.3))) {
      const col = rng.pick(FIELD);
      g.fillStyle = col;
      g.fillRect(x, y, w, hh);
      const furrow = rng.int(0, 3);
      if (furrow === 1) {
        g.fillStyle = shadeHex(col, 0.86);
        for (let fy = y + 1; fy < y + hh; fy += 2) g.fillRect(x + 1, fy, w - 2, 1);
      } else if (furrow === 2) {
        g.fillStyle = shadeHex(col, 0.88);
        for (let fx = x + 1; fx < x + w; fx += 2) g.fillRect(fx, y + 1, 1, hh - 2);
      } else if (furrow === 3) {
        g.fillStyle = shadeHex(col, 1.12);
        for (let k = 0; k < (w * hh) / 30; k++) g.fillRect(x + rng.int(1, w - 2), y + rng.int(1, hh - 2), 1, 1);
      }
      // Hedgerows with trees.
      g.fillStyle = '#26301f';
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y, 1, hh);
      for (let k = 0; k < (w + hh) / 14; k++) {
        g.fillStyle = rng.chance(0.5) ? '#1f2a1a' : '#2c3a22';
        if (rng.chance(0.5)) g.fillRect(x + rng.int(0, w - 2), y - 1, 2, 2);
        else g.fillRect(x - 1, y + rng.int(0, hh - 2), 2, 2);
      }
      return;
    }
    if (w > hh * 1.2 || (w > hh * 0.8 && rng.chance(0.5))) {
      const cut = Math.round(w * rng.range(0.3, 0.7));
      split(x, y, cut, hh, depth + 1);
      split(x + cut, y, w - cut, hh, depth + 1);
    } else {
      const cut = Math.round(hh * rng.range(0.3, 0.7));
      split(x, y, w, cut, depth + 1);
      split(x, y + cut, w, hh - cut, depth + 1);
    }
  };
  for (let by = 0; by < h; by += 90) for (let bx = 0; bx < W; bx += 120) split(bx, by, 120, 90, 0);
  // River
  g.fillStyle = '#2b3a44';
  for (let yy = 0; yy < h; yy++) {
    const cx = W * 0.68 + Math.sin(yy / 37) * 40 + Math.sin(yy / 13) * 6;
    g.fillRect(Math.round(cx), yy, 6, 1);
    g.fillStyle = '#3d505c';
    g.fillRect(Math.round(cx) + 1, yy, 1, 1);
    g.fillStyle = '#2b3a44';
  }
  // Road
  g.fillStyle = '#6b6450';
  for (let yy = 0; yy < h; yy++) {
    const cx = W * 0.22 + Math.sin(yy / 61) * 30;
    g.fillRect(Math.round(cx), yy, 2, 1);
  }
  // A village: tiny roofs
  for (let k = 0; k < 3; k++) {
    const vx = rng.int(40, W - 40);
    const vy = rng.int(20, h - 20);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = rng.pick(['#5a3a2e', '#6a4836', '#4a3a34']);
      g.fillRect(vx + rng.int(-10, 10), vy + rng.int(-8, 8), 3, 2);
    }
  }
  return c;
}

function clouds(seed: number, h: number, thresh = 0.64): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, h);
  const field = new Float32Array(W * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      const t = y / h;
      const N = (yy: number) => vnoise(x, yy, seed, 46) * 0.62 + vnoise(x, yy, seed + 1, 15) * 0.28 + vnoise(x, yy, seed + 2, 5) * 0.1;
      field[y * W + x] = N(y) * (1 - t) + N(y - h) * t;
    }
  const at = (x: number, y: number) => field[((y + h) % h) * W + ((x + W) % W)];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      const n = at(x, y);
      if (n < thresh) continue;
      const i = (y * W + x) * 4;
      // Light from the top-left: compare with the neighbour towards the light.
      const lit = at(x - 2, y - 2) < n - 0.01;
      const shade = at(x + 2, y + 2) < thresh + 0.01;
      let v = 214;
      if (lit) v = 240;
      if (shade) v = 172;
      if (n < thresh + 0.015 && (x + y) % 2 === 0) continue; // dithered fringe
      img.data[i] = v;
      img.data[i + 1] = v - 4;
      img.data[i + 2] = v - 12;
      img.data[i + 3] = 240;
    }
  g.putImageData(img, 0, 0);
  return c;
}

function spriteCanvas(kind: AircraftKind, side: SideId, seed: number): HTMLCanvasElement {
  const r = renderAircraft(kind, { side, seed });
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  c.getContext('2d')!.putImageData(new ImageData(r.data, r.w, r.h), 0, 0);
  return c;
}

export function titleScene(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'scene pix';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const rng = Rng.fromSeed('title');
  const land = terrain(rng, H * 2);
  const cl = clouds(11, H * 2, 0.66);
  const cl2 = clouds(29, H * 2, 0.7);
  const bomber = spriteCanvas('medium', 0, 3);
  const heavy = spriteCanvas('heavy', 0, 5);
  const fighter = spriteCanvas('fighter', 1, 9);
  const formation = [
    [0, 0, heavy], [-58, 34, bomber], [58, 34, bomber], [-110, 70, bomber], [110, 70, bomber],
  ] as [number, number, HTMLCanvasElement][];
  const puffs: { x: number; y: number; age: number }[] = [];
  let t = 0;
  let last = 0;
  const frame = (now: number) => {
    if (!c.isConnected && t > 0) return;
    requestAnimationFrame(frame);
    if (now - last < 66) return; // ~15 fps, deliberately chunky
    last = now;
    t++;
    const ly = (t * 0.5) % (H * 2);
    g.drawImage(land, 0, ly - H * 2);
    g.drawImage(land, 0, ly);
    // Dusk tint
    g.fillStyle = 'rgba(20, 18, 40, 0.28)';
    g.fillRect(0, 0, W, H);
    // Cloud shadows then clouds (parallax)
    const cy = (t * 0.9) % (H * 2);
    g.globalAlpha = 0.3;
    g.filter = 'brightness(0)';
    g.drawImage(cl, 14, cy - H * 2 + 14);
    g.drawImage(cl, 14, cy + 14);
    g.filter = 'none';
    g.globalAlpha = 0.9;
    g.drawImage(cl, 0, cy - H * 2);
    g.drawImage(cl, 0, cy);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // Formation shadows
    const fx = W * 0.6 + Math.sin(t / 40) * 4;
    const fy = 30;
    g.globalAlpha = 0.3;
    for (const [dx, dy, s] of formation) {
      g.filter = 'brightness(0)';
      g.drawImage(s, Math.round(fx + dx - s.width / 2 + 30), Math.round(fy + dy + 36));
    }
    g.filter = 'none';
    g.globalAlpha = 1;
    for (const [dx, dy, s] of formation) g.drawImage(s, Math.round(fx + dx - s.width / 2), Math.round(fy + dy + Math.sin((t + dx) / 9)));
    // Enemy fighter diving through
    const ex = ((t * 3) % (W + 200)) - 100;
    g.drawImage(fighter, Math.round(ex), Math.round(40 + ex * 0.35));
    // High clouds over everything
    g.globalAlpha = 0.8;
    const cy2 = (t * 1.4) % (H * 2);
    g.drawImage(cl2, 0, cy2 - H * 2);
    g.drawImage(cl2, 0, cy2);
    g.globalAlpha = 1;
    // Flak
    if (t % 6 === 0) puffs.push({ x: fx + rng.range(-170, 170), y: fy + rng.range(-60, 120), age: 0 });
    for (const p of puffs) {
      p.age++;
      p.y += 0.5;
      const r = Math.min(6, 2 + p.age * 0.6);
      g.fillStyle = p.age < 3 ? '#f0b040' : p.age < 20 ? '#2a2724' : '#4a4642';
      g.globalAlpha = Math.max(0, 1 - p.age / 50);
      g.beginPath();
      g.arc(Math.round(p.x), Math.round(p.y), r, 0, Math.PI * 2);
      g.fill();
      if (p.age >= 3 && p.age < 20) {
        g.fillStyle = '#5a554e';
        g.fillRect(Math.round(p.x - r / 2), Math.round(p.y - r / 2), 2, 2);
      }
      g.globalAlpha = 1;
    }
    while (puffs.length && puffs[0].age > 50) puffs.shift();
    // Vignette
    const grd = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
  return c;
}
