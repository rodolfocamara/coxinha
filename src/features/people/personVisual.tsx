import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePersonPhoto } from './personPhotos';

/** Stable person hue (1..4) from the person id, so a person keeps their colour everywhere. */
export function personHue(personId: string): 1 | 2 | 3 | 4 {
  let hash = 0;
  for (let i = 0; i < personId.length; i++) hash = (hash * 31 + personId.charCodeAt(i)) >>> 0;
  return ((hash % 4) + 1) as 1 | 2 | 3 | 4;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? '');
  return (first + last).toLocaleUpperCase();
}

/** The directory photo (spec 0117), else initials on the person hue, which are decorative. */
export function PersonAvatar({
  personId,
  name,
  size = 22,
}: {
  personId: string;
  name: string;
  size?: 22 | 40;
}) {
  const { t } = useTranslation();
  const photo = usePersonPhoto({ personId });
  const [failed, setFailed] = useState<string | null>(null);
  const shown = photo && photo !== failed ? photo : null;
  const hue = personHue(personId);
  return (
    <span
      aria-hidden={shown ? undefined : 'true'}
      data-hue={hue}
      className={
        'grid shrink-0 place-items-center rounded-full font-bold ' +
        (size === 40 ? 'size-10 text-sm' : 'size-[1.375rem] text-[0.59375rem]')
      }
      style={{ background: `oklch(var(--p${hue}-bg))`, color: `oklch(var(--p${hue}))` }}
    >
      {shown ? (
        <img
          className="size-full rounded-full object-cover"
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
