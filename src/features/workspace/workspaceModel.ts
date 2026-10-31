import type { Note } from '../../lib/bindings';
import type { Board, BoardItem } from '../board/model';
import { canLink } from '../board/model';
import { fitAreas } from '../board/hierarchy';

/** Size of a card created by the Workspace (prototype `bcard`). */
export const CARD_SIZE = { width: 220, height: 104 };

export function resolveNote(notes: Note[], item: BoardItem): Note | undefined {
  if (item.kind === 'area') return undefined;
  return notes.find((n) => n.id === item.noteId) ?? notes.find((n) => n.path === item.notePath);
}

const references = (item: BoardItem, note: Note) =>
  item.kind !== 'area' && (item.noteId === note.id || item.notePath === note.path);

/** Notes no board item references: meeting notes, shortcut and palette notes. */
export function offBoardNotes(notes: Note[], board: Board | null): Note[] {
  if (!board) return [];
  return notes.filter((n) => !board.items.some((i) => references(i, n)));
}

/** The item showing `noteId`, preferring `preferred` when two items share the note. */
export function itemForNote(
  board: Board | null,
  notes: Note[],
  noteId: string | null,
  preferred?: string | null
): BoardItem | undefined {
  if (!board || !noteId) return undefined;
  const note = notes.find((n) => n.id === noteId);
  const matches = (i: BoardItem) =>
    i.kind !== 'area' && (i.noteId === noteId || (!!note && i.notePath === note.path));
  return board.items.find((i) => i.id === preferred && matches(i)) ?? board.items.find(matches);
}

/** "Virar atividade": only the kind changes (and progress starts at 0). */
export function promote(board: Board, id: string): Board {
  return {
    ...board,
    items: board.items.map((i) =>
      i.id === id && i.kind === 'text' ? { ...i, kind: 'card', progress: 0 } : i
    ),
  };
}

/**
 * Back to a plain note: only the kind changes. Links survive while the other
 * side is still an activity; note-to-note links are not allowed (`board.rs`).
 */
export function demote(board: Board, id: string): Board {
  const items = board.items.map((i) =>
    i.id === id && i.kind === 'card' ? { ...i, kind: 'text' as const } : i
  );
  const find = (key: string) => items.find((i) => i.id === key);
  return {
    ...board,
    items,
    edges: board.edges.filter((e) => canLink(find(e.source), find(e.target))),
  };
}

export function noteItem(
  id: string,
  note: Note,
  at: { x: number; y: number },
  kind: 'card' | 'text' = 'text',
  parentId: string | null = null
): BoardItem {
  return {
    id,
    kind,
    ...at,
    ...CARD_SIZE,
    color: 'neutral',
    label: '',
    progress: 0,
    parentId,
    noteId: note.id,
    notePath: note.path,
  };
}

/** Adds `item`, an optional link `source -> item`, and grows its area. */
export function addItem(board: Board, item: BoardItem, source?: BoardItem): Board {
  const edge =
    source && canLink(source, item)
      ? [{ id: crypto.randomUUID(), source: source.id, target: item.id }]
      : [];
  return fitAreas({ ...board, items: [...board.items, item], edges: [...board.edges, ...edge] });
}

const normal = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * The activity a checklist line became: a card whose note title is the line,
 * preferring one linked from the source by a dependency.
 */
export function cardForTask(
  board: Board,
  notes: Note[],
  sourceId: string | null,
  text: string
): BoardItem | undefined {
  const wanted = normal(text);
  if (!wanted) return undefined;
  const cards = board.items.filter(
    (i) =>
      i.kind === 'card' &&
      i.id !== sourceId &&
      normal(resolveNote(notes, i)?.title ?? '') === wanted
  );
  const linked = new Set(board.edges.filter((e) => e.source === sourceId).map((e) => e.target));
  return cards.find((c) => linked.has(c.id)) ?? cards[0];
}

/** First prose line of a note, without Markdown marks, for card previews. */
export function excerpt(markdown: string, max = 120): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line || /^(#|```|---|\||>?\s*$)/.test(line)) continue;
    const text = line
      .replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
      .replace(/^([-*+]|\d+\.)\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`~]/g, '')
      .trim();
    if (text) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  return '';
}

export function centerOf(rect: { x: number; y: number }, size = CARD_SIZE) {
  return { x: rect.x - size.width / 2, y: rect.y - size.height / 2 };
}
