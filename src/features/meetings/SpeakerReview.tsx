import { useEffect, useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import { library, type ProcessingDetail, type ProcessingReport, type Recognition } from './library';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import { VoiceComparisonPanel } from './VoiceComparisonPanel';
import { ParticipantContext } from './ParticipantContext';
import { PersonFormSheet } from './PersonFormSheet';
import { SpeakerCard, speakerButton as button, speakerField as field } from './SpeakerCard';
import type { ExcerptPlayback } from './useBoundedPlayback';
function SpeakerReviewForRun({
  meetingId,
  data,
  report,
  disabled,
  onSeek,
  act,
  playback,
}: {
  meetingId: string;
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
  const [legacyOrigin, setLegacyOrigin] = useState('');
  const [created, setCreated] = useState<ProcessingDetail['people']>([]);
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
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
  const people = [
    ...data.people,
    ...created.filter((p) => !data.people.some((other) => other.id === p.id)),
  ];
  const speakers = Array.from(
    new Map(
      [
        ...report.turns,
        ...report.assignments.filter((a) => a.track != null && a.state === 'confirmed'),
      ]
        .filter((s) => !s.speaker.toLowerCase().includes('unknown'))
        .map((s) => [JSON.stringify([s.track, s.speaker]), { speaker: s.speaker, track: s.track! }])
    ).values()
  );
  return (
    <div className="space-y-4 min-w-0">
      <p className="text-xs text-muted-foreground">{t('peopleDirectory.meetingContext')}</p>
      <p role="status" className="text-sm text-muted-foreground">
        {w(
          error
            ? 'recognitionUnavailable'
            : !recognition
              ? 'recognitionPending'
              : recognition.calibrationStatus === 'calibrated'
                ? 'calibrationReported'
                : 'noCalibration'
        )}
      </p>
      {error && (
        <div role="alert" className="text-sm">
          <p>{error}</p>
          <button className={button} onClick={() => setAttempt((n) => n + 1)}>
            {t('session.retry')}
          </button>
        </div>
      )}
      {speakers.length === 0 && <p role="status">{w('noSpeakers')}</p>}
      {report.turns.some((s) => s.speaker.toLowerCase().includes('unknown')) && (
        <p className="text-sm text-muted-foreground">{w('overlap')}</p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {speakers.map(({ speaker, track }) => (
          <SpeakerCard
            key={JSON.stringify([track, speaker])}
            {...{
              meetingId,
              curationVersion,
              speaker,
              track,
              report,
              people,
              recognition,
              disabled,
              playback,
              onSeek,
            }}
            act={curate}
          />
        ))}
      </div>
      <VoiceProfilesPanel version={curationVersion} disabled={disabled} act={curate} />
      <VoiceComparisonPanel job={report.job} version={curationVersion} disabled={disabled} />
      <div>
        <Button
          icon={<UserPlus size={16} aria-hidden="true" />}
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
