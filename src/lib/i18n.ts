import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';

// Detect OS locale; fall back to `en` if anything goes wrong.
// The future Settings view lets the user override this.
const osLocale =
  typeof navigator !== 'undefined' && navigator.language
    ? navigator.language
    : 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'pt-BR': { translation: ptBR },
    },
    lng: osLocale,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes
    },
    returnEmptyString: false,
  });

export default i18n;
