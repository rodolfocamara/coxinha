// Generates every logo SVG in this folder from one shared coxinha geometry.
// Usage: node docs/design/logo/build.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'svg');
mkdirSync(out, { recursive: true });

const C = {
  canvas: '#0A0A0A',
  tile: '#161616',
  crust: '#E8892C',
  crustShade: '#C46A1A',
  crumbLight: '#F6B565',
  crumbDark: '#A4520F',
  edge: '#4A2508',
  filling: '#FBE7BC',
  strand: '#E3B465',
  ink: '#0A0A0A',
  tangerine: '#F69B5A',
  rec: '#F0503C',
};

// Flat-bottomed bulb, pinched neck, soft nub on top: what separates a coxinha from a water drop.
const BODY =
  'M50 10 C54.6 10 57.6 13.4 57.6 18 C57.6 22.2 60 27.2 64 33 C68 39 81 50 81 64.5 ' +
  'C81 79.5 68 88 50 88 C32 88 19 79.5 19 64.5 C19 50 32 39 36 33 ' +
  'C40 27.2 42.4 22.2 42.4 18 C42.4 13.4 45.4 10 50 10 Z';

// Small sizes exaggerate the nub and the base so the tip never reads as a flame or a drop.
const TRAY_BODY =
  'M50 8.5 C56 8.5 59.6 12.8 59.6 18.6 C59.6 23 62 27.6 66 33 C70.5 39.5 82.5 50 82.5 65.5 ' +
  'C82.5 80.5 69 89.5 50 89.5 C31 89.5 17.5 80.5 17.5 65.5 C17.5 50 29.5 39.5 34 33 ' +
  'C38 27.6 40.4 23 40.4 18.6 C40.4 12.8 44 8.5 50 8.5 Z';

globalThis.BODY_DEFAULT = BODY;
const inset = (k) => `translate(50 62) scale(${k}) translate(-50 -62)`;

const svg = (viewBox, body, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">\n${body}\n</svg>\n`;

const tile = (fill) => `<rect x="4" y="4" width="92" height="92" rx="22" fill="${fill}"/>`;

// Bite: scallop of two teeth marks on the right shoulder.
const BITE = [
  [73, 29, 12.5],
  [86, 45.5, 12],
];
const TRAY_BITE = [[80, 38, 16]];

function bitten(id, { body: BODY = globalThis.BODY_DEFAULT, bite = BITE, crumbs = true, shade = true, strands = true, edge = 0, face = 7 } = {}) {
  const holes = bite.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#000"/>`).join('');
  const cut = bite.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + face}"/>`).join('');
  const crumbDots = crumbs
    ? [
        [36, 56], [44, 47], [30, 68], [40, 79], [53, 71], [48, 33], [62, 80], [27, 59],
        [46, 62], [35, 72], [58, 58], [51, 49], [41, 39], [66, 69], [55, 84], [31, 78],
      ]
        .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 1.1 : 1.5}" fill="${i % 4 ? C.crumbLight : C.crumbDark}"/>`)
        .join('')
    : '';
  const strandPaths = strands
    ? `<path d="M58 33 q3 -1.5 5 1.5 M60 41 q3 2 6 0 M66 50 q2.5 -3 6 -2 M57 38 q2.5 2 1.5 5.5 M69 56 q2 1.5 4.5 0" fill="none" stroke="${C.strand}" stroke-width="1.8" stroke-linecap="round"/>`
    : '';
  return `<defs>
  <mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>${holes}</mask>
  <clipPath id="${id}-body"><path d="${BODY}"/></clipPath>
  <clipPath id="${id}-in"><path d="${BODY}" transform="${inset(0.89)}"/></clipPath>
</defs>
<g mask="url(#${id}-m)">
  ${edge ? `<path d="${BODY}" fill="none" stroke="${C.edge}" stroke-width="${edge}" stroke-linejoin="round"/>` : ''}
  <path d="${BODY}" fill="${C.crust}"/>
  ${shade ? `<g clip-path="url(#${id}-body)"><path d="M80 40 C86 70 70 96 36 92 C64 86 78 66 72 40 Z" fill="${C.crustShade}"/></g>` : ''}
  <g clip-path="url(#${id}-body)">${crumbDots}</g>
  <g clip-path="url(#${id}-in)" fill="${C.filling}">${cut}</g>
  <g clip-path="url(#${id}-in)">${strandPaths}</g>
</g>`;
}

// A: the silhouette with a bite. The whole logo is the snack itself.
const A = {
  app: svg('0 0 100 100', `${tile(C.tile)}\n<g transform="translate(2 1.5) scale(0.96)">${bitten('a', { face: 10 })}</g>`, 1024),
  tray: svg('8 8 84 84', bitten('at', { body: TRAY_BODY, bite: TRAY_BITE, crumbs: false, shade: false, strands: false, edge: 6, face: 8 }), 32),
  mark: svg('8 8 84 84', bitten('am', { face: 9, strands: false }), 64),
};

