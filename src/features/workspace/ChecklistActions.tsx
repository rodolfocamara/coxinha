import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, LayoutGrid } from 'lucide-react';
import { Button } from '../../components/ui';
import type { NoteBlockEditor } from '../notes/NoteEditor';

type Task = { id: string; text: string };
type Block = {
  id: string;
  type: string;
  props?: { checked?: boolean };
  content?: unknown;
  children?: Block[];
};

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part: { type?: string; text?: string; content?: unknown }) =>
      part.type === 'text' ? (part.text ?? '') : inlineText(part.content)
    )
    .join('');
}

/** Unchecked checklist lines of a BlockNote document, nested ones included. */
export function uncheckedTasks(blocks: Block[]): Task[] {
  return blocks.flatMap((block) => [
    ...(block.type === 'checkListItem' && !block.props?.checked && inlineText(block.content).trim()
      ? [{ id: block.id, text: inlineText(block.content).trim() }]
      : []),
    ...uncheckedTasks(block.children ?? []),
  ]);
}

const escape = (id: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
const lineOf = (host: Element | null | undefined, id: string) =>
  host?.querySelector(`[data-id="${escape(id)}"] .bn-block-content`) ??
  host?.querySelector(`[data-id="${escape(id)}"]`) ??
  null;

/**
 * Overlay over the side editor's document: each unchecked task line shows
 * "→ atividade" on hover (always in the tab order), or "no quadro" once it
 * became a card. Positions follow the rendered lines; the text is untouched.
 */
export function ChecklistActions({
  editor,
  linked,
  onCreate,
  onOpen,
}: {
  editor: NoteBlockEditor;
  linked: (text: string) => string | undefined;
  onCreate: (text: string, line: Element | null) => void;
  onOpen: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<Task[]>(() => uncheckedTasks(editor.document as Block[]));
  const [rects, setRects] = useState<Record<string, { top: number; height: number }>>({});
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const read = () => setTasks(uncheckedTasks(editor.document as Block[]));
    read();
    return typeof editor.onChange === 'function' ? editor.onChange(read) : undefined;
  }, [editor]);

  useLayoutEffect(() => {
    const host = root.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const base = host.getBoundingClientRect();
      const next: Record<string, { top: number; height: number }> = {};
      for (const task of tasks) {
        const rect = lineOf(host, task.id)?.getBoundingClientRect();
        if (rect) next[task.id] = { top: rect.top - base.top, height: rect.height };
      }
      setRects(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [tasks]);

  useEffect(() => {
    const host = root.current?.parentElement;
    if (!host) return;
    const over = (event: MouseEvent) => {
      const target = event.target as Element;
      const action = target.closest?.('[data-task-id]');
      const block = target.closest?.('.bn-block-outer[data-id]');
      setHover(action?.getAttribute('data-task-id') ?? block?.getAttribute('data-id') ?? null);
    };
    const leave = () => setHover(null);
    host.addEventListener('mouseover', over);
    host.addEventListener('mouseleave', leave);
    return () => {
      host.removeEventListener('mouseover', over);
      host.removeEventListener('mouseleave', leave);
    };
  }, []);

  if (!tasks.length) return null;
  return (
    <div
      ref={root}
      className="ws-task-actions"
      role="group"
      aria-label={t('workspace.checklist.group')}
    >
      {tasks.map((task) => {
        const card = linked(task.text);
        const rect = rects[task.id];
        return (
          <div
            key={task.id}
            data-task-id={task.id}
            className="ws-task-action"
            data-visible={hover === task.id || !!card || undefined}
            style={rect ? { top: rect.top, height: rect.height } : { position: 'static' }}
          >
            {card ? (
              <button
                type="button"
                className="ws-chip"
                aria-label={t('workspace.checklist.onBoardFor', { text: task.text })}
                onClick={() => onOpen(card)}
              >
                <LayoutGrid size={12} aria-hidden="true" />
                {t('workspace.checklist.onBoard')}
              </button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                icon={<ArrowRight size={12} aria-hidden="true" />}
                title={t('workspace.checklist.toActivityHint')}
                aria-label={t('workspace.checklist.toActivityFor', { text: task.text })}
                onClick={() => onCreate(task.text, lineOf(root.current?.parentElement, task.id))}
              >
                {t('workspace.checklist.toActivity')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
