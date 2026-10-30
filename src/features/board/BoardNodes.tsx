import { useRef, type CSSProperties } from 'react';
import { BoardCardResizer } from './BoardCardResizer';
import { containsChildren, type ChildBounds } from './resizeBounds';
import { useTranslation } from 'react-i18next';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { ArrowDownToLine, ArrowUpToLine, Pencil, Check } from 'lucide-react';
import { CanvasNote } from './editor/CanvasNote';
import { NodeResizer } from '@xyflow/react';
import type { EditorFocusRequest } from '../notes/editorFocusRequest';
import { progressColor, type BoardItem } from './model';

type CardData = {
  item: BoardItem;
  label: string;
  editing: boolean;
  focusRequest?: EditorFocusRequest;
  pending?: boolean;
  failed?: boolean;
  retry: () => void;
  dismiss: () => void;
  edit: () => void;
  close: () => void;
  progress: (value: number) => void;
  layer: (direction: 'front' | 'back') => void;
};
export function CardNode({ data, selected }: NodeProps<Node<CardData>>) {
  const { t } = useTranslation('board');
  const body = useRef<HTMLDivElement>(null);
  const progress = data.item.progress ?? 0;
  const activity = data.item.kind === 'card';
  return (
    <div
      ref={body}
      className={`board-card-body ${activity ? '' : 'board-text-body'}`}
      style={
        {
          '--activity-progress': progressColor(progress),
          minHeight: Math.max(activity ? 158 : 78, data.item.height - 2),
        } as CSSProperties
      }
    >
      <BoardCardResizer body={body} visible={!!selected && !data.pending} text={!activity} />
      {activity && <Handle type="target" position={Position.Left} />}
      {data.pending ? (
        <div className="board-pending nodrag nopan">
          <p role={data.failed ? 'alert' : 'status'}>
            {t(data.failed ? 'createFailed' : 'creating')}
          </p>
          {data.failed && (
            <>
              <button onClick={data.retry}>{t('retry')}</button>
              <button onClick={data.dismiss}>{t('cancel')}</button>
            </>
          )}
        </div>
      ) : data.item.noteId ? (
        <CanvasNote
          noteId={data.item.noteId}
          editing={data.editing}
          edit={data.edit}
          close={data.close}
          activity={data.item.kind === 'card'}
          focusRequest={data.focusRequest}
        />
      ) : (
        <p>{t('missing')}</p>
      )}

      {!data.pending && (
        <footer className="board-card-footer nodrag nopan nowheel">
          {activity && (
            <label className="board-completion" title={t('progress')}>
              <span className="sr-only">{t('progress')}</span>
              {data.editing ? (
                <input
                  aria-label={t('progress')}
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={progress}
                  onChange={(e) => {
                    const n = e.target.valueAsNumber;
                    if (Number.isInteger(n) && n >= 0 && n <= 100) data.progress(n);
                  }}
                />
              ) : (
                <span>{progress}</span>
              )}
              <span>%</span>
              {progress === 100 && <Check size={13} aria-hidden="true" />}
            </label>
          )}
          {(selected || data.editing) && (
            <div className="board-card-actions">
              {!data.editing && (
                <button
                  onClick={data.edit}
                  aria-label={t('editActivity')}
                  title={t('editActivity')}
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                onClick={() => data.layer('front')}
                aria-label={t('front')}
                title={t('front')}
              >
                <ArrowUpToLine size={13} />
              </button>
              <button onClick={() => data.layer('back')} aria-label={t('back')} title={t('back')}>
                <ArrowDownToLine size={13} />
              </button>
            </div>
          )}
        </footer>
      )}
      {activity && (
        <div
          className="board-progress-track"
          role="progressbar"
          aria-label={t('progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div style={{ width: `${progress}%` }} />
        </div>
      )}
      {activity && <Handle type="source" position={Position.Right} />}
    </div>
  );
}
export function AreaNode({
  data,
  selected,
}: NodeProps<
  Node<{
    label: string;
    layer: (direction: 'front' | 'back') => void;
    count: number;
    progress: number | null;
    dropTarget: boolean;
    childBounds?: ChildBounds;
  }>
>) {
  const { t } = useTranslation('board');
  const p = data.progress;
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        handleClassName="board-resize-handle"
        lineClassName="board-resize-line"
        shouldResize={(_, rect) => containsChildren(rect, data.childBounds)}
      />
      <div className="board-area-heading">
        <span>{data.label}</span>
        <span className="board-area-progress" style={{ color: progressColor(p ?? 0) }}>
          {p === null
            ? t('noActivities')
            : `${p}% · ${t(p === 100 ? 'completed' : p === 0 ? 'notStarted' : 'inProgress')} · ${data.count}`}
        </span>
        {selected && (
          <div className="nodrag nopan board-card-actions">
            <button onClick={() => data.layer('front')} aria-label={t('front')} title={t('front')}>
              <ArrowUpToLine size={13} />
            </button>
            <button onClick={() => data.layer('back')} aria-label={t('back')} title={t('back')}>
              <ArrowDownToLine size={13} />
            </button>
          </div>
        )}
      </div>
      {p !== null && (
        <div
          className="board-area-meter"
          role="progressbar"
          aria-label={t('areaProgress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p}
        >
          <div style={{ width: `${p}%`, background: progressColor(p) }} />
        </div>
      )}
      {data.dropTarget && (
        <div className="board-drop-hint" role="status">
          {t('dropInto', { area: data.label })}
        </div>
      )}
    </>
  );
}
export const nodeTypes = { card: CardNode, text: CardNode, area: AreaNode };
