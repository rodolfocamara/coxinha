import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { Alert, Button, PageHeader } from '../../components/ui';
import { library } from './library';
import { PersonFormSheet } from './PersonFormSheet';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import { voiceCurationErrorText } from './voiceCurationError';

export function PeopleDirectory() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState('');
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
  const available = library.available();
  const addPerson = (
    <Button
      variant="primary"
      icon={<UserPlus size={16} aria-hidden="true" />}
      aria-haspopup="dialog"
      onClick={() => setAdding(true)}
    >
      {t('peopleDirectory.addPerson')}
    </Button>
  );
  return (
    <section className="h-full overflow-auto bg-card" aria-labelledby="people-heading">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHeader
          titleId="people-heading"
          title={t('peopleDirectory.title')}
          description={t('peopleDirectory.description')}
          actions={available ? addPerson : undefined}
        />
        {!available ? (
          <Alert tone="info">{t('library.desktopRequired')}</Alert>
        ) : (
          <div className="space-y-4">
            {!!error && !adding && <Alert tone="error">{voiceCurationErrorText(error, t)}</Alert>}
            {!!created && (
              <Alert tone="success">{t('peopleDirectory.created', { name: created })}</Alert>
            )}
            <PersonFormSheet
              open={adding}
              onOpenChange={setAdding}
              run={act}
              disabled={busy && !adding}
              onCreated={(_id, name) => setCreated(name)}
            />
            <VoiceProfilesPanel
              key={version}
              standalone
              version={version}
              disabled={busy}
              act={act}
              onAddPerson={() => setAdding(true)}
            />
            <p className="text-xs text-muted-foreground">{t('peopleDirectory.training')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
