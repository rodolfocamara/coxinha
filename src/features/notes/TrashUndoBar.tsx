import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { shortcutHint, useShortcut } from '../../lib/shortcuts';
import { undoTrash, useTrashUndo } from './trashUndo';

/** The undo of a note moved to the trash outside the board, which has its own. */
export function TrashUndoBar() {
  const { t } = useTranslation();
  const pending = useTrashUndo((s) => s.pending);
  const failed = useTrashUndo((s) => s.failed);
  useShortcut('app.undoTrash', () => void undoTrash(), { enabled: !!pending });
  if (!pending && !failed) return null;
  return (
    <div
      className="fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2.5 rounded-[10px] border border-border bg-popover py-1.5 pr-1.5 pl-3.5 text-[0.8125rem] text-popover-foreground shadow-lg"
      role={failed ? 'alert' : 'status'}
    >
      {pending ? (
        <>
          <span>{t('workspace.trashed', { title: pending.title || t('sidebar.untitled') })}</span>
          <Button
            size="sm"
            variant="ghost"
            title={shortcutHint('app.undoTrash')}
            onClick={() => void undoTrash()}
          >
            {t('workspace.undo')}
          </Button>
        </>
      ) : (
        <span>{t('shortcuts.undoFailed')}</span>
      )}
    </div>
  );
}
