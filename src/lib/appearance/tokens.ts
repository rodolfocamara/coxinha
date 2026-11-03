import {
  contrastRatio,
  fitGamut,
  hexToOklch,
  parseToken,
  reachContrast,
  type Oklch,
} from './color';
import { CONTRAST, type AccentPreset, type Appearance } from './settings';

export type Theme = 'light' | 'dark';
export const THEMES: readonly Theme[] = ['light', 'dark'];

/** Mirrors `src/index.css`; a test keeps the two in step. */
export const BASE_TOKENS = {
  light: {
    surfaces: {
      canvas: '0.9667 0.0027 84.6',
      surface: '0.9958 0.0016 84.6',
      'surface-2': '0.9405 0.0035 84.6',
      sunken: '0.9232 0.0045 84.6',
      overlay: '0.9958 0.0016 84.6',
    },
    fg: {
      primary: '0.28518 0.00564 271.22',
      secondary: '0.45364 0.00658 274.85',
      tertiary: '0.5005 0.00797 277.04',
      quaternary: '0.55975 0.00775 277.07',
    },
    accent: {
      accent: '0.7 0.14 55',
      hover: '0.65 0.15 55',
      soft: '0.935 0.035 65',
      ink: '0.5249 0.1306 55',
      onAccent: '0.25997 0.01184 67.27',
      selection: '0.86 0.06 55',
      blob: '0.84 0.09 55 / 0.2',
    },
    borderAlpha: 0.08,
    borderInk: 'var(--fg-primary)',
  },
  dark: {
    surfaces: {
      canvas: '0.1645 0.0055 271',
      surface: '0.2085 0.0065 271',
      'surface-2': '0.2455 0.0075 271',
      sunken: '0.1495 0.005 271',
      overlay: '0.2235 0.007 271',
    },
    fg: {
      primary: '0.94548 0.00675 97.35',
      secondary: '0.81001 0.00837 98.91',
      tertiary: '0.7347 0.00881 91.51',
      quaternary: '0.67629 0.00899 91.52',
    },
    accent: {
      accent: '0.77 0.135 55',
      hover: '0.81 0.135 55',
      soft: '0.32 0.06 55',
      ink: '0.77 0.135 55',
      onAccent: '0.25997 0.01184 67.27',
      selection: '0.86 0.06 55',
      blob: '0.74 0.14 55 / 0.13',
    },
    borderAlpha: 0.08,
    borderInk: '1 0 0',
  },
} as const;

/** Lightness and chroma per theme, sized like tangerine so a swap keeps the UI's weight. */
const PRESETS: Record<
  Exclude<AccentPreset, 'tangerine'>,
  { h: number; light: [number, number]; dark: [number, number] }
> = {
  blue: { h: 255, light: [0.7, 0.13], dark: [0.77, 0.115] },
  teal: { h: 195, light: [0.7, 0.11], dark: [0.77, 0.115] },
  green: { h: 150, light: [0.7, 0.14], dark: [0.77, 0.135] },
  violet: { h: 295, light: [0.7, 0.13], dark: [0.77, 0.115] },
  pink: { h: 350, light: [0.7, 0.15], dark: [0.77, 0.125] },
  graphite: { h: 270, light: [0.42, 0.012], dark: [0.86, 0.012] },
};

/** Tangerine's literals, then the rest. Swatches and the picker's starting point read these. */
export function presetColour(preset: AccentPreset, theme: Theme): Oklch {
  if (preset === 'tangerine') return parseToken(BASE_TOKENS[theme].accent.accent);
  const { h, [theme]: shape } = PRESETS[preset];
  return fitGamut({ l: shape[0], c: shape[1], h });
}

const surfacesOf = (theme: Theme) =>
  Object.values(BASE_TOKENS[theme].surfaces).map((value) => parseToken(value));

/** A visible control next to its background (WCAG 1.4.11). */
const NON_TEXT_RATIO = 3;
export const TEXT_RATIO = 4.5;

const INK = parseToken(BASE_TOKENS.light.accent.onAccent);
const WHITE: Oklch = { l: 0.99, c: 0, h: 0 };
const BLACK: Oklch = { l: 0, c: 0, h: 0 };

