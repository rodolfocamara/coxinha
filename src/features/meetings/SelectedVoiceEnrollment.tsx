import { voiceCurationErrorText } from './voiceCurationError';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceCuration, validVoiceOrigin } from './voiceCuration';
import { useCurationRead } from './useCurationRead';
import { voiceButton as button, voiceField as field, voiceTime } from './voiceControls';
import { excerptKey, type ExcerptPlayback } from './useBoundedPlayback';
import type { ProcessingReport } from './library';

export function SelectedVoiceEnrollment({
  meetingId,
  track,
  speaker,
  report,
  assignment,
  disabled,
  act,
  playback,
  version,
}: {
  meetingId: string;
  track: string;
  speaker: string;
  report: ProcessingReport;
  assignment: ProcessingReport['assignments'][number];
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  playback?: ExcerptPlayback;
  version: unknown;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const help = useId();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const query = useCurationRead(
    open,
    JSON.stringify([report.job, track, speaker, assignment.id, assignment.person_id]),
    version,
    () => voiceCuration.candidates(report.job, track, speaker)
  );
  const data = query.data;
  const matches =
    !!data &&
    data.job === report.job &&
    data.meetingId === meetingId &&
    data.track === track &&
    data.speaker === speaker &&
    data.assignmentId === assignment.id &&
    data.personId === assignment.person_id &&
    data.assignmentRevision !== null;
  // Reset while rendering, not in an effect: a deferred effect could wipe a
  // selection the user made right after the candidates appeared.
  const [shown, setShown] = useState({ data, open });
  if (shown.data !== data || shown.open !== open) {
    setShown({ data, open });
    setSelected([]);
    setOrigin('');
  }
  const eligible = matches
    ? selected.filter((id) => data.turns.some((turn) => turn.turnId === id && turn.eligible))
    : [];
  async function enroll() {
    if (
      pending.current ||
      disabled ||
      !matches ||
      !validVoiceOrigin(origin) ||
      eligible.length === 0 ||
      eligible.length > 128
    )
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await act(async () => {
        try {
          await voiceCuration.enroll({
            job: data.job,
            track: data.track,
            speaker: data.speaker,
            assignmentId: data.assignmentId!,
            personId: data.personId!,
            expectedAssignmentRevision: data.assignmentRevision!,
            turnIds: eligible,
            humanOrigin: origin.trim(),
          });
        } catch (e) {
          setError(String(e));
          throw e;
        } finally {
          setSelected([]);
          setOrigin('');
          query.reload();
        }
      });
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="space-y-3 border-t border-border pt-3"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) playback?.stop();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">{k('chooseSamples')}</summary>
      {open && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{k('structuralNotice')}</p>
          <p className="text-xs text-muted-foreground">{k('unmeasured')}</p>
          <p className="text-xs text-muted-foreground">{k('previewNotice')}</p>
          {query.loading && <p role="status">{k('loading')}</p>}
          {(query.error || error) && (
            <p role="alert">{voiceCurationErrorText(query.error ?? error, t)}</p>
          )}
          <button
            className={button}
            disabled={disabled || busy}
            onClick={() => {
              setSelected([]);
              setError('');
              query.reload();
            }}
          >
            {k('refresh')}
          </button>
          {data && !matches && <p role="status">{k('staleAssignment')}</p>}
          {matches && (
            <>
              {data.turns.length === 0 && <p role="status">{k('noTurns')}</p>}
              {data.turns.map((turn) => {
                const excerpt = {
                  track,
                  start: turn.startMs / 1000,
                  end: Math.min(turn.endMs / 1000, turn.startMs / 1000 + 12),
                };
                return (
                  <div key={turn.turnId} className="space-y-2 border-b border-border pb-3">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={
                          disabled ||
                          busy ||
                          !turn.eligible ||
                          (selected.length >= 128 && !selected.includes(turn.turnId))
                        }
                        checked={selected.includes(turn.turnId)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? ids.includes(turn.turnId)
                                ? ids
                                : [...ids, turn.turnId]
                              : ids.filter((id) => id !== turn.turnId)
                          )
                        }
                      />
                      {voiceTime(turn.startMs)}–{voiceTime(turn.endMs)} · {turn.turnId}
                    </label>
                    {!turn.eligible && (
                      <p className="text-xs text-muted-foreground">
                        {turn.reasons
                          .map((reason) =>
                            t(`voiceCuration.reasons.${reason}`, { defaultValue: reason })
                          )
                          .join(' · ')}
                      </p>
                    )}
                    {turn.activeSampleCount > 0 && (
                      <p className="text-xs">
                        {t('voiceCuration.activeSamples', { count: turn.activeSampleCount })}
                      </p>
                    )}
                    {playback && turn.endMs > turn.startMs && turn.startMs >= 0 && (
                      <button
                        className={button}
                        disabled={disabled || busy}
                        aria-pressed={playback.current === excerptKey(excerpt)}
                        aria-label={`${t('speakers.listen')} · ${voiceTime(excerpt.start * 1000)}–${voiceTime(excerpt.end * 1000)}`}
                        onClick={() => playback.play(excerpt)}
                      >
                        {playback.current === excerptKey(excerpt)
                          ? t('speakers.pause')
                          : t('speakers.listen')}{' '}
                        · {voiceTime(excerpt.start * 1000)}–{voiceTime(excerpt.end * 1000)}
                      </button>
                    )}
                  </div>
                );
              })}
              <label className="block space-y-1 text-sm">
                <span>{k('enrollmentOrigin')}</span>
                <input
                  className={field}
                  aria-describedby={help}
                  disabled={disabled || busy}
                  aria-invalid={!!origin && !validVoiceOrigin(origin)}
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  required
                />
              </label>
              {!!origin && !validVoiceOrigin(origin) && (
                <p role="status" className="text-xs">
                  {k('invalidOrigin')}
                </p>
              )}
              <p id={help} className="text-xs text-muted-foreground">
                {k('enrollmentHelp')}
              </p>
              <button
                className={button}
                disabled={disabled || busy || eligible.length === 0 || !validVoiceOrigin(origin)}
                onClick={() => void enroll()}
              >
                {t('voiceCuration.enrollSelected', { count: eligible.length })}
              </button>
            </>
          )}
        </div>
      )}
    </details>
  );
}
