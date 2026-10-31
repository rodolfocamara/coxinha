import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import type { Session } from '../sessions/sessions';
import { voiceCurationErrorText } from '../meetings/voiceCurationError';
import { VoiceSpaceInfo } from '../meetings/VoiceSpaceInfo';
import { voiceTime } from '../meetings/voiceControls';
import { PersonAvatar } from './personVisual';
import { SampleRow, sampleDate } from './SampleRow';
import { usePersonSamples, type VoiceSample } from './usePersonSamples';
import { useSamplePlayer } from './useSamplePlayer';

export type PersonSummary = { active: number; more: boolean; meetings: number };

type Props = {
  person: { personId: string; name: string };
  generation: number | null;
  onStale: () => void;
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  onSummary: (personId: string, summary: PersonSummary) => void;
  sessionsByMeeting: Map<string, Session>;
  /** Recording titles from `library_list`, for recordings without a meeting session. */
  recordingTitles: Map<string, string>;
  onOpenMeeting: (sessionId: string) => void;
};

/** Recent meetings this person has samples from, newest sample first. */
function recentMeetings(samples: VoiceSample[], limit = 5) {
  const seen = new Map<string, string>();
  for (const sample of [...samples].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    if (!seen.has(sample.meetingId)) seen.set(sample.meetingId, sample.createdAt);
  return [...seen.entries()].slice(0, limit);
}

export function PersonDetail({
  person,
  generation,
  onStale,
  version,
  disabled,
  act,
  onSummary,
  sessionsByMeeting,
  recordingTitles,
  onOpenMeeting,
}: Props) {
  const { t, i18n } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const samples = usePersonSamples({
    personId: person.personId,
    enabled: true,
    version,
    generation,
    onStale,
    disabled,
    act,
  });
  const { query, stats, locked, error } = samples;
  const player = useSamplePlayer();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (query.stale) {
      setConfirming(null);
      setOrigin('');
    }
  }, [query.stale]);
  useEffect(() => {
    if (query.loaded && !query.stale)
      onSummary(person.personId, {
        active: stats.active,
        more: query.more,
        meetings: stats.meetings,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.personId, query.loaded, query.stale, query.more, stats.active, stats.meetings]);
  const recent = useMemo(() => recentMeetings(query.items), [query.items]);
  const titleFor = (meetingId: string) => {
    const session = sessionsByMeeting.get(meetingId);
    return (
      session?.title ||
      session?.recording?.title ||
      recordingTitles.get(meetingId) ||
      t('people.sample.unknownMeeting')
    );
  };
  const count =
    stats.active === 0 && !query.more
      ? t('people.row.noSamples')
      : t(query.more ? 'people.row.samplesPartial' : 'people.row.samples', {
          count: stats.active,
        });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 px-6 pt-[18px]">
        <PersonAvatar personId={person.personId} name={person.name} size={40} />
        <div className="min-w-0">
          <h2 id="person-heading" className="truncate text-[21px] font-semibold tracking-tight">
            {person.name}
          </h2>
          {query.loaded && (
            <p className="mt-1 text-xs text-muted-foreground">
              {count}
              {stats.meetings > 0 && ` ${t('people.detail.inMeetings', { count: stats.meetings })}`}
              {stats.revoked > 0 && ` · ${t('people.detail.revoked', { count: stats.revoked })}`}
              {stats.invalidated > 0 &&
                ` · ${t('people.detail.invalidated', { count: stats.invalidated })}`}
            </p>
          )}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_268px]">
        <section
          className="min-h-0 space-y-3 overflow-auto px-6 py-4 text-ui"
          aria-labelledby="samples-heading"
        >
          <div className="flex items-center gap-2">
            <h3 id="samples-heading" className="text-[11px] font-semibold text-muted-foreground">
              {t('people.detail.samplesTitle')}{' '}
              <span className="font-normal">· {t('people.detail.samplesHint')}</span>
            </h3>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              icon={<RefreshCw size={12} aria-hidden="true" />}
              disabled={disabled || samples.busy || query.loading}
              onClick={() => {
                setConfirming(null);
                setOrigin('');
                samples.restart();
              }}
            >
              {t(query.stale ? 'people.restart' : 'people.detail.refresh')}
            </Button>
          </div>
          {query.loading && (
            <p role="status" className="text-ui text-muted-foreground">
              {k('loading')}
            </p>
          )}
          {query.stale && <Alert tone="warning">{k('staleView')}</Alert>}
          {!!error && (
            <Alert
              tone="error"
              action={
                !query.stale && (
                  <Button size="sm" onClick={samples.restart}>
                    {t('people.retry')}
                  </Button>
                )
              }
            >
              {voiceCurationErrorText(error, t)}
            </Alert>
          )}
          {player.failed && <Alert tone="error">{t('people.sample.playError')}</Alert>}
          {query.loaded && query.items.length === 0 && !query.more && (
            <p
              role="status"
              className="cx-glass rounded-[14px] px-4 py-3 text-ui text-muted-foreground"
            >
              {t('people.detail.noSamples')}
            </p>
          )}
          {query.items.length > 0 && (
            <ul className="cx-glass rounded-[14px]" aria-labelledby="samples-heading">
              {query.items.map((sample) => (
                <SampleRow
                  key={sample.sampleId}
                  sample={sample}
                  meetingTitle={titleFor(sample.meetingId)}
                  playing={player.playing === sample.sampleId}
                  onListen={() => player.toggle(sample)}
                  confirming={confirming === sample.sampleId}
                  onRevoke={() => {
                    setConfirming(sample.sampleId);
                    setOrigin('');
                  }}
                  onCancel={() => setConfirming(null)}
                  origin={origin}
                  onOrigin={setOrigin}
                  locked={locked}
                  onConfirm={() =>
                    void samples.revoke(sample.sampleId, origin).then((ok) => {
                      if (ok) {
                        setConfirming(null);
                        setOrigin('');
                      }
                    })
                  }
                />
              ))}
            </ul>
          )}
          {query.more && (
            <Button
              size="sm"
              disabled={disabled || samples.busy || query.loading || query.stale}
              onClick={query.loadMore}
            >
              {t('people.detail.loadMore')}
            </Button>
          )}
          {query.loaded && stats.groups.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('people.detail.technical')}</summary>
              <div className="mt-2 space-y-2">
                <p>
                  {t(
                    `voiceCuration.${query.more ? 'loadedCountsPartial' : 'loadedCountsComplete'}`,
                    {
                      active: stats.active,
                      revoked: stats.revoked,
                      invalidated: stats.invalidated,
                    }
                  )}
                </p>
                {stats.groups.map(([key, group]) => (
                  <div key={key} className="space-y-1">
                    <VoiceSpaceInfo space={group.space} />
                    <p>
                      {t(
                        `voiceCuration.${query.more ? 'loadedSpacePartial' : 'loadedSpaceComplete'}`,
                        {
                          count: group.count,
                          duration: voiceTime(group.duration),
                        }
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
        <aside
          className="flex min-h-0 flex-col gap-[18px] overflow-auto border-l border-border p-4 text-xs"
          aria-label={t('people.inspector.recent')}
        >
          <div>
            <h3 className="mb-2 text-[11px] font-semibold text-muted-foreground">
              {t('people.inspector.recent')}
            </h3>
            {recent.length === 0 ? (
              <p className="text-muted-foreground">{t('people.inspector.none')}</p>
            ) : (
              <ul className="space-y-0.5">
                {recent.map(([meetingId, createdAt]) => {
                  const session = sessionsByMeeting.get(meetingId);
                  const label = `${titleFor(meetingId)} · ${sampleDate(session?.starts_at ?? createdAt, i18n?.resolvedLanguage)}`;
                  return (
                    <li key={meetingId}>
                      {session ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 truncate rounded-[5px] px-1 py-0.5 text-left hover:bg-secondary"
                          onClick={() => onOpenMeeting(session.id)}
                        >
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
                          />
                          <span className="truncate">{label}</span>
                        </button>
                      ) : (
                        <span className="flex items-center gap-1.5 truncate px-1 py-0.5 text-muted-foreground">
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-border"
                          />
                          {label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold text-muted-foreground">
              {t('people.inspector.privacyTitle')}
            </h3>
            <p className="text-muted-foreground">{t('people.inspector.privacy')}</p>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold text-muted-foreground">
              {t('people.inspector.teachTitle')}
            </h3>
            <p className="text-muted-foreground">{t('peopleDirectory.training')}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
