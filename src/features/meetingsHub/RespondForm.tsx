import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Field, Input, Textarea } from '../../components/ui';
import type { CalendarEvent } from '../agenda/calendar';
import { myResponse } from './eventDetailsModel';
import { rowTime } from './format';
import { useOutlookWrite } from './OutlookOption';
import {
  allowsProposals,
  asksForResponse,
  isRecurring,
  MAX_COMMENT,
  organizerName,
  ownerZone,
  type Choice,
  type Draft,
  type SlotProblem,
} from './respondModel';

const CHOICES: Choice[] = ['accept', 'tentative', 'decline', 'propose'];

function Radio({
  name,
  checked,
  disabled,
  onChange,
  inputRef,
  hint,
  children,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  inputRef?: (input: HTMLInputElement | null) => void;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="ch-respond-option" data-disabled={disabled || undefined}>
      <input
        ref={inputRef}
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>
        {children}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

/** Step one of spec 0130 P4. Nothing here talks to the network. */
export function RespondForm({
  event,
  draft,
  edit,
  now,
  problem,
  noChoice,
}: {
  event: CalendarEvent;
  draft: Draft;
  edit: (change: Partial<Draft>) => void;
  now: Date;
  problem: SlotProblem | null;
  noChoice: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingDetail.respond.${key}`, options);
  const first = useRef<HTMLInputElement | null>(null);
  const { connected, write } = useOutlookWrite();
  const proposing = draft.choice === 'propose';
  const name = organizerName(event);
  const start = new Date(event.startsAt);
  const notify = proposing || draft.notify;
  const response = myResponse(event);
  useEffect(() => {
    // After Radix has placed focus on the sheet, so its focus return still knows the opener.
    const frame = requestAnimationFrame(() => first.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <form
      className="ch-respond"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      {connected && !write && <Alert tone="warning">{k('noWrite')}</Alert>}
      {response && (
        <p className="ch-respond-current">
          {k('current', { response: t(`meetingDetail.values.response.${response}`) })}
        </p>
      )}
      <fieldset className="ch-respond-set">
        <legend>{k('choiceLegend')}</legend>
        {CHOICES.map((choice, i) => {
          const blocked = choice === 'propose' && !allowsProposals(event);
          return (
            <Radio
              key={choice}
              name="respond-choice"
              checked={draft.choice === choice}
              disabled={blocked}
              hint={blocked ? k('noProposals') : undefined}
              inputRef={i === 0 ? (input) => void (first.current = input) : undefined}
              onChange={() => edit({ choice })}
            >
              {k(`choice.${choice}`)}
            </Radio>
          );
        })}
        {noChoice && (
          <p role="alert" className="cx-field-error">
            {k('problem.noChoice')}
          </p>
        )}
      </fieldset>
      {proposing && (
        <>
          <fieldset className="ch-respond-set">
            <legend>{k('proposeAsLegend')}</legend>
            {(['tentative', 'decline'] as const).map((proposeAs) => (
              <Radio
                key={proposeAs}
                name="respond-propose-as"
                checked={draft.proposeAs === proposeAs}
                onChange={() => edit({ proposeAs })}
              >
                {k(`choice.${proposeAs}`)}
              </Radio>
            ))}
          </fieldset>
          <div className="ch-respond-slot">
            <Field label={k('date')}>
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => edit({ date: e.target.value })}
              />
            </Field>
            <Field label={k('from')}>
              <Input
                type="time"
                value={draft.from}
                onChange={(e) => edit({ from: e.target.value })}
              />
            </Field>
            <Field label={k('to')}>
              <Input type="time" value={draft.to} onChange={(e) => edit({ to: e.target.value })} />
            </Field>
          </div>
          <p className="cx-field-hint">{k('zoneHint', { zone: ownerZone(start, locale) })}</p>
          {problem && (
            <p role="alert" className="cx-field-error">
              {k(`problem.${problem}`)}
            </p>
          )}
        </>
      )}
      {isRecurring(event) && (
        <fieldset className="ch-respond-set">
          <legend>{k('scopeLegend')}</legend>
          <Radio
            name="respond-scope"
            checked={proposing || draft.scope === 'occurrence'}
            onChange={() => edit({ scope: 'occurrence' })}
          >
            {k('scope.occurrence', { when: rowTime(start, now, locale) })}
          </Radio>
          <Radio
            name="respond-scope"
            checked={!proposing && draft.scope === 'series'}
            disabled={proposing}
            hint={proposing ? k('oneOccurrence') : undefined}
            onChange={() => edit({ scope: 'series' })}
          >
            {k('scope.series')}
          </Radio>
        </fieldset>
      )}
      {notify && (
        <Field label={k('comment')} hint={k('commentHint')}>
          <Textarea
            rows={3}
            maxLength={MAX_COMMENT}
            value={draft.comment}
            onChange={(e) => edit({ comment: e.target.value })}
          />
        </Field>
      )}
      <label className="ch-respond-option" data-disabled={proposing || undefined}>
        <input
          type="checkbox"
          checked={notify}
          disabled={proposing}
          onChange={(e) => edit({ notify: e.target.checked })}
        />
        <span>
          {k('notify', { name })}
          {proposing ? (
            <small>{k('notifyProposal')}</small>
          ) : (
            !asksForResponse(event) && <small>{k('notifyNotAsked')}</small>
          )}
        </span>
      </label>
    </form>
  );
}
