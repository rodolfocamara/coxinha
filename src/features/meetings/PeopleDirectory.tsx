import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../../components/ui';
import { library } from './library';
import { PersonFormSheet } from './PersonFormSheet';
import { voiceCurationErrorText } from './voiceCurationError';
import { PeopleBrowser } from '../people/PeopleBrowser';

/**
 * Pessoas (spec 0096 P6): the global local registry of people and voice
 * samples in the list + detail grammar. Mutations run one at a time through
 * `act`, then the browser remounts so every page reloads from a fresh view.
 */
export function PeopleDirectory() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ personId: string; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setVersion((value) => value + 1);
    } catch (failure) {
      setError(failure);
      throw failure;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!library.available()) {
    return (
      <section className="h-full overflow-auto p-6" aria-labelledby="people-heading">
        <h1 id="people-heading" className="mb-3 text-base font-semibold">
          {t('people.title')}
        </h1>
        <Alert tone="info">{t('library.desktopRequired')}</Alert>
      </section>
    );
  }
  const notices = (
    <div className="space-y-2 px-3.5 empty:hidden">
      {!!error && !adding && <Alert tone="error">{voiceCurationErrorText(error, t)}</Alert>}
      {created && (
        <Alert tone="success">
          <span role="status">{t('people.created', { name: created.name })}</span>
        </Alert>
      )}
    </div>
  );
  return (
    <section className="flex h-full min-h-0" aria-labelledby="people-heading">
      <PeopleBrowser
        key={version}
        version={version}
        disabled={busy}
        act={act}
        selected={selected}
        onSelect={setSelected}
        search={search}
        onSearch={setSearch}
        onAdd={() => setAdding(true)}
        created={created}
        notices={notices}
      />
      <PersonFormSheet
        open={adding}
        onOpenChange={setAdding}
        run={act}
        disabled={busy && !adding}
        onCreated={(personId, name) => {
          setCreated({ personId, name });
          setSelected(personId);
          setSearch('');
        }}
      />
    </section>
  );
}
