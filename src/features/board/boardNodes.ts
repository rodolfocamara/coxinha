import type { Note } from '../../lib/bindings';
import type { Board, BoardItem } from './model';
import { itemLayer, editingSize, progressColor } from './model';
import { areaProgress } from './hierarchy';
import { childBounds } from './resizeBounds';
import type { EditorFocusRequest } from '../notes/editorFocusRequest';
type Args = {
  board: Board;
  measured: Map<string, { width: number; height: number }>;
  selected: string | null;
  dropTarget: string | null;
  resolveNote: (item: BoardItem) => Note | undefined;
  title: (item: BoardItem) => string;
  editor: { editing: { cardId?: string; focusRequest: EditorFocusRequest } | null };
  creation: {
    pending: { item: BoardItem; failed: boolean } | null;
    retry: () => void;
    dismiss: () => void;
  };
  openNote: (id: string, cardId?: string) => Promise<void>;
  closeEditor: () => void;
  patch: (id: string, values: Partial<BoardItem>) => void;
  layer: (id: string, direction: 'front' | 'back') => void;
};
export function boardNodes({
  board,
  measured,
  selected,
  dropTarget,
  resolveNote,
  title,
  editor,
  creation,
  openNote,
  closeEditor,
  patch,
  layer,
}: Args) {
  return [...board.items, ...(creation.pending ? [creation.pending.item] : [])].map((i, index) => {
    const note = resolveNote(i);
    const editing = i.kind !== 'area' && !!note && editor.editing?.cardId === i.id;
    const pending = creation.pending?.item.id === i.id;
    const size = editing || pending ? editingSize(i) : i;
    return {
      id: i.id,
      type: i.kind,
      position: { x: i.x, y: i.y },
      data: {
        label: title(i),
        childBounds: i.kind === 'area' ? childBounds(board, i.id, measured) : undefined,
        ...areaProgress(board, i.id),
        dropTarget: dropTarget === i.id,
        item: { ...i, noteId: note?.id ?? i.noteId },
        editing,
        focusRequest: editing ? editor.editing?.focusRequest : undefined,
        pending,
        failed: creation.pending?.failed,
        retry: creation.retry,
        dismiss: creation.dismiss,
        edit: () => note && void openNote(note.id, i.id),
        close: closeEditor,
        progress:
          i.kind === 'area'
            ? areaProgress(board, i.id).progress
            : (progress: number) => patch(i.id, { progress }),
        layer: (direction: 'front' | 'back') => layer(i.id, direction),
      },
      measured: measured.get(i.id) ?? { width: size.width, height: size.height },
      width: size.width,
      height: i.kind === 'area' ? size.height : undefined,
      style: {
        width: size.width,
        ...(i.kind === 'area'
          ? {
              height: size.height,
              borderColor: areaProgress(board, i.id).count
                ? progressColor(areaProgress(board, i.id).progress ?? 0)
                : undefined,
            }
          : {}),
      },
      dragHandle: i.kind !== 'area' ? '.board-card-body' : undefined,
      className: `board-${i.color} board-${i.kind}${editing ? ' board-editing' : ''}${dropTarget === i.id ? ' board-drop-target' : ''}`,
      selected: i.id === selected,
      draggable: !pending,
      zIndex: itemLayer(i, index),
      ariaLabel: title(i),
    };
  });
}
