/**
 * The desk and its materials, drawn once at start-up: wood grain, the baize
 * of the map table, cork for the intelligence board and a paper grain. Each
 * becomes a small tiling image in a CSS variable (--tex-wood, …).
 */

function tile(size: number, draw: (g: CanvasRenderingContext2D, n: (x: number, y: number) => number) => void): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const grid = Array.from({ length: size * size }, rnd);
  draw(g, (x, y) => grid[(((y % size) + size) % size) * size + (((x % size) + size) % size)]);
  return c.toDataURL();
}

function px(g: CanvasRenderingContext2D, x: number, y: number, c: string) {
  g.fillStyle = c;
  g.fillRect(x, y, 1, 1);
}

export function installTextures() {
  const root = document.documentElement.style;
  // Dark stained wood: long grain lines that wander, darker knots of noise.
  root.setProperty('--tex-wood', `url(${tile(128, (g, n) => {
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        // Long, gently wandering grain; low contrast so it reads as wood, not scanlines.
        const grain = Math.sin((y + Math.sin(x / 23) * 5 + Math.sin(x / 9 + y / 31) * 2) * 0.45) * 0.5 + 0.5;
        const v = grain * 0.45 + n(x, y) * 0.55;
        px(g, x, y, v > 0.8 ? '#29211a' : v > 0.5 ? '#251e17' : v > 0.22 ? '#221b15' : '#1f1913');
      }
  })})`);
  // Map-table baize: a tight, even weave.
  root.setProperty('--tex-baize', `url(${tile(64, (g, n) => {
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = n(x, y) + ((x + y) % 2 ? 0.08 : 0);
        px(g, x, y, v > 0.8 ? '#2d3b31' : v > 0.4 ? '#27342b' : '#222e26');
      }
  })})`);
  // Cork: warm speckle with dark pits.
  root.setProperty('--tex-cork', `url(${tile(96, (g, n) => {
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 96; x++) {
        const v = n(x, y);
        px(g, x, y, v > 0.93 ? '#4a3420' : v > 0.7 ? '#a27e53' : v > 0.35 ? '#94724a' : '#866641');
      }
  })})`);
  // Paper grain: a light speckle laid over any paper colour.
  root.setProperty('--tex-grain', `url(${tile(64, (g, n) => {
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = n(x, y);
        if (v > 0.9) px(g, x, y, 'rgba(40,36,30,0.035)');
        else if (v < 0.06) px(g, x, y, 'rgba(255,255,255,0.05)');
      }
  })})`);
}
