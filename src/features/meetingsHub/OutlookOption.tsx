import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { useOutlookCategories } from '../agenda/categories';

/** Whether the new meeting can also be created in Outlook (spec 0104 P5). */
export function useOutlookWrite() {
  const access = useOutlookCategories((s) => s.access);
  return { connected: access !== null, write: !!access?.write };
}

/**
 * "Criar também no Outlook": enabled only with `Calendars.ReadWrite`, which
 * the categories access already tracks (spec 0103).
 */
export function OutlookOption({
  checked,
  disabled,
  onChange,
  onReconnect,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.newSheet.${key}`);
  const { connected, write } = useOutlookWrite();
  const hint = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className={`flex items-center gap-2 text-sm ${write ? '' : 'opacity-60'}`}>
        <input
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={write && checked}
          disabled={!write || disabled}
          aria-describedby={hint}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{k('alsoOutlook')}</span>
      </label>
      <p id={hint} className="text-xs text-muted-foreground">
        {k(write ? 'alsoOutlookHint' : connected ? 'outlookNeedsWrite' : 'outlookOff')}
      </p>
      {!write && (
        <div>
          <Button size="sm" variant="ghost" onClick={onReconnect}>
            {connected ? t('outlookCategories.reconnect') : k('connectOutlook')}
          </Button>
        </div>
      )}
    </div>
  );
}
