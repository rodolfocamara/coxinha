import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { library, type ParticipantCandidate } from './library';
import { Alert, Button, Field, Input } from '../../components/ui';
function ParticipantContextForMeeting({
  meetingId,
  disabled,
  onSelect,
}: {
  meetingId: string;
  disabled: boolean;
  /** Omitted where no person form consumes the chosen name (Reuniões inspector). */
  onSelect?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`library.processing.${name}`);
  const [rows, setRows] = useState<ParticipantCandidate[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    library
      .participantContext(meetingId)
      .then((value) => {
        if (live) {
          setRows(value);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [meetingId, reload]);
  const locked = disabled || busy || !loaded;
  return (
    <>
      {error && !loaded && (
        <Button
          size="sm"
          disabled={disabled || busy}
          onClick={() => setReload((value) => value + 1)}
        >
          {k('retryCandidates')}
        </Button>
      )}
      <fieldset
        disabled={locked}
        className="space-y-3 rounded-md border border-border bg-card p-4 disabled:opacity-60"
      >
        <legend className="px-1 text-sm font-semibold">{k('participantContext')}</legend>
        <p className="text-ui text-muted-foreground">{k('participantNotice')}</p>
        {error && <Alert tone="error">{error}</Alert>}
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2 sm:items-end"
          >
            <Field label={k('candidateName')}>
              <Input
                value={row.name}
                onChange={(e) =>
                  setRows(
                    rows.map((item, i) => (i === index ? { ...item, name: e.target.value } : item))
                  )
                }
              />
            </Field>
            <Field label={k('candidateEmail')}>
              <Input
                type="email"
                value={row.email ?? ''}
                onChange={(e) =>
                  setRows(
                    rows.map((item, i) =>
                      i === index ? { ...item, email: e.target.value || null } : item
                    )
                  )
                }
              />
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              {onSelect && (
                <Button size="sm" onClick={() => onSelect(row.name)} disabled={!row.name.trim()}>
                  {k('useCandidate')}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={14} aria-hidden="true" />}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                {k('removeCandidate')}
              </Button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={14} aria-hidden="true" />}
            onClick={() => setRows([...rows, { name: '', email: null }])}
          >
            {k('addCandidate')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={rows.some((row) => !row.name.trim())}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                setRows(await library.setParticipantContext(meetingId, rows));
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {k('saveCandidates')}
          </Button>
        </div>
      </fieldset>
    </>
  );
}

export function ParticipantContext(props: Parameters<typeof ParticipantContextForMeeting>[0]) {
  return <ParticipantContextForMeeting key={props.meetingId} {...props} />;
}
