import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const OPEN_PALETTE_EVENT = 'coxinha:open-palette';
export const openSearch = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Spec 0122 P1: the title bar's way into the universal search palette. */
export function SearchBar() {
  const { t } = useTranslation();
  const shortcut = isMac() ? '⌘K' : 'Ctrl+K';
  return (
    <button
      type="button"
      className="cx-searchbar"
      onClick={openSearch}
      aria-haspopup="dialog"
      aria-keyshortcuts={isMac() ? 'Meta+K' : 'Control+K'}
      aria-label={t('search.bar')}
    >
      <Search size={13} aria-hidden="true" />
      <span className="cx-searchbar-label">{t('search.bar')}</span>
      <kbd className="cx-kbd" aria-hidden="true">
        {shortcut}
      </kbd>
    </button>
  );
}
