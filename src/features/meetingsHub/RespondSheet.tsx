import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, RotateCcw, Send, X } from 'lucide-react';
import { Button, Sheet } from '../../components/ui';
import { calendar, type CalendarEvent, type ResponseRequest } from '../agenda/calendar';
import { whenLabel } from './format';
import { RespondForm } from './RespondForm';
import { RespondReview } from './RespondReview';
import { initialDraft, organizerName, requestOf, slotProblem, type Draft } from './respondModel';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Compose, then review, then send: a response reaches other people and cannot be
 * recalled, so only the review's button sends, and only after Graph has it does
 * anything change (spec 0130 P4).
 */
export function RespondSheet({
  event,
  open,
  onOpenChange,
  onSent,
}: {
  event: CalendarEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (request: ResponseRequest) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.respond.${key}`, options);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(event));
  const [step, setStep] = useState<'compose' | 'review'>('compose');
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const now = useMemo(() => new Date(), [open]);
  const when = whenLabel(new Date(event.startsAt), new Date(event.endsAt), now, locale, t);
  const request = requestOf(draft);
  const problem = draft.choice === 'propose' ? slotProblem(draft, event, new Date()) : null;
  const name = organizerName(event);

  const edit = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const toReview = () => {
    setAttempted(true);
    if (request && !problem) {
      setError(null);
      setStep('review');
    }
  };
  const send = async () => {
    if (!request || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await calendar.respond(event.id, request);
      onSent(request);
      onOpenChange(false);
    } catch (e) {
      const code = message(e);
      setError(t(code.startsWith('calendar.') ? code : 'calendar.failed'));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const SendIcon = error ? RotateCcw : Send;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!inFlight.current) onOpenChange(next);
      }}
      title={k(step === 'compose' ? 'title' : 'reviewTitle')}
      description={`${event.title} · ${when}`}
      closeLabel={t('meetingsHub.close')}
      footer={
        step === 'compose' ? (
          <>
            <Button
              variant="ghost"
              icon={<X size={14} aria-hidden="true" />}
              onClick={() => onOpenChange(false)}
            >
              {t('meetingsHub.cancel')}
            </Button>
            <Button
              variant="primary"
              icon={<ArrowRight size={14} aria-hidden="true" />}
              onClick={toReview}
            >
              {k('buttons.review')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              disabled={sending}
              icon={<ArrowLeft size={14} aria-hidden="true" />}
              onClick={() => setStep('compose')}
            >
              {k('buttons.back')}
            </Button>
            <Button
              variant="primary"
              disabled={sending}
              aria-busy={sending || undefined}
              icon={<SendIcon size={14} aria-hidden="true" />}
              onClick={() => void send()}
            >
              {sending
                ? k('buttons.sending')
                : error
                  ? k('buttons.retry')
                  : request?.notify
                    ? k('buttons.send', { name })
                    : k('buttons.save')}
            </Button>
          </>
        )
      }
    >
      {step === 'compose' ? (
        <RespondForm
          event={event}
          draft={draft}
          edit={edit}
          now={now}
          problem={attempted ? problem : null}
          noChoice={attempted && !draft.choice}
        />
      ) : (
        request && <RespondReview event={event} request={request} when={when} error={error} />
      )}
    </Sheet>
  );
}
