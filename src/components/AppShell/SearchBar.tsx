import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { shortcutAria, shortcutHint } from '../../lib/shortcuts';

export const OPEN_PALETTE_EVENT = 'coxinha:open-palette';
export const openSearch = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

/** Spec 0122 P1: the title bar's way into the universal search palette. */
export function SearchBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const shortcut = shortcutHint('app.palette');
  return (
    <button
      type="button"
      className="cx-searchbar"
      data-compact={compact || undefined}
      onClick={openSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts={shortcutAria('app.palette')}
      aria-label={t('search.bar')}
      title={`${t('search.bar')} (${shortcut})`}
    >
      <Search size={14} aria-hidden="true" />
      <span className="cx-searchbar-label">{t('search.bar')}</span>
      <kbd className="cx-kbd" aria-hidden="true">
        {shortcut}
      </kbd>
    </button>
  );
}
