import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './board.css';
import type { Note } from '../../lib/bindings';
import { useResolvedTheme } from '../../lib/useTheme';
import { boardSession } from './persistence';
import { canLink, connect, progressColor, type Board, type BoardItem } from './model';
import { edgeTypes, nodeTypes } from './BoardNodes';
import { boardEdges, boardNodes } from './boardNodes';
import { boardDrag } from './boardDrag';
import { boardGeometryChanges } from './boardGeometryChanges';
import type { useBoardViewport } from './useBoardViewport';

/** Drag payload for a note row dragged from the Workspace drawer. */
export const NOTE_DRAG_TYPE = 'application/x-coxinha-note';

// The viewport survives route remounts so returning to the Workspace (or the
// Hoje zoom) lands on the same spot instead of re-fitting.
let lastViewport: Viewport | null = null;

type Props = {
  board: Board;
  notes: Note[];
  selected: string | null;
  fx: { pop: string | null; edge: string | null };
  viewport: ReturnType<typeof useBoardViewport>;
  title: (item: BoardItem) => string;
  onSelect: (item: BoardItem) => void;
  onPromote: (id: string) => void;
  onCreateAt: (point: { x: number; y: number }) => void;
  onDropNote: (noteId: string, point?: { x: number; y: number }) => void;
  children?: ReactNode;
};

export function BoardCanvas({
  board,
  notes,
  selected,
  fx,
  viewport,
  title,
  onSelect,
  onPromote,
  onCreateAt,
  onDropNote,
  children,
}: Props) {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const measured = useRef(new Map<string, { width: number; height: number }>());
  const resized = useRef(new Set<string>());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const drag = boardDrag(measured, setDropTarget);
  const byId = (id: string) => board.items.find((i) => i.id === id);
  const label = (item: BoardItem) =>
    item.kind === 'area'
      ? t('workspace.a11y.area', { title: title(item) })
      : item.kind === 'card'
        ? t('workspace.a11y.activity', { title: title(item), progress: item.progress ?? 0 })
        : t('workspace.a11y.note', { title: title(item) });

  function changes(list: NodeChange[]) {
    const current = boardSession.get();
    if (!current) return;
    if (list.some((c) => c.type === 'position')) viewport.release();
    // Selection is owned by the Workspace (click / Enter), never by drag starts.
    const geometry = list.filter((c) => c.type !== 'select' && c.type !== 'remove');
    for (const c of list) if (c.type === 'dimensions' && c.resizing) resized.current.add(c.id);
    const next = boardGeometryChanges(
      current,
      geometry,
      measured.current,
      undefined,
      resized.current
    );
    if (next !== current) boardSession.update(next);
  }

  function edgeChanges(list: EdgeChange[]) {
    for (const c of list)
      if (c.type === 'select')
        setSelectedEdge((previous) => (c.selected ? c.id : previous === c.id ? null : previous));
  }

  return (
    <div
      className="ws-canvas"
      ref={viewport.canvas}
      onKeyDown={(event) => {
        const node = (event.target as HTMLElement).closest?.('.react-flow__node');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        const item = byId(node.getAttribute('data-id') ?? '');
        if (item) {
          event.preventDefault();
          onSelect(item);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(NOTE_DRAG_TYPE)) event.preventDefault();
      }}
      onDrop={(event) => {
        const noteId = event.dataTransfer.getData(NOTE_DRAG_TYPE);
        if (!noteId) return;
        event.preventDefault();
        const point = viewport.screenPosition({ x: event.clientX, y: event.clientY });
        // A position the backend would reject (non-finite) falls back to the viewport centre.
        onDropNote(
          noteId,
          point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : undefined
        );
      }}
    >
      <ReactFlow
        colorMode={theme}
        onInit={viewport.initialize}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        autoPanOnNodeFocus={false}
        elevateNodesOnSelect={false}
        elevateEdgesOnSelect={false}
        nodes={boardNodes({
          board,
          notes,
          measured: measured.current,
          selected,
          dropTarget,
          pop: fx.pop,
          promote: onPromote,
          label,
        })}
        edges={boardEdges(board, selectedEdge, fx.edge, (e) =>
          t('workspace.a11y.edge', {
            source: title(byId(e.source)!),
            target: title(byId(e.target)!),
          })
        )}
        onNodesChange={changes}
        onEdgesChange={edgeChanges}
        onNodeDrag={drag.move}
        onNodeDragStop={drag.stop}
        onNodeClick={(_, node) => {
          const item = byId(node.id);
          if (item) onSelect(item);
        }}
        onDoubleClick={(event) => {
          if (!(event.target instanceof HTMLElement)) return;
          if (!event.target.classList.contains('react-flow__pane')) return;
          const point = viewport.screenPosition({ x: event.clientX, y: event.clientY });
          if (point) onCreateAt(point);
        }}
        onMoveStart={(event) => {
          if (event) viewport.release();
        }}
        onMoveEnd={(_, next) => {
          lastViewport = next;
        }}
        isValidConnection={(c) => {
          const find = (id: string) => board.items.find((i) => i.id === id);
          return canLink(find(c.source), find(c.target));
        }}
        onConnect={(c) => {
          if (c.source && c.target) boardSession.update(connect(board, c.source, c.target));
        }}
        // Delete removes only the selected dependency; items leave the board from the editor.
        deleteKeyCode="Delete"
        onBeforeDelete={async ({ edges }) => ({ nodes: [], edges })}
        onEdgesDelete={(edges) => {
          const current = boardSession.get();
          if (!current) return;
          boardSession.update({
            ...current,
            edges: current.edges.filter((e) => !edges.some((d) => d.id === e.id)),
          });
          setSelectedEdge(null);
        }}
        {...(lastViewport
          ? { defaultViewport: lastViewport }
          : { fitView: true, fitViewOptions: { maxZoom: 1 } })}
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        ariaLabelConfig={{
          'controls.ariaLabel': t('workspace.canvas.controls'),
          'controls.zoomIn.ariaLabel': t('workspace.canvas.zoomIn'),
          'controls.zoomOut.ariaLabel': t('workspace.canvas.zoomOut'),
          'controls.fitView.ariaLabel': t('workspace.canvas.fitView'),
          'controls.interactive.ariaLabel': t('workspace.canvas.interactive'),
          'minimap.ariaLabel': t('workspace.canvas.minimap'),
          'node.a11yDescription.ariaLiveMessage': ({ x, y }) =>
            t('workspace.canvas.moved', { x, y }),
          'node.a11yDescription.default': t('workspace.canvas.nodeHelp'),
          'node.a11yDescription.keyboardDisabled': t('workspace.canvas.nodeHelp'),
          'edge.a11yDescription.default': t('workspace.canvas.edgeHelp'),
        }}
      >
        <Background gap={22} size={1} color="var(--ws-dot)" />
        <Controls fitViewOptions={{ maxZoom: 1 }} showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="ws-minimap"
          nodeColor={(node) =>
            node.type === 'area'
              ? 'none'
              : progressColor((node.data.item as BoardItem)?.progress ?? 0)
          }
          nodeStrokeColor={(node) => (node.type === 'area' ? '#8888' : 'none')}
          nodeStrokeWidth={1}
        />
      </ReactFlow>
      {children}
    </div>
  );
}
