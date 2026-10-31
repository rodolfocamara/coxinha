import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { Alert, Button, EmptyState } from '../../components/ui';
import { voiceCuration } from '../meetings/voiceCuration';
import { library } from '../meetings/library';
import { useVoiceInventoryPages } from '../meetings/useVoiceInventoryPages';
import { voiceCurationErrorText } from '../meetings/voiceCurationError';
import { useSessions, type Session } from '../sessions/sessions';
import { prepareRouteTransition } from '../../lib/motion';
import { PeopleList } from './PeopleList';
import { PersonDetail, type PersonSummary } from './PersonDetail';

type Props = {
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  selected: string | null;
  onSelect: (personId: string | null) => void;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  /** Just-created person, shown before its profile page is loaded. */
  created: { personId: string; name: string } | null;
  notices: React.ReactNode;
};

/**
 * List + detail for the voice registry. Remounted after each mutation (key =
 * version) so pages reload fresh; selection and search live in the parent.
 */
export function PeopleBrowser({
  version,
  disabled,
  act,
  selected,
  onSelect,
  search,
  onSearch,
  onAdd,
  created,
  notices,
}: Props) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<Record<string, PersonSummary>>({});
  const query = useVoiceInventoryPages(
    true,
    'profiles',
    version,
    async (cursor) => {
      const page = await voiceCuration.profilesPage(cursor);
      return { ...page, items: page.profiles };
    },
    (person) => person.personId
  );
  const sessions = useSessions();
  const sessionsByMeeting = useMemo(() => {
    const map = new Map<string, Session>();
    for (const session of sessions.data ?? [])
      if (session.meeting_id) map.set(session.meeting_id, session);
    return map;
  }, [sessions.data]);

  const [recordingTitles, setRecordingTitles] = useState(() => new Map<string, string>());
  useEffect(() => {
    let alive = true;
    library
      .list()
      .then((list) => alive && setRecordingTitles(new Map(list.map((m) => [m.id, m.title]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Backend totals win over the partial counts a loaded detail page reports.
  const rowSummaries = useMemo(() => {
    const merged = { ...summaries };
    for (const person of query.items)
      if (typeof person.activeSamples === 'number')
        merged[person.personId] = {
          active: person.activeSamples,
          more: false,
          meetings: person.sampleMeetings ?? 0,
        };
    return merged;
  }, [summaries, query.items]);

  const needle = search.trim().toLocaleLowerCase();
  const visible = query.items.filter((person) => person.name.toLocaleLowerCase().includes(needle));
  const person =
    query.items.find((item) => item.personId === selected) ??
    (created && created.personId === selected ? created : null);

  // List + detail: open the first person when nothing (valid) is selected.
  useEffect(() => {
    if (query.loaded && !person && visible.length > 0) onSelect(visible[0].personId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.loaded, person, visible[0]?.personId]);

  const empty = query.loaded && query.items.length === 0 && !query.more;

  const footer = (
    <div className="space-y-2 px-3.5 py-3">
      {query.loading && (
        <p role="status" className="text-ui text-muted-foreground">
          {k('loading')}
        </p>
      )}
      {query.stale && (
        <Alert
          tone="warning"
          action={
            <Button size="sm" disabled={disabled || query.loading} onClick={query.restart}>
              {t('people.restart')}
            </Button>
          }
        >
          {k('staleView')}
        </Alert>
      )}
      {!!query.error && !query.stale && (
        <Alert
          tone="error"
          action={
            <Button size="sm" disabled={query.loading} onClick={query.restart}>
              {t('people.retry')}
            </Button>
          }
        >
          {voiceCurationErrorText(query.error, t)}
        </Alert>
      )}
      {needle && query.loaded && visible.length === 0 && (
        <p role="status" className="text-ui text-muted-foreground">
          {t('people.noMatch')}
        </p>
      )}
      {query.more && (
        <Button
          size="sm"
          disabled={disabled || query.loading || query.stale}
          onClick={query.loadMore}
        >
          {t('people.loadMore')}
        </Button>
      )}
      {query.loaded && query.items.length > 0 && (
        <p role="status" className="text-[11px] text-muted-foreground">
          {t(`voiceCuration.${query.more ? 'peopleLoadedPartial' : 'peopleLoadedComplete'}`, {
            count: query.items.length,
          })}
        </p>
      )}
    </div>
  );

  return (
    <>
      <PeopleList
        people={visible}
        selected={person?.personId ?? null}
        onSelect={onSelect}
        summaries={rowSummaries}
        search={search}
        onSearch={onSearch}
        onAdd={onAdd}
        onRefresh={query.restart}
        refreshing={disabled || query.loading}
        footer={footer}
        notices={notices}
      />
      {person ? (
        <PersonDetail
          key={person.personId}
          person={person}
          generation={query.generation}
          onStale={query.invalidate}
          version={version}
          disabled={disabled || query.stale}
          act={act}
          onSummary={(id, summary) => setSummaries((all) => ({ ...all, [id]: summary }))}
          sessionsByMeeting={sessionsByMeeting}
          recordingTitles={recordingTitles}
          onOpenMeeting={(sessionId) =>
            void navigate({
              to: '/meetings/$sessionId',
              params: { sessionId },
              viewTransition: prepareRouteTransition('nav'),
            })
          }
        />
      ) : (
        <div className="grid min-w-0 flex-1 place-items-center p-6">
          {empty ? (
            <div role="status">
              <EmptyState
                title={t('peopleDirectory.empty.title')}
                description={t('peopleDirectory.empty.description')}
                action={
                  <Button
                    variant="primary"
                    icon={<UserPlus size={16} aria-hidden="true" />}
                    onClick={onAdd}
                  >
                    {t('peopleDirectory.addPerson')}
                  </Button>
                }
              />
            </div>
          ) : (
            query.loaded && (
              <p className="text-ui text-muted-foreground">{t('people.detail.pick')}</p>
            )
          )}
        </div>
      )}
    </>
  );
}
