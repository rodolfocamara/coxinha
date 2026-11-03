import { useTranslation } from 'react-i18next';
import { library, type VoiceState } from './library';

const textAction =
  'rounded px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-ring disabled:opacity-40';

/** Whether the confirmation's voice is remembered yet (spec 0120 P3). */
export function SpeakerVoiceState({
  voice,
  assignmentId,
  disabled,
  act,
}: {
  voice?: VoiceState | null;
  assignmentId: string;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  if (!voice) return null;
  const n = (name: string, options?: Record<string, unknown>) =>
    t(`speakerNaming.${name}`, options);
  if (voice.state === 'failed')
    return (
      <p role="status" className="flex flex-wrap items-center gap-1 text-xs text-warning">
        {n('voiceFailed', { reason: voice.error ?? '' })}
        <button
          type="button"
          className={textAction}
          disabled={disabled}
          onClick={() => void act(() => library.retryVoice(assignmentId)).catch(() => undefined)}
        >
          {n('voiceRetry')}
        </button>
      </p>
    );
  return (
    <p className="truncate text-xs text-muted-foreground">
      {voice.state === 'enrolled'
        ? n('voiceEnrolled', { count: voice.samples })
        : voice.state === 'off'
          ? n('voiceOff')
          : n('voicePending')}
    </p>
  );
}