// B: cut in half, the shredded chicken is a voice waveform.
const BARS = [
  [36, 10], [43, 20], [50, 30], [57, 18], [64, 8],
];
const bars = (color, w = 4.6) =>
  BARS.map(([x, h]) => `<line x1="${x}" y1="${64 - h / 2}" x2="${x}" y2="${64 + h / 2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
const halved = (id, { edge = 0, trayBars = false } = {}) => `<defs><clipPath id="${id}-in"><path d="${BODY}" transform="${inset(0.8)}"/></clipPath></defs>
${edge ? `<path d="${BODY}" fill="none" stroke="${C.edge}" stroke-width="${edge}" stroke-linejoin="round"/>` : ''}
<path d="${BODY}" fill="${C.crust}"/>
${trayBars ? '' : `<path d="${BODY}" transform="${inset(0.8)}" fill="${C.filling}"/>`}
<g clip-path="url(#${id}-in)">${trayBars
  ? [[40, 12], [50, 26], [60, 12]].map(([x, h]) => `<line x1="${x}" y1="${64 - h / 2}" x2="${x}" y2="${64 + h / 2}" stroke="${C.edge}" stroke-width="7" stroke-linecap="round"/>`).join('')
  : bars(C.crustShade)}</g>`;
const B = {
  app: svg('0 0 100 100', `${tile(C.tile)}\n<g transform="translate(2 1.5) scale(0.96)">${halved('b')}</g>`, 1024),
  tray: svg('8 8 84 84', halved('bt', { edge: 6, trayBars: true }).replaceAll(BODY, TRAY_BODY), 32),
  mark: svg('8 8 84 84', halved('bm'), 64),
};

// C: geometric monoline, the bite left as a break in the line and a record dot as its filling.
const MONO_BITE = [80, 37, 14];
function mono(id, stroke, dot, w, { halo = 0 } = {}) {
  const [bx, by, br] = MONO_BITE;
  const line = (col, sw) => `<g mask="url(#${id}-m)"><path d="${BODY}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round"/></g>
<g clip-path="url(#${id}-c)"><circle cx="${bx}" cy="${by}" r="${br}" fill="none" stroke="${col}" stroke-width="${sw}"/></g>`;
  return `<defs>
  <mask id="${id}-m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/><circle cx="${bx}" cy="${by}" r="${br}" fill="#000"/></mask>
  <clipPath id="${id}-c"><path d="${BODY}"/></clipPath>
</defs>
${halo ? line(C.edge, w + halo) : ''}${line(stroke, w)}
<circle cx="46" cy="64" r="${w * 1.25}" fill="${dot}"${halo ? ` stroke="${C.edge}" stroke-width="${halo / 2}"` : ''}/>`;
}
const Cdir = {
  app: svg('0 0 100 100', `${tile(C.tangerine)}\n<g transform="translate(2 1.5) scale(0.96)">${mono('c', C.ink, C.ink, 7)}</g>`, 1024),
  tray: svg('8 8 84 84', mono('ct', C.crust, C.rec, 9, { halo: 6 }), 32),
  mark: svg('8 8 84 84', mono('cm', C.tangerine, C.tangerine, 7.5), 64),
};

// D: mascot-lite, a coxinha listening in on the meeting.
const freckles = [[34, 72], [64, 74], [47, 44], [57, 52], [40, 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="${C.crumbLight}"/>`).join('');
const face = (s = 1) => `<circle cx="42" cy="62" r="${2.6 * s}" fill="${C.ink}"/><circle cx="58" cy="62" r="${2.6 * s}" fill="${C.ink}"/>
<path d="M45.5 70 q4.5 4 9 0" fill="none" stroke="${C.ink}" stroke-width="${2.2 * s}" stroke-linecap="round"/>`;
const phones = (band, cup, w = 5) => `<path d="M24 60 C22 32 34 22 50 22 C66 22 78 32 76 60" fill="none" stroke="${band}" stroke-width="${w}" stroke-linecap="round"/>
<rect x="15" y="52" width="12" height="20" rx="6" fill="${cup}"/><rect x="73" y="52" width="12" height="20" rx="6" fill="${cup}"/>`;
const cups = (fill) => `<rect x="13" y="51" width="13" height="22" rx="6.5" fill="${fill}"/><rect x="74" y="51" width="13" height="22" rx="6.5" fill="${fill}"/>`;
const D = {
  app: svg('0 0 100 100', `${tile(C.tile)}\n<g transform="translate(2 2.5) scale(0.96)">${phones('#71717A', '#E4E4E7', 6)}<path d="${BODY}" fill="${C.crust}"/>${freckles}${face()}${cups('#E4E4E7')}</g>`, 1024),
  tray: svg('4 6 92 92', `${phones(C.edge, C.edge, 13)}${phones('#E4E4E7', '#E4E4E7', 7)}<path d="${TRAY_BODY}" fill="${C.crust}" stroke="${C.edge}" stroke-width="6" paint-order="stroke"/><rect x="7" y="48" width="18" height="30" rx="9" fill="#E4E4E7" stroke="${C.edge}" stroke-width="5"/><rect x="75" y="48" width="18" height="30" rx="9" fill="#E4E4E7" stroke="${C.edge}" stroke-width="5"/>`, 32),
  mark: svg('8 8 84 84', `${phones('#71717A', '#D4D4D8')}<path d="${BODY}" fill="${C.crust}"/>${face()}${cups('#D4D4D8')}`, 64),
};

