import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PenLine } from 'lucide-react';
import { Alert, Button, Field, Input } from '../../components/ui';
import { sessions, type Session } from '../sessions/sessions';
import { claimTitleMorph } from './meetingsSheets';
import { TitleSuggestionNote } from '../live/TitleSuggestionNote';

/**
 * Meeting title with explicit rename (sessions only). Rename opens only from
 * the icon button; Escape cancels without writing; a failed save keeps the draft.
 */
export function MeetingHeading({
  title,
  session,
  refresh,
  actions,
}: {
  title: string;
  session: Session | null;
  refresh: () => Promise<unknown>;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const k = (key: string) => t(`meetingsHub.${key}`);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const rename = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => claimTitleMorph(heading.current), []);
  useLayoutEffect(() => {
    if (draft === null && restoreFocus.current) {
      rename.current?.focus();
      restoreFocus.current = false;
    }
  }, [draft]);
  const close = () => {
    restoreFocus.current = true;
    setDraft(null);
    setFailed(false);
  };
  return (
    <>
      <div className="mh-dh-top">
        <h2 ref={heading} className="mh-title" id="meeting-title">
          {title || k('untitled')}
        </h2>
        {session && draft === null && (
          <Button
            ref={rename}
            variant="ghost"
            size="sm"
            iconOnly
            icon={<PenLine size={15} aria-hidden="true" />}
            aria-label={k('rename')}
            title={k('rename')}
            onClick={() => {
              setDraft(session.title);
              setFailed(false);
            }}
          />
        )}
        {session?.meeting_id && draft === null && (
          <TitleSuggestionNote meetingId={session.meeting_id} title={title} />
        )}
        <span className="flex-1" />
        {actions}
      </div>
      {session && draft !== null && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !saving) {
              e.preventDefault();
              close();
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (saving || !draft.trim()) return;
            setSaving(true);
            setFailed(false);
            try {
              await sessions.update(session.id, {
                title: draft.trim(),
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
          <Field label={k('titleLabel')} className="min-w-0 flex-1">
            <Input
              autoFocus
              value={draft}
              maxLength={500}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={saving || !draft.trim()}>
            {k('save')}
          </Button>
          <Button variant="ghost" disabled={saving} onClick={close}>
            {k('cancel')}
          </Button>
          {failed && (
            <Alert tone="error" className="basis-full">
              {k('renameFailed')}
            </Alert>
          )}
        </form>
      )}
    </>
  );
}
