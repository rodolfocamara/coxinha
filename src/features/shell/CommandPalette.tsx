import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FileText, Search, Settings, Sparkles, Trash2 } from 'lucide-react';
import clsx from 'clsx';

import { useAppStore } from '../../lib/store';
import { applyTheme, setThemePreference } from '../../lib/theme';
import { useResolvedTheme } from '../../lib/useTheme';
import { noteDeletionErrorKey } from '../../lib/noteFileErrors';

interface Props {
  open: boolean;
  onClose: () => void;
}

type PaletteRow =
  | { kind: 'note'; id: string; label: string; hint?: string }
  | { kind: 'action'; id: string; label: string; hint?: string; run: () => void };

type Group = { label: string; items: PaletteRow[] };

/**
 * Ctrl+K overlay. Fuzzy across note titles + an action registry
 * (new note, switch view, toggle theme, delete current note,
 * open settings). Per-row trash button + Ctrl+Backspace for fast
 * delete from the list. Spec 0043.
 */
export function CommandPalette({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resolvedTheme = useResolvedTheme();
  const pathname = useLocation({ select: (s) => s.pathname });
  const notes = useAppStore((s) => s.notes);
  const newNote = useAppStore((s) => s.newNote);
  const deleteNote = useAppStore((s) => s.deleteNote);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [deleteFailure, setDeleteFailure] = useState<{ error: unknown } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDeleteFailure(null);
    setCursor(0);
    const id = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open]);

  const currentNoteId = useMemo(() => {
    const match = pathname.match(/^\/notes\/([^/]+)/);
    return match?.[1];
  }, [pathname]);
  const currentNote = useMemo(
    () => (currentNoteId ? notes.find((n) => n.id === currentNoteId) : undefined),
    [currentNoteId, notes]
  );

  async function confirmAndDelete(note: { id: string; title: string }) {
    const label = note.title || t('sidebar.untitled');
    const prompt = t('palette.deleteConfirm', { title: label });
    if (!window.confirm(prompt)) return;
    try {
      await deleteNote(note.id);
      setDeleteFailure(null);
      if (note.id === currentNoteId) {
        await navigate({ to: '/notes' });
        onClose();
      }
    } catch (error) {
      setDeleteFailure({ error });
    }
  }

  const actions = useMemo<PaletteRow[]>(() => {
    const items: PaletteRow[] = [
      {
        kind: 'action',
        id: 'new-note',
        label: t('palette.actions.newNote'),
        hint: 'Ctrl+N',
        run: async () => {
          const note = await newNote();
          await navigate({
            to: '/notes/$noteId',
            params: { noteId: note.id },
          });
        },
      },
      {
        kind: 'action',
        id: 'open-agenda',
        label: t('palette.actions.openAgenda'),
        hint: 'Win+Shift+A',
        run: () => navigate({ to: '/agenda' }),
      },
      {
        kind: 'action',
        id: 'toggle-theme',
        label: t('palette.actions.toggleTheme'),
        run: () => {
          const next = resolvedTheme === 'dark' ? 'light' : 'dark';
          setThemePreference(next);
          applyTheme(next);
        },
      },
      {
        kind: 'action',
        id: 'open-settings',
        label: t('palette.actions.openSettings'),
        hint: 'Ctrl+,',
        run: () => navigate({ to: '/settings' }),
      },
    ];
    if (currentNote) {
      items.splice(1, 0, {
        kind: 'action',
        id: 'delete-current-note',
        label: t('palette.actions.deleteCurrentNote'),
        hint: 'Ctrl+Backspace',
        run: () => void confirmAndDelete(currentNote),
      });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, newNote, t, currentNote, resolvedTheme]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // All notes on empty query — palette doubles as a browse list.
      const recent = notes.map<PaletteRow>((n) => ({
        kind: 'note',
        id: n.id,
        label: n.title || t('sidebar.untitled'),
      }));
      return [
        ...(recent.length ? [{ label: t('palette.sections.notes'), items: recent }] : []),
        { label: t('palette.sections.actions'), items: actions },
      ];
    }
    const noteHits = notes
      .filter((n) => (n.title || '').toLowerCase().includes(q))
      .slice(0, 20)
      .map<PaletteRow>((n) => ({
        kind: 'note',
        id: n.id,
        label: n.title || t('sidebar.untitled'),
      }));
    const actionHits = actions.filter((a) => a.label.toLowerCase().includes(q));
    return [
      ...(noteHits.length ? [{ label: t('palette.sections.notes'), items: noteHits }] : []),
      ...(actionHits.length ? [{ label: t('palette.sections.actions'), items: actionHits }] : []),
    ];
  }, [query, notes, actions, t]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setCursor(0), [query]);

  function pick(row: PaletteRow) {
    if (row.kind === 'action' && row.id === 'delete-current-note') {
      row.run();
      return;
    }
    onClose();
    if (row.kind === 'action') {
      row.run();
    } else {
      void navigate({ to: '/notes/$noteId', params: { noteId: row.id } });
    }
  }

  async function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((v) => Math.min(flat.length - 1, v + 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((v) => Math.max(0, v - 1));
    }
    // Ctrl+Backspace on a focused note row → delete with confirm
    if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
      const row = flat[cursor];
      if (row?.kind === 'note') {
        e.preventDefault();
        const note = notes.find((n) => n.id === row.id);
        if (note) {
          await confirmAndDelete({ id: note.id, title: note.title });
        }
        return;
      }
    }
    if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      pick(flat[cursor]);
    }
  }

  if (!open) return null;

  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center px-4 pt-[14vh] bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[560px] max-h-[60vh] flex flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
      >
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border">
          <Search size={17} className="text-muted-foreground shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            className="flex-1 bg-transparent outline-none text-base text-foreground placeholder:text-muted-foreground"
          />
          <kbd className="cx-kbd">Esc</kbd>
        </div>

        {deleteFailure && (
          <p role="alert" className="px-4 py-2">
            {t(noteDeletionErrorKey(deleteFailure.error) ?? 'editor.deleteFailed')}
          </p>
        )}
        <div className="flex-1 overflow-y-auto p-1.5">
          {flat.length === 0 && (
            <div className="px-4 py-7 text-center text-sm text-muted-foreground">
              {t('palette.empty', { query })}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label} className="py-1.5">
              <div className="cx-eyebrow px-2.5 pt-1.5 pb-1">{group.label}</div>
              {group.items.map((item) => {
                flatIdx++;
                const active = flatIdx === cursor;
                const localIdx = flatIdx;
                return (
                  <PaletteItemRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    active={active}
                    onHover={() => setCursor(localIdx)}
                    onPick={() => pick(item)}
                    onDelete={
                      item.kind === 'note'
                        ? () => {
                            const note = notes.find((n) => n.id === item.id);
                            if (note) {
                              void confirmAndDelete({
                                id: note.id,
                                title: note.title,
                              });
                            }
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex gap-3.5 px-3.5 py-2 border-t border-border text-[11px] text-muted-foreground">
          <span>
            <kbd className="cx-kbd">↑</kbd>
            <kbd className="cx-kbd ml-0.5">↓</kbd> {t('palette.hints.navigate')}
          </span>
          <span>
            <kbd className="cx-kbd">↵</kbd> {t('palette.hints.open')}
          </span>
          <span>
            <kbd className="cx-kbd">⌘⌫</kbd> {t('palette.hints.delete')}
          </span>
          <span>
            <kbd className="cx-kbd">Esc</kbd> {t('palette.hints.close')}
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
        'group w-full flex items-center rounded-md text-sm text-foreground',
        active && 'bg-secondary/70'
      )}
      onMouseEnter={onHover}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 text-left"
      >
        {item.kind === 'note' ? (
          <FileText size={15} className="text-muted-foreground shrink-0" aria-hidden="true" />
        ) : item.id === 'open-settings' ? (
          <Settings size={15} className="text-muted-foreground shrink-0" aria-hidden="true" />
        ) : item.id === 'delete-current-note' ? (
          <Trash2 size={15} className="text-destructive shrink-0" aria-hidden="true" />
        ) : (
          <Sparkles size={15} className="text-muted-foreground shrink-0" aria-hidden="true" />
        )}
        <span className="flex-1 truncate">{item.label}</span>
      </button>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('palette.actions.deleteThisNote')}
          title={t('palette.actions.deleteThisNote')}
          className="shrink-0 mx-1 p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : item.hint ? (
        <span className="shrink-0 pr-3 font-mono text-[11px] text-muted-foreground">
          {item.hint}
        </span>
      ) : null}
    </div>
  );
}
