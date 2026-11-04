import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  FileText,
  Files,
  ListChecks,
  NotebookPen,
  Shapes,
  Sparkles,
  Users,
} from 'lucide-react';
import type { MeetingSignals } from '../meetings/library';
import { durationLabel } from './format';
import { memoryState, speakersValue } from './meetingDetailModel';
import { ItemList, TextLines } from './PeekSections';
import { PropAction, PropDash, PropDisclosure, PropRow } from './PropertySheet';
import { useSignalsReport } from './meetingSignals';
import type { MeetingOutcome } from './useMeetingOutcome';
import { settingsLocation } from '../settings/settingsIndex';

/**
 * What a past meeting produced, one row per thing and always the same rows, so
 * the eye learns where each one is. An absent value is a dash, not a sentence.
 */
export function ResultRows({
  outcome,
  sessionId,
  durationMs,
  onTranscript,
  onSpeakers,
}: {
  outcome: MeetingOutcome;
  sessionId: string | null;
  durationMs: number | null;
  onTranscript: () => void;
  onSpeakers: (() => void) | null;
}) {
  const { t } = useTranslation();
  const v = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.values.${key}`, options);
  const r = (key: string) => t(`meetingDetail.rows.${key}`);
  const a = (key: string) => t(`meetingDetail.actions.${key}`);
  const navigate = useNavigate();
  const report = useSignalsReport().data;
  const signals: MeetingSignals | undefined = report?.sessions.find(
    (s) => s.sessionId === sessionId
  );
  const hasTranscript = !!signals?.transcript || outcome.hasTranscript;
  const hasSummary = !!signals?.summary || outcome.source === 'summary';
  const speakers = signals ? signals.speakers.named + signals.speakers.unnamed : 0;
  const followUps = signals ? signals.followUps.linked + signals.followUps.actions : 0;
  const itemCount = outcome.files.length + outcome.references.length;
  const memory = report && signals ? memoryState(signals, report.summariesOn) : null;
  const yes = hasTranscript
    ? durationMs
      ? v('transcriptYes', { duration: durationLabel(durationMs, t) })
      : v('yes')
    : null;
  const summaryValue = hasSummary
    ? v('yes')
    : !report || !signals
      ? null
      : !report.summariesOn
        ? v('off')
        : hasTranscript
          ? v('notYet')
          : null;
  return (
    <>
      <PropRow
        icon={FileText}
        label={r('transcript')}
        quiet={!yes}
        action={
          yes && (
            <PropAction name={a('openTranscript')} onClick={onTranscript}>
              {a('open')}
            </PropAction>
          )
        }
      >
        {yes ?? v(outcome.transcriptJob ?? 'no')}
      </PropRow>
      <PropRow
        icon={Users}
        label={r('speakers')}
        quiet={!speakers}
        action={
          signals && signals.speakers.unnamed > 0 && onSpeakers ? (
            <PropAction name={a('nameSpeakers')} onClick={onSpeakers}>
              {a('name')}
            </PropAction>
          ) : null
        }
      >
        {speakers && signals ? speakersValue(signals.speakers, t) : <PropDash />}
      </PropRow>
      <PropRow icon={NotebookPen} label={r('note')} quiet={!signals?.note}>
        {signals?.note ? v('yes') : <PropDash />}
      </PropRow>
      <PropRow
        icon={Sparkles}
        label={r('summary')}
        quiet={!hasSummary}
        action={
          !hasSummary && report && signals && !report.summariesOn ? (
            <PropAction
              name={a('setUpSummaries')}
              onClick={() => void navigate(settingsLocation('summaries'))}
            >
              {a('setUp')}
            </PropAction>
          ) : null
        }
      >
        {summaryValue ?? <PropDash />}
      </PropRow>
      {outcome.activities.length > 0 ? (
        <PropDisclosure icon={ListChecks} label={r('followUps')} summary={followUps}>
          <ItemList outcome={outcome} parts={['activities']} />
        </PropDisclosure>
      ) : (
        <PropRow
          icon={ListChecks}
          label={r('followUps')}
          quiet={!followUps}
          title={
            followUps
              ? t('meetingsHub.signals.followUps', {
                  linked: signals?.followUps.linked,
                  actions: signals?.followUps.actions,
                })
              : undefined
          }
        >
          {followUps || <PropDash />}
        </PropRow>
      )}
      {itemCount > 0 ? (
        <PropDisclosure icon={Files} label={r('files')} summary={itemCount}>
          <ItemList outcome={outcome} parts={['files', 'references']} />
        </PropDisclosure>
      ) : (
        <PropRow icon={Files} label={r('files')} quiet>
          <PropDash />
        </PropRow>
      )}
      {signals?.diagram && (
        <PropRow icon={Shapes} label={r('diagram')}>
          {v('yes')}
        </PropRow>
      )}
      <PropRow
        icon={Brain}
        label={r('memory')}
        quiet={memory !== 'memoryKept'}
        title={memory ? t(`meetingsHub.signals.state.${memory}`) : undefined}
      >
        {memory ? (
          v(memory === 'memoryKept' ? 'memoryKept' : memory === 'memoryPending' ? 'notYet' : 'no')
        ) : (
          <PropDash />
        )}
      </PropRow>
    </>
  );
}

/**
 * The only running text of a past meeting: what a model summarized or the owner
 * wrote. It carries a title of its own, since a summary is generated.
 */
export function OutcomeText({ outcome }: { outcome: MeetingOutcome }) {
  const { t } = useTranslation();
  if (!outcome.lines.length) return null;
  return (
    <section className="ch-peek-card" data-titled="">
      <h3 className="ch-peek-h">
        {t(
          outcome.source === 'summary' ? 'meetingsHub.home.summary' : 'meetingsHub.home.notesStart'
        )}
      </h3>
      <TextLines lines={outcome.lines} />
    </section>
  );
}
