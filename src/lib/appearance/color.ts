/** OKLCH as the design tokens write it: lightness 0-1, chroma, hue in degrees. */
export type Oklch = { l: number; c: number; h: number };

const GAMMA_BREAK = 0.0031308;

function toLinear(channel: number) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number) {
  return channel <= GAMMA_BREAK ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

/** Linear sRGB, unclamped: values outside 0-1 mean the colour is out of gamut. */
export function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** Same lightness and hue with chroma lowered until sRGB can show it. */
export function fitGamut(color: Oklch): Oklch {
  if (inGamut(oklchToLinearRgb(color))) return color;
  let low = 0;
  let high = color.c;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid;
    else high = mid;
  }
  return { ...color, c: low };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function luminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(fitGamut(color)).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToOklch(hex: string): Oklch {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((v) =>
    toLinear(v / 255)
  );
  const lp = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mp = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const sp = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp;
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp;
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}

export function oklchToHex(color: Oklch): string {
  const channels = oklchToLinearRgb(fitGamut(color)).map((v) =>
    Math.round(clamp01(fromLinear(clamp01(v))) * 255)
  );
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The tokens' `L C H` triplet (`oklch(var(--accent))` wraps it in CSS). */
export function token({ l, c, h }: Oklch): string {
  const round = (value: number, digits: number) => +value.toFixed(digits);
  return `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`;
}

export function parseToken(triplet: string): Oklch {
  const [l, c, h] = triplet.trim().split(/\s+/).map(Number);
  return { l, c, h };
}

/**
 * The nearest lightness at which `color` reaches `ratio` against every
 * background, moving away from them. Dark and light backgrounds never mix here:
 * each theme's surfaces sit on one side of the scale.
 */
export function reachContrast(color: Oklch, backgrounds: Oklch[], ratio: number): Oklch {
  const worst = (l: number) =>
    Math.min(...backgrounds.map((bg) => contrastRatio(fitGamut({ ...color, l }), bg)));
  if (worst(color.l) >= ratio) return fitGamut(color);
  const darkBackgrounds = backgrounds.every((bg) => bg.l < 0.5);
  let far = darkBackgrounds ? 1 : 0;
  let near = color.l;
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (worst(mid) >= ratio) far = mid;
    else near = mid;
  }
  return fitGamut({ ...color, l: far });
}
