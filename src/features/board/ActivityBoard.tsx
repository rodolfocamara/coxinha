import { useCallback, useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Background, Controls, MiniMap, ReactFlow, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './locale';
import './board.css';
import { useAppStore } from '../../lib/store';
import { boardSession } from './persistence';
import { connect, reorderItem, editingSize, progressColor, type BoardItem } from './model';
import { nodeTypes } from './BoardNodes';
import { boardNodes } from './boardNodes';
import { boardDrag } from './boardDrag';
import { boardGeometryChanges } from './boardGeometryChanges';
import { areaProgress, patchItem } from './hierarchy';
import { useBoardCreation } from './useBoardCreation';
import { useBoardEditor } from './useBoardEditor';
import { useBoardViewport } from './useBoardViewport';
import { BoardInspector } from './BoardInspector';
import { Plus, LayoutGrid } from 'lucide-react';
import { BoardToolbar } from './BoardToolbar';
import { useResolvedTheme } from '../../lib/useTheme';
import { errorCategory } from './persistence';
export function ActivityBoard() {
  const { t } = useTranslation('board');
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const editor = useBoardEditor(inspectorToggle);
  const [recovery, setRecovery] = useState(false);
  const notes = useAppStore((s) => s.notes);
  const newNote = useAppStore((s) => s.newNote);
  const [, render] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const resized = useRef(new Set<string>());
  const measured = useRef(new Map<string, { width: number; height: number }>());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [existing, setExisting] = useState('');
  const theme = useResolvedTheme();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const load = useCallback(() => {
    setLoadError(false);
    void boardSession.load().catch(() => setLoadError(true));
  }, []);
  useEffect(() => boardSession.subscribe(() => render((n) => n + 1)), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      void boardSession.flush().catch(() => {});
    },
    []
  );
  const board = boardSession.get();
  const viewport = useBoardViewport(!!board && !loadError, editor.editing?.id ?? null);
  const drag = boardDrag(measured, setDropTarget);
  const dirty = boardSession.dirty();
  const error = boardSession.error();
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void boardSession.flush().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [board, dirty]);
  const update = (fn: (items: BoardItem[]) => BoardItem[]) => {
    if (board) boardSession.update({ ...board, items: fn(board.items) });
  };
  const patch = (id: string, values: Partial<BoardItem>) => {
    const current = boardSession.get();
    if (values.width !== undefined || values.height !== undefined) resized.current.add(id);
    if (current) boardSession.update(patchItem(current, id, values));
  };
  const resolveNote = (item: BoardItem) =>
    notes.find((n) => n.id === item.noteId) || notes.find((n) => n.path === item.notePath);
  const title = (item: BoardItem) =>
    item.kind === 'area'
      ? item.label
      : resolveNote(item)?.title || (resolveNote(item) ? t('untitled') : t('missing'));
  async function openNote(id: string, cardId?: string) {
    const item =
      board?.items.find(
        (candidate) => candidate.id === (cardId ?? selected) && resolveNote(candidate)?.id === id
      ) ?? board?.items.find((candidate) => resolveNote(candidate)?.id === id);
    if (item) focusItem(editingSize(item), false);
    setInspectorOpen(false);
    editor.open(id, undefined, item?.id);
  }
  function focusItem(item: BoardItem, details = true) {
    setSelected(item.id);
    if (details) setInspectorOpen(true);
    viewport.focus(item);
  }
  const creation = useBoardCreation({
    notes,
    newNote,
    begin: editor.begin,
    position: viewport.creationPosition,
    open: (item, request) => {
      if (editor.open(item.noteId!, request, item.id)) {
        focusItem(editingSize(item), false);
        setInspectorOpen(false);
      }
    },
  });
  const addNote = creation.create;
  const layer = (id: string, direction: 'front' | 'back') => {
    const current = boardSession.get();
    if (current) boardSession.update(reorderItem(current, id, direction));
  };
  const closeEditor = () => {
    viewport.release();
    editor.close();
  };
  function addArea() {
    if (!board) return;
    const item: BoardItem = {
      id: crypto.randomUUID(),
      kind: 'area',
      ...viewport.creationPosition(580, 350),
      width: 580,
      height: 350,
      color: 'blue',
      label: t('areaName'),
      noteId: null,
      notePath: null,
    };
    update((items) => [item, ...items]);
    focusItem(item);
  }

  function changes(changes: NodeChange[]) {
    const current = boardSession.get();
    if (!current) return;
    for (const change of changes) {
      if (change.type === 'select')
        setSelected((previous) =>
          change.selected ? change.id : previous === change.id ? null : previous
        );
      if (change.type === 'position') viewport.release();
    }
    const next = boardGeometryChanges(
      current,
      changes,
      measured.current,
      editor.editing?.cardId,
      resized.current
    );
    if (next !== current) boardSession.update(next);
  }

  if (loadError)
    return (
      <div role="alert" className="p-8">
        <p>{t('loadError')}</p>
        <button onClick={load}>{t('retryLoad')}</button>
      </div>
    );
  if (!board)
    return (
      <p role="status" className="p-8">
        {t('loading')}
      </p>
    );
  const active = board.items.find((i) => i.id === selected);
  return (
    <section className="activity-board" aria-label={t('title')}>
      <BoardToolbar
        inspectorToggle={inspectorToggle}
        dirty={dirty}
        error={error}
        notes={notes}
        existing={existing}
        setExisting={setExisting}
        addNote={addNote}
        addArea={addArea}
        addText={() => void creation.createText()}
        inspectorOpen={inspectorOpen && !editor.editing}
        outlineOpen={outlineOpen}
        setInspectorOpen={(open) => {
          if (open && editor.editing) editor.close();
          setInspectorOpen(open);
        }}
        setOutlineOpen={setOutlineOpen}
        save={() => {
          void boardSession.flush().catch(() => {});
        }}
      />
      {(error || actionError) && (
        <p role="alert" className="board-error">
          {t(error ? errorCategory(error) : 'actionError')}
          {error && (
            <>
              <button
                onClick={() => {
                  void boardSession
                    .exportRecovery()
                    .then(() => setRecovery(true))
                    .catch(() => setActionError(true));
                }}
              >
                {t('export')}
              </button>
              {recovery && <span role="status">{t('recoverySaved')}</span>}
              <button onClick={() => setConfirmReload(true)}>{t('reload')}</button>
            </>
          )}
        </p>
      )}
      {confirmReload && (
        <div role="alertdialog" aria-label={t('reload')} className="board-toolbar">
          <p>{t('reloadConfirm')}</p>
          <button
            onClick={() => {
              void boardSession
                .reloadSaved()
                .then(() => setConfirmReload(false))
                .catch(() => setActionError(true));
            }}
          >
            {t('discard')}
          </button>
          <button onClick={() => setConfirmReload(false)}>{t('cancel')}</button>
        </div>
      )}

      <div className="board-workspace">
        <div className="board-canvas" ref={viewport.canvas}>
          <ReactFlow
            colorMode={theme}
            onInit={viewport.initialize}
            nodeTypes={nodeTypes}
            autoPanOnNodeFocus={false}
            elevateNodesOnSelect={false}
            elevateEdgesOnSelect={false}
            nodes={boardNodes({
              board,
              measured: measured.current,
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
            })}
            edges={board.edges.map((e) => ({
              ...e,
              markerEnd: { type: 'arrowclosed' as never },
              ariaLabel: `${title(board.items.find((i) => i.id === e.source)!)} → ${title(board.items.find((i) => i.id === e.target)!)}`,
            }))}
            onNodesChange={changes}
            onNodeDrag={drag.move}
            onNodeDragStop={drag.stop}
            onDoubleClick={(e) => {
              if (
                e.target instanceof HTMLElement &&
                e.target.classList.contains('react-flow__pane')
              ) {
                const point = viewport.screenPosition({ x: e.clientX, y: e.clientY });
                if (point) void creation.createText(point);
              }
            }}
            onMoveStart={(event) => {
              if (event) viewport.release();
            }}
            onNodeClick={(_, node) => {
              setSelected(node.id);
              if (
                !editor.editing &&
                board.items.find((item) => item.id === node.id)?.kind === 'area'
              )
                setInspectorOpen(true);
              setOutlineOpen(false);
            }}
            onNodeDoubleClick={(_, node) => {
              const item = board.items.find((i) => i.id === node.id);
              const note = item ? resolveNote(item) : undefined;
              if (note) void openNote(note.id, node.id);
            }}
            onConnect={(c) => {
              if (c.source && c.target) boardSession.update(connect(board, c.source, c.target));
            }}
            onEdgesDelete={(edges) =>
              boardSession.update({
                ...board,
                edges: board.edges.filter((e) => !edges.some((d) => d.id === e.id)),
              })
            }
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            zoomOnDoubleClick={false}
            ariaLabelConfig={{
              'controls.ariaLabel': t('tools'),
              'controls.zoomIn.ariaLabel': t('zoomIn'),
              'controls.zoomOut.ariaLabel': t('zoomOut'),
              'controls.fitView.ariaLabel': t('fitView'),
              'controls.interactive.ariaLabel': t('toggleInteractive'),
              'minimap.ariaLabel': t('minimap'),
              'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
                t('moved', { direction, x, y }),
              'node.a11yDescription.default': t('nodeHelp'),
              'node.a11yDescription.keyboardDisabled': t('nodeHelp'),
              'edge.a11yDescription.default': t('edgeHelp'),
            }}
            minZoom={0.1}
            maxZoom={2}
            deleteKeyCode={null}
          >
            <Background gap={24} size={1} color="var(--board-dot)" />
            <Controls fitViewOptions={{ maxZoom: 1 }} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.type === 'area'
                  ? 'none'
                  : progressColor((node.data.item as BoardItem)?.progress ?? 0)
              }
              nodeStrokeColor={(node) =>
                node.type === 'area'
                  ? progressColor(areaProgress(board, node.id).progress ?? 0)
                  : 'none'
              }
              nodeStrokeWidth={1}
            />
          </ReactFlow>
          {board.items.length === 0 && !creation.pending && (
            <div className="board-empty">
              <LayoutGrid size={32} strokeWidth={1.3} />
              <h2>{t('emptyTitle')}</h2>
              <p>{t('emptyBody')}</p>
              <button className="board-primary" onClick={() => void addNote()}>
                <Plus size={16} />
                {t('startActivity')}
              </button>
            </div>
          )}
          <p className="board-help">{t('canvasHint')}</p>
        </div>
        {inspectorOpen && !editor.editing && (
          <BoardInspector
            board={board}
            active={active}
            selected={selected}
            outline={outlineOpen}
            title={title}
            focusItem={focusItem}
            patch={patch}
            layer={layer}
            resolveNote={resolveNote}
            openNote={openNote}
            setSelected={setSelected}
            close={() => {
              setInspectorOpen(false);
              inspectorToggle.current?.focus();
            }}
          />
        )}
      </div>
    </section>
  );
}
