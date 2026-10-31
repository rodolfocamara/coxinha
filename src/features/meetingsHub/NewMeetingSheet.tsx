import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Input, Select, Sheet } from '../../components/ui';
import { refreshSessionList, sessions } from '../sessions/sessions';
import { dayKey } from '../sessions/sessionDates';
import type { CalendarEvent } from '../agenda/calendar';

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

/** "Nova reunião": a planned session to take notes in; recording comes later. */
export function NewMeetingSheet({
  open,
  onOpenChange,
  events,
  now,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  events: CalendarEvent[];
  now: Date;
  onCreated: (sessionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string) => t(`meetingsHub.newSheet.${key}`);
  const slot = nextSlot(now);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dayKey(slot));
  const [from, setFrom] = useState(hhmm(slot));
  const [to, setTo] = useState(hhmm(new Date(slot.getTime() + 30 * 60_000)));
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
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
    try {
      const created = await sessions.create({
        title: title.trim(),
        starts_at: localInstant(date, from),
        ends_at: to ? localInstant(date, to) : null,
        status: 'planned',
      });
      await refreshSessionList();
      onCreated(created.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k('description')}
      closeLabel={t('meetingsHub.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('meetingsHub.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || !title.trim()} onClick={() => void submit()}>
            {k('create')}
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
            value={title}
            maxLength={500}
            placeholder={k('titlePlaceholder')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-3">
          <Field label={k('date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={k('from')}>
            <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={k('to')}>
            <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {events.length > 0 && (
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
        {failed && <Alert tone="error">{k('failed')}</Alert>}
      </form>
    </Sheet>
  );
}
