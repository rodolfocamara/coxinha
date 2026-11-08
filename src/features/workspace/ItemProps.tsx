import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import { Button, Select } from '../../components/ui';
import { progressFill } from '../board/BoardNodes';
import type { BoardItem } from '../board/model';
import type { Workspace } from './useWorkspace';

function setText(el: Element, text: string) {
  // Keep React's own text node so later renders stay in sync.
  if (el.firstChild?.nodeType === Node.TEXT_NODE) el.firstChild.nodeValue = text;
  else el.textContent = text;
}

/**
 * Uncontrolled range: dragging updates the card in place (label and bar)
 * without re-rendering React or the slider; the board commits on `change`.
 */
function ProgressSlider({ item, commit }: { item: BoardItem; commit: (progress: number) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLOutputElement>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const progress = item.progress ?? 0;
  useLayoutEffect(() => {
    if (output.current) output.current.textContent = `${progress}%`;
  }, [progress]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const done = () => commitRef.current(Number(el.value));
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [item.id]);
  const live = (value: number) => {
    if (output.current) output.current.textContent = `${value}%`;
    document
      .querySelectorAll(`[data-progress-label="${item.id}"]`)
      .forEach((el) => setText(el, `${value}%`));
    document.querySelectorAll<HTMLElement>(`[data-progress-bar="${item.id}"]`).forEach((el) => {
      el.style.width = `${value}%`;
      el.style.background = progressFill(value);
    });
  };
  return (
    <span className="flex items-center gap-2">
      <input
        key={item.id}
        ref={input}
        type="range"
        min={0}
        max={100}
        step={5}
        defaultValue={progress}
        aria-label={t('workspace.progress')}
        className="ws-range"
        onInput={(e) => live(Number(e.currentTarget.value))}
      />
      <output ref={output} className="w-9 text-right tabular-nums font-semibold" />
    </span>
  );
}

/** Activity properties: progress, area, dependencies ("Depende de" + "ligar"). */
export function ActivityProps({ ws, item }: { ws: Workspace; item: BoardItem }) {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false);
  useEffect(() => setLinking(false), [item.id]);
  const board = ws.board!;
  const areas = board.items.filter((i) => i.kind === 'area');
  const deps = board.edges.filter((e) => e.target === item.id);
  const candidates = board.items.filter(
    (i) => i.kind === 'card' && i.id !== item.id && !deps.some((d) => d.source === i.id)
  );
  const byId = (id: string) => board.items.find((i) => i.id === id)!;
  return (
    <div className="ws-props">
      <span>{t('workspace.progress')}</span>
      <ProgressSlider item={item} commit={(progress) => ws.patch(item.id, { progress })} />
      <span>{t('workspace.editor.area')}</span>
      <Select
        size="sm"
        block
        aria-label={t('workspace.editor.area')}
        value={item.parentId ?? ''}
        onChange={(e) => ws.assignArea(item.id, e.target.value || null)}
      >
        <option value="">{t('workspace.editor.noArea')}</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {ws.title(a)}
          </option>
        ))}
      </Select>
      <span>{t('workspace.editor.dependsOn')}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {deps.map((edge) => (
          <span key={edge.id} className="ws-chip-group">
            <button
              type="button"
              className="ws-chip"
              onClick={() => ws.selectById(edge.source, true)}
            >
              {ws.title(byId(edge.source))}
            </button>
            <button
              type="button"
              className="ws-chip-x"
              aria-label={t('workspace.editor.removeDependency', {
                title: ws.title(byId(edge.source)),
              })}
              onClick={() => ws.disconnect(edge.id)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
        {!deps.length && !linking && (
          <span className="text-muted-foreground">{t('workspace.editor.nothing')}</span>
        )}
        {linking ? (
          <Select
            size="sm"
            aria-label={t('workspace.editor.chooseDependency')}
            value=""
            onChange={(e) => {
              if (e.target.value) ws.connect(e.target.value, item.id);
              setLinking(false);
            }}
          >
            <option value="">{t('workspace.editor.choose')}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {ws.title(c)}
              </option>
            ))}
          </Select>
        ) : (
          <button
            type="button"
            className="ws-chip ws-chip-add"
            disabled={!candidates.length}
            onClick={() => setLinking(true)}
          >
            <Plus size={11} aria-hidden="true" />
            {t('workspace.editor.link')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A note on the board: one line of explanation and "Virar atividade". */
export function NoteProps({ ws, item }: { ws: Workspace; item: BoardItem }) {
  const { t } = useTranslation();
  return (
    <div className="ws-props ws-props-single">
      <span className="text-muted-foreground">{t('workspace.editor.noteHint')}</span>
      <span>
        <Button
          size="xs"
          variant="primary"
          icon={<Check size={12} aria-hidden="true" />}
          onClick={() => ws.promote(item.id)}
        >
          {t('workspace.promote')}
        </Button>
      </span>
    </div>
  );
}

/** A note off the board (meeting, shortcut or palette note). */
export function OffBoardProps({ ws, noteId }: { ws: Workspace; noteId: string }) {
  const { t } = useTranslation();
  return (
    <div className="ws-props ws-props-single">
      <span className="text-muted-foreground">{t('workspace.editor.offBoardHint')}</span>
      <span>
        <Button
          size="xs"
          variant="primary"
          icon={<Plus size={12} aria-hidden="true" />}
          onClick={() => ws.place(noteId)}
        >
          {t('workspace.drawer.place')}
        </Button>
      </span>
    </div>
  );
}
