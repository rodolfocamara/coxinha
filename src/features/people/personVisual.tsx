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

/** Initials on the person hue; decorative, the name is always rendered next to it. */
export function PersonAvatar({
  personId,
  name,
  size = 22,
}: {
  personId: string;
  name: string;
  size?: 22 | 40;
}) {
  const hue = personHue(personId);
  return (
    <span
      aria-hidden="true"
      data-hue={hue}
      className={
        'grid shrink-0 place-items-center rounded-full font-bold ' +
        (size === 40 ? 'size-10 text-sm' : 'size-[22px] text-[9.5px]')
      }
      style={{ background: `oklch(var(--p${hue}-bg))`, color: `oklch(var(--p${hue}))` }}
    >
      {initials(name)}
    </span>
  );
}
