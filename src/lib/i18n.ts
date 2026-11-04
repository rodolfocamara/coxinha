import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';
import { readAppearance, resolveLanguage } from './appearance/settings';

// Spec 0096: each redesigned area owns `src/locales/areas/<area>.<lng>.json`
// with a single top-level namespace key, merged over the base catalogs.
type Catalog = Record<string, unknown>;
const areaFiles = import.meta.glob<Catalog>('../locales/areas/*.json', {
  eager: true,
  import: 'default',
});
function withAreas(base: Catalog, lng: string): Catalog {
  const merged: Catalog = { ...base };
  for (const [path, catalog] of Object.entries(areaFiles)) {
    if (path.endsWith(`.${lng}.json`)) Object.assign(merged, catalog);
  }
  return merged;
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: withAreas(en, 'en') },
    'pt-BR': { translation: withAreas(ptBR, 'pt-BR') },
  },
  lng: resolveLanguage(readAppearance().language),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false, // React already escapes
  },
  returnEmptyString: false,
});

const syncDocumentLanguage = (language: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
};
syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
