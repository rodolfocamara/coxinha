import { useTranslation } from 'react-i18next';
import type { Session } from '../sessions/sessions';
import { useCaptureStore, useIsLive } from './captureStore';
import '../../components/Shell/shell.css';

type Props = { session: Pick<Session, 'id' | 'meeting_id'> | null | undefined; className?: string };

/**
 * Read-only marker for a meeting that is being captured right now. Controls
 * live only in the recorder strip; this never starts or stops anything.
 */
export function LiveBadge({ session, className = '' }: Props) {
  const { t } = useTranslation();
  const live = useIsLive(session);
  const paused = useCaptureStore((s) => !!s.status?.active?.paused);
  if (!live) return null;
  return (
    <span className={`cx-live-badge ${className}`} data-paused={paused}>
      {t(paused ? 'recorder.badgePaused' : 'recorder.badgeLive')}
    </span>
  );
}
