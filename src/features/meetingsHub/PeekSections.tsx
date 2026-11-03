import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FileCode2, File as FileIcon, Link2, SquareCheck } from 'lucide-react';
import { items } from '../items/items';
import { PersonRow } from './InviteeList';
import { SignalIcons } from './SignalIcons';
import type { SignalItem } from './meetingSignals';
import { confirmedSpeakers, useProcessing, type MeetingOutcome } from './useMeetingOutcome';

const LINE = /^\[(\d+:\d+)\] ([^:]+): (.*)$/su;

/** A line of the excerpt: who is what you scan for, the clock is secondary. */
function TranscriptLine({ line }: { line: string }) {
  const parts = LINE.exec(line);
  if (!parts) return <p className="ch-peek-quote">{line}</p>;
  return (
    <p className="ch-peek-quote">
      <b>{parts[2]}</b> <time>{parts[1]}</time> {parts[3]}
    </p>
  );
}

function TextLines({ lines }: { lines: string[] }) {
  return lines.map((line, i) => (
    <p key={i} className="ch-peek-line" data-bullet={line.startsWith('• ') || undefined}>
      {line}
    </p>
  ));
}

/**
 * Spec 0126 P2: what came out of a past meeting comes first, or a plain sentence
 * when nothing did. The summary carries a label of its own: it is generated.
 */
export function PeekOutcome({
  outcome,
  signals,
  onFull,
}: {
  outcome: MeetingOutcome;
  signals: SignalItem[];
  onFull: () => void;
}) {
  const { t } = useTranslation();
  const { lines, source, transcript } = outcome;
  const nothing =
    outcome.ready &&
    !lines.length &&
    !transcript.length &&
    !outcome.files.length &&
    !outcome.references.length &&
    !outcome.activities.length;
  return (
    <div className="ch-outcome" data-outcome="">
      {lines.length > 0 && (
        <section className="ch-peek-card">
          <h3 className="ch-peek-h">
            {t(source === 'summary' ? 'meetingsHub.home.summary' : 'meetingsHub.home.notesStart')}
          </h3>
          <TextLines lines={lines} />
        </section>
      )}
      <SignalIcons items={signals} labelled />
      {nothing && <p className="ch-peek-line">{t('meetingDetail.noOutcome')}</p>}
      {transcript.length > 0 && (
        <section className="ch-peek-sec">
          <h3 className="ch-peek-h">{t('meetingsHub.home.transcript')}</h3>
          {transcript.map((line, i) => (
            <TranscriptLine key={i} line={line} />
          ))}
          <button type="button" className="ch-peek-link" onClick={onFull}>
            {t('meetingsHub.home.fullTranscript')}
          </button>
        </section>
      )}
      <PeekFilesAndLinks outcome={outcome} />
    </div>
  );
}

/**
 * Spec 0124 P2: speakers the owner confirmed on the recording, apart from who
 * was invited. Silent or unnamed people are not here, so it never claims a
 * full attendance; without a recording it claims nothing.
 */
export function WhoCame({
  meetingId,
  headingClassName = 'ch-peek-h',
}: {
  meetingId: string | null;
  headingClassName?: string;
}) {
  const { t } = useTranslation();
  const report = useProcessing(meetingId).data?.report;
  if (!report) return null;
  const names = confirmedSpeakers(report);
  return (
    <section className="ch-peek-sec">
      <h3 className={headingClassName}>{t('meetingsHub.eventDetails.whoCame')}</h3>
      {names.length ? (
        <ul className="ch-people">
          {names.map((name) => (
            <PersonRow key={name} name={name} />
          ))}
        </ul>
      ) : (
        <p className="ch-peek-line">{t('meetingsHub.eventDetails.nobodyConfirmed')}</p>
      )}
      {names.length > 0 && (
        <p className="ch-peek-note">{t('meetingsHub.eventDetails.whoCameHint')}</p>
      )}
    </section>
  );
}

/** Files of the meeting folder and linked activities (spec 0105), names only. */
export function PeekFilesAndLinks({ outcome }: { outcome: MeetingOutcome }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { item, files, references, activities } = outcome;
  if (!item || (!files.length && !references.length && !activities.length)) return null;
  return (
    <section className="ch-peek-sec">
      <h3 className="ch-peek-h">{t('meetingsHub.home.filesAndActivities')}</h3>
      <ul className="ch-files">
        {files.map((file) => (
          <li key={file.name}>
            <button
              type="button"
              onClick={() => void items.open(item, { kind: 'file', name: file.name })}
            >
              {file.kind === 'html' || file.kind === 'htm' ? (
                <FileCode2 size={14} aria-hidden="true" />
              ) : (
                <FileIcon size={14} aria-hidden="true" />
              )}
              <span>{file.name}</span>
            </button>
          </li>
        ))}
        {references.map((ref) => (
          <li key={ref.target}>
            <button
              type="button"
              disabled={ref.missing}
              onClick={() => void items.open(item, { kind: 'reference', target: ref.target })}
            >
              <Link2 size={14} aria-hidden="true" />
              <span>{ref.label ?? ref.target.split(/[\\/]/).pop()}</span>
            </button>
          </li>
        ))}
        {activities.map((act) => (
          <li key={act.id}>
            <button
              type="button"
              onClick={() =>
                void navigate({ to: '/workspace/$noteId', params: { noteId: act.id } })
              }
            >
              <SquareCheck size={14} aria-hidden="true" />
              <span>{act.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Before a meeting: what is ready for it, or the plain mark that nothing is. */
export function PeekPreparation({
  outcome,
  signals,
  prepare,
}: {
  outcome: MeetingOutcome;
  signals: SignalItem[];
  /** The prepare action when the head has a more urgent one. */
  prepare?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const hasLines = outcome.lines.length > 0;
  if (
    !signals.length &&
    !hasLines &&
    !outcome.files.length &&
    !outcome.references.length &&
    !prepare
  )
    return null;
  return (
    <>
      <section className="ch-peek-sec">
        <h3 className="ch-peek-h">{t('meetingDetail.preparation')}</h3>
        <SignalIcons items={signals} labelled />
        <TextLines lines={outcome.lines} />
        {prepare && <div className="ch-peek-actions">{prepare}</div>}
      </section>
      <PeekFilesAndLinks outcome={outcome} />
    </>
  );
}
