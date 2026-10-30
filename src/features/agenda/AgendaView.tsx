import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Settings } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
} from '../../components/ui';
import { type CalendarEvent } from './calendar';
import { library, type LibraryMeeting } from '../meetings/library';
import { OutlookConnectionCard } from './OutlookConnectionCard';
import { useOutlookConnection } from './useOutlookConnection';

type Props = {
  /** Opens the Outlook integration in Settings; the route supplies navigation. */
  onConfigure?: () => void;
};

export function AgendaView({ onConfigure }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [meetings, setMeetings] = useState<LibraryMeeting[]>([]);
  const [meetingId, setMeetingId] = useState('');
  const [notice, setNotice] = useState('');
  const connection = useOutlookConnection({
    onReset: () => {
      setSelected(null);
      setMeetingId('');
      setNotice('');
    },
  });
  const { snapshot, busy, connected, error, run } = connection;

  async function select(event: CalendarEvent) {
    setSelected(event);
    setMeetingId('');
    setNotice('');
    try {
      setMeetings(await library.list());
    } catch {
      connection.setError(t('outlook.meetingsError'));
    }
  }
  async function copyCandidates() {
    if (!selected || !meetingId) return;
    await run(async () => {
      const current = await library.participantContext(meetingId);
      const merged = [...current];
      for (const candidate of selected.attendees)
        if (
          !merged.some((c) =>
            c.email && candidate.email
              ? c.email.toLowerCase() === candidate.email.toLowerCase()
              : !c.email &&
                !candidate.email &&
                c.name.trim().toLowerCase() === candidate.name.trim().toLowerCase()
          )
        )
          merged.push(candidate);
      if (merged.length > 100) throw new Error('calendar.candidateLimit');
      await library.setParticipantContext(meetingId, merged);
      setNotice(t('outlook.copied'));
    });
  }
  return (
    <section className="h-full overflow-auto" aria-labelledby="agenda-heading">
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        <PageHeader
          titleId="agenda-heading"
          title={t('agenda.title')}
          description={t('outlook.subtitle')}
          actions={
            connected && (
              <>
                {onConfigure && (
                  <Button
                    variant="ghost"
                    icon={<Settings size={14} aria-hidden="true" />}
                    onClick={onConfigure}
                  >
                    {t('outlook.configure')}
                  </Button>
                )}
                <Button
                  icon={<RefreshCw size={14} aria-hidden="true" />}
                  disabled={busy}
                  onClick={connection.sync}
                >
                  {t('outlook.sync')}
                </Button>
              </>
            )
          }
        />
        {/* Disconnected or expired: the shared card owns setup, status and errors. */}
        {!connected && <OutlookConnectionCard connection={connection} />}
        {connected && (
          <>
            {busy && (
              <p role="status" className="text-ui text-muted-foreground">
                {t('outlook.working')}
              </p>
            )}
            {snapshot.syncedAt && (
              <p className="text-xs text-muted-foreground">
                {t('outlook.freshness', { date: new Date(snapshot.syncedAt).toLocaleString() })}
              </p>
            )}
            {error && (
              <Alert
                tone="error"
                action={
                  <Button size="sm" onClick={connection.retry}>
                    {t('settings.recovery.retry')}
                  </Button>
                }
              >
                {error}
              </Alert>
            )}
          </>
        )}
        <Card aria-labelledby="agenda-events-heading">
          <CardHeader titleId="agenda-events-heading" title={t('outlook.eventsHeading')} />
          <CardBody className="pt-2">
            {snapshot.events.length === 0 ? (
              <EmptyState title={t('outlook.empty')} />
            ) : (
              <ul className="divide-y divide-border">
                {snapshot.events.map((event) => (
                  <li
                    key={`${snapshot.account}:${event.id}`}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.startsAt).toLocaleString()} ·{' '}
                        {event.allDay
                          ? t('outlook.allDay')
                          : new Date(event.endsAt).toLocaleTimeString()}
                      </p>
                      <h3 className="truncate text-sm font-semibold">{event.title}</h3>
                      <p className="text-ui text-muted-foreground">
                        {event.cancelled
                          ? t('outlook.cancelled')
                          : t('outlook.candidates', { count: event.attendees.length })}
                      </p>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => void select(event)}>
                      {t('outlook.review')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        {selected && (
          <Card aria-label={t('outlook.review')}>
            <CardHeader title={selected.title} description={t('outlook.candidateHint')} />
            <CardBody className="space-y-4">
              <ul className="flex flex-wrap gap-2">
                {selected.attendees.map((candidate, i) => (
                  <li key={i} className="cx-badge">
                    {candidate.name}
                  </li>
                ))}
              </ul>
              <Field label={t('outlook.chooseMeeting')}>
                <Select block value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
                  <option value="">{t('outlook.chooseMeeting')}</option>
                  {meetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title} · {new Date(m.createdAt).toLocaleString()}
                    </option>
                  ))}
                </Select>
              </Field>
              {notice && <Alert tone="success">{notice}</Alert>}
            </CardBody>
            <CardFooter>
              <Button
                variant="primary"
                disabled={busy || !meetingId || !selected.attendees.length}
                onClick={() => void copyCandidates()}
              >
                {t('outlook.copy')}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </section>
  );
}
