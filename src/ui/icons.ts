/** Hand-placed 9x9 pixel icons. Each char maps to a palette entry. */
const ICONS: Record<string, string[]> = {
  supplies: [
    '.........',
    '.kkkkkkk.',
    '.kwwwwwk.',
    '.kwbwbwk.',
    '.kkkkkkk.',
    '.kwwwwwk.',
    '.kwbwbwk.',
    '.kkkkkkk.',
    '.........',
  ],
  fuel: [
    '..kkkkk..',
    '.krrrrrk.',
    '.kRRRRRk.',
    '.krrrrrk.',
    '.krrrrrk.',
    '.kRRRRRk.',
    '.krrrrrk.',
    '..kkkkk..',
    '.........',
  ],
  munitions: [
    '....k....',
    '...kgk...',
    '..kgggk..',
    '..kgGgk..',
    '..kgGgk..',
    '..kgggk..',
    '..kgggk..',
    '.kk.k.kk.',
    '.........',
  ],
  crew: [
    '...kkk...',
    '..kwwwk..',
    '..kwwwk..',
    '...kkk...',
    '..kgggk..',
    '.kgggggk.',
    '.kgggggk.',
    '.kkkkkkk.',
    '.........',
  ],
  trust: [
    '.k.....k.',
    'kyk...kyk',
    'kyykkkyyk',
    '.kyyyyyk.',
    '..kyyyk..',
    '..kyyyk..',
    '...kyk...',
    '....k....',
    '.........',
  ],
  front: [
    '.k.......',
    '.krrrr...',
    '.krrrrr..',
    '.krrrr...',
    '.k.......',
    '.k.......',
    '.k.......',
    'kkk......',
    '.........',
  ],
  week: [
    'kkkkkkkkk',
    'krrrrrrrk',
    'kkkkkkkkk',
    'kwwwwwwwk',
    'kwkwkwkwk',
    'kwwwwwwwk',
    'kwkwkwkwk',
    'kkkkkkkkk',
    '.........',
  ],
  gunnery: [
    '...kkk...',
    '.kkwwwkk.',
    '.kw.k.wk.',
    'kw..k..wk',
    'kkkk.kkkk',
    'kw..k..wk',
    '.kw.k.wk.',
    '.kkwwwkk.',
    '...kkk...',
  ],
  engines: [
    '....k....',
    '..k.k.k..',
    '..kkkkk..',
    'kkkwwwkkk',
    '..kwkwk..',
    'kkkwwwkkk',
    '..kkkkk..',
    '..k.k.k..',
    '....k....',
  ],
  protection: [
    'kkkkkkkkk',
    'kggggGggk',
    'kggggGggk',
    'kggggGggk',
    '.kgggGgk.',
    '.kgggGgk.',
    '..kggGk..',
    '...kgk...',
    '....k....',
  ],
  bombing: [
    '.......k.',
    '......ky.',
    '...kkkk..',
    '..kggggk.',
    '.kgGgggk.',
    '.kgggggk.',
    '.kggggk..',
    '..kkkk...',
    '.........',
  ],
  signals: [
    '....y....',
    '...y.y...',
    '..y.k.y..',
    '....k....',
    '....k....',
    '...kkk...',
    '..k.k.k..',
    '.k..k..k.',
    'kkkkkkkkk',
  ],
  industry: [
    '.k.....k.',
    'kkk.k.kkk',
    '.kkkkkkk.',
    '..kw.wk..',
    'kkkw.wkkk',
    '..kw.wk..',
    '.kkkkkkk.',
    'kkk...kkk',
    '.k.....k.',
  ],
  plane: [
    '....k....',
    '....k....',
    '...kwk...',
    'kkkkwkkkk',
    'kwwwwwwwk',
    '.kkkwkkk.',
    '....w....',
    '...kwk...',
    '...kkk...',
  ],
};

const COLORS: Record<string, string> = {
  k: '#16171a',
  w: '#c9a46a',
  b: '#7a5a32',
  r: '#7c2a24',
  R: '#a8443a',
  g: '#5f6f47',
  G: '#8a9a62',
  y: '#d8b040',
};

const cache = new Map<string, string>();

/** Returns a data URL for an icon at 1x; scale with CSS. */
export function iconUrl(name: string): string {
  if (cache.has(name)) return cache.get(name)!;
  const rows = ICONS[name];
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 9;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = COLORS[ch];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  const url = c.toDataURL();
  cache.set(name, url);
  return url;
}

export function icon(name: string, size = 18): HTMLImageElement {
  const img = document.createElement('img');
  img.src = iconUrl(name);
  img.width = size;
  img.height = size;
  img.className = 'icon';
  img.alt = name;
  return img;
}
