import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
export type RecoveryReason =
  | 'save_failed'
  | 'attachment_pending'
  | 'flush_delayed'
  | 'shutdown_failed';
export interface RecoveryRequest {
  requestId: string;
  recoveryId: string;
  reason: RecoveryReason;
}
export type RecoveryAction = 'retry' | 'cancel' | 'discard';
export function DesktopRecoveryDialog({
  recovery,
  busy,
  onAction,
  onPresented,
}: {
  recovery: RecoveryRequest;
  busy: boolean;
  onAction: (action: RecoveryAction) => void;
  onPresented: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    onPresented();
  }, [recovery.recoveryId, onPresented]);
  const reason = {
    save_failed: 'saveFailed',
    attachment_pending: 'attachmentPending',
    flush_delayed: 'delayed',
    shutdown_failed: 'shutdownFailed',
  }[recovery.reason];
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-exit-title"
        aria-describedby="desktop-exit-reason desktop-exit-warning"
        tabIndex={-1}
        className="max-h-full w-full max-w-lg overflow-auto rounded-lg border bg-background p-6 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onAction('cancel');
          }
          if (event.key === 'Tab') {
            const buttons = [
              ...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                []),
            ];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault();
            buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
          }
        }}
      >
        <h2 id="desktop-exit-title" className="mb-3 text-lg font-semibold">
          {t('desktopRecovery.title')}
        </h2>
        <p id="desktop-exit-reason">{t(`desktopRecovery.${reason}`)}</p>
        <p id="desktop-exit-warning" className="my-4 text-sm">
          {t('desktopRecovery.discardWarning')}
        </p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} onClick={() => onAction('cancel')}>
            {t('desktopRecovery.keepOpen')}
          </button>
          <button disabled={busy} onClick={() => onAction('retry')}>
            {t('desktopRecovery.retry')}
          </button>
          <button disabled={busy} onClick={() => onAction('discard')}>
            {t('desktopRecovery.discardExit')}
          </button>
        </div>
      </div>
    </div>
  );
}
