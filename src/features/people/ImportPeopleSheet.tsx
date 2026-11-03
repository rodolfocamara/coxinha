import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, X } from 'lucide-react';
import { Alert, Button, Input, Sheet } from '../../components/ui';
import { calendar } from '../agenda/calendar';
import { library } from '../meetings/library';
import { nameKey } from '../meetings/personChoices';
import { voiceCuration } from '../meetings/voiceCuration';
import { voiceCurationErrorText } from '../meetings/voiceCurationError';
import { calendarParticipants, type CalendarParticipant } from './calendarParticipants';

type Loaded = { connected: boolean; participants: CalendarParticipant[] };

/** "Importar da agenda" (spec 0110 P4): the calendar's invitees become people. */
export function ImportPeopleSheet({
  open,
  onOpenChange,
  run,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  onImported: (result: { created: number; skipped: number }) => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`people.import.${key}`, options);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoaded(null);
    setError(null);
    setUnchecked(new Set());
    setSearch('');
    Promise.all([calendar.status(), voiceCuration.profiles()])
      .then(([snapshot, profiles]) => {
        if (!live) return;
        setLoaded({
          connected: !!snapshot.account,
          participants: calendarParticipants(
            snapshot,
            profiles.profiles.map((p) => p.name)
          ),
        });
      })
      .catch((failure) => live && setError(failure));
    return () => {
      live = false;
    };
  }, [open]);

  const participants = loaded?.participants ?? [];
  const needle = nameKey(search);
  const visible = useMemo(
    () =>
      needle
        ? participants.filter(
            (p) => nameKey(p.name).includes(needle) || !!p.email?.includes(needle)
          )
        : participants,
    [participants, needle]
  );
  const chosen = participants.filter((p) => !unchecked.has(p.key));

  function toggle(keys: string[], on: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      keys.forEach((key) => (on ? next.delete(key) : next.add(key)));
      return next;
    });
  }

  function submit() {
    if (busy || !chosen.length) return;
    setBusy(true);
    setError(null);
    run(async () => {
      const result = await library.importPeople(
        chosen.map((p) => p.name),
        k('consent')
      );
      onImported(result);
      onOpenChange(false);
    })
      .catch((failure) => setError(failure))
      .finally(() => setBusy(false));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={k('title')}
      description={k('description')}
      closeLabel={k('close')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} icon={<X size={14} aria-hidden="true" />}>
            {k('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !chosen.length}
            onClick={submit}
            icon={<CalendarPlus size={14} aria-hidden="true" />}
          >
            {k('submit', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!!error && <Alert tone="error">{voiceCurationErrorText(error, t)}</Alert>}
        {!loaded && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {k('loading')}
          </p>
        )}
        {loaded && !loaded.connected && <Alert tone="info">{k('noCalendar')}</Alert>}
        {loaded?.connected && participants.length === 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            {k('empty')}
          </p>
        )}
        {participants.length > 0 && (
          <>
            <Input
              aria-label={k('search')}
              placeholder={k('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className="text-primary-ink hover:underline"
                onClick={() =>
                  toggle(
                    visible.map((p) => p.key),
                    true
                  )
                }
              >
                {k('selectAll')}
              </button>
              <button
                type="button"
                className="text-primary-ink hover:underline"
                onClick={() =>
                  toggle(
                    visible.map((p) => p.key),
                    false
                  )
                }
              >
                {k('selectNone')}
              </button>
            </div>
            {visible.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {k('noMatch')}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {visible.map((p) => (
                  <li key={p.key}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={!unchecked.has(p.key)}
                        onChange={(e) => toggle([p.key], e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        {p.email && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.email}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {k('meetings', { count: p.meetings })}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
