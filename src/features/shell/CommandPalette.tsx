import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { useAppStore } from '../../lib/store';
import { noteDeletionErrorKey } from '../../lib/noteFileErrors';
import { buildGroups, type Target } from '../search/universalSearch';
import { useUniversalSearch } from '../search/useUniversalSearch';
import { usePaletteActions } from './usePaletteActions';
import {
  LISTBOX_ID,
  optionId,
  PaletteList,
  type NoteRow,
  type PaletteGroup,
  type PaletteRow,
} from './PaletteList';
import './palette.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Ctrl+K overlay (specs 0096, 0122): actions, every rail destination and the
 * universal search over notes, meetings, transcripts and people. Note rows
 * open in the Workspace; the trash button and Ctrl+Backspace delete with
 * confirmation.
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
  const search = useUniversalSearch(query, open);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDeleteFailure(null);
    setCursor(0);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open]);

  /** Esc and the backdrop hand focus back to where the palette was opened. */
  function dismiss() {
    onClose();
    if (opener.current?.isConnected) opener.current.focus();
  }

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

  const groups = useMemo<PaletteGroup[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (label: string) => !q || label.toLowerCase().includes(q);
    const g = (key: string) => t(`people.palette.groups.${key}`);
    const commands: PaletteGroup[] = [
      { id: 'actions', label: g('actions'), items: actions.filter((a) => match(a.label)) },
      { id: 'go', label: g('goTo'), items: destinations.filter((a) => match(a.label)) },
    ];
    if (!q)
      commands.push({
        id: 'notes',
        label: g('notes'),
        items: notes.map<NoteRow>((n) => ({ kind: 'note', id: n.id, label: n.title || untitled })),
      });
    const found = buildGroups(query, notes, search.answer, new Date(), untitled).map(
      (group): PaletteGroup => ({
        id: group.kind,
        label: t(`search.groups.${group.kind}`),
        items: group.items.map(
          (item): PaletteRow =>
            item.target.view === 'note'
              ? {
                  kind: 'note',
                  id: item.target.noteId,
                  label: item.label,
                  detail: item.detail,
                  activity: item.activity,
                }
              : { kind: 'result', id: item.key, item }
        ),
      })
    );
    return [...commands, ...found].filter((group) => group.items.length > 0);
  }, [query, notes, actions, destinations, t, untitled, search.answer]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    document.getElementById(optionId(cursor))?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  function openTarget(target: Target) {
    switch (target.view) {
      case 'note':
        return navigate({ to: '/workspace/$noteId', params: { noteId: target.noteId } });
      case 'session':
        return navigate({ to: '/meetings/$sessionId', params: { sessionId: target.sessionId } });
      case 'event':
        return navigate({ to: '/meetings', search: { event: target.eventId } });
      case 'transcript':
        return navigate({
          to: '/meetings/$sessionId',
          params: { sessionId: target.sessionId },
          search: { panel: 'transcript', find: target.find },
        });
      case 'person':
        return navigate({ to: '/people', search: { person: target.personId, name: target.name } });
    }
  }

  function pick(row: PaletteRow) {
    if (row.kind === 'action' && row.keepOpen) {
      void row.run();
      return;
    }
    onClose();
    if (row.kind === 'action') void row.run();
    else if (row.kind === 'note')
      void navigate({ to: '/workspace/$noteId', params: { noteId: row.id } });
    else void openTarget(row.item.target);
  }

  async function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
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

  const mod = isMac() ? '⌘' : 'Ctrl';

  return (
    <div
      className="cx-palette-overlay fixed inset-0 z-50 flex justify-center bg-black/35 px-4 pt-[5.625rem] backdrop-blur-[3px]"
      onClick={dismiss}
      role="presentation"
    >
      <div
        className="cx-palette-panel flex max-h-[min(560px,70vh)] w-full max-w-[37.5rem] flex-col self-start overflow-hidden rounded-[16px] border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        role="dialog"
        aria-modal="true"
        aria-label={t('people.palette.title')}
      >
        <div className="flex h-[3.25rem] items-center gap-2.5 border-b border-border px-4">
          <Search size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={flat[cursor] ? optionId(cursor) : undefined}
            placeholder={t('people.palette.placeholder')}
            aria-label={t('people.palette.placeholder')}
            className="flex-1 bg-transparent text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground"
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
              {search.pending ? t('search.searching') : t('people.palette.empty', { query })}
            </div>
          )}
          <PaletteList
            groups={groups}
            cursor={cursor}
            query={query}
            onHover={setCursor}
            onPick={pick}
            onDelete={(id) => {
              const note = notes.find((n) => n.id === id);
              if (note) void confirmAndDelete({ id: note.id, title: note.title });
            }}
          />
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {query.trim()
            ? search.pending
              ? t('search.searching')
              : t('search.count', { count: flat.length })
            : ''}
        </p>

        <div className="flex gap-3.5 border-t border-border px-3.5 py-2 text-[0.6875rem] text-muted-foreground">
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
