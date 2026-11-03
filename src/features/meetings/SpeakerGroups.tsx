import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { library, type ProcessingReport } from './library';

const textAction =
  'rounded px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring disabled:opacity-40';

/** Spec 0120 P5: noise and room bleed, still nameable, out of the way. */
export function FoldedSpeakers({ count, children }: { count: number; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {t('speakerNaming.foldedGroup', { count })}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{t('speakerNaming.foldedHint')}</p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
        {children}
      </ul>
    </details>
  );
}

/** Spec 0120 P6: speakers marked "not a participant", each reversible. */
export function RejectedSpeakers({
  assignments,
  disabled,
  act,
}: {
  assignments: ProcessingReport['assignments'];
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {t('speakerNaming.rejectedGroup', { count: assignments.length })}
      </summary>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {assignments.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {t(`library.${a.track}`)} · {a.speaker}
            </span>
            <button
              type="button"
              className={textAction}
              disabled={disabled}
              onClick={() =>
                void act(() => library.revokeAssignment(a.id, t('speakerNaming.undoOrigin'))).catch(
                  () => undefined
                )
              }
            >
              {t('speakerNaming.undo')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
