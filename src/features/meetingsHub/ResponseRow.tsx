import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Circle, CircleCheck, CircleHelp, CircleX, UserRound, type LucideIcon } from 'lucide-react';
import type { CalendarEvent, ResponseRequest } from '../agenda/calendar';
import { myResponse, type MyResponse } from './eventDetailsModel';
import { PropAction, PropRow } from './PropertySheet';
import { canRespond, organizerName } from './respondModel';
import { RespondSheet } from './RespondSheet';
import './respond.css';

const ICONS: Record<MyResponse, LucideIcon> = {
  organizer: UserRound,
  accepted: CircleCheck,
  tentative: CircleHelp,
  declined: CircleX,
  none: Circle,
};

/** The owner's answer, and for an invitee the way to give or change it (spec 0130 P4). */
export function ResponseRow({ event }: { event: CalendarEvent }) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.respond.${key}`, options);
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  const response = myResponse(event);
  if (!response) return null;
  const respondable = canRespond(event);
  const sent = (request: ResponseRequest) =>
    setNote(request.notify ? k('note.sent', { name: organizerName(event) }) : k('note.silent'));
  return (
    <>
      <PropRow
        icon={ICONS[response]}
        label={t('meetingDetail.rows.response')}
        tone={response}
        action={
          respondable && (
            <PropAction
              name={k(response === 'none' ? 'action.respondName' : 'action.changeName')}
              onClick={() => {
                setNote('');
                setAttempt((n) => n + 1);
                setOpen(true);
              }}
            >
              {k(response === 'none' ? 'action.respond' : 'action.change')}
            </PropAction>
          )
        }
      >
        {t(`meetingDetail.values.response.${response}`)}
        <span role="status" className="ch-respond-note">
          {note}
        </span>
      </PropRow>
      {respondable && (
        <RespondSheet
          key={attempt}
          event={event}
          open={open}
          onOpenChange={setOpen}
          onSent={sent}
        />
      )}
    </>
  );
}
