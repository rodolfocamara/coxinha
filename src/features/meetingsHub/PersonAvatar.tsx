import { useState } from 'react';
import { hueFor, initials } from './format';

/**
 * Initials on a hue stable per name. `photo` is for spec 0117; a photo that
 * fails to load falls back to the initials. Decorative: the name is beside it.
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
  const [failed, setFailed] = useState(false);
  const tint = hue ?? hueFor(name);
  return (
    <span
      className="mh-av"
      aria-hidden="true"
      style={{ background: `oklch(var(--p${tint}-bg))`, color: `oklch(var(--p${tint}))` }}
    >
      {photo && !failed ? (
        <img className="mh-av-photo" src={photo} alt="" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}
