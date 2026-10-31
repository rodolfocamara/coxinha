import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Alert, Button, Field, Input, Sheet } from '../../components/ui';
import { library } from '../meetings/library';
import { useCaptureStore } from '../capture/captureStore';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * "Importar áudio": one local WAV chosen through the native dialog becomes a
 * recording. The library refuses imports while a capture or processing runs.
 */
export function ImportAudioSheet({
  open,
  onOpenChange,
  initialTitle,
  forMeeting,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle: string;
  /** Opened from a meeting: the audio still becomes its own recording. */
  forMeeting: boolean;
  onImported: (meetingId: string) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.importSheet.${key}`);
  const blocked = useCaptureStore((s) => !!s.status?.active || !!s.status?.processing);
  const [path, setPath] = useState<string | null>(null);
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    setError(null);
    try {
      const picked = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (typeof picked !== 'string') return;
      setPath(picked);
      if (!title.trim()) setTitle(baseName(picked).replace(/\.wav$/i, ''));
    } catch (e) {
      setError(message(e));
    }
  };
  const submit = async () => {
    if (!path || !title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await library.importAudio(title.trim(), path);
      onImported(imported.meeting.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k(forMeeting ? 'descriptionForMeeting' : 'description')}
      closeLabel={t('meetingsHub.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('meetingsHub.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || blocked || !path || !title.trim()}
            onClick={() => void submit()}
          >
            {k('import')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={k('file')}>
          <Button
            className="justify-start"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            disabled={busy}
            onClick={() => void choose()}
          >
            {path ? baseName(path) : k('chooseFile')}
          </Button>
        </Field>
        <Field label={k('titleLabel')} required>
          <Input value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {blocked && <Alert tone="info">{k('blocked')}</Alert>}
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            {k('importing')}
          </p>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Sheet>
  );
}
