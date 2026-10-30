import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, PenLine } from 'lucide-react';
import { sessions, type Session } from './sessions';
import { Alert, Button, ButtonLink, Field, Input } from '../../components/ui';

export function SessionHeading({
  session,
  refresh,
}: {
  session: Session;
  refresh: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const rename = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (title === null && restoreFocus.current) {
      rename.current?.focus();
      restoreFocus.current = false;
    }
  }, [title]);
  function close() {
    restoreFocus.current = true;
    setTitle(null);
    setFailed(false);
  }
  return (
    <header className="space-y-2">
      <div className="flex items-start gap-2">
        <h1 className="cx-page-title break-words min-w-0">{session.title}</h1>
        <Button
          ref={rename}
          variant="ghost"
          size="sm"
          iconOnly
          icon={<PenLine size={15} aria-hidden="true" />}
          className="shrink-0"
          aria-label={t('session.rename')}
          title={t('session.rename')}
          onClick={() => {
            setTitle(session.title);
            setFailed(false);
          }}
          hidden={title !== null}
        />
      </div>
      {title !== null && (
        <form
          className="flex flex-wrap items-end gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !saving) {
              e.preventDefault();
              close();
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving || !title.trim()) return;
            setSaving(true);
            setFailed(false);
            try {
              await sessions.update(session.id, {
                title: title.trim(),
                starts_at: session.starts_at,
                ends_at: session.ends_at,
                status: session.status,
              });
              await refresh();
              close();
            } catch {
              setFailed(true);
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label={t('session.title')} className="min-w-0 flex-1">
            <Input
              autoFocus
              value={title}
              maxLength={500}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={saving || !title.trim()}>
            {t('session.saveTitle')}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={close}>
            {t('session.cancelRename')}
          </Button>
          {failed && (
            <Alert tone="error" className="basis-full">
              {t('session.updateFailed')}
            </Alert>
          )}
        </form>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <p>
          {session.starts_at
            ? new Date(session.starts_at).toLocaleString(i18n?.resolvedLanguage ?? i18n?.language)
            : t('session.noDate')}{' '}
          · {t(`session.state.${session.status}`)}
        </p>
        <ButtonLink
          to="/agenda"
          variant="ghost"
          size="sm"
          icon={<CalendarDays size={14} aria-hidden="true" />}
        >
          {t('session.agendaUtility')}
        </ButtonLink>
      </div>
    </header>
  );
}
