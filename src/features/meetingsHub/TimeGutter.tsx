import type { CSSProperties } from 'react';
import { clockTime } from './format';
import { rem } from '../../lib/appearance/units';
import { HOUR_PX } from './weekLayout';
import { shortName, useTimeZones, zoneHour, zoneLabel, type ExtraZone } from './timeZones';
import { regionOfZone } from './zoneCatalog';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const ZONE_PX = 34;

/** Gutter width: Outlook's single clock, or one narrow column per zone. */
export function gutterStyle(extra: number): CSSProperties {
  return { '--mh-week-gutter': extra ? rem((extra + 1) * ZONE_PX) : rem(52) } as CSSProperties;
}

export function useExtraZones(): ExtraZone[] {
  return useTimeZones((s) => s.zones);
}

/** Zone names above the hour columns, extra zones first and local last. */
export function ZoneHeadings({
  zones,
  day,
  locale,
}: {
  zones: ExtraZone[];
  day: Date;
  locale: string;
}) {
  const local = useTimeZones((s) => s.localLabel);
  if (!zones.length) return <span />;
  return (
    <span className="mh-week-zones">
      {zones.map((zone) => (
        <span key={zone.id}>{zoneLabel(zone, day, locale)}</span>
      ))}
      <span>
        {local ||
          regionOfZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ||
          shortName(day, locale)}
      </span>
    </span>
  );
}

/**
 * Hour labels sit just under their line (spec 0119 P4). With extra zones each
 * zone gets a column showing its wall time at the same instant; the first
 * visible day decides the offsets, as in Outlook.
 */
export function TimeGutter({
  zones,
  day,
  locale,
}: {
  zones: ExtraZone[];
  day: Date;
  locale: string;
}) {
  const at = (hour: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
  return (
    <div className="mh-week-hours" data-zones={zones.length || undefined} aria-hidden="true">
      {[...zones.map((z) => z.id), null].map((zone) => (
        <div key={zone ?? 'local'} className="mh-week-zone" data-zone={zone ?? 'local'}>
          {HOURS.map((hour) => (
            <span key={hour} style={{ top: rem(hour * HOUR_PX) }}>
              {zones.length
                ? zoneHour(at(hour), locale, zone ?? undefined)
                : clockTime(at(hour), locale)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
