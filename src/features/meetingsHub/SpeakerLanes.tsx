import { useTranslation } from 'react-i18next';
import type { Lane } from './lanes';
import { mediaClock } from './format';

/**
 * The product signature on meeting detail: who spoke, when and for how long.
 * Clicking a track seeks the recording to that moment.
 */
export function SpeakerLanes({
  lanes,
  totalMs,
  onSeek,
}: {
  lanes: Lane[];
  totalMs: number;
  onSeek?: (track: string, seconds: number) => void;
}) {
  const { t } = useTranslation();
  if (!lanes.length || !totalMs) return null;
  return (
    <div className="mh-lanes" role="group" aria-label={t('meetingsHub.lanes.label')}>
      {lanes.map((lane, laneIndex) => {
        const label = lane.name ?? t('meetingsHub.lanes.unknown', { n: lane.index });
        const hue = lane.name ? lane.hue : null;
        const color = hue ? `oklch(var(--p${hue}))` : 'var(--color-warning)';
        const fill = hue ? `oklch(var(--p${hue}-bg))` : 'oklch(var(--p3-bg))';
        const seek = (seconds: number) => onSeek?.(lane.track, seconds);
        return (
          <div key={lane.key} className="contents">
            <span className="mh-lane-who" data-unconfirmed={!lane.name || undefined}>
              <i style={{ background: color }} aria-hidden="true" />
              <span className="truncate">{label}</span>
            </span>
            <button
              type="button"
              className="mh-lane-track"
              disabled={!onSeek}
              aria-label={t('meetingsHub.lanes.seek', {
                name: label,
                time: mediaClock(lane.segments[0].startMs),
                share: lane.share,
              })}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                // Keyboard activation has no pointer position: start at the first turn.
                if (!e.clientX || !box.width) return seek(lane.segments[0].startMs / 1000);
                const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
                seek((ratio * totalMs) / 1000);
              }}
            >
              {lane.segments.map((segment, i) => (
                <b
                  key={i}
                  style={
                    {
                      left: `${segment.left}%`,
                      width: `${segment.width}%`,
                      background: fill,
                      '--i': laneIndex * 2 + Math.min(i, 6),
                    } as React.CSSProperties
                  }
                />
              ))}
            </button>
            <span className="mh-lane-share">{lane.share}%</span>
          </div>
        );
      })}
    </div>
  );
}
