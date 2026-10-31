import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FileText, Search, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { useAppStore } from '../../lib/store';
import { noteDeletionErrorKey } from '../../lib/noteFileErrors';
import { usePaletteActions, type PaletteAction } from './usePaletteActions';
import './palette.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type NoteRow = { kind: 'note'; id: string; label: string };
type PaletteRow = NoteRow | PaletteAction;
type Group = { id: string; label: string; items: PaletteRow[] };

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Ctrl+K overlay (spec 0096): actions (record, new meeting, new note, import
 * audio), every rail destination and note titles. Note rows open in the
 * Workspace; the trash button and Ctrl+Backspace delete with confirmation.
 */
export function CommandPalette({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (s) => s.pathname });
  const notes = useAppStore((s) => s.notes);
  const deleteNote = useAppStore((s) => s.deleteNote);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [deleteFailure, setDeleteFailure] = useState<{ error: unknown } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const untitled = t('sidebar.untitled');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDeleteFailure(null);
    setCursor(0);
    const id = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open]);

  const currentNoteId = pathname.match(/^\/(?:workspace|notes)\/([^/]+)/)?.[1];
  const currentNote = useMemo(
    () => (currentNoteId ? notes.find((n) => n.id === currentNoteId) : undefined),
    [currentNoteId, notes]
  );

  async function confirmAndDelete(note: { id: string; title: string }) {
    if (!window.confirm(t('palette.deleteConfirm', { title: note.title || untitled }))) return;
    try {
      await deleteNote(note.id);
      setDeleteFailure(null);
      if (note.id === currentNoteId) {
        await navigate({ to: '/workspace' });
        onClose();
      }
    } catch (error) {
      setDeleteFailure({ error });
    }
  }

  const { actions, destinations } = usePaletteActions({
    open,
    pathname,
    currentNote,
    onDeleteCurrent: (note) => void confirmAndDelete(note),
  });

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (label: string) => !q || label.toLowerCase().includes(q);
    const noteRows = notes
      .filter((n) => match(n.title || untitled))
      .slice(0, q ? 20 : undefined)
      .map<NoteRow>((n) => ({ kind: 'note', id: n.id, label: n.title || untitled }));
    const g = (key: string) => t(`people.palette.groups.${key}`);
    return [
      { id: 'actions', label: g('actions'), items: actions.filter((a) => match(a.label)) },
      { id: 'go', label: g('goTo'), items: destinations.filter((a) => match(a.label)) },
      { id: 'notes', label: g('notes'), items: noteRows },
    ].filter((group) => group.items.length > 0);
  }, [query, notes, actions, destinations, t, untitled]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setCursor(0), [query]);

  function pick(row: PaletteRow) {
    if (row.kind === 'action' && row.keepOpen) {
      void row.run();
      return;
    }
    onClose();
    if (row.kind === 'action') void row.run();
    else void navigate({ to: '/workspace/$noteId', params: { noteId: row.id } });
  }

  async function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor((v) => Math.min(flat.length - 1, Math.max(0, v + step)));
      return;
    }
    if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
      const row = flat[cursor];
      if (row?.kind === 'note') {
        e.preventDefault();
        const note = notes.find((n) => n.id === row.id);
        if (note) await confirmAndDelete({ id: note.id, title: note.title });
      }
      return;
    }
    if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      pick(flat[cursor]);
    }
  }

  if (!open) return null;

  let flatIdx = -1;
  const mod = isMac() ? '⌘' : 'Ctrl';

  return (
    <div
      className="cx-palette-overlay fixed inset-0 z-50 flex justify-center bg-black/35 px-4 pt-[90px] backdrop-blur-[3px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="cx-palette-panel flex max-h-[min(560px,70vh)] w-full max-w-[600px] flex-col self-start overflow-hidden rounded-[16px] border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        role="dialog"
        aria-modal="true"
        aria-label={t('people.palette.title')}
      >
        <div className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
          <Search size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('people.palette.placeholder')}
            aria-label={t('people.palette.placeholder')}
            className="flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="cx-kbd">Esc</kbd>
        </div>

        {deleteFailure && (
          <p role="alert" className="px-4 py-2">
            {t(noteDeletionErrorKey(deleteFailure.error) ?? 'editor.deleteFailed')}
          </p>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {flat.length === 0 && (
            <div className="px-4 py-7 text-center text-sm text-muted-foreground">
              {t('people.palette.empty', { query })}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`palette-group-${group.id}`}>
              <h6
                id={`palette-group-${group.id}`}
                className="mx-2 mt-1 mb-1 text-[11px] font-semibold text-muted-foreground"
              >
                {group.label}
              </h6>
              {group.items.map((item) => {
                flatIdx++;
                const index = flatIdx;
                return (
                  <PaletteItemRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    active={index === cursor}
                    onHover={() => setCursor(index)}
                    onPick={() => pick(item)}
                    onDelete={
                      item.kind === 'note'
                        ? () => {
                            const note = notes.find((n) => n.id === item.id);
                            if (note) void confirmAndDelete({ id: note.id, title: note.title });
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex gap-3.5 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
          <span>
            <kbd className="cx-kbd">↑</kbd>
            <kbd className="cx-kbd ml-0.5">↓</kbd> {t('people.palette.hints.navigate')}
          </span>
          <span>
            <kbd className="cx-kbd">↵</kbd> {t('people.palette.hints.open')}
          </span>
          <span>
            <kbd className="cx-kbd">{mod}⌫</kbd> {t('people.palette.hints.delete')}
          </span>
          <span>
            <kbd className="cx-kbd">Esc</kbd> {t('people.palette.hints.close')}
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteItemRow({
  item,
  active,
  onHover,
  onPick,
  onDelete,
}: {
  item: PaletteRow;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'group flex h-9 w-full items-center rounded-lg text-sm text-foreground transition-colors duration-(--m-instant)',
        active && 'bg-accent'
      )}
      data-active={active || undefined}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2 text-left outline-none"
      >
        <span
          className={clsx(
            'shrink-0',
            item.kind === 'action' && item.danger ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {item.kind === 'note' ? <FileText size={15} aria-hidden="true" /> : item.icon}
        </span>
        <span className="flex-1 truncate">{item.label}</span>
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('people.palette.actions.deleteNote')}
          title={t('people.palette.actions.deleteNote')}
          className="mx-1 shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : item.kind === 'action' && item.hint ? (
        <kbd className="cx-kbd mr-2 shrink-0">{item.hint}</kbd>
      ) : null}
    </div>
  );
}
