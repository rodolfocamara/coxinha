import { voiceCurationErrorText } from './voiceCurationError';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { voiceComparison } from './voiceCuration';
import { useCurationRead } from './useCurationRead';
import { voiceButton as button, voiceTime } from './voiceControls';
import { VoiceSpaceInfo } from './VoiceSpaceInfo';
export function VoiceComparisonPanel({
  job,
  version,
  disabled,
}: {
  job: string;
  version: unknown;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const [open, setOpen] = useState(false);
  const query = useCurationRead(open, job, version, () => voiceComparison(job));
  const data = query.data?.job === job && query.data.experimental === true ? query.data : undefined;
  return (
    <details
      className="space-y-3 rounded-lg border border-border p-4"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">{k('comparison')}</summary>
      {open && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{k('comparisonNotice')}</p>
          <p className="text-xs text-muted-foreground">{k('unmeasured')}</p>
          {query.loading && <p role="status">{k('loading')}</p>}
          {query.error && <p role="alert">{voiceCurationErrorText(query.error, t)}</p>}
          <button className={button} disabled={disabled} onClick={query.reload}>
            {k('refresh')}
          </button>
          {data?.speakers.length === 0 && <p role="status">{k('noComparison')}</p>}
          {data?.speakers.map((speaker) => (
            <section
              key={JSON.stringify([speaker.track, speaker.speaker])}
              className="space-y-3 border-t border-border pt-3"
              aria-label={`${t(`library.${speaker.track}`)} · ${speaker.speaker}`}
            >
              <h4 className="text-sm">
                {t(`library.${speaker.track}`)} · {speaker.speaker}
              </h4>
              {speaker.queryStatus === 'no_eligible_turns' && (
                <p role="status">{k('noEligibleQuery')}</p>
              )}
              {speaker.spaces.map((space, index) => (
                <div key={index} className="space-y-3">
                  <VoiceSpaceInfo space={space.space} />
                  <p role="status" className="text-sm">
                    {t(`voiceCuration.comparisonStates.${space.status}`)}
                  </p>
                  {space.invalidHistorySamples > 0 && (
                    <p className="text-xs">
                      {t('voiceCuration.invalidHistory', { count: space.invalidHistorySamples })}
                    </p>
                  )}
                  {space.candidates.map((candidate) => (
                    <div
                      key={candidate.personId}
                      className="space-y-2 border-l border-border pl-3 text-sm break-words"
                    >
                      <p>
                        {candidate.name} · {candidate.personId}
                      </p>
                      <p>
                        {t('voiceCuration.cosines', {
                          mean: candidate.meanCosine.toFixed(3),
                          max: candidate.maxCosine.toFixed(3),
                        })}
                      </p>
                      <p>
                        {t('voiceCuration.support', {
                          turns: candidate.supportTurns,
                          duration: voiceTime(candidate.supportDurationMs),
                          samples: candidate.activeSamples,
                        })}
                      </p>
                      <details className="text-xs">
                        <summary className="cursor-pointer">{k('turnEvidence')}</summary>
                        {candidate.turnDetailsTruncated && <p role="status">{k('truncated')}</p>}
                        {candidate.turns.map((turn) => (
                          <p key={turn.turnId}>
                            {turn.turnId} · {voiceTime(turn.startMs)}–{voiceTime(turn.endMs)} ·{' '}
                            {turn.cosine.toFixed(3)}
                          </p>
                        ))}
                      </details>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </details>
  );
}
