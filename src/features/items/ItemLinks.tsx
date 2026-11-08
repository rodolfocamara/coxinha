import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { CalendarDays, Link2, SquareCheck, X } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui';
import { commands } from '../../lib/bindings';
import { sessions } from '../sessions/sessions';
import { normalize } from '../meetingsHub/meetingRows';
import { errorText, links, type ItemLink } from './items';

type Side = { side: 'meeting'; sessionId: string } | { side: 'activity'; noteId: string };
type Candidate = { id: string; title: string; detail: string };

/** Meeting notes and daily notes are not activities to link. */
const isActivityNote = (path: string) => !path.startsWith('daily/') && !/session-/.test(path);

async function candidates(side: Side['side'], locale: string): Promise<Candidate[]> {
  if (side === 'meeting') {
    const result = await commands.listNotes();
    if (result.status === 'error') throw new Error(String(result.error));
    return result.data
      .filter((note) => isActivityNote(note.path))
      .map((note) => ({ id: note.id, title: note.title, detail: '' }));
  }
  const list = await sessions.list();
  return list.map((session) => {
    const when = session.starts_at ?? session.created_at;
    return {
      id: session.id,
      title: session.title,
      detail: when
        ? new Date(when).toLocaleDateString(locale, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '',
    };
  });
}

/**
 * Links between a meeting and activities (spec 0105 P5). One record per pair,
 * read from both ends: the meeting inspector lists activities, the activity
 * editor lists meetings.
 */
export function ItemLinks(props: Side & { headingClassName?: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const navigate = useNavigate();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`items.links.${props.side}.${key}`, options);
  const own = props.side === 'meeting' ? props.sessionId : props.noteId;
  const [linked, setLinked] = useState<ItemLink[]>([]);
  const [pool, setPool] = useState<Candidate[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const searchId = useId();

  useEffect(() => {
    let current = true;
    const load = props.side === 'meeting' ? links.ofSession(own) : links.ofNote(own);
    Promise.all([load, candidates(props.side, locale)])
      .then(([rows, items]) => {
        if (!current) return;
        setLinked(rows);
        setPool(items);
      })
      .catch((e) => current && setError(errorText(e)));
    return () => {
      current = false;
    };
  }, [props.side, own, locale]);

  const otherOf = (link: ItemLink) => (props.side === 'meeting' ? link.note : link.session);
  const pair = (other: string) =>
    props.side === 'meeting' ? ([own, other] as const) : ([other, own] as const);
  const change = async (other: string, add: boolean) => {
    setError('');
    try {
      const [session, note] = pair(other);
      await (add ? links.add(session, note) : links.remove(session, note));
      setLinked(await (props.side === 'meeting' ? links.ofSession(own) : links.ofNote(own)));
      if (add) {
        setPicking(false);
        setQuery('');
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const go = (other: string) =>
    void (props.side === 'meeting'
      ? navigate({ to: '/workspace/$noteId', params: { noteId: other } })
      : navigate({ to: '/meetings/$sessionId', params: { sessionId: other } }));

  const taken = new Set(linked.map(otherOf));
  const q = normalize(query);
  const results = pool
    .filter((c) => !taken.has(c.id) && (!q || normalize(`${c.title} ${c.detail}`).includes(q)))
    .slice(0, 8);
  const Icon = props.side === 'meeting' ? SquareCheck : CalendarDays;

  return (
    <div>
      <h3 className={props.headingClassName ?? 'text-sm font-medium'}>{k('title')}</h3>
      {error && <Alert tone="error">{error}</Alert>}
      {linked.length === 0 ? (
        <p className="text-muted-foreground">{k('empty')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1" aria-label={k('title')}>
          {linked.map((link) => {
            const other = otherOf(link);
            const found = pool.find((c) => c.id === other);
            const name = found?.title || k('missing');
            return (
              <li
                key={other}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-1 text-xs"
              >
                <Icon size={12} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                <button
                  type="button"
                  className="truncate hover:underline disabled:opacity-60"
                  disabled={!found}
                  onClick={() => go(other)}
                >
                  {name}
                </button>
                <button
                  type="button"
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary"
                  aria-label={k('unlink', { name })}
                  title={k('unlink', { name })}
                  onClick={() => void change(other, false)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        size="xs"
        variant="ghost"
        className="mt-1 -ml-2"
        icon={<Link2 size={13} aria-hidden="true" />}
        aria-expanded={picking}
        onClick={() => setPicking((v) => !v)}
      >
        {k('link')}
      </Button>
      {picking && (
        <div className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-1">
          <label htmlFor={searchId} className="sr-only">
            {k('search')}
          </label>
          <Input
            id={searchId}
            size="sm"
            type="search"
            autoFocus
            value={query}
            placeholder={k('search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">{k('noResults')}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)]" aria-label={k('results')}>
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-secondary"
                    onClick={() => void change(c.id, true)}
                  >
                    <span className="truncate">{c.title || k('untitled')}</span>{' '}
                    {c.detail && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {c.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
