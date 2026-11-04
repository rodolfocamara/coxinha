import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePersonPhoto } from '../people/personPhotos';
import { hueFor, initials } from './format';

/**
 * The person's directory photo (spec 0117), found by name, else initials on a
 * hue stable per name, also when the photo fails to load. Initials are decorative.
 */
export function PersonAvatar({
  name,
  hue,
  photo,
}: {
  name: string;
  hue?: number;
  photo?: string | null;
}) {
  const { t } = useTranslation();
  const known = usePersonPhoto({ name });
  const source = photo ?? known;
  const [failed, setFailed] = useState<string | null>(null);
  const shown = source && source !== failed ? source : null;
  const tint = hue ?? hueFor(name);
  return (
    <span
      className="mh-av"
      aria-hidden={shown ? undefined : 'true'}
      style={{ background: `oklch(var(--p${tint}-bg))`, color: `oklch(var(--p${tint}))` }}
    >
      {shown ? (
        <img
          className="mh-av-photo"
          src={shown}
          alt={t('people.photoAlt', { name })}
          onError={() => setFailed(shown)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
