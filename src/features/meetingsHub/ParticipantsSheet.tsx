import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { Alert, Button, Sheet } from '../../components/ui';
import { library } from '../meetings/library';
import { ParticipantContext } from '../meetings/ParticipantContext';
import type { CalendarEvent } from '../agenda/calendar';
import { sameCandidate } from './MeetingInspector';

const LIMIT = 100;

/**
 * Speaker candidates of one recording. Outlook invitees are merged into the
 * existing list (deduplicated by e-mail, else by name), never replacing it,
 * and the 100-candidate limit is reported before anything is written.
 */
export function ParticipantsSheet({
  open,
  onOpenChange,
  meetingId,
  event,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  event: CalendarEvent | null;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.participantsSheet.${key}`);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const invitees = event?.attendees ?? [];
  const copyInvitees = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const current = await library.participantContext(meetingId);
      const merged = [...current];
      for (const candidate of invitees)
        if (!merged.some((c) => sameCandidate(c, candidate))) merged.push(candidate);
      if (merged.length > LIMIT) {
        setNotice({ tone: 'error', text: t('calendar.candidateLimit') });
        return;
      }
      await library.setParticipantContext(meetingId, merged);
      setRevision((n) => n + 1);
      setNotice({ tone: 'success', text: t('outlook.copied') });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k('description')}
      closeLabel={t('meetingsHub.close')}
    >
      <div className="flex flex-col gap-4">
        {invitees.length > 0 && (
          <div className="flex flex-col items-start gap-2">
            <Button
              icon={<CalendarDays size={14} aria-hidden="true" />}
              disabled={busy}
              onClick={() => void copyInvitees()}
            >
              {t('meetingsHub.participantsSheet.copyInvitees', { count: invitees.length })}
            </Button>
            {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
          </div>
        )}
        <ParticipantContext key={revision} meetingId={meetingId} disabled={busy} />
      </div>
    </Sheet>
  );
}
