import { useTranslation } from 'react-i18next';
import { Alert, Button, EmptyState } from '../../components/ui';

/** Notes tab of a meeting that has no session: an Outlook event or a loose recording. */
export function NotesPlaceholder({
  kind,
  busy,
  onPrepare,
}: {
  kind: 'event' | 'recording';
  busy: boolean;
  onPrepare: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.notes.${key}`);
  return kind === 'event' ? (
    <EmptyState
      title={k('eventTitle')}
      description={k('eventHint')}
      action={
        <Button variant="primary" size="sm" disabled={busy} onClick={onPrepare}>
          {k('prepare')}
        </Button>
      }
    />
  ) : (
    <EmptyState title={k('recordingTitle')} description={k('recordingHint')} />
  );
}

/** Transcript or speakers tab before the recording detail is available. */
export function MediaPlaceholder({
  tab,
  hasRecording,
  failed,
  onRetry,
}: {
  tab: 'transcript' | 'people';
  hasRecording: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.${key}`);
  if (!hasRecording)
    return (
      <EmptyState
        title={k(tab === 'people' ? 'emptySpeakers' : 'emptyTranscript')}
        description={k(tab === 'people' ? 'emptySpeakersHint' : 'emptyTranscriptHint')}
      />
    );
  if (failed)
    return (
      <Alert
        tone="error"
        action={
          <Button size="sm" onClick={onRetry}>
            {k('retry')}
          </Button>
        }
      >
        {k('audioFailed')}
      </Alert>
    );
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {k('loading')}
    </p>
  );
}
