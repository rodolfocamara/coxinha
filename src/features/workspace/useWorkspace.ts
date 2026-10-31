import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useAppStore } from '../../lib/store';
import { registerSaveParticipant } from '../../lib/lifecycle';
import { nameForTransition, runTransition } from '../../lib/motion';
import { boardSession } from '../board/persistence';
import { connect, removeItem, reorderItem, type Board, type BoardItem } from '../board/model';
import { assignArea, patchItem } from '../board/hierarchy';
import { useBoardViewport } from '../board/useBoardViewport';
import { refreshSessionList } from '../sessions/sessions';
import { editorFocusRequest, type EditorFocusRequest } from '../notes/editorFocusRequest';
import { freeSpot } from './freeSpot';
import { useBoardSession } from './useBoardSession';
import {
  CARD_SIZE,
  addItem,
  cardForTask,
  centerOf,
  demote,
  itemForNote,
  noteItem,
  promote,
  resolveNote,
} from './workspaceModel';

// Desktop exit waits for a note being created so its card is saved too.
const creations = new Set<Promise<unknown>>();
/** The source of a flight keeps its name only in the old state: no duplicate in the new one. */
const unname = (element?: Element | null) => {
  if (element instanceof HTMLElement) element.style.viewTransitionName = '';
};
registerSaveParticipant(async () => {
  await Promise.all([...creations]);
});
function tracked<T>(work: Promise<T>) {
  creations.add(work);
  void work.finally(() => creations.delete(work)).catch(() => {});
  return work;
}

type Selection = { itemId: string | null; noteId: string | null };
type Point = { x: number; y: number };

/**
 * Workspace state: one selection (a board item and/or a note), the drawer,
 * the side editor and every board action. Discrete actions run as `local`
 * view transitions so cards morph, fly and pop; the URL follows the open note.
 */
