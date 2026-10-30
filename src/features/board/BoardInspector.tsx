import { Select } from '../../components/ui/Select';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { assignArea } from './hierarchy';
import { BoardFields } from './BoardFields';
import { boardSession } from './persistence';
import { connect, removeItem, type Board, type BoardItem } from './model';
export function BoardInspector({
  board,
  active,
  selected,
  outline,
  title,
  focusItem,
  patch,
  layer,
  resolveNote,
  openNote,
  setSelected,
  close,
}: {
  board: Board;
  active: BoardItem | undefined;
  selected: string | null;
  layer: (id: string, direction: 'front' | 'back') => void;
  outline: boolean;
  title: (item: BoardItem) => string;
  focusItem: (item: BoardItem) => void;
  patch: (id: string, values: Partial<BoardItem>) => void;
  resolveNote: (item: BoardItem) => { id: string } | undefined;
  openNote: (id: string) => Promise<void>;
  setSelected: (id: string | null) => void;
  close: () => void;
}) {
  const { t } = useTranslation('board');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  return (
    <aside className="board-inspector" aria-label={t('outline')}>
      <div className="board-inspector-heading">
        <h2>{t(active ? 'selection' : 'outline')}</h2>
        <button aria-label={t('hideInspector')} onClick={close}>
          <X size={16} />
        </button>
      </div>
      <details open={outline || !active}>
        <summary>{t('outline')}</summary>
        <ul>
          {board.items.map((i) => (
            <li key={i.id}>
              <button aria-pressed={selected === i.id} onClick={() => focusItem(i)}>
                {title(i)}
              </button>
            </li>
          ))}
        </ul>
      </details>
      {active && active.kind !== 'area' && (
        <label>
          {t('parentArea')}
          <Select
            aria-label={t('parentArea')}
            value={active.parentId ?? ''}
            onChange={(e) =>
              boardSession.update(assignArea(board, active.id, e.target.value || null))
            }
          >
            <option value="">{t('outsideArea')}</option>
            {board.items
              .filter((i) => i.kind === 'area')
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
          </Select>
        </label>
      )}
      {active && (
        <BoardFields
          item={active}
          patch={(values) => patch(active.id, values)}
          layer={(direction) => layer(active.id, direction)}
          canOpen={!!resolveNote(active)}
          open={() => void openNote(resolveNote(active)!.id)}
          remove={() => {
            boardSession.update(removeItem(board, active.id));
            setSelected(null);
          }}
        />
      )}
      <details className="board-dependencies">
        <summary>{t('dependencies')}</summary>
        <fieldset>
          <legend>{t('dependencies')}</legend>
          <label>
            {t('source')}
            <Select
              aria-label={t('source')}
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              <option value="">…</option>
              {board.items
                .filter((i) => i.kind === 'card')
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {title(i)}
                  </option>
                ))}
            </Select>
          </label>
          <label>
            {t('target')}
            <Select
              aria-label={t('target')}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">…</option>
              {board.items
                .filter((i) => i.kind === 'card')
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {title(i)}
                  </option>
                ))}
            </Select>
          </label>
          <button
            disabled={!source || !target || source === target}
            onClick={() => boardSession.update(connect(board, source, target))}
          >
            {t('connect')}
          </button>
          <ul>
            {board.edges.map((e) => (
              <li key={e.id}>
                {title(board.items.find((i) => i.id === e.source)!)} →{' '}
                {title(board.items.find((i) => i.id === e.target)!)}{' '}
                <button
                  aria-label={t('removeEdge')}
                  onClick={() =>
                    boardSession.update({
                      ...board,
                      edges: board.edges.filter((d) => d.id !== e.id),
                    })
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      </details>
    </aside>
  );
}
