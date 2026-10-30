import { type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { BacklinksPanel } from './BacklinksPanel';
import { NoteHeader } from './NoteHeader';
import { NoteActionsMenu, type NoteFont } from './NoteActionsMenu';
import { noteDeletionErrorKey } from '../../lib/noteFileErrors';

export type NoteEditorVariant = 'standalone' | 'embedded';
export function NoteEditorFrame({
  variant,
  noteId,
  title,
  tags,
  updatedAt,
  font,
  smallText,
  fullWidth,
  menuOpen,
  setMenuOpen,
  menuButtonRef,
  deleteFailure,
  duplicateFailed,
  onMouseDown,
  menu,
  children,
}: {
  variant: NoteEditorVariant;
  noteId: string;
  title: string;
  tags: string[];
  updatedAt: string;
  font: NoteFont;
  smallText: boolean;
  fullWidth: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  deleteFailure: { error: unknown } | null;
  duplicateFailed: boolean;
  onMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  menu: ComponentProps<typeof NoteActionsMenu>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const embedded = variant === 'embedded';
  return (
    <div
      className={clsx(
        embedded ? 'cx-note-embedded min-w-0' : 'h-full flex',
        font === 'serif' && 'cx-note-font-serif',
        font === 'mono' && 'cx-note-font-mono',
        smallText && 'cx-note-size-small'
      )}
    >
      <section
        className={clsx(
          'relative min-w-0 bn-container cursor-text',
          !embedded && 'flex-1 overflow-auto'
        )}
        aria-label={t('editor.region')}
        onMouseDown={onMouseDown}
        data-testid="note-editor-surface"
      >
        <div className={embedded ? 'flex justify-end px-1' : undefined}>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('noteMenu.open')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={`${t('noteMenu.open')} (Ctrl+.)`}
            data-testid="note-actions-trigger"
            className={clsx(
              'z-10 flex items-center gap-1 rounded-md hover:bg-secondary px-2 py-1.5 text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              !embedded && 'absolute top-3 right-3 border border-border bg-secondary/60 shadow-sm'
            )}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            <kbd className="hidden sm:inline-block font-mono text-[10px] text-muted-foreground">
              {embedded && !/Mac|iPhone|iPad/.test(navigator.platform) ? 'Ctrl+.' : '⌘.'}
            </kbd>
          </button>
        </div>
        <div
          className={clsx(
            embedded ? 'min-w-0 mx-auto pb-8' : 'mx-auto px-6 sm:px-12 lg:px-20 pt-12 pb-10',
            fullWidth ? 'max-w-none' : 'max-w-[960px]'
          )}
        >
          {deleteFailure && (
            <p role="alert">
              {t(noteDeletionErrorKey(deleteFailure.error) ?? 'editor.deleteFailed')}
            </p>
          )}
          {duplicateFailed && <p role="alert">{t('editor.duplicateFailed')}</p>}
          {!embedded && <NoteHeader title={title} tags={tags} updatedAt={updatedAt} />}
          {children}
        </div>
        <NoteActionsMenu {...menu} allowDuplicateAndDelete={!embedded} />
      </section>
      {!embedded && <BacklinksPanel noteId={noteId} />}
    </div>
  );
}