export function useWorkspace() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { noteId: routeNoteId } = useParams({ strict: false }) as { noteId?: string };
  const notes = useAppStore((s) => s.notes);
  const createNote = useAppStore((s) => s.newNote);
  const saveNote = useAppStore((s) => s.saveNote);
  const session = useBoardSession();
  const board = session.board;
  const [sel, setSel] = useState<Selection>({ itemId: null, noteId: routeNoteId ?? null });
  const viewport = useBoardViewport(!!board && !session.loadError, sel.itemId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fx, setFx] = useState<{ pop: string | null; edge: string | null }>({
    pop: null,
    edge: null,
  });
  const [focusRequest, setFocusRequest] = useState<EditorFocusRequest>();
  const [creating, setCreating] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [actionError, setActionError] = useState(false);
  const [taskLinks, setTaskLinks] = useState(() => new Map<string, string>());
  const retryCreate = useRef<() => void>(() => {});
  const returnFocus = useRef<HTMLElement | null>(null);
  const routeRef = useRef(routeNoteId ?? null);
  routeRef.current = routeNoteId ?? null;

  // Meeting notes are recognised through their session (drawer subtitle, editor chip).
  useEffect(() => {
    void refreshSessionList();
  }, []);

  // Back/forward, the palette and Hoje drive the selection through the URL.
  useEffect(() => {
    setSel((current) =>
      (routeNoteId ?? null) === current.noteId
        ? current
        : { itemId: null, noteId: routeNoteId ?? null }
    );
  }, [routeNoteId]);

  useEffect(() => {
    if (!fx.pop && !fx.edge) return;
    const timer = setTimeout(() => setFx({ pop: null, edge: null }), 900);
    return () => clearTimeout(timer);
  }, [fx]);

  const item =
    (sel.itemId ? board?.items.find((i) => i.id === sel.itemId) : undefined) ??
    itemForNote(board, notes, sel.noteId);
  const note = sel.noteId
    ? notes.find((n) => n.id === sel.noteId)
    : item
      ? resolveNote(notes, item)
      : undefined;
  const editorOpen = !!(sel.noteId || item);

  const title = (i: BoardItem) =>
    i.kind === 'area'
      ? i.label || t('workspace.area.untitled')
      : resolveNote(notes, i)?.title ||
        t(resolveNote(notes, i) ? 'workspace.untitled' : 'workspace.card.missing');

  const syncUrl = (noteId: string | null) => {
    if (routeRef.current === noteId) return;
    void navigate(noteId ? { to: '/workspace/$noteId', params: { noteId } } : { to: '/workspace' });
  };
  /**
   * Runs a discrete change as a `local` view transition, committed
   * synchronously. The URL follows inside the callback: navigating earlier
   * would update the selection before the old state is captured.
   */
  const local = (update: () => void, url?: string | null) =>
    void runTransition('local', () => {
      flushSync(update);
      if (url !== undefined) syncUrl(url);
    });
  const update = (fn: (b: Board) => Board) => {
    const current = boardSession.get();
    if (current) boardSession.update(fn(current));
  };
  const rememberFocus = () => {
    if (!editorOpen && document.activeElement instanceof HTMLElement)
      returnFocus.current = document.activeElement;
  };

  function select(next: BoardItem) {
    const noteId = resolveNote(notes, next)?.id ?? null;
    if (item?.id === next.id && sel.noteId === noteId) return;
    rememberFocus();
    local(() => setSel({ itemId: next.id, noteId }), noteId);
  }

  function selectById(id: string, center = false) {
    const next = board?.items.find((i) => i.id === id);
    if (!next) return;
    select(next);
    if (center) viewport.focus(next);
  }

  function openNote(noteId: string) {
    rememberFocus();
    local(() => setSel({ itemId: null, noteId }), noteId);
  }

  function close() {
    local(() => {
      setSel({ itemId: null, noteId: null });
      setExpanded(false);
    }, null);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) target.focus();
  }

  /** Puts an off-board note on the board; `source` (a drawer row) flies to the new card. */
  function place(noteId: string, source?: Element | null, point?: Point) {
    const placed = notes.find((n) => n.id === noteId);
    const current = boardSession.get();
    if (!placed || !current) return;
    const id = crypto.randomUUID();
    const preferred = point
      ? centerOf(point)
      : viewport.creationPosition(CARD_SIZE.width, CARD_SIZE.height);
    const at = freeSpot(current, preferred, CARD_SIZE);
    nameForTransition(source, `card-${id}`);
    local(() => {
      unname(source);
      boardSession.update(addItem(current, noteItem(id, placed, at)));
      setSel({ itemId: id, noteId });
      setFx({ pop: id, edge: null });
    }, noteId);
  }

  function promoteItem(id: string) {
    const target = board?.items.find((i) => i.id === id);
    if (!target) return;
    const noteId = resolveNote(notes, target)?.id ?? null;
    local(() => {
      update((b) => promote(b, id));
      setSel({ itemId: id, noteId });
      setFx({ pop: id, edge: null });
    }, noteId);
  }

  function demoteItem(id: string) {
    local(() => update((b) => demote(b, id)));
  }

  async function create(kind: 'card' | 'text', point?: Point) {
    if (creating === 'busy' || !boardSession.get()) return;
    retryCreate.current = () => void create(kind, point);
    setCreating('busy');
    try {
      const created = await tracked(createNote());
      const current = boardSession.get();
      if (!current) throw new Error('board unavailable');
      const id = crypto.randomUUID();
      const preferred = point
        ? centerOf(point)
        : viewport.creationPosition(CARD_SIZE.width, CARD_SIZE.height);
      const at = freeSpot(current, preferred, CARD_SIZE);
      const request = editorFocusRequest();
      rememberFocus();
      local(() => {
        boardSession.update(addItem(current, noteItem(id, created, at, kind)));
        setSel({ itemId: id, noteId: created.id });
        setFx({ pop: id, edge: null });
        setFocusRequest(request);
      }, created.id);
      setCreating('idle');
    } catch {
      setCreating('failed');
    }
  }

  function addArea() {
    const current = boardSession.get();
    if (!current) return;
    const area: BoardItem = {
      id: crypto.randomUUID(),
      kind: 'area',
      ...viewport.creationPosition(580, 350),
      width: 580,
      height: 350,
      color: 'blue',
      label: t('workspace.area.newName'),
      noteId: null,
      notePath: null,
    };
    local(() => {
      boardSession.update({ ...current, items: [area, ...current.items] });
      setSel({ itemId: area.id, noteId: null });
    }, null);
  }

  const taskKey = (sourceId: string, text: string) => `${sourceId}\n${text.trim()}`;

  /** The card a checklist line of the open note became, if it is on the board. */
  function linkedTask(text: string) {
    if (!item || !board) return undefined;
    const known = taskLinks.get(taskKey(item.id, text));
    if (known && board.items.some((i) => i.id === known)) return known;
    return cardForTask(board, notes, item.id, text)?.id;
  }

  /** A checklist line becomes an activity under its note: the line flies out, the link draws in. */
  async function taskToActivity(text: string, line?: Element | null) {
    const source = item;
    if (!source || source.kind === 'area') return;
    try {
      const created = await tracked(createNote());
      const body = `# ${text.trim()}\n\n${t('workspace.checklist.provenance', { title: note?.title || t('workspace.untitled') })}\n`;
      await tracked(saveNote(created.id, body));
      const current = boardSession.get();
      const origin = current?.items.find((i) => i.id === source.id);
      if (!current || !origin) return;
      const id = crypto.randomUUID();
      const at = freeSpot(current, { x: origin.x, y: origin.y + origin.height + 32 }, CARD_SIZE, {
        areaId: origin.parentId,
      });
      const next = addItem(
        current,
        noteItem(id, created, at, 'card', origin.parentId ?? null),
        origin
      );
      const edge =
        next.edges.length > current.edges.length ? next.edges[next.edges.length - 1].id : null;
      nameForTransition(line, `card-${id}`);
      local(() => {
        unname(line);
        boardSession.update(next);
        setFx({ pop: id, edge });
        setTaskLinks((links) => new Map(links).set(taskKey(origin.id, text), id));
      });
    } catch {
      setActionError(true);
    }
  }

  return {
    board,
    notes,
    session,
    viewport,
    sel,
    item,
    note,
    editorOpen,
    drawerOpen,
    expanded,
    fx,
    focusRequest,
    creating,
    actionError,
    setActionError,
    title,
    select,
    selectById,
    openNote,
    close,
    place,
    promote: promoteItem,
    demote: demoteItem,
    createNote: (point?: Point) => void create('text', point),
    createActivity: () => void create('card'),
    retryCreate: () => retryCreate.current(),
    dismissCreate: () => setCreating('idle'),
    addArea,
    linkedTask,
    taskToActivity: (text: string, line?: Element | null) => void taskToActivity(text, line),
    setDrawerOpen: (open: boolean) => local(() => setDrawerOpen(open)),
    setExpanded: (open: boolean) => local(() => setExpanded(open)),
    patch: (id: string, values: Partial<BoardItem>) => update((b) => patchItem(b, id, values)),
    assignArea: (id: string, areaId: string | null) =>
      local(() => update((b) => assignArea(b, id, areaId))),
    connect: (source: string, target: string) => {
      const before = boardSession.get()?.edges.length ?? 0;
      local(() => {
        update((b) => connect(b, source, target));
        const edges = boardSession.get()?.edges ?? [];
        if (edges.length > before) setFx({ pop: null, edge: edges[edges.length - 1].id });
      });
    },
    disconnect: (edgeId: string) =>
      update((b) => ({ ...b, edges: b.edges.filter((e) => e.id !== edgeId) })),
    layer: (id: string, direction: 'front' | 'back') =>
      update((b) => reorderItem(b, id, direction)),
    removeFromBoard: (id: string) => local(() => update((b) => removeItem(b, id))),
    /** After a note file is deleted its cards leave the board and the editor closes. */
    forgetNote: (noteId: string) => {
      update((b) => {
        const gone = new Set(b.items.filter((i) => i.noteId === noteId).map((i) => i.id));
        return {
          ...b,
          items: b.items.filter((i) => !gone.has(i.id)),
          edges: b.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
        };
      });
      close();
    },
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
