import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Brain, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '../../components/ui';
import { library, type MeetingMark } from '../meetings/library';
import { SIGNALS_KEY, useSignalsReport } from './meetingSignals';

/**
 * Spec 0124 P5–P6, a past meeting: the owner's mark, what it generated and what
 * memory holds of it. Generated content never stands in for the mark, and the
 * memory line says what is true today rather than implying a meeting was kept.
 */
export function PeekMeetingState({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.signals.state.${key}`);
  const navigate = useNavigate();
  const client = useQueryClient();
  const report = useSignalsReport();
  const [failed, setFailed] = useState(false);
  const signals = report.data?.sessions.find((s) => s.sessionId === sessionId);
  if (!report.data || !signals) return null;
  const choose = (mark: MeetingMark) => {
    setFailed(false);
    library
      .setMark(sessionId, signals.mark === mark ? null : mark)
      .then(() => client.invalidateQueries({ queryKey: SIGNALS_KEY }))
      .catch(() => setFailed(true));
  };
  const memory = signals.summary
    ? 'memoryKept'
    : !report.data.summariesOn
      ? 'memoryOff'
      : signals.transcript
        ? 'memoryPending'
        : 'memoryNoTranscript';
  return (
    <>
      <section className="ch-peek-sec">
        <h3 className="ch-peek-h">{k('label')}</h3>
        <div className="ch-mark" role="group" aria-label={k('markLabel')}>
          <Button
            variant="secondary"
            size="sm"
            icon={<ThumbsUp size={14} aria-hidden="true" />}
            aria-pressed={signals.mark === 'useful'}
            onClick={() => choose('useful')}
          >
            {k('useful')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ThumbsDown size={14} aria-hidden="true" />}
            aria-pressed={signals.mark === 'notUseful'}
            onClick={() => choose('notUseful')}
          >
            {k('notUseful')}
          </Button>
        </div>
        {failed && (
          <p className="ch-peek-error" role="alert">
            {k('markFailed')}
          </p>
        )}
        <p className="ch-peek-note">{k(signals.generatedContent ? 'generated' : 'notGenerated')}</p>
      </section>
      <section className="ch-peek-sec">
        <h3 className="ch-peek-h">{t('meetingDetail.memory')}</h3>
        <p className="ch-peek-memory">
          <Brain size={14} aria-hidden="true" />
          <span>{k(memory)}</span>
        </p>
        {memory === 'memoryOff' && (
          <button
            type="button"
            className="ch-peek-link"
            onClick={() => void navigate({ to: '/settings', hash: 'integrations' })}
          >
            {k('openSetting')}
          </button>
        )}
      </section>
    </>
  );
}
