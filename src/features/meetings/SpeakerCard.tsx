import { Select } from '../../components/ui/Select';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { library, type ProcessingDetail, type ProcessingReport, type Recognition } from './library';
import { SelectedVoiceEnrollment } from './SelectedVoiceEnrollment';
import { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';
import { speakerExcerpt } from './speakerExcerpt';
import { excerptKey, type ExcerptPlayback } from './useBoundedPlayback';
export { voiceButton as speakerButton, voiceField as speakerField } from './voiceControls';
export function SpeakerCard({
  meetingId,
  curationVersion,
  track,
  speaker,
  report,
  people,
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
  recognition: Recognition | null;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  playback?: ExcerptPlayback;
  onSeek: (track: string, seconds: number, end?: number) => void;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const w = (name: string) => t(`speakers.${name}`);
  const helpId = useId();
  const [person, setPerson] = useState('');
  const [origin, setOrigin] = useState('');
  const assignment = report.assignments.find(
    (a) => a.track === track && a.speaker === speaker && a.state === 'confirmed'
  );
  const unchangedIdentity = !!person && assignment?.person_id === person;
  const canConfirm = !disabled && !!person && !!origin.trim() && !unchangedIdentity;
  const suggestion = recognition?.speakers.find((a) => a.track === track && a.speaker === speaker);
  const hasSuggestion =
    suggestion?.state === 'suggested' &&
    recognition?.calibrationStatus === 'calibrated' &&
    !!suggestion.policyId;
  const excerpt = speakerExcerpt(report, track, speaker);
  const playing = excerpt && playback?.current === excerptKey(excerpt);
  return (
    <fieldset
      disabled={disabled}
      aria-label={`${t(`library.${track}`)} · ${speaker}`}
      className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-4"
    >
      <legend className="px-1 text-sm text-muted-foreground">
        {t(`library.${track}`)} · {speaker}
      </legend>
      <p className="font-medium break-words">
        {assignment ? `${w('confirmed')}: ${assignment.name ?? k('anonymous')}` : w('anonymous')}
      </p>
      {!assignment && suggestion && hasSuggestion && (
        <div role="status" className="text-sm text-muted-foreground space-y-1">
          <p>
            {hasSuggestion
              ? `${w('proposed')}: ${suggestion.name ?? k('anonymous')}`
              : w('unknown')}
          </p>
          {hasSuggestion &&
            suggestion.personId &&
            people.some((p) => p.id === suggestion.personId) && (
              <button className={speakerButton} onClick={() => setPerson(suggestion.personId!)}>
                {k('selectSuggestion')}
              </button>
            )}
        </div>
      )}
      {excerpt ? (
        <button
          type="button"
          className={speakerButton}
          aria-pressed={!!playing}
          aria-label={`${w('listen')} · ${formatTime(excerpt.start)}–${formatTime(excerpt.end)}`}
          onClick={() =>
            playback ? playback.play(excerpt) : onSeek(excerpt.track, excerpt.start, excerpt.end)
          }
        >
          {playing ? w('pause') : w('listen')} · {formatTime(excerpt.start)}–
          {formatTime(excerpt.end)}
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">{w('noCleanExcerpt')}</p>
      )}
      <label className="block space-y-1 text-sm">
        <span>{k('person')}</span>
        <Select
          aria-label={k('person')}
          className={speakerField}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">{k('choosePerson')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {personOptionLabel(p, people)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{w('decisionOrigin')}</span>
        <input
          className={speakerField}
          aria-describedby={helpId}
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          required
        />
      </label>
      <p id={helpId} className="text-xs text-muted-foreground">
        {t('speakers.decisionHelpShort')}
      </p>
      <p className="text-xs text-muted-foreground">{t('voiceCuration.confirmScope')}</p>
      {unchangedIdentity && (
        <p role="status" className="text-xs text-muted-foreground">
          {w('alreadyConfirmed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          className={speakerButton}
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) return;
            void act(() =>
              library.confirmSpeaker(report.job, speaker, person, origin.trim(), false, track)
            );
          }}
        >
          {assignment ? k('correctIdentity') : k('confirm')}
        </button>
        {assignment && (
          <button
            className={speakerButton}
            disabled={!origin.trim()}
            onClick={() => void act(() => library.revokeAssignment(assignment.id, origin.trim()))}
          >
            {k('revoke')}
          </button>
        )}
      </div>
      {!assignment && (
        <p className="text-xs text-muted-foreground">{t('voiceCuration.identityOnly')}</p>
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

function personOptionLabel(
  person: ProcessingDetail['people'][number],
  people: ProcessingDetail['people']
) {
  const normalized = (name: string) => name.trim().normalize('NFKC').toLocaleLowerCase();
  const homonyms = people.filter((p) => normalized(p.name) === normalized(person.name));
  if (homonyms.length < 2) return person.name;
  const shortId = person.id.slice(-8);
  const unique = homonyms.every((p) => p.id === person.id || p.id.slice(-8) !== shortId);
  return `${person.name} (${unique ? shortId : person.id})`;
}
