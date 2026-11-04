export const FONT_SIZE = { min: 12, max: 20, default: 16 } as const;
export const CONTRAST = { min: 50, max: 200, step: 5, default: 100 } as const;

export const ACCENT_PRESETS = [
  'tangerine',
  'blue',
  'teal',
  'green',
  'violet',
  'pink',
  'graphite',
] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export const LANGUAGES = ['auto', 'pt-BR', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

/** T3 Code's scheme where it fits this product (spec 0125). */
export type Appearance = {
  fontSize: number;
  contrast: number;
  accent: AccentPreset | 'custom';
  customAccent: string;
  fontFamilySans: string;
  fontFamilyMono: string;
  language: Language;
};

export const DEFAULT_APPEARANCE: Appearance = {
  fontSize: FONT_SIZE.default,
  contrast: CONTRAST.default,
  accent: 'tangerine',
  customAccent: '#e8843c',
  fontFamilySans: '',
  fontFamilyMono: '',
  language: 'auto',
};

export const APPEARANCE_STORAGE_KEY = 'coxinha.appearance';
/** The generated stylesheet, ready for the script in index.html before first paint. */
export const APPEARANCE_CSS_KEY = 'coxinha.appearance.css';

/** The catalog a language setting selects; Automatic follows the OS, else `en`. */
export function resolveLanguage(language: Language): string {
  if (language !== 'auto') return language;
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en';
}

const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColour = (value: string) => HEX.test(value);

const clampStep = (value: unknown, min: number, max: number, step: number, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
};

/** Anything stored by hand or an older build still yields a valid appearance. */
export function sanitize(raw: unknown): Appearance {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof Appearance, unknown>
  >;
  const d = DEFAULT_APPEARANCE;
  const accent = v.accent === 'custom' || ACCENT_PRESETS.includes(v.accent as AccentPreset);
  return {
    fontSize: clampStep(v.fontSize, FONT_SIZE.min, FONT_SIZE.max, 1, d.fontSize),
    contrast: clampStep(v.contrast, CONTRAST.min, CONTRAST.max, CONTRAST.step, d.contrast),
    accent: accent ? (v.accent as Appearance['accent']) : d.accent,
    customAccent:
      typeof v.customAccent === 'string' && isHexColour(v.customAccent)
        ? v.customAccent.toLowerCase()
        : d.customAccent,
    fontFamilySans: typeof v.fontFamilySans === 'string' ? v.fontFamilySans : d.fontFamilySans,
    fontFamilyMono: typeof v.fontFamilyMono === 'string' ? v.fontFamilyMono : d.fontFamilyMono,
    language: LANGUAGES.includes(v.language as Language) ? (v.language as Language) : d.language,
  };
}

export function readAppearance(): Appearance {
  try {
    return sanitize(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'));
  } catch {
    // Restricted storage or a damaged value: today's look.
    return DEFAULT_APPEARANCE;
  }
}

/**
 * The CSS font-family list for what the owner typed, or null when empty. Quotes
 * names with spaces and drops what could close the declaration, as this ends up
 * inside a stylesheet.
 */
export function fontFamilyList(typed: string): string | null {
  const names = typed
    .replace(/[;{}<>\\]/g, '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) =>
      /^(['"]).*\1$/.test(name) || /^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)
        ? name
        : `"${name.replaceAll('"', '')}"`
    );
  return names.length ? names.join(', ') : null;
}
