import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { library, type VoiceMemory as Memory } from '../meetings/library';

const field =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus-visible:outline focus-visible:outline-ring';

/**
 * Spec 0120 P4: forget the whole voice (and stop remembering it from later
 * confirmations), or turn memory back on; pending and failed confirmations.
 */
export function VoiceMemory({
  personId,
  version,
  disabled,
  act,
  meetingTitle,
}: {
  personId: string;
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  meetingTitle: (meetingId: string) => string;
}) {
  const { t } = useTranslation();
  const k = (name: string, options?: Record<string, unknown>) =>
    t(`people.voiceMemory.${name}`, options);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    let live = true;
    (async () => library.voiceMemory(personId))().then(
      (value) => live && value.personId === personId && setMemory(value),
      () => live && setMemory(null)
    );
    return () => {
      live = false;
    };
  }, [personId, version]);
  if (!memory) return null;
  const run = (action: () => Promise<unknown>) =>
    void act(action).then(
      () => {
        setForgetting(false);
        setReason('');
      },
      () => undefined
    );
  return (
    <div className="space-y-2">
      {memory.off ? (
        <>
          <p role="status" className="text-muted-foreground">
            {k('off')}
          </p>
          <Button
            size="xs"
            disabled={disabled}
            onClick={() => run(() => library.rememberVoice(personId))}
          >
            {k('rememberAgain')}
          </Button>
        </>
      ) : forgetting ? (
        <>
          <input
            className={field}
            aria-label={k('forgetReason')}
            placeholder={k('forgetReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-1">
            <Button
              size="xs"
              disabled={disabled || !reason.trim()}
              onClick={() => run(() => library.forgetVoice(personId, reason.trim()))}
            >
              {k('forgetConfirm')}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setForgetting(false)}>
              {k('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setForgetting(true)}>
          {k('forget')}
        </Button>
      )}
      {memory.pending > 0 && (
        <p role="status" className="text-muted-foreground">
          {k('pending', { count: memory.pending })}
        </p>
      )}
      {memory.failed.map((failure) => (
        <p key={failure.assignmentId} role="status" className="text-warning">
          {k('failed', { meeting: meetingTitle(failure.meetingId), reason: failure.error ?? '' })}{' '}
          <button
            type="button"
            className="underline-offset-2 hover:underline disabled:opacity-40"
            disabled={disabled}
            onClick={() => run(() => library.retryVoice(failure.assignmentId))}
          >
            {k('retry')}
          </button>
        </p>
      ))}
    </div>
  );
}
