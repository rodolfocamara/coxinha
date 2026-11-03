import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarPlus, UserPlus } from 'lucide-react';
import { Button } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import {
  library,
  type ParticipantCandidate,
  type ProcessingDetail,
  type ProcessingReport,
  type Recognition,
  type SpeakerLevel,
} from './library';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import { VoiceComparisonPanel } from './VoiceComparisonPanel';
import { ParticipantContext } from './ParticipantContext';
import { PersonFormSheet } from './PersonFormSheet';
import { ImportPeopleSheet } from '../people/ImportPeopleSheet';
import { SpeakerCard, speakerButton as button, speakerField as field } from './SpeakerCard';
import { mergeParticipants } from './personChoices';
import { foldedSpeakers, speakerKey } from './speakerNoise';
import { FoldedSpeakers, RejectedSpeakers } from './SpeakerGroups';
import type { ExcerptPlayback } from './useBoundedPlayback';
function SpeakerReviewForRun({
  meetingId,
  data,
  report,
  disabled,
  onSeek,
  act,
  playback,
  calendarInvitees = [],
  more,
  manualEnrollBlocked = false,
}: {
  /** A capture or processing holds the disk; selected samples wait. */
  manualEnrollBlocked?: boolean;
  /** Processing details shown under "Mais opções". */
  more?: ReactNode;
  meetingId: string;
  /** Attendees of the calendar event the meeting page shows (spec 0110 P3). */
  calendarInvitees?: ParticipantCandidate[];
  data: ProcessingDetail;
  report: ProcessingReport;
  disabled: boolean;
  onSeek: (track: string, seconds: number, end?: number) => void;
  act: (action: () => Promise<unknown>) => Promise<void>;
  playback?: ExcerptPlayback;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const w = (name: string) => t(`speakers.${name}`);
  const [curationRevision, setCurationRevision] = useState(0);
  const curationVersion = useMemo(() => ({ report, curationRevision }), [report, curationRevision]);
  async function curate(action: () => Promise<unknown>) {
    try {
      await act(action);
    } finally {
      setCurationRevision((n) => n + 1);
    }
  }
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [legacyOrigin, setLegacyOrigin] = useState('');
  const [created, setCreated] = useState<ProcessingDetail['people']>([]);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [stored, setStored] = useState<ParticipantCandidate[]>([]);
  const invitees = useMemo(
    () => mergeParticipants(calendarInvitees, stored),
    [calendarInvitees, stored]
  );
  useEffect(() => {
    let live = true;
    library.participantContext(meetingId).then(
      (rows) => live && setStored(rows),
      () => live && setStored([])
    );
    return () => {
      live = false;
    };
  }, [meetingId, curationRevision]);
  useEffect(() => {
    let live = true;
    setRecognition(null);
    setError('');
    library
      .recognition(report.job)
      .then((value) => {
        if (live && value.job === report.job) setRecognition(value);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [report.job, attempt, curationRevision]);
  const [levels, setLevels] = useState<SpeakerLevel[] | null>(null);
  useEffect(() => {
    let live = true;
    // Without levels only the brief rule folds speakers.
    (async () => library.speakerLevels(report.job))().then(
      (rows) => live && setLevels(rows),
      () => live && setLevels(null)
    );
    return () => {
      live = false;
    };
  }, [report.job]);
  const people = [
    ...data.people,
    ...created.filter((p) => !data.people.some((other) => other.id === p.id)),
  ];
  const rejected = report.assignments.filter((a) => a.track != null && a.state === 'rejected');
  const rejectedKeys = new Set(rejected.map((a) => speakerKey(a.track!, a.speaker)));
  const all = Array.from(
    new Map(
      [
        ...report.turns,
        ...report.assignments.filter((a) => a.track != null && a.state === 'confirmed'),
      ]
        .filter((s) => !s.speaker.toLowerCase().includes('unknown'))
        .map((s) => [speakerKey(s.track!, s.speaker), { speaker: s.speaker, track: s.track! }])
    ).values()
  ).filter((s) => !rejectedKeys.has(speakerKey(s.track, s.speaker)));
  const folds = foldedSpeakers(report, levels);
  const speakers = all.filter((s) => !folds.has(speakerKey(s.track, s.speaker)));
  const folded = all.filter((s) => folds.has(speakerKey(s.track, s.speaker)));
  const card = ({ speaker, track }: { speaker: string; track: string }, note?: string) => (
    <SpeakerCard
      key={speakerKey(track, speaker)}
      {...{
        meetingId,
        curationVersion,
        speaker,
        track,
        report,
        people,
        invitees,
        recognition,
        disabled,
        playback,
        onSeek,
        manualEnrollBlocked,
        note,
      }}
      act={curate}
    />
  );
  const named = speakers.filter(({ speaker, track }) =>
    report.assignments.some(
      (a) => a.track === track && a.speaker === speaker && a.state === 'confirmed'
    )
  ).length;
  const calibrated = recognition?.calibrationStatus === 'calibrated';
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium">
          {t('speakerNaming.heading', { count: speakers.length })}
        </h3>
        {speakers.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {named === speakers.length
              ? t('speakerNaming.allNamed')
              : t('speakerNaming.unnamed', { count: speakers.length - named })}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<CalendarPlus size={14} aria-hidden="true" />}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setImporting(true)}
        >
          {t('people.import.button')}
        </Button>
        <ImportPeopleSheet
          open={importing}
          onOpenChange={setImporting}
          run={curate}
          onImported={() => undefined}
        />
      </div>
      {calibrated && (
        <p role="status" className="text-xs text-muted-foreground">
          {w('calibrationReported')}
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p>{w('recognitionUnavailable')}</p>
          <button className={button} onClick={() => setAttempt((n) => n + 1)}>
            {t('session.retry')}
          </button>
          <p className="basis-full text-xs text-muted-foreground">{error}</p>
        </div>
      )}
      {all.length === 0 && rejected.length === 0 ? (
        <p role="status">{w('noSpeakers')}</p>
      ) : (
        speakers.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {speakers.map((s) => card(s))}
          </ul>
        )
      )}
      {folded.length > 0 && (
        <FoldedSpeakers count={folded.length}>
          {folded.map((s) =>
            card(
              s,
              t(
                folds.get(speakerKey(s.track, s.speaker)) === 'bleed'
                  ? 'speakerNaming.foldedBleed'
                  : 'speakerNaming.foldedBrief'
              )
            )
          )}
        </FoldedSpeakers>
      )}
      {rejected.length > 0 && (
        <RejectedSpeakers assignments={rejected} disabled={disabled} act={curate} />
      )}
      {report.turns.some((s) => s.speaker.toLowerCase().includes('unknown')) && (
        <p className="text-xs text-muted-foreground">{w('overlap')}</p>
      )}
      <details className="group text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {t('speakerNaming.more')}
        </summary>
        <div className="mt-3 space-y-3">
          {!calibrated && (
            <p role="status" className="text-xs text-muted-foreground">
              {w(
                error
                  ? 'recognitionUnavailable'
                  : !recognition
                    ? 'recognitionPending'
                    : 'noCalibration'
              )}
            </p>
          )}
          <div>
            <Button
              size="sm"
              icon={<UserPlus size={14} aria-hidden="true" />}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => setAdding(true)}
            >
              {w('addPerson')}
            </Button>
            <PersonFormSheet
              open={adding}
              onOpenChange={setAdding}
              run={curate}
              disabled={disabled}
              onCreated={(id, name) => setCreated((rows) => [...rows, { id, name }])}
              suggestions={(setName) => (
                <ParticipantContext meetingId={meetingId} disabled={disabled} onSelect={setName} />
              )}
            />
          </div>
          <VoiceProfilesPanel version={curationVersion} disabled={disabled} act={curate} />
          <VoiceComparisonPanel job={report.job} version={curationVersion} disabled={disabled} />
          {more}
        </div>
      </details>
      {report.assignments.some((a) => a.track == null) && (
        <section
          className="space-y-3 rounded-lg border border-border p-4"
          aria-label={k('legacyAssignments')}
        >
          <h4>{k('legacyAssignments')}</h4>
          <p className="text-sm">{k('legacyNotice')}</p>
          <label className="block text-sm">
            {w('legacyOrigin')}
            <input
              className={field}
              disabled={disabled}
              value={legacyOrigin}
              onChange={(e) => setLegacyOrigin(e.target.value)}
            />
          </label>
          {report.assignments
            .filter((a) => a.track == null)
            .map((a) => (
              <div key={a.id} className="space-y-2">
                <p>
                  {a.speaker} · {a.name ?? k('anonymous')} ·{' '}
                  {a.state === 'confirmed' ? w('confirmed') : w('revoked')}
                </p>
                {a.state === 'confirmed' && (
                  <button
                    className={button}
                    disabled={disabled || !legacyOrigin.trim()}
                    onClick={() =>
                      void curate(() => library.revokeAssignment(a.id, legacyOrigin.trim()))
                    }
                  >
                    {k('revokeLegacy')}
                  </button>
                )}
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
export function SpeakerReview(props: Parameters<typeof SpeakerReviewForRun>[0]) {
  return <SpeakerReviewForRun key={`${props.meetingId}:${props.report.job}`} {...props} />;
}
