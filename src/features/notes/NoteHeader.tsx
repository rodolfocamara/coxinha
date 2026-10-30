import { useTranslation } from 'react-i18next';

interface Props {
  title: string;
  tags: string[];
  /** ISO-8601 string from the `NoteContent.note.updated_at` field. */
  updatedAt: string;
}

/**
 * Note title + meta + tag chips block rendered above the BlockNote
 * column. Matches the Mix B Refined handoff: 38 px Geist 700 title
 * with tight tracking, muted meta line, and pill-style tag chips.
 * Pure presentational — tests can drive it directly.
 */
export function NoteHeader({ title, tags, updatedAt }: Props) {
  const { t } = useTranslation();
  const displayTitle = title || t('sidebar.untitled');
  const meta = formatNoteMeta(updatedAt);

  return (
    <>
      <header className="flex flex-col gap-2.5 mb-5">
        <h1 className="cx-display text-[38px] text-foreground" style={{ textWrap: 'balance' }}>
          {displayTitle}
        </h1>
        {meta && <p className="text-xs text-muted-foreground tracking-wide">{meta}</p>}
      </header>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6" data-testid="note-tag-row">
          {tags.map((tag) => (
            <span key={tag} className="cx-tag-chip">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function formatNoteMeta(updatedAt: string): string {
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return '';
  const formatted = d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return formatted;
}