/**
 * Text on `fills`: today's warm ink when it is readable, else white, else black.
 * One of white and black always reaches 4.5:1 on a single colour; two fills
 * close to each other could split them, so the caller keeps the hover on the
 * safe side of the accent.
 */
export function foregroundOn(fills: Oklch[]): Oklch {
  const worst = (fg: Oklch) => Math.min(...fills.map((fill) => contrastRatio(fg, fill)));
  for (const fg of [INK, WHITE]) if (worst(fg) >= TEXT_RATIO) return fg;
  return worst(BLACK) >= worst(WHITE) ? BLACK : WHITE;
}

export type AccentTokens = {
  accent: Oklch;
  hover: Oklch;
  soft: Oklch;
  ink: Oklch;
  onAccent: Oklch;
  /** The accent as drawn differs from what was picked, to stay visible on this theme. */
  adjusted: boolean;
};

/** Everything derived from one accent colour in one theme; nothing is taken on trust. */
export function deriveAccent(picked: Oklch, theme: Theme): AccentTokens {
  const surfaces = surfacesOf(theme);
  const canvas = parseToken(BASE_TOKENS[theme].surfaces.canvas);
  const accent = reachContrast(fitGamut(picked), [canvas], NON_TEXT_RATIO);
  const onAccent = foregroundOn([accent]);
  // Hover moves away from the text so the pair only gains contrast.
  const towards = onAccent.l > accent.l ? -1 : 1;
  const hover = fitGamut({
    ...accent,
    l: Math.min(0.99, Math.max(0.05, accent.l + towards * 0.05)),
  });
  const soft = fitGamut(
    theme === 'light'
      ? { l: 0.935, c: Math.min(accent.c, 0.035), h: accent.h }
      : { l: 0.32, c: Math.min(accent.c, 0.06), h: accent.h }
  );
  return {
    accent,
    hover,
    soft,
    ink: reachContrast(accent, surfaces, TEXT_RATIO),
    onAccent,
    adjusted: Math.abs(accent.l - picked.l) > 0.002,
  };
}

/** The accent tokens in force for a setting. Tangerine stays index.css's own literals. */
export function accentTokens(a: Pick<Appearance, 'accent' | 'customAccent'>, theme: Theme) {
  if (a.accent === 'tangerine') {
    const base = BASE_TOKENS[theme].accent;
    return {
      accent: parseToken(base.accent),
      hover: parseToken(base.hover),
      soft: parseToken(base.soft),
      ink: parseToken(base.ink),
      onAccent: parseToken(base.onAccent),
      adjusted: false,
    } satisfies AccentTokens;
  }
  const picked = a.accent === 'custom' ? hexToOklch(a.customAccent) : presetColour(a.accent, theme);
  return deriveAccent(picked, theme);
}

/** Least contrast each text level keeps however low the setting goes. */
const TEXT_FLOORS = { primary: 7, secondary: TEXT_RATIO, tertiary: TEXT_RATIO, quaternary: 3.5 };

/**
 * T3 Code's contrast setting: below 100 text fades towards the page, above 100 it
 * moves towards black or white. Floors stop it from going unreadable.
 */
export function textTokens(
  contrast: number,
  theme: Theme
): Record<keyof typeof TEXT_FLOORS, Oklch> {
  const { fg } = BASE_TOKENS[theme];
  const surfaces = surfacesOf(theme);
  const canvas = parseToken(BASE_TOKENS[theme].surfaces.canvas);
  const target = theme === 'dark' ? 1 : 0;
  const levels = Object.keys(TEXT_FLOORS) as (keyof typeof TEXT_FLOORS)[];
  return Object.fromEntries(
    levels.map((level) => {
      const base = parseToken(fg[level]);
      const amount = (contrast - CONTRAST.default) / CONTRAST.default;
      const l =
        amount >= 0
          ? base.l + (target - base.l) * amount * 0.75
          : base.l + (canvas.l - base.l) * -amount;
      return [level, reachContrast({ ...base, l }, surfaces, TEXT_FLOORS[level])];
    })
  ) as Record<keyof typeof TEXT_FLOORS, Oklch>;
}
