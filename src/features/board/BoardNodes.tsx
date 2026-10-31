import { useRef, type CSSProperties } from 'react';
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
import { Check, FileText } from 'lucide-react';
import { Button } from '../../components/ui';
import { noteContentQueryOptions } from '../notes/noteQuery';
import { excerpt } from '../workspace/workspaceModel';
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
  const preview = query.data ? excerpt(query.data.markdown) : '';
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
  label: string;
  color: Color;
  count: number;
  progress: number | null;
  dropTarget: boolean;
  childBounds?: ChildBounds;
};

export function AreaNode({ data, selected }: NodeProps<Node<AreaData>>) {
  const { t } = useTranslation();
  const p = data.progress;
  return (
    <div className="ws-area" data-color={data.color}>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        handleClassName="board-resize-handle"
        lineClassName="board-resize-line"
        shouldResize={(_, rect) => containsChildren(rect, data.childBounds)}
      />
      <h3 className="ws-area-heading">
        {data.label || t('workspace.area.untitled')}
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
