import { useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Field, Input, Sheet, Textarea } from '../../components/ui';
import { library } from './library';
import { validVoiceOrigin } from './voiceCuration';
import { voiceCurationErrorText } from './voiceCurationError';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the creation inside the caller's lifecycle (refresh, curation revision). */
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  onCreated?: (id: string, name: string) => void;
  disabled?: boolean;
  /** Optional suggestions above the form; receives a setter for the name field. */
  suggestions?: (setName: (name: string) => void) => ReactNode;
};

/** Explicit person creation with separate consent (spec 0092), shared by People and review. */
export function PersonFormSheet({
  open,
  onOpenChange,
  run,
  onCreated,
  disabled = false,
  suggestions,
}: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const reasonId = useId();
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef(false);
  const invalidOrigin = !!origin.trim() && !validVoiceOrigin(origin);
  const reason = !name.trim()
    ? t('peopleDirectory.form.needName')
    : !origin.trim()
      ? t('peopleDirectory.form.needConsent')
      : invalidOrigin
        ? t('peopleDirectory.form.invalidConsent')
        : '';
  const blocked = disabled || busy || !!reason;

  function submit() {
    if (pending.current || blocked) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const personName = name.trim();
    run(async () => {
      const id = await library.createPerson(personName, origin.trim());
      onCreated?.(id, personName);
      setName('');
      setOrigin('');
      onOpenChange(false);
    })
      .catch((failure) => setError(failure))
      .finally(() => {
        pending.current = false;
        setBusy(false);
      });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('peopleDirectory.form.title')}
      description={t('peopleDirectory.form.description')}
      closeLabel={t('peopleDirectory.form.close')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('peopleDirectory.form.cancel')}</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={blocked}
            aria-describedby={reason ? reasonId : undefined}
          >
            {t('library.processing.createPerson')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {suggestions && (
          <section aria-label={t('peopleDirectory.form.agendaNames')} className="space-y-2">
            {suggestions(setName)}
          </section>
        )}
        {!!error && <Alert tone="error">{voiceCurationErrorText(error, t)}</Alert>}
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={disabled || busy} className="space-y-4">
            <legend className="sr-only">{t('peopleDirectory.form.title')}</legend>
            <Field
              label={t('library.processing.personName')}
              hint={t('peopleDirectory.form.nameHint')}
              required
            >
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field
              label={t('speakers.consentOrigin')}
              hint={t('speakers.consentHelp')}
              error={invalidOrigin ? t('peopleDirectory.form.invalidConsent') : undefined}
              required
            >
              <Textarea
                rows={3}
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              />
            </Field>
          </fieldset>
          {reason && (
            // The invalid-origin reason is already visible as the field error.
            <p
              id={reasonId}
              className={invalidOrigin ? 'sr-only' : 'text-xs text-muted-foreground'}
            >
              {reason}
            </p>
          )}
        </form>
      </div>
    </Sheet>
  );
}
