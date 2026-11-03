import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, FileText, LayoutGrid, MessageSquareQuote, Trash2, User } from 'lucide-react';
import clsx from 'clsx';

import { mediaClock } from '../meetingsHub/format';
import { highlight, type SearchItem } from '../search/universalSearch';
import type { PaletteAction } from './usePaletteActions';

export type NoteRow = {
  kind: 'note';
  id: string;
  label: string;
  detail?: string;
  activity?: boolean;
};
export type ResultRow = { kind: 'result'; id: string; item: SearchItem };
export type PaletteRow = NoteRow | PaletteAction | ResultRow;
export type PaletteGroup = { id: string; label: string; items: PaletteRow[] };

export const optionId = (index: number) => `palette-option-${index}`;
export const LISTBOX_ID = 'palette-listbox';

const RESULT_ICON = {
  meetings: CalendarDays,
  transcripts: MessageSquareQuote,
  people: User,
  notes: FileText,
} as const;

/** The palette's listbox: labelled groups of options, the active one marked. */
export function PaletteList({
  groups,
  cursor,
  query,
  onHover,
  onPick,
  onDelete,
}: {
  groups: PaletteGroup[];
  cursor: number;
  query: string;
  onHover: (index: number) => void;
  onPick: (row: PaletteRow) => void;
  onDelete: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  let flatIdx = -1;
  return (
    <div id={LISTBOX_ID} role="listbox" aria-label={t('people.palette.title')}>
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
              <PaletteOption
                key={`${item.kind}-${item.id}`}
                index={index}
                item={item}
                query={query}
                active={index === cursor}
                onHover={() => onHover(index)}
                onPick={() => onPick(item)}
                onDelete={item.kind === 'note' ? () => onDelete(item.id) : undefined}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-primary/20 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

function PaletteOption({
  index,
  item,
  query,
  active,
  onHover,
  onPick,
  onDelete,
}: {
  index: number;
  item: PaletteRow;
  query: string;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
  onDelete?: () => void;
}) {
  const { t, i18n } = useTranslation();
  let icon: ReactNode;
  let label: string;
  let detail: string | undefined;
  let meta: string | undefined;
  if (item.kind === 'action') {
    icon = item.icon;
    label = item.label;
  } else if (item.kind === 'note') {
    const Icon = item.activity ? LayoutGrid : FileText;
    icon = <Icon size={15} aria-hidden="true" />;
    label = item.label;
    detail = item.detail;
    meta = item.activity ? t('search.activity') : undefined;
  } else {
    const result = item.item;
    const Icon = RESULT_ICON[result.kind];
    icon = <Icon size={15} aria-hidden="true" />;
    label = result.label;
    detail =
      result.kind === 'people' && result.detail
        ? t('search.alias', { alias: result.detail })
        : result.detail;
    meta =
      result.atMs !== undefined
        ? mediaClock(result.atMs)
        : result.date
          ? new Date(result.date).toLocaleDateString(i18n.resolvedLanguage ?? i18n.language, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : undefined;
  }
  return (
    <div
      id={optionId(index)}
      role="option"
      aria-selected={active}
      className={clsx(
        'group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors duration-(--m-instant)',
        active && 'bg-accent'
      )}
      data-active={active || undefined}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <span
        className={clsx(
          'shrink-0',
          item.kind === 'action' && item.danger ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail && (
          <span className="truncate text-xs text-muted-foreground">
            <Marked text={detail} query={query} />
          </span>
        )}
      </span>
      {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
      {onDelete ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t('people.palette.actions.deleteNote')}
          title={t('people.palette.actions.deleteNote')}
          className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-data-active:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      ) : item.kind === 'action' && item.hint ? (
        <kbd className="cx-kbd shrink-0">{item.hint}</kbd>
      ) : null}
    </div>
  );
}
