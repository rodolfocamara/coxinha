import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { commands, type Note } from '../../lib/bindings';

type State = { kind: 'loading' } | { kind: 'ready'; backlinks: Note[] } | { kind: 'error' };

interface Props {
  noteId: string;
}

export function BacklinksPanel({ noteId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    commands
      .getBacklinks(noteId)
      .then((r) => {
        if (cancelled) return;
        if (r.status === 'error') {
          setState({ kind: 'error' });
        } else {
          setState({ kind: 'ready', backlinks: r.data });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  return (
    <aside
      aria-label={t('backlinks.region')}
      className="w-64 shrink-0 border-l border-border overflow-auto p-3 bg-muted/30"
    >
      <h2 className="text-xs uppercase text-muted-foreground mb-2">{t('backlinks.heading')}</h2>

      {state.kind === 'loading' && (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {t('backlinks.loading')}
        </p>
      )}

      {state.kind === 'error' && (
        <p role="alert" className="text-xs text-destructive">
          {t('backlinks.unavailable')}
        </p>
      )}

      {state.kind === 'ready' && state.backlinks.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('backlinks.empty')}</p>
      )}

      {state.kind === 'ready' && state.backlinks.length > 0 && (
        <ul className="space-y-0.5">
          {state.backlinks.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => navigate({ to: '/notes/$noteId', params: { noteId: b.id } })}
                className="w-full text-left px-2 py-1 rounded text-sm truncate hover:bg-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {b.title || t('sidebar.untitled')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
