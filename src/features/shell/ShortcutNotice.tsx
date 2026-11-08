import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { formatChord, useSystemChords } from '../../lib/shortcuts';
import { settingsLocation } from '../settings/settingsIndex';

/** A system chord that failed at startup would otherwise fail in silence (spec 0128 P6). */
export function ShortcutNotice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const report = useSystemChords((state) => state.report);
  const [dismissed, setDismissed] = useState(false);
  const broken = report?.statuses.filter((status) => status.failure || status.conflict) ?? [];
  if (dismissed || broken.length === 0) return null;
  return (
    <div role="alert" className="flex items-center gap-3 border-b px-4 py-2 text-sm">
      <span className="min-w-0 flex-1">
        {t('shortcuts.notice.message', {
          chords: broken.map((status) => formatChord(status.chord)).join(', '),
        })}
      </span>
      <Button size="sm" onClick={() => void navigate(settingsLocation('shortcuts'))}>
        {t('shortcuts.notice.open')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
        {t('shortcuts.notice.dismiss')}
      </Button>
    </div>
  );
}
