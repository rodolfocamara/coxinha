import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  BaseEdge,
  Handle,
  NodeResizer,
  Position,
  getBezierPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Check, FileText, Square, SquareCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import { noteContentQueryOptions } from '../notes/noteQuery';
import { checklist, excerpt } from '../workspace/workspaceModel';
import { BoardCardResizer } from './BoardCardResizer';
import { containsChildren, type ChildBounds } from './resizeBounds';
import type { BoardItem, Color } from './model';

/** Progress fill shared by cards, areas and the live slider preview. */
export function progressFill(progress: number) {
  return progress >= 100
    ? 'oklch(var(--success))'
    : progress > 0
      ? 'oklch(var(--accent))'
      : 'transparent';
}

export type CardData = {
  item: BoardItem;
  title: string;
  noteId: string | null;
  missing: boolean;
  pop: boolean;
  promote: () => void;
};

/** Activity (`card`) or note (`text`) on the canvas. Editing happens only in the side editor. */
export function CardNode({ data, selected }: NodeProps<Node<CardData>>) {
  const { t } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  const activity = data.item.kind === 'card';
  const progress = data.item.progress ?? 0;
  const query = useQuery({
    ...noteContentQueryOptions(data.noteId ?? ''),
    enabled: !!data.noteId,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const markdown = query.data?.markdown ?? '';
  const tasks = activity && markdown ? checklist(markdown) : [];
  const preview = markdown && !tasks.length ? excerpt(markdown) : '';
  return (
    <div
      ref={body}
      className={`ws-card${activity ? '' : ' ws-card-note'}${data.pop ? ' cx-card-pop' : ''}`}
      style={{ minHeight: Math.max(0, data.item.height - 2) } as CSSProperties}
    >
      <BoardCardResizer body={body} visible={!!selected} text={!activity} />
      <Handle type="target" position={Position.Left} />
      <span className="ws-card-kind" data-progress-label={activity ? data.item.id : undefined}>
        {activity ? (
          `${progress}%`
        ) : (
          <>
            <FileText size={11} aria-hidden="true" />
            {t('workspace.card.note')}
          </>
        )}
      </span>
      <h3 className="ws-card-title">
        {data.missing ? t('workspace.card.missing') : data.title || t('workspace.untitled')}
      </h3>
      {preview && <p className="ws-card-excerpt">{preview}</p>}
      {tasks.length > 0 && (
        <ul className="ws-card-tasks" aria-label={t('workspace.card.checklist')}>
          {tasks.map((task, index) => (
            <li key={index} data-done={task.done || undefined}>
              {task.done ? (
                <SquareCheck size={12} aria-hidden="true" />
              ) : (
                <Square size={12} aria-hidden="true" />
              )}
              <span>
                {task.text}
                {task.done && <span className="sr-only"> ({t('workspace.card.done')})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {activity && (
        <div
          className="ws-card-bar"
          role="progressbar"
          aria-label={t('workspace.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <i
            data-progress-bar={data.item.id}
            style={{ width: `${progress}%`, background: progressFill(progress) }}
          />
        </div>
      )}
      {!activity && !data.missing && (
        <span className="ws-card-quick">
          <Button
            size="xs"
            className="nodrag"
            icon={<Check size={12} aria-hidden="true" />}
            onClick={(event) => {
              event.stopPropagation();
              data.promote();
            }}
          >
            {t('workspace.promote')}
          </Button>
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export type AreaData = {
  id: string;
  label: string;
  /** Double click edits the name in place, as in Excalidraw (spec 0112 P1). */
  rename: (id: string, label: string) => void;
  color: Color;
  count: number;
  progress: number | null;
  dropTarget: boolean;
  childBounds?: ChildBounds;
};

export function AreaNode({ data, selected }: NodeProps<Node<AreaData>>) {
  const { t } = useTranslation();
  const p = data.progress;
  const [editing, setEditing] = useState(false);
  return (
    <div
      className="ws-area"
      data-color={data.color}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        handleClassName="board-resize-handle"
        lineClassName="board-resize-line"
        shouldResize={(_, rect) => containsChildren(rect, data.childBounds)}
      />
      <h3 className="ws-area-heading">
        {editing ? (
          <AreaName
            label={data.label}
            onDone={(label) => {
              setEditing(false);
              if (label !== null && label !== data.label) data.rename(data.id, label);
            }}
          />
        ) : (
          data.label || t('workspace.area.untitled')
        )}
        <span>
          {p === null
            ? t('workspace.area.empty')
            : p === 100
              ? t('workspace.area.done', { count: data.count })
              : t('workspace.area.summary', { progress: p, count: data.count })}
        </span>
      </h3>
      {p !== null && (
        <div
          className="ws-area-meter"
          role="progressbar"
          aria-label={t('workspace.area.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p}
        >
          <i
            style={{
              width: `${p}%`,
              background: p >= 100 ? 'oklch(var(--success))' : 'oklch(var(--info))',
            }}
          />
        </div>
      )}
      {data.dropTarget && (
        <div className="ws-area-drop" role="status">
          {t('workspace.area.dropInto', { area: data.label })}
        </div>
      )}
    </div>
  );
}

/** The area's name as a field: Enter or leaving saves, Escape cancels. */
function AreaName({ label, onDone }: { label: string; onDone: (label: string | null) => void }) {
  const { t } = useTranslation();
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value === null ? null : value.trim());
  };
  return (
    <input
      className="ws-area-name nodrag nopan"
      aria-label={t('workspace.area.rename')}
      defaultValue={label}
      maxLength={200}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Dependency edge. Side by side it runs from the right handle to the left
 * one; when the target sits below the source it drops from the bottom centre
 * to the top centre (prototype `path()`). A new edge draws in once.
 */
export function DependencyEdge(props: EdgeProps<Edge<{ fresh?: boolean }>>) {
  const source = useInternalNode(props.source);
  const target = useInternalNode(props.target);
  let path = getBezierPath(props)[0];
  if (source && target) {
    const a = source.internals.positionAbsolute;
    const b = target.internals.positionAbsolute;
    const aw = source.measured.width ?? 0;
    const ah = source.measured.height ?? 0;
    const bw = target.measured.width ?? 0;
    if (b.y > a.y + ah + 8) {
      const x1 = a.x + aw / 2;
      const y1 = a.y + ah;
      const x2 = b.x + bw / 2;
      const y2 = b.y;
      const my = (y1 + y2) / 2;
      path = `M${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    }
  }
  return (
    <BaseEdge
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
      pathLength={1}
      className={props.data?.fresh ? 'cx-draw' : undefined}
    />
  );
}

export const nodeTypes = { card: CardNode, text: CardNode, area: AreaNode };
export const edgeTypes = { dependency: DependencyEdge };