const options = { a: A, b: B, c: Cdir, d: D };
for (const [k, o] of Object.entries(options)) {
  for (const [v, s] of Object.entries(o)) writeFileSync(join(out, `${k}-${v}.svg`), s);
}
console.log('wrote', Object.keys(options).length * 3, 'svgs to', out);

const titles = {
  a: ['A. Bitten silhouette', 'The snack itself: golden crust, breadcrumbs, one bite showing the shredded chicken. Recommended and applied.'],
  b: ['B. Waveform filling', 'Cut in half, the shredded chicken becomes a voice waveform. Ties the snack to recording; weakest at 16 px.'],
  c: ['C. Monoline and record dot', 'One line drawn from a circle and a pinched nub, the bite left as a break and the record light inside. Best monochrome reading.'],
  d: ['D. Listening mascot', 'A coxinha with headphones, sitting in on the meeting. Friendliest, but the face disappears below 32 px.'],
};
const SIZES = [16, 22, 32, 64, 256];
const BGS = [['#0A0A0A', 'Canvas'], ['#1f1f1f', 'Dark panel'], ['#f5f5f5', 'Light panel']];
const imgs = (file, sizes) =>
  sizes.map((s) => `<figure><img src="svg/${file}" width="${s}" height="${s}" alt=""><figcaption>${s}</figcaption></figure>`).join('');
const sections = Object.keys(options)
  .map((k) => {
    const [h, p] = titles[k];
    const rows = BGS.map(
      ([bg, name]) => `<div class="row" style="--bg:${bg}" aria-label="${name} ${bg}">
  <div class="group"><h3>App icon</h3><div class="cells">${imgs(`${k}-app.svg`, SIZES)}</div></div>
  <div class="group"><h3>Tray</h3><div class="cells">${imgs(`${k}-tray.svg`, [16, 22, 32, 64])}</div></div>
  <div class="group"><h3>In-app mark</h3><div class="cells">${imgs(`${k}-mark.svg`, [26, 64])}</div></div>
</div>`,
    ).join('\n');
    return `<section id="${k}"${k === 'a' ? ' class="chosen"' : ''}>
<h2>${h}</h2>
<p>${p}</p>
${rows}
</section>`;
  })
  .join('\n');

writeFileSync(
  join(here, 'options.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coxinha logo options</title>
<style>
  :root { color-scheme: dark; --ink: #fafafa; --muted: #a1a1aa; --accent: #f69b5a; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 32px 96px; background: #0A0A0A; color: var(--ink);
    font: 16px/1.55 Geist, ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: clamp(40px, 6vw, 88px); line-height: 0.95; letter-spacing: -0.04em; margin: 0 0 16px; }
  body > p { max-width: 62ch; margin: 0 0 32px; }
  .sheet { display: block; max-width: 100%; height: auto; margin-top: 24px; }
  section { margin-top: 120px; }
  h2 { font-size: 36px; letter-spacing: -0.02em; margin: 0 0 8px; }
  .chosen h2 { color: var(--accent); }
  section > p { margin: 0 0 24px; max-width: 62ch; }
  .row { background: var(--bg); padding: 24px; display: flex; flex-wrap: wrap; gap: 48px; align-items: flex-end; }
  .row[style*="f5f5f5"] { color: #18181b; }
  h3 { font-size: 14px; font-weight: 600; margin: 0 0 12px; opacity: 0.7; }
  .cells { display: flex; gap: 20px; align-items: flex-end; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  figcaption { font-size: 12px; opacity: 0.6; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>Coxinha logo options</h1>
<p>Four directions, each as an app icon, a tray glyph and the in-app rail mark, shown at their real pixel sizes on the app canvas, a dark panel and a light panel. Option A is applied to the app. The rendered sheet with 8x zooms of the 16 px tray is <a href="options.png">options.png</a>.</p>
${sections}
<section>
<h2>Rendered sheet</h2>
<p>Rasterised with rsvg-convert at each size, the way the platform icons are produced.</p>
<img class="sheet" src="options.png" alt="Every option rendered at 16, 22, 32, 64 and 256 px on three backgrounds">
</section>
</body>
</html>
`,
);
console.log('wrote options.html');
