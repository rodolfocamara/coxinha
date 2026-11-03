import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { OUTLOOK_PRESETS } from './categories';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'categories.css'),
  'utf8'
);

const block = (selector: string) => {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf('}', start));
};
const values = (text: string) =>
  Object.fromEntries(
    [...text.matchAll(/--outlook-cat-(\d+(?:-bg)?):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]])
  );

it('defines a mark and a fill for every preset in both themes', () => {
  for (const theme of [values(block(':root {')), values(block("[data-theme='dark'] {"))]) {
    for (const [index] of OUTLOOK_PRESETS.entries()) {
      expect(theme[String(index)]).toMatch(/^#/);
      expect(theme[`${index}-bg`]).toMatch(/^#/);
    }
  }
});

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

it('paints each preset with the colour Outlook shows, in both themes', () => {
  const light = values(block(':root {'));
  const dark = values(block("[data-theme='dark'] {"));
  for (const [index] of OUTLOOK_PRESETS.entries())
    expect(dark[String(index)]).toBe(light[String(index)]);
  // Measured on the owner's Outlook in the dark theme (spec 0119 P3).
  expect(light['10']).toBe('#005b70');
  expect(light['11']).toBe('#063842');
  expect(light['2']).toBe('#ff8c00');
  expect(dark['4-bg']).toBe('#136211');
  expect(dark['11-bg']).toBe('#0c282d');
});

it('keeps light text readable on every dark fill', () => {
  const dark = values(block("[data-theme='dark'] {"));
  for (const [index] of OUTLOOK_PRESETS.entries())
    expect(contrast('#efeeea', dark[`${index}-bg`]), String(index)).toBeGreaterThanOrEqual(4.5);
});

const stripe = (selector: string) => {
  const match = /--cx-hatch: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\);/.exec(block(selector));
  return { channel: Number(match![1]), alpha: Number(match![4]) };
};
const painted = (fill: string, { channel, alpha }: { channel: number; alpha: number }) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(parseInt(fill.slice(i, i + 2), 16) * (1 - alpha) + channel * alpha)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

it('keeps text readable over the tentative stripes (spec 0124 P3)', () => {
  const dark = values(block("[data-theme='dark'] {"));
  const light = values(block(':root {'));
  for (const [index] of OUTLOOK_PRESETS.entries()) {
    const onDark = painted(dark[`${index}-bg`], stripe("[data-theme='dark'] {"));
    expect(contrast('#efeeea', onDark), String(index)).toBeGreaterThanOrEqual(
      contrast('#efeeea', dark[`${index}-bg`])
    );
    const onLight = painted(light[`${index}-bg`], stripe(':root {'));
    expect(luminance(onLight), String(index)).toBeGreaterThanOrEqual(
      luminance(light[`${index}-bg`])
    );
  }
});

it('never dims a declined block with opacity, which would dim its text', () => {
  const week = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../meetingsHub/weekView.css'),
    'utf8'
  );
  const rules = week.split('}').filter((rule) => rule.includes("[data-look='declined']"));
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) expect(rule).not.toContain('opacity');
});
