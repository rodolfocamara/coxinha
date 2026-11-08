import type { Board, BoardItem } from '../board/model';

/** Area header band: cards never land on it (matches `hierarchy.ts`). */
const HEADER = 52;
const PAD = 16;
const GAP = 16;
const STEP = 20;

type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Rect = Point & Size;

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

const inside = (r: Rect, area: BoardItem) =>
  r.x >= area.x + PAD &&
  r.y >= area.y + HEADER &&
  r.x + r.width <= area.x + area.width - PAD &&
  r.y + r.height <= area.y + area.height - PAD;

/**
 * Nearest spot to `preferred` where a new card overlaps no other card, no
 * area other than `areaId` and no area header. Spots above the preferred
 * point cost more (cards grow downwards from their source); with `areaId`,
 * spots inside that area win over spots outside it (the area grows to fit
 * otherwise, see `fitAreas`).
 */
export function freeSpot(
  board: Board,
  preferred: Point,
  size: Size,
  options: { areaId?: string | null; measured?: Map<string, Size> } = {}
): Point {
  const area = options.areaId
    ? board.items.find((i) => i.id === options.areaId && i.kind === 'area')
    : undefined;
  const sized = (i: BoardItem): Rect => ({ ...i, ...(options.measured?.get(i.id) ?? {}) });
  const busy: Rect[] = [
    ...board.items.filter((i) => i.kind !== 'area').map(sized),
    ...board.items.filter((i) => i.kind === 'area' && i.id !== area?.id),
  ];
  const headers: Rect[] = board.items
    .filter((i) => i.kind === 'area')
    .map((a) => ({ x: a.x, y: a.y, width: a.width, height: HEADER }));
  const free = (r: Rect) =>
    busy.every((b) => !overlaps(r, b, GAP)) && headers.every((h) => !overlaps(r, h));
  const px = Math.round(preferred.x / STEP) * STEP;
  const py = Math.round(preferred.y / STEP) * STEP;
  let best: Point | null = null;
  let cost = Infinity;
  for (let dy = -200; dy <= 1000; dy += STEP) {
    for (let dx = -800; dx <= 800; dx += STEP) {
      const r = { x: px + dx, y: py + dy, ...size };
      const c = dx * dx + dy * dy * (dy < 0 ? 6 : 1) + (area && !inside(r, area) ? 4e6 : 0);
      if (c < cost && free(r)) {
        cost = c;
        best = { x: r.x, y: r.y };
      }
    }
  }
  return best ?? preferred;
}
