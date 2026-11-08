import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '../../components/ui';
import { colourVar, type CategoryColour } from '../agenda/categories';
import type { CalendarEvent } from '../agenda/calendar';
import { eventLook } from './eventDetailsModel';
import { durationLabel, whenLabel } from './format';
import { relativeLabel, type PanelState } from './meetingDetailModel';
import type { MeetingRow } from './meetingRows';

/**
 * The part of the panel that never scrolls away (spec 0126 P1). The close button
 * follows the title in the DOM: focus starts on the title, so tab reads on from it.
 */
export function PeekHead({
  row,
  title,
  now,
  state,
  event,
  colour,
  durationMs,
  headingRef,
  onClose,
  children,
}: {
  row: MeetingRow;
  title: string;
  now: Date;
  state: PanelState;
  event: CalendarEvent | null;
  colour: CategoryColour | null;
  durationMs: number | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.home.${key}`, options);
  const relative =
    state === 'now' && row.end
      ? t('meetingDetail.underWay', { left: durationLabel(row.end.getTime() - now.getTime(), t) })
      : state === 'past'
        ? row.end || row.start
          ? relativeLabel((row.end ?? row.start)!, now, locale)
          : null
        : row.start
          ? relativeLabel(row.start, now, locale)
          : null;
  const hasMeta = !!colour || !!durationMs || !!event?.cancelled;
  return (
    <header className="ch-peek-head">
      <div className="ch-peek-titlerow">
        <h2
          id="ch-peek-title"
          ref={headingRef}
          tabIndex={-1}
          className="ch-peek-title"
          title={title}
          data-look={eventLook(event) ?? undefined}
        >
          {title}
        </h2>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          icon={<X size={14} aria-hidden="true" />}
          aria-label={k('closePeek')}
          onClick={onClose}
        />
      </div>
      <p className="ch-peek-when">
        <span>{whenLabel(row.start, row.end, now, locale, t)}</span>
        {relative && (
          <span className="ch-peek-rel" data-state={state}>
            {relative}
          </span>
        )}
      </p>
      {hasMeta && (
        <p className="ch-peek-meta">
          {colour && (
            <span>
              <i
                className="ch-cat-swatch"
                aria-hidden="true"
                style={{ background: colourVar(colour.preset) }}
              />
              {colour.name}
            </span>
          )}
          {durationMs ? (
            <span>{k('recorded', { duration: durationLabel(durationMs, t) })}</span>
          ) : null}
          {event?.cancelled && <span data-cancelled="">{t('meetingsHub.cancelled')}</span>}
        </p>
      )}
      {children}
    </header>
  );
}
