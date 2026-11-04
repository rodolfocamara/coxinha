import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APPEARANCE_APPLIED_EVENT } from '.';

/** Changes when text changes size or language, for effects that measure elements. */
export function useAppearanceLayout(): string {
  const { i18n } = useTranslation();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1);
    window.addEventListener(APPEARANCE_APPLIED_EVENT, bump);
    return () => window.removeEventListener(APPEARANCE_APPLIED_EVENT, bump);
  }, []);
  return `${revision}:${i18n?.language}`;
}
