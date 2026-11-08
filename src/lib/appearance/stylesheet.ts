import { token } from './color';
import {
  CONTRAST,
  DEFAULT_APPEARANCE,
  FONT_SIZE,
  fontFamilyList,
  type Appearance,
} from './settings';
import { BASE_TOKENS, THEMES, accentTokens, textTokens, type Theme } from './tokens';

const SANS_STACK =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const MONO_STACK = "ui-monospace, 'SF Mono', Menlo, monospace";
const DISPLAY_STACK = 'ui-sans-serif, system-ui, sans-serif';

function themeDeclarations(a: Appearance, theme: Theme): string[] {
  const lines: string[] = [];
  if (a.accent !== DEFAULT_APPEARANCE.accent) {
    const tokens = accentTokens(a, theme);
    const { h, c } = tokens.accent;
    const blob =
      theme === 'light'
        ? { l: 0.8, c: Math.min(c, 0.12), alpha: 0.22 }
        : { l: 0.72, c: Math.min(c, 0.14), alpha: 0.09 };
    lines.push(
      `--accent:${token(tokens.accent)}`,
      `--accent-hover:${token(tokens.hover)}`,
      `--accent-soft:${token(tokens.soft)}`,
      `--accent-ink:${token(tokens.ink)}`,
      `--fg-on-accent:${token(tokens.onAccent)}`,
      `--selection:0.86 ${+Math.min(c, 0.06).toFixed(4)} ${+h.toFixed(2)}`,
      `--blob-a:${blob.l} ${+blob.c.toFixed(4)} ${+h.toFixed(2)} / ${blob.alpha}`
    );
  }
  if (a.contrast !== CONTRAST.default) {
    const text = textTokens(a.contrast, theme);
    const { borderAlpha, borderInk } = BASE_TOKENS[theme];
    const alpha = +((borderAlpha * a.contrast) / CONTRAST.default).toFixed(3);
    lines.push(
      `--fg-primary:${token(text.primary)}`,
      `--fg-secondary:${token(text.secondary)}`,
      `--fg-tertiary:${token(text.tertiary)}`,
      `--fg-quaternary:${token(text.quaternary)}`,
      `--color-border:oklch(${borderInk} / ${alpha})`
    );
  }
  return lines;
}

/**
 * One stylesheet for the whole setting, empty at the defaults. Unlayered, so it
 * wins over the `@layer` tokens in index.css; the theme class picks its block.
 */
export function appearanceStylesheet(a: Appearance): string {
  const rules: string[] = [];
  if (a.fontSize !== FONT_SIZE.default) {
    rules.push(`html{font-size:${a.fontSize}px}`);
    // Lucide sizes are attributes in px. `scale` draws them larger without moving the layout.
    rules.push(`svg.lucide{scale:${a.fontSize / FONT_SIZE.default}}`);
  }
  const sans = fontFamilyList(a.fontFamilySans);
  const mono = fontFamilyList(a.fontFamilyMono);
  const fonts = [
    sans && `--font-sans:${sans}, ${SANS_STACK}`,
    sans && `--font-display:${sans}, ${DISPLAY_STACK}`,
    mono && `--font-mono:${mono}, ${MONO_STACK}`,
  ].filter(Boolean);
  if (fonts.length) rules.push(`:root{${fonts.join(';')}}`);
  const [light, dark] = THEMES.map((theme) => themeDeclarations(a, theme));
  // Same variables in both blocks, or dark would inherit the light values.
  if (light.length) rules.push(`:root{${light.join(';')}}`);
  if (dark.length) rules.push(`.dark,[data-theme='dark']{${dark.join(';')}}`);
  return rules.join('\n');
}
