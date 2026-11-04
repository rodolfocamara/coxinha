import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pause, Play } from 'lucide-react';
import {
  library,
  type ParticipantCandidate,
  type ProcessingDetail,
  type ProcessingReport,
  type Recognition,
} from './library';
import { PersonAvatar } from '../people/personVisual';
import { PersonCombobox } from './PersonCombobox';
import { personChoices, resolveTyped, type Pick } from './personChoices';
import { SelectedVoiceEnrollment } from './SelectedVoiceEnrollment';
import { SpeakerVoiceState } from './SpeakerVoiceState';
import { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';
import { speakerExcerpt } from './speakerExcerpt';
import { excerptKey, type ExcerptPlayback } from './useBoundedPlayback';
export { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';

const textAction =
  'rounded px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring disabled:opacity-40';

/**
 * One voice as a list row (specs 0102, 0110): listen, then type who it is.
 * Confirming also remembers the voice (spec 0120). A named voice keeps
 * correction, "not a participant" and selected samples behind "Trocar".
 */
export function SpeakerCard({
  meetingId,
  curationVersion,
  track,
  speaker,
  report,
  people,
  invitees = [],
  recognition,
  disabled,
  act,
  playback,
  onSeek,
  manualEnrollBlocked = false,
  note,
}: {
  meetingId: string;
  curationVersion: unknown;
  track: string;
  speaker: string;
  report: ProcessingReport;
  people: ProcessingDetail['people'];
  /** The meeting's participants (spec 0102): listed first, created on confirm. */
  invitees?: ParticipantCandidate[];
  recognition: Recognition | null;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  playback?: ExcerptPlayback;
  onSeek: (track: string, seconds: number, end?: number) => void;
  /** Selected samples still wait for an idle library; confirmation does not. */
  manualEnrollBlocked?: boolean;
  /** Why the row sits in the folded group. */
  note?: string;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const w = (name: string) => t(`speakers.${name}`);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Pick | null>(null);
  const [changing, setChanging] = useState(false);
  // A correction or revocation needs its own reason; a first naming uses the default.
  const [reason, setReason] = useState('');
  const assignment = report.assignments.find(
    (a) => a.track === track && a.speaker === speaker && a.state === 'confirmed'
  );
  const editing = !assignment || changing;
  const origin = assignment ? reason.trim() : w('defaultOrigin');
  const choices = personChoices(people, invitees);
  const choice = picked ?? resolveTyped(choices, text);
  const homonyms = !!text.trim() && !choice;
  const unchangedIdentity = choice?.kind === 'person' && assignment?.person_id === choice.id;
  const canConfirm = !disabled && !!choice && !!origin && !unchangedIdentity;
  const suggestion = recognition?.speakers.find((a) => a.track === track && a.speaker === speaker);
  const suggested =
    !assignment &&
    suggestion?.state === 'suggested' &&
    recognition?.calibrationStatus === 'calibrated' &&
    !!suggestion.policyId
      ? suggestion
      : null;
  const suggestedPerson = suggested?.personId
    ? choices.find((c) => c.kind === 'person' && c.id === suggested.personId)
    : undefined;
  const excerpt = speakerExcerpt(report, track, speaker);
  const playing = excerpt && playback?.current === excerptKey(excerpt);
  const trackName = t(`library.${track}`);
  const range = excerpt ? `${formatTime(excerpt.start)}–${formatTime(excerpt.end)}` : null;
  const name = assignment ? (assignment.name ?? k('anonymous')) : null;

  function reset() {
    setText('');
    setPicked(null);
    setReason('');
    setChanging(false);
  }

  function confirm() {
    if (!canConfirm || !choice) return;
    void act(async () => {
      const id =
        choice.kind === 'person'
          ? choice.id
          : choice.kind === 'invitee'
            ? await library.createPerson(choice.invitee.name.trim(), w('inviteeConsent'))
            : await library.createPerson(choice.label, t('speakerNaming.typedConsent'));
      await library.confirmSpeaker(report.job, speaker, id, origin, track);
    }).then(reset, () => undefined);
  }

  /** Spec 0120 P6: leaves naming and sample collection; reversible. */
  function notParticipant() {
    const why = assignment ? reason.trim() : t('speakerNaming.notParticipantOrigin');
    if (disabled || !why) return;
    void act(() => library.rejectSpeaker(report.job, speaker, why, track)).then(
      reset,
      () => undefined
    );
  }

  return (
    <li>
      <fieldset
        disabled={disabled}
        aria-label={`${trackName} · ${speaker}`}
        className="min-w-0 space-y-2 px-3 py-2.5"
      >
        <legend className="sr-only">
          {trackName} · {speaker}
        </legend>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {excerpt ? (
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-border hover:bg-accent focus-visible:outline focus-visible:outline-ring"
              aria-pressed={!!playing}
              aria-label={`${w('listen')} · ${range}`}
              title={range ?? undefined}
              onClick={() =>
                playback
                  ? playback.play(excerpt)
                  : onSeek(excerpt.track, excerpt.start, excerpt.end)
              }
            >
              {playing ? (
                <Pause size={14} aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              <span className="sr-only">
                {playing ? w('pause') : w('listen')} · {range}
              </span>
            </button>
          ) : (
            <span className="size-8 shrink-0" title={w('noCleanExcerpt')} />
          )}
          <div className="min-w-0 flex-1 basis-32">
            {name ? (
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {assignment?.person_id && (
                  <PersonAvatar personId={assignment.person_id} name={name} />
                )}
                <Check size={14} aria-hidden="true" className="shrink-0 text-success" />
                <span className="truncate" aria-hidden="true">
                  {name}
                </span>
                <span className="sr-only">{`${w('confirmed')}: ${name}`}</span>
              </p>
            ) : (
              <p className="truncate text-sm text-muted-foreground">{w('anonymous')}</p>
            )}
            <p className="truncate text-xs text-muted-foreground tabular-nums">
              {trackName}
              {range && ` · ${range}`}
              {note && ` · ${note}`}
            </p>
            {assignment && (
              <SpeakerVoiceState
                voice={assignment.voice}
                assignmentId={assignment.id}
                disabled={disabled}
                act={act}
              />
            )}
          </div>
          {editing ? (
            <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-80">
              <PersonCombobox
                label={t('speakerNaming.who')}
                choices={choices}
                text={text}
                onText={(value) => {
                  setText(value);
                  setPicked(null);
                }}
                onPick={(pick) => {
                  setPicked(pick);
                  setText(pick.label);
                }}
                onSubmit={confirm}
                disabled={disabled}
              />
              <button
                type="button"
                className={`${speakerButton} shrink-0`}
                disabled={!canConfirm}
                onClick={confirm}
              >
                {assignment ? k('correctIdentity') : k('confirm')}
              </button>
              {!assignment && (
                <button type="button" className={`${textAction} shrink-0`} onClick={notParticipant}>
                  {t('speakerNaming.notParticipant')}
                </button>
              )}
            </div>
          ) : (
            <button type="button" className={textAction} onClick={() => setChanging(true)}>
              {t('speakerNaming.change')}
            </button>
          )}
        </div>
        {suggested && (
          <p
            role="status"
            className="flex flex-wrap items-center gap-2 pl-11 text-xs text-muted-foreground"
          >
            {`${w('proposed')}: ${suggested.name ?? k('anonymous')}`}
            {suggestedPerson && (
              <button
                type="button"
                className={textAction}
                onClick={() => {
                  setPicked(suggestedPerson);
                  setText(suggestedPerson.label);
                }}
              >
                {k('selectSuggestion')}
              </button>
            )}
          </p>
        )}
        {choice?.kind === 'new' && (
          <p role="status" className="pl-11 text-xs text-muted-foreground">
            {t('speakerNaming.newPerson', { name: choice.label })}
          </p>
        )}
        {homonyms && (
          <p role="status" className="pl-11 text-xs text-warning">
            {t('speakerNaming.pickHomonym')}
          </p>
        )}
        {unchangedIdentity && (
          <p role="status" className="pl-11 text-xs text-muted-foreground">
            {w('alreadyConfirmed')}
          </p>
        )}
        {assignment && changing && (
          <div className="space-y-2 pl-11">
            <input
              className={speakerField}
              aria-label={w('decisionOrigin')}
              placeholder={t('speakerNaming.reason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className={textAction}
                disabled={!reason.trim()}
                onClick={() =>
                  void act(() => library.revokeAssignment(assignment.id, reason.trim()))
                }
              >
                {k('revoke')}
              </button>
              <button
                type="button"
                className={textAction}
                disabled={!reason.trim()}
                onClick={notParticipant}
              >
                {t('speakerNaming.notParticipant')}
              </button>
              <button type="button" className={textAction} onClick={reset}>
                {t('speakerNaming.cancel')}
              </button>
            </div>
            {assignment.person_id && (
              <SelectedVoiceEnrollment
                key={`${assignment.id}:${assignment.person_id}`}
                meetingId={meetingId}
                track={track}
                speaker={speaker}
                report={report}
                assignment={assignment}
                disabled={disabled || manualEnrollBlocked}
                act={act}
                playback={playback}
                version={curationVersion}
              />
            )}
          </div>
        )}
      </fieldset>
    </li>
  );
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
