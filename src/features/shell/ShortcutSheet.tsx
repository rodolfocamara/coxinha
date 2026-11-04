import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/ui';
import { useActiveScopes, useShortcut, type ShortcutScope } from '../../lib/shortcuts';
import { ShortcutList } from './ShortcutList';

export const OPEN_SHORTCUTS_EVENT = 'coxinha:open-shortcuts';

const SCREEN_SCOPES: readonly ShortcutScope[] = ['calendar', 'board', 'note'];

/** `?`: what works on the screen in front of the user, then what works everywhere. */
export function ShortcutSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const active = useActiveScopes();
  useShortcut('app.help', () => setOpen(true));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, show);
  }, []);
  if (!open) return null;
  const screen = SCREEN_SCOPES.filter((scope) => active.includes(scope));
  return (
    <Sheet
      open
      onOpenChange={setOpen}
      title={t('shortcuts.sheet.title')}
      description={t('shortcuts.sheet.description')}
      closeLabel={t('shortcuts.sheet.close')}
    >
      <ShortcutList scopes={[...screen, 'app', 'layer', 'list', 'system']} />
    </Sheet>
  );
}
