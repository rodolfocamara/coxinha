/** Root size all rem lengths hang from at the default setting. */
export const BASE_FONT_PX = 16;

/** A design length (px at the default size) as a length that follows the setting. */
export const rem = (designPx: number) => `${designPx / BASE_FONT_PX}rem`;

/** Real pixels per design pixel, for code that measures or scrolls the page. */
export function remScale(): number {
  if (typeof document === 'undefined') return 1;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return size > 0 ? size / BASE_FONT_PX : 1;
}
