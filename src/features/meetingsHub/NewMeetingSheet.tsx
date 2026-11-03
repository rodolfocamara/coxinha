import { useState } from 'react';
import { ExternalLink, Plus, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Input, Select, Sheet } from '../../components/ui';
import { refreshSessionList, sessions } from '../sessions/sessions';
import { dayKey } from '../sessions/sessionDates';
import { calendar, type CalendarEvent } from '../agenda/calendar';
import { OutlookOption, useOutlookWrite } from './OutlookOption';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Local civil date + time to the UTC instant the session store expects. */
export function localInstant(date: string, time: string) {
  if (!date) return null;
  const value = new Date(`${date}T${time || '00:00'}`);
  return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 19) + 'Z' : null;
}

function nextSlot(now: Date) {
  const slot = new Date(now);
  slot.setSeconds(0, 0);
  slot.setMinutes(slot.getMinutes() < 30 ? 30 : 60);
  return slot;
}

/**
 * "Nova reunião": a planned session to take notes in; recording comes later.
 * From the calendar grid it opens on the picked slot and can also create the
 * Outlook event (spec 0104 P5).
 */
export function NewMeetingSheet({
  open,
  onOpenChange,
  events,
  now,
  initial,
  onCreated,
  onReconnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: CalendarEvent[];
  now: Date;
  initial?: { start: Date; end: Date };
  onCreated: (sessionId: string) => void;
  onReconnect: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string) => t(`meetingsHub.newSheet.${key}`);
  const slot = initial?.start ?? nextSlot(now);
  const slotEnd = initial?.end ?? new Date(slot.getTime() + 30 * 60_000);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dayKey(slot));
  const [from, setFrom] = useState(hhmm(slot));
  const [to, setTo] = useState(hhmm(slotEnd));
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [alsoOutlook, setAlsoOutlook] = useState(false);
  const { write } = useOutlookWrite();
  // Once the session exists, a retry only redoes the Outlook part.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [outlookError, setOutlookError] = useState<string | null>(null);
  const pick = (id: string) => {
    setEventId(id);
    const event = events.find((e) => e.id === id);
    if (!event) return;
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    setTitle(event.title);
    setDate(dayKey(start));
    setFrom(hhmm(start));
    setTo(hhmm(end));
  };
  const submit = async () => {
    if (busy || !title.trim()) return;
    setBusy(true);
    setFailed(false);
    setOutlookError(null);
    const startsAt = localInstant(date, from);
    const endsAt = to ? localInstant(date, to) : null;
    let id = createdId;
    try {
      if (!id) {
        id = (
          await sessions.create({
            title: title.trim(),
            starts_at: startsAt,
            ends_at: endsAt,
            status: 'planned',
          })
        ).id;
        setCreatedId(id);
        await refreshSessionList();
      }
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    if (alsoOutlook && write) {
      try {
        await calendar.createEvent(title.trim(), startsAt ?? '', endsAt ?? '', id);
      } catch (error) {
        setOutlookError(String(error));
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onCreated(id);
  };
  const locked = createdId !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k('description')}
      closeLabel={t('meetingsHub.close')}
      footer={
        <>
          {createdId ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => onCreated(createdId)}
              icon={<ExternalLink size={14} aria-hidden="true" />}
            >
              {k('openMeeting')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              icon={<X size={14} aria-hidden="true" />}
            >
              {t('meetingsHub.cancel')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !title.trim()}
            onClick={() => void submit()}
            icon={
              createdId ? (
                <RotateCcw size={14} aria-hidden="true" />
              ) : (
                <Plus size={14} aria-hidden="true" />
              )
            }
          >
            {k(createdId ? 'retryOutlook' : 'create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={k('titleLabel')} required>
          <Input
            autoFocus
            disabled={locked}
            value={title}
            maxLength={500}
            placeholder={k('titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3">
          <Field label={k('date')}>
            <Input
              type="date"
              disabled={locked}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label={k('from')}>
            <Input
              type="time"
              disabled={locked}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label={k('to')}>
            <Input
              type="time"
              disabled={locked}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        {events.length > 0 && !initial && (
          <Field label={k('event')} hint={k('eventHint')}>
            <Select block value={eventId} onChange={(e) => pick(e.target.value)}>
              <option value="">{k('noEvent')}</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title} ·{' '}
                  {new Date(event.startsAt).toLocaleString(locale, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <OutlookOption
          checked={alsoOutlook}
          disabled={locked || busy}
          onChange={setAlsoOutlook}
          onReconnect={onReconnect}
        />
        {failed && <Alert tone="error">{k('failed')}</Alert>}
        {outlookError && (
          <Alert tone="error">
            {k(
              outlookError.includes('calendar.createReconnect')
                ? 'outlookFailedReconnect'
                : 'outlookFailed'
            )}
          </Alert>
        )}
      </form>
    </Sheet>
  );
}
