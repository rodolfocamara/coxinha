import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Plus, RefreshCw, Upload } from 'lucide-react';
import { Button } from '../../components/ui';
import { library, type LibraryDetail, type ParticipantCandidate } from '../meetings/library';
import type { CalendarEvent } from '../agenda/calendar';
import type { Lane } from './lanes';
import { durationLabel, hueFor, initials, mediaClock, whenLabel } from './format';
import { normalize } from './meetingRows';

type Props = {
  start: Date | null;
  end: Date | null;
  now: Date;
  event: CalendarEvent | null;
  source: 'session' | 'event' | 'recording';
  meetingId: string | null;
  detail: LibraryDetail | null;
  live: boolean;
  liveElapsedMs: number | null;
  transcript: string;
  lanes: Lane[];
  participantsRevision: number;
  onAddParticipant: (() => void) | null;
  onImport: () => void;
  onTranscribeAgain: (() => void) | null;
};

/** Right column of meeting detail: facts, participants and actions. */
export function MeetingInspector(p: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.inspector.${key}`, options);
  const [context, setContext] = useState<ParticipantCandidate[] | null>(null);
  useEffect(() => {
    let current = true;
    setContext(null);
    if (p.meetingId)
      library
        .participantContext(p.meetingId)
        .then((rows) => current && setContext(rows))
        .catch(() => current && setContext(null));
    return () => {
      current = false;
    };
  }, [p.meetingId, p.participantsRevision]);
  const people: ParticipantCandidate[] = [...(context ?? [])];
  for (const attendee of p.event?.attendees ?? [])
    if (!people.some((person) => sameCandidate(person, attendee))) people.push(attendee);
  const audio = audioFacts(p, t);
  const laneOf = (name: string) =>
    p.lanes.find((l) => l.name && normalize(l.name) === normalize(name));
  const share = (name: string) => laneOf(name)?.share;
  return (
    <aside className="mh-insp" aria-label={k('label')}>
      <div>
        <h3 className="mh-insp-h">{k('meeting')}</h3>
        <dl className="mh-kv">
          <dt>{k('when')}</dt>
          <dd>{whenLabel(p.start, p.end, p.now, locale, t)}</dd>
          <dt>{k('event')}</dt>
          <dd>
            {p.event?.title ?? (p.source === 'recording' ? k('localRecording') : k('noEvent'))}
          </dd>
          <dt>{k('audio')}</dt>
          <dd>{audio}</dd>
          <dt>{k('transcript')}</dt>
          <dd>{p.transcript}</dd>
          {p.detail?.storage?.directory && (
            <>
              <dt>{k('folder')}</dt>
              <dd className="truncate" title={p.detail.storage.directory}>
                {p.detail.storage.directory}
              </dd>
            </>
          )}
        </dl>
      </div>
      <div>
        <h3 className="mh-insp-h">
          {k('participants')}
          {p.onAddParticipant && (
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              className="ml-auto"
              icon={<Plus size={13} aria-hidden="true" />}
              aria-label={k('addParticipant')}
              title={k('addParticipant')}
              onClick={p.onAddParticipant}
            />
          )}
        </h3>
        {people.length === 0 ? (
          <p className="text-muted-foreground">
            {p.meetingId ? k('noParticipants') : k('participantsAfterRecording')}
          </p>
        ) : (
          <ul>
            {people.map((person, i) => {
              const hue = laneOf(person.name)?.hue ?? hueFor(person.name);
              const pct = share(person.name);
              return (
                <li key={`${person.email ?? person.name}-${i}`} className="mh-person">
                  <span
                    className="mh-av"
                    aria-hidden="true"
                    style={{
                      background: `oklch(var(--p${hue}-bg))`,
                      color: `oklch(var(--p${hue}))`,
                    }}
                  >
                    {initials(person.name)}
                  </span>
                  <span className="truncate" title={person.email ?? undefined}>
                    {person.name}
                  </span>
                  {pct !== undefined && (
                    <span className="ml-auto text-muted-foreground">{pct}%</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mh-insp-h">{k('actions')}</h3>
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<Upload size={14} aria-hidden="true" />}
            onClick={p.onImport}
          >
            {k('importAudio')}
          </Button>
          {p.onTranscribeAgain && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={p.onTranscribeAgain}
            >
              {k('transcribeAgain')}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

function audioFacts(p: Props, t: TFunction) {
  if (p.live)
    return p.liveElapsedMs
      ? t('meetingsHub.inspector.recordingFor', { time: mediaClock(p.liveElapsedMs) })
      : t('meetingsHub.inspector.recordingNow');
  if (!p.meetingId) return '–';
  const tracks =
    Object.keys(p.detail?.audio ?? {}).length || p.detail?.manifest?.tracks.length || 0;
  const imported = !!p.detail?.audio && 'imported' in p.detail.audio;
  const ms = p.detail?.storage?.durationMs;
  const parts = [
    ms ? mediaClock(ms) : null,
    imported
      ? t('meetingsHub.inspector.imported')
      : tracks
        ? t('meetingsHub.inspector.tracks', { count: tracks })
        : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return ms ? durationLabel(ms, t) : t('meetingsHub.inspector.audioPending');
}

export function sameCandidate(a: ParticipantCandidate, b: ParticipantCandidate) {
  return a.email && b.email
    ? a.email.toLowerCase() === b.email.toLowerCase()
    : !a.email && !b.email && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
