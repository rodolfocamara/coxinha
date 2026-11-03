import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pause, Play } from 'lucide-react';
import {
  library,
  type ParticipantCandidate,
  type ProcessingDetail,
  type ProcessingReport,
  type Recognition,
} from './library';
import { PersonCombobox } from './PersonCombobox';
import { personChoices, resolveTyped, type Pick } from './personChoices';
import { SelectedVoiceEnrollment } from './SelectedVoiceEnrollment';
import { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';
import { speakerExcerpt } from './speakerExcerpt';
import { excerptKey, type ExcerptPlayback } from './useBoundedPlayback';
export { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';

/** One voice to name (specs 0102, 0110): a header and a "Quem é?" row. */
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
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const w = (name: string) => t(`speakers.${name}`);
  const originId = useId();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Pick | null>(null);
  const assignment = report.assignments.find(
    (a) => a.track === track && a.speaker === speaker && a.state === 'confirmed'
  );
  // Prefilled only for a first naming: a revocation or correction needs its own reason.
  const [origin, setOrigin] = useState(() => (assignment ? '' : w('defaultOrigin')));
  const choices = personChoices(people, invitees);
  const choice = picked ?? resolveTyped(choices, text);
  const homonyms = !!text.trim() && !choice;
  const unchangedIdentity = choice?.kind === 'person' && assignment?.person_id === choice.id;
  const canConfirm = !disabled && !!choice && !!origin.trim() && !unchangedIdentity;
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

  function confirm() {
    if (!canConfirm || !choice) return;
    const name = choice.label;
    void act(async () => {
      const id =
        choice.kind === 'person'
          ? choice.id
          : choice.kind === 'invitee'
            ? await library.createPerson(choice.invitee.name.trim(), w('inviteeConsent'))
            : await library.createPerson(name, t('speakerNaming.typedConsent'));
      await library.confirmSpeaker(report.job, speaker, id, origin.trim(), false, track);
    }).then(
      () => {
        setText('');
        setPicked(null);
      },
      () => undefined
    );
  }

  return (
    <fieldset
      disabled={disabled}
      aria-label={`${trackName} · ${speaker}`}
      className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-3"
    >
      <legend className="sr-only">
        {trackName} · {speaker}
      </legend>
      <div className="flex min-w-0 items-center gap-2">
        {excerpt ? (
          <button
            type="button"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border hover:bg-accent focus-visible:outline focus-visible:outline-ring"
            aria-pressed={!!playing}
            aria-label={`${w('listen')} · ${formatTime(excerpt.start)}–${formatTime(excerpt.end)}`}
            title={`${formatTime(excerpt.start)}–${formatTime(excerpt.end)}`}
            onClick={() =>
              playback ? playback.play(excerpt) : onSeek(excerpt.track, excerpt.start, excerpt.end)
            }
          >
            {playing ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
            <span className="sr-only">
              {playing ? w('pause') : w('listen')} · {formatTime(excerpt.start)}–
              {formatTime(excerpt.end)}
            </span>
          </button>
        ) : (
          <span className="sr-only">{w('noCleanExcerpt')}</span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {assignment ? (
              <>
                <Check size={13} aria-hidden="true" className="mr-1 inline text-success" />
                {`${w('confirmed')}: ${assignment.name ?? k('anonymous')}`}
              </>
            ) : (
              w('anonymous')
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {trackName} · {speaker}
            {excerpt && ` · ${formatTime(excerpt.start)}–${formatTime(excerpt.end)}`}
          </p>
        </div>
      </div>
      {suggested && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          {`${w('proposed')}: ${suggested.name ?? k('anonymous')}`}
          {suggestedPerson && (
            <button
              type="button"
              className={speakerButton}
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
      <div className="flex items-start gap-2">
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
      </div>
      {choice?.kind === 'new' && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('speakerNaming.newPerson', { name: choice.label })}
        </p>
      )}
      {homonyms && (
        <p role="status" className="text-xs text-warning">
          {t('speakerNaming.pickHomonym')}
        </p>
      )}
      {unchangedIdentity && (
        <p role="status" className="text-xs text-muted-foreground">
          {w('alreadyConfirmed')}
        </p>
      )}
      {assignment ? (
        <div className="space-y-2">
          <label className="block space-y-1 text-sm">
            <span>{w('decisionOrigin')}</span>
            <input
              className={speakerField}
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              required
            />
          </label>
          <button
            type="button"
            className={speakerButton}
            disabled={!origin.trim()}
            onClick={() => void act(() => library.revokeAssignment(assignment.id, origin.trim()))}
          >
            {k('revoke')}
          </button>
        </div>
      ) : (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {t('speakerNaming.verification')}: {origin.trim() || '—'}
          </summary>
          <label htmlFor={originId} className="sr-only">
            {w('decisionOrigin')}
          </label>
          <input
            id={originId}
            className={`${speakerField} mt-1`}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            required
          />
        </details>
      )}
      {assignment?.person_id && (
        <SelectedVoiceEnrollment
          key={`${assignment.id}:${assignment.person_id}`}
          meetingId={meetingId}
          track={track}
          speaker={speaker}
          report={report}
          assignment={assignment}
          disabled={disabled}
          act={act}
          playback={playback}
          version={curationVersion}
        />
      )}
    </fieldset>
  );
}
function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
