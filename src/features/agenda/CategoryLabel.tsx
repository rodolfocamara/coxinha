import { useTranslation } from 'react-i18next';
import type { CategoryColour } from './categories';
import './categories.css';

/** Screen-reader name of the colour mark drawn by `.cx-cat-mark` or a dot. */
export function CategoryLabel({ colour }: { colour: CategoryColour | null }) {
  const { t } = useTranslation();
  if (!colour) return null;
  return <span className="sr-only">{t('outlookCategories.mark', { name: colour.name })}</span>;
}
