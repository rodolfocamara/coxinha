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
import type { SignalItem } from './meetingSignals';
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

/** The panel's narrow list; the full wording of spec 0124 stays as its tooltip. */
export function signalShortLabel(item: SignalItem, t: TFunction) {
  switch (item.id) {
    case 'speakers':
      return t('meetingDetail.signals.speakers', {
        count: item.named + item.unnamed,
        named: item.named,
      });
    case 'followUps':
      return t('meetingDetail.signals.followUps', { count: item.linked + item.actions });
    default:
      return signalLabel(item, t);
  }
}

/**
 * What a meeting has, as icons with a tooltip and an accessible name. Inside a
 * block or row they are phrasing content of its button; the peek's `labelled`
 * list spells each one out, and doubles as the legend.
 */
export function SignalIcons({
  items,
  labelled = false,
}: {
  items: SignalItem[];
  labelled?: boolean;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;
  const size = labelled ? 13 : 11;
  const parts = items.map((item) => {
    const Icon = ICONS[item.id];
    return { id: item.id, Icon, label: signalLabel(item, t), short: signalShortLabel(item, t) };
  });
  if (labelled)
    return (
      <ul className="ch-signals" data-labelled="" aria-label={t('meetingsHub.signals.label')}>
        {parts.map(({ id, Icon, label, short }) => (
          <li
            key={id}
            className="ch-signal"
            data-signal={id}
            title={label === short ? undefined : label}
          >
            <Icon size={size} aria-hidden="true" />
            {short}
          </li>
        ))}
      </ul>
    );
  return (
    <span className="ch-signals">
      {parts.map(({ id, Icon, label }) => (
        <span key={id} className="ch-signal" data-signal={id} title={label}>
          <Icon size={size} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </span>
  );
}
