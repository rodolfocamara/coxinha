import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  ClipboardCheck,
  ClipboardX,
  FileText,
  Files,
  ListChecks,
  NotebookPen,
  Shapes,
  ThumbsDown,
  ThumbsUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { speakersValue } from './meetingDetailModel';
import type { SignalItem } from './meetingSignals';
import { PropRow } from './PropertySheet';
import './signals.css';

const ICONS: Record<SignalItem['id'], LucideIcon> = {
  useful: ThumbsUp,
  notUseful: ThumbsDown,
  transcript: FileText,
  speakers: Users,
  note: NotebookPen,
  preparation: ClipboardCheck,
  noPreparation: ClipboardX,
  diagram: Shapes,
  memory: Brain,
  followUps: ListChecks,
  files: Files,
};

export function signalLabel(item: SignalItem, t: TFunction) {
  const key = `meetingsHub.signals.${item.id}`;
  switch (item.id) {
    case 'speakers':
      return t(key, { named: item.named, unnamed: item.unnamed });
    case 'followUps':
      return t(key, { linked: item.linked, actions: item.actions });
    case 'files':
      return t('meetingDetail.signals.files', { count: item.count });
    default:
      return t(key);
  }
}

/**
 * What a meeting has, as icons with a tooltip and an accessible name. Inside a
 * block or row they are phrasing content of its button.
 */
export function SignalIcons({ items }: { items: SignalItem[] }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <span className="ch-signals">
      {items.map((item) => {
        const Icon = ICONS[item.id];
        const label = signalLabel(item, t);
        return (
          <span key={item.id} className="ch-signal" data-signal={item.id} title={label}>
            <Icon size={11} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </span>
  );
}

/** The rows of the meeting page's inspector: what the meeting has, and only that. */
export function SignalRows({ items }: { items: SignalItem[] }) {
  const { t } = useTranslation();
  const v = (key: string) => t(`meetingDetail.values.${key}`);
  return items.map((item) => {
    const value = signalValue(item, t, v);
    if (value === null) return null;
    return (
      <PropRow
        key={item.id}
        icon={ICONS[item.id]}
        label={t(`meetingDetail.rows.${ROW_LABELS[item.id]}`)}
        title={signalLabel(item, t)}
      >
        {value}
      </PropRow>
    );
  });
}

const ROW_LABELS: Record<SignalItem['id'], string> = {
  useful: 'mark',
  notUseful: 'mark',
  transcript: 'transcript',
  speakers: 'speakers',
  note: 'note',
  preparation: 'preparation',
  noPreparation: 'preparation',
  diagram: 'diagram',
  memory: 'memory',
  followUps: 'followUps',
  files: 'files',
};

function signalValue(item: SignalItem, t: TFunction, v: (key: string) => string) {
  switch (item.id) {
    case 'useful':
    case 'notUseful':
      return t(`meetingsHub.signals.state.${item.id}`);
    case 'speakers':
      return speakersValue(item, t);
    case 'followUps':
      return item.linked + item.actions;
    case 'files':
      return item.count;
    case 'memory':
      return v('memoryKept');
    case 'noPreparation':
      return v('prepNone');
    default:
      return v('yes');
  }
}
