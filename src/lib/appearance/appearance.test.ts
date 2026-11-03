import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APPEARANCE_CSS_KEY,
  APPEARANCE_ELEMENT_ID,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearance,
  fontFamilyList,
  readAppearance,
  rem,
  saveAppearance,
  sanitize,
} from '.';
import { appearanceStylesheet } from './stylesheet';

const removeStyle = () => document.getElementById(APPEARANCE_ELEMENT_ID)?.remove();

beforeEach(() => {
  localStorage.clear();
  removeStyle();
});
afterEach(removeStyle);

describe('settings', () => {
  it('defaults to today, with T3 Code numbers', () => {
    expect(DEFAULT_APPEARANCE).toMatchObject({
      fontSize: 16,
      contrast: 100,
      accent: 'tangerine',
      language: 'auto',
    });
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it('clamps and rounds, and survives damaged storage', () => {
    expect(sanitize({ fontSize: 40, contrast: 7 })).toMatchObject({ fontSize: 20, contrast: 50 });
    expect(sanitize({ fontSize: 15.6, contrast: 123 })).toMatchObject({
      fontSize: 16,
      contrast: 125,
    });
    expect(sanitize({ accent: 'nope', customAccent: 'red', language: 'fr' })).toEqual(
      DEFAULT_APPEARANCE
    );
    expect(sanitize('junk')).toEqual(DEFAULT_APPEARANCE);
    localStorage.setItem(APPEARANCE_STORAGE_KEY, '{not json');
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it('saves locally and applies at once', () => {
    saveAppearance({ fontSize: 18 });
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY)!).fontSize).toBe(18);
    expect(document.getElementById(APPEARANCE_ELEMENT_ID)?.textContent).toContain(
      'html{font-size:18px}'
    );
    expect(localStorage.getItem(APPEARANCE_CSS_KEY)).toContain('html{font-size:18px}');
  });

  it('going back to the defaults leaves no stylesheet behind', () => {
    saveAppearance({ fontSize: 18, accent: 'blue' });
    saveAppearance({ fontSize: 16, accent: 'tangerine' });
    expect(document.getElementById(APPEARANCE_ELEMENT_ID)?.textContent).toBe('');
    expect(localStorage.getItem(APPEARANCE_CSS_KEY)).toBeNull();
  });
});

describe('stylesheet', () => {
  it('is empty at the defaults, so today renders from index.css alone', () => {
    expect(appearanceStylesheet(DEFAULT_APPEARANCE)).toBe('');
  });

  it('sets the same variables in both theme blocks', () => {
    const css = appearanceStylesheet({ ...DEFAULT_APPEARANCE, accent: 'teal', contrast: 150 });
    const names = (block: string) => [...block.matchAll(/--[a-z0-9-]+(?=:)/g)].map((m) => m[0]);
    const [light, dark] = css.split('\n');
    expect(light.startsWith(':root{')).toBe(true);
    expect(dark.startsWith(".dark,[data-theme='dark']{")).toBe(true);
    expect(names(light)).toEqual(names(dark));
    expect(names(light)).toContain('--fg-on-accent');
    expect(names(light)).toContain('--fg-secondary');
  });

  it('scales the icons with the text', () => {
    expect(appearanceStylesheet({ ...DEFAULT_APPEARANCE, fontSize: 20 })).toContain(
      'svg.lucide{scale:1.25}'
    );
  });

  it('keeps a typed font name from closing the declaration', () => {
    expect(fontFamilyList('')).toBeNull();
    expect(fontFamilyList(' , ')).toBeNull();
    expect(fontFamilyList('Inter, JetBrains Mono')).toBe('Inter, "JetBrains Mono"');
    expect(fontFamilyList('"Fira Sans"')).toBe('"Fira Sans"');
    expect(fontFamilyList('x;}html{display:none')).not.toMatch(/[;{}]/);
    const css = appearanceStylesheet({
      ...DEFAULT_APPEARANCE,
      fontFamilySans: 'Inter',
      fontFamilyMono: 'Fira Code',
    });
    expect(css).toContain('--font-sans:Inter, ui-sans-serif');
    expect(css).toContain('--font-mono:"Fira Code", ui-monospace');
  });
});

describe('before first paint', () => {
  const bootScript = () => {
    const html = readFileSync('index.html', 'utf8');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error('index.html lost its inline script');
    return script;
  };

  it('index.html applies the saved stylesheet with no module loaded', () => {
    saveAppearance({ fontSize: 20, accent: 'blue' });
    const saved = localStorage.getItem(APPEARANCE_CSS_KEY);
    removeStyle();
    // eslint-disable-next-line no-new-func -- the test runs the page's own inline script.
    new Function(bootScript())();
    const style = document.getElementById(APPEARANCE_ELEMENT_ID);
    expect(style?.textContent).toBe(saved);
    expect(style?.parentElement).toBe(document.head);
  });

  it('index.html does nothing without a saved stylesheet', () => {
    // eslint-disable-next-line no-new-func -- the test runs the page's own inline script.
    new Function(bootScript())();
    expect(document.getElementById(APPEARANCE_ELEMENT_ID)).toBeNull();
  });

  it('applyAppearance reuses the boot element rather than adding a second one', () => {
    saveAppearance({ fontSize: 20 });
    removeStyle();
    // eslint-disable-next-line no-new-func -- the test runs the page's own inline script.
    new Function(bootScript())();
    applyAppearance();
    expect(document.querySelectorAll(`#${APPEARANCE_ELEMENT_ID}`)).toHaveLength(1);
  });
});

describe('type follows one variable', () => {
  const files = (glob: string) =>
    execSync(`git ls-files --cached --others --exclude-standard '${glob}'`)
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);

  it('no CSS font size or line height in px', () => {
    const found = files('src/**/*.css').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /^\s*(font-size|line-height):[^;]*\dpx/.test(line))
        .map((line) => `${file}: ${line.trim()}`)
    );
    expect(found).toEqual([]);
  });

  it('no px type in Tailwind classes', () => {
    const found = files('src/**/*.tsx')
      .filter((file) => !file.endsWith('.test.tsx'))
      .flatMap((file) =>
        (readFileSync(file, 'utf8').match(/\b(text|leading)-\[[\d.]+px\]/g) ?? []).map(
          (hit) => `${file}: ${hit}`
        )
      );
    expect(found).toEqual([]);
  });

  it('design lengths convert at 16', () => {
    expect(rem(48)).toBe('3rem');
    expect(rem(52)).toBe('3.25rem');
  });
});
