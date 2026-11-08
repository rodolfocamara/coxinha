import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToOklch, oklchToHex, parseToken, token, type Oklch } from './color';
import { ACCENT_PRESETS, CONTRAST, DEFAULT_APPEARANCE, type Appearance } from './settings';
import { appearanceStylesheet } from './stylesheet';
import { BASE_TOKENS, THEMES, TEXT_RATIO, accentTokens, deriveAccent, textTokens } from './tokens';

const surfaces = (theme: 'light' | 'dark') =>
  Object.entries(BASE_TOKENS[theme].surfaces).map(([name, value]) => ({
    name,
    color: parseToken(value),
  }));

const worstOn = (color: Oklch, theme: 'light' | 'dark') =>
  Math.min(...surfaces(theme).map((surface) => contrastRatio(color, surface.color)));

/** A coarse walk of sRGB, plus the colours most likely to break a naive rule. */
const SAMPLED_COLOURS = (() => {
  const steps = ['00', '33', '66', '80', '99', 'cc', 'ff'];
  const all: string[] = ['#767676', '#777777', '#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  for (const r of steps) for (const g of steps) for (const b of steps) all.push(`#${r}${g}${b}`);
  return all;
})();

describe('WCAG math', () => {
  it('matches known ratios', () => {
    expect(contrastRatio(hexToOklch('#000000'), hexToOklch('#ffffff'))).toBeCloseTo(21, 1);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio(hexToOklch('#767676'), hexToOklch('#ffffff'))).toBeCloseTo(4.54, 1);
  });

  it('round-trips hex through OKLCH', () => {
    for (const hex of ['#e8843c', '#123456', '#ffffff', '#000000', '#7f00ff'])
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });
});

describe('index.css and the generator agree', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const block = (theme: 'light' | 'dark') => {
    const start = css.indexOf(theme === 'light' ? ':root {' : "[data-theme='dark'] {");
    return css.slice(start, css.indexOf('\n  }', start));
  };
  const read = (theme: 'light' | 'dark', name: string) =>
    new RegExp(`--${name}: ([^;]+);`).exec(block(theme))?.[1];

  it.each(THEMES)('%s tokens', (theme) => {
    const base = BASE_TOKENS[theme];
    for (const [name, value] of Object.entries(base.surfaces))
      expect(read(theme, `bg-${name}`)).toBe(value);
    for (const [name, value] of Object.entries(base.fg))
      expect(read(theme, `fg-${name}`)).toBe(value);
    expect(read(theme, 'accent')).toBe(base.accent.accent);
    expect(read(theme, 'accent-hover')).toBe(base.accent.hover);
    expect(read(theme, 'accent-soft')).toBe(base.accent.soft);
    expect(read(theme, 'accent-ink')).toBe(base.accent.ink);
    expect(read(theme, 'fg-on-accent')).toBe(base.accent.onAccent);
    expect(read(theme, 'selection')).toBe(base.accent.selection);
    expect(read(theme, 'blob-a')).toBe(base.accent.blob);
  });
});

describe('text on every surface', () => {
  it.each(THEMES)('primary and secondary reach 4.5:1 at every contrast setting, %s', (theme) => {
    for (let c = CONTRAST.min; c <= CONTRAST.max; c += CONTRAST.step) {
      const text = textTokens(c, theme);
      expect(worstOn(text.primary, theme), `primary at ${c}`).toBeGreaterThanOrEqual(TEXT_RATIO);
      expect(worstOn(text.secondary, theme), `secondary at ${c}`).toBeGreaterThanOrEqual(
        TEXT_RATIO
      );
      expect(worstOn(text.tertiary, theme), `tertiary at ${c}`).toBeGreaterThanOrEqual(TEXT_RATIO);
    }
  });

  it.each(THEMES)('contrast moves text in the promised direction, %s', (theme) => {
    const at = (c: number) => worstOn(textTokens(c, theme).primary, theme);
    expect(at(200)).toBeGreaterThan(at(100));
    expect(at(50)).toBeLessThan(at(100));
  });

  it.each(THEMES)('100% changes nothing, %s', (theme) => {
    const text = textTokens(100, theme);
    expect(worstOn(text.primary, theme)).toBeCloseTo(
      worstOn(parseToken(BASE_TOKENS[theme].fg.primary), theme),
      5
    );
  });
});

describe('accent', () => {
  const choices: Appearance['accent'][] = [...ACCENT_PRESETS];

  describe.each(THEMES)('%s', (theme) => {
    it.each(choices)('%s: text on the accent and on its hover reaches 4.5:1', (accent) => {
      const tokens = accentTokens({ ...DEFAULT_APPEARANCE, accent }, theme);
      expect(contrastRatio(tokens.onAccent, tokens.accent)).toBeGreaterThanOrEqual(TEXT_RATIO);
      expect(contrastRatio(tokens.onAccent, tokens.hover)).toBeGreaterThanOrEqual(TEXT_RATIO);
    });

    it.each(choices)('%s: as text on every surface it reaches 4.5:1', (accent) => {
      const { ink } = accentTokens({ ...DEFAULT_APPEARANCE, accent }, theme);
      expect(worstOn(ink, theme)).toBeGreaterThanOrEqual(TEXT_RATIO);
    });

    it.each(choices)('%s: primary text on the soft fill reaches 4.5:1', (accent) => {
      const { soft } = accentTokens({ ...DEFAULT_APPEARANCE, accent }, theme);
      const primary = parseToken(BASE_TOKENS[theme].fg.primary);
      expect(contrastRatio(primary, soft)).toBeGreaterThanOrEqual(TEXT_RATIO);
    });

    it('any custom colour gets a readable foreground', () => {
      for (const customAccent of SAMPLED_COLOURS) {
        const tokens = accentTokens({ accent: 'custom', customAccent }, theme);
        const pair = `${customAccent} -> ${token(tokens.onAccent)} on ${token(tokens.accent)}`;
        expect(contrastRatio(tokens.onAccent, tokens.accent), pair).toBeGreaterThanOrEqual(
          TEXT_RATIO
        );
        expect(contrastRatio(tokens.onAccent, tokens.hover), pair).toBeGreaterThanOrEqual(
          TEXT_RATIO
        );
        expect(worstOn(tokens.ink, theme), pair).toBeGreaterThanOrEqual(TEXT_RATIO);
      }
    });

    it('a colour close to the page is adjusted and says so', () => {
      const near = theme === 'dark' ? '#202125' : '#f5f4f0';
      const tokens = deriveAccent(hexToOklch(near), theme);
      expect(tokens.adjusted).toBe(true);
      expect(
        contrastRatio(tokens.accent, parseToken(BASE_TOKENS[theme].surfaces.canvas))
      ).toBeGreaterThanOrEqual(3);
    });
  });

  it('keeps a mid-grey accent readable, the case where a naive light/dark rule fails', () => {
    const tokens = accentTokens({ accent: 'custom', customAccent: '#777777' }, 'light');
    expect(contrastRatio(tokens.onAccent, tokens.accent)).toBeGreaterThanOrEqual(TEXT_RATIO);
  });

  it('leaves the danger foreground out of it', () => {
    const css = appearanceStylesheet({ ...DEFAULT_APPEARANCE, accent: 'blue' });
    expect(css).not.toContain('fg-on-danger');
  });

  it('never touches the Outlook category colours', () => {
    const css = appearanceStylesheet({ ...DEFAULT_APPEARANCE, accent: 'violet', contrast: 150 });
    expect(css).not.toContain('outlook-cat');
    expect(css).not.toContain('--cx-cat');
  });
});
