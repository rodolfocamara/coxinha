import type { ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList,
  FileCode2,
  File as FileIcon,
  Link2,
  SquareCheck,
  UserCheck,
} from 'lucide-react';
import { items } from '../items/items';
import { PersonRow } from './InviteeList';
import { PropDisclosure, PropRow } from './PropertySheet';
import type { SignalItem } from './meetingSignals';
import { confirmedSpeakers, useProcessing, type MeetingOutcome } from './useMeetingOutcome';

export function TextLines({ lines }: { lines: string[] }) {
  return lines.map((line, i) => (
    <p key={i} className="ch-peek-line" data-bullet={line.startsWith('• ') || undefined}>
      {line}
    </p>
  ));
}

/**
 * Spec 0124 P2: speakers the owner confirmed on the recording, apart from who
 * was invited. Silent or unnamed people are not here, so it never claims a
 * full attendance; with nobody confirmed, who came is unknown.
 */
export function PresentRow({ meetingId }: { meetingId: string | null }) {
  const { t } = useTranslation();
  const label = t('meetingDetail.rows.present');
  const report = useProcessing(meetingId).data?.report;
  const names = report ? confirmedSpeakers(report) : [];
  if (!names.length)
    return (
      <PropRow
        icon={UserCheck}
        label={label}
        quiet
        title={t('meetingsHub.eventDetails.nobodyConfirmed')}
      >
        {t('meetingDetail.values.unknown')}
      </PropRow>
    );
  return (
    <PropDisclosure
      icon={UserCheck}
      label={label}
      summary={t('meetingDetail.values.confirmed', { count: names.length })}
      title={t('meetingsHub.eventDetails.whoCameHint')}
    >
      <ul className="ch-people">
        {names.map((name) => (
          <PersonRow key={name} name={name} />
        ))}
      </ul>
    </PropDisclosure>
  );
}

type ItemPart = 'files' | 'references' | 'activities';

/** Files of the meeting folder, its references and linked activities (spec 0105), names only. */
export function ItemList({ outcome, parts }: { outcome: MeetingOutcome; parts: ItemPart[] }) {
  const navigate = useNavigate();
  const { item } = outcome;
  const files = parts.includes('files') ? outcome.files : [];
  const references = parts.includes('references') ? outcome.references : [];
  const activities = parts.includes('activities') ? outcome.activities : [];
  return (
    <ul className="ch-files">
      {item &&
        files.map((file) => (
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
      {item &&
        references.map((ref) => (
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
            onClick={() => void navigate({ to: '/workspace/$noteId', params: { noteId: act.id } })}
          >
            <SquareCheck size={14} aria-hidden="true" />
            <span>{act.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Before a meeting: what is ready, as counts that open, or the plain mark that nothing is. */
export function PreparationRow({
  outcome,
  signals,
  prepare,
}: {
  outcome: MeetingOutcome;
  signals: SignalItem[];
  /** The prepare action when the head has a more urgent one. */
  prepare?: ReactNode;
}) {
  const { t } = useTranslation();
  const v = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.values.${key}`, options);
  const label = t('meetingDetail.rows.preparation');
  const { files, references, activities, lines } = outcome;
  const hasNote = lines.length > 0 || signals.some((s) => s.id === 'note');
  const parts = [
    hasNote && v('prepNote'),
    files.length > 0 && t('meetingDetail.signals.files', { count: files.length }),
    references.length > 0 && v('prepLinks', { count: references.length }),
    activities.length > 0 && v('prepActivities', { count: activities.length }),
  ].filter(Boolean);
  if (parts.length)
    return (
      <PropDisclosure
        icon={ClipboardList}
        label={label}
        summary={parts.join(' · ')}
        action={prepare}
      >
        <TextLines lines={lines} />
        {files.length + references.length + activities.length > 0 && (
          <ItemList outcome={outcome} parts={['files', 'references', 'activities']} />
        )}
      </PropDisclosure>
    );
  if (!prepare && !signals.some((s) => s.id === 'noPreparation')) return null;
  return (
    <PropRow icon={ClipboardList} label={label} quiet action={prepare}>
      {v('prepNone')}
    </PropRow>
  );
}
