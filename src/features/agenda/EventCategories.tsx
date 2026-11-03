import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plug, Tag } from 'lucide-react';
import { Button } from '../../components/ui';
import type { CalendarEvent } from './calendar';
import {
  changeEventCategories,
  colourVar,
  presetOf,
  useEventCategories,
  useOutlookCategories,
} from './categories';
import './categories.css';

type Props = {
  event: CalendarEvent;
  /** Opens the Outlook connection, where Reconnect grants the new scopes. */
  onReconnect: () => void;
  headingClassName?: string;
};

/** Inspector section: the event's Outlook categories and, with write access, a picker. */
export function EventCategories({ event, onReconnect, headingClassName }: Props) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`outlookCategories.${key}`, options);
  const access = useOutlookCategories((s) => s.access);
  const master = useOutlookCategories((s) => s.master);
  const names = useEventCategories(event);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const listId = useId();
  if (!access) return null;
  const selected = (name: string) =>
    names.some((n) => n.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
  const toggle = (name: string) => {
    setError('');
    const next = selected(name)
      ? names.filter((n) => n.localeCompare(name, undefined, { sensitivity: 'accent' }) !== 0)
      : [...names, name];
    changeEventCategories(event.id, next).catch((e: unknown) => {
      const code = e instanceof Error ? e.message : String(e);
      setError(t(code.startsWith('calendar.') ? code : 'calendar.failed'));
    });
  };
  const reconnect = (
    <Button
      variant="ghost"
      size="xs"
      icon={<Plug size={13} aria-hidden="true" />}
      onClick={onReconnect}
    >
      {k('reconnect')}
    </Button>
  );
  return (
    <div>
      <h3 className={headingClassName}>
        {k('title')}
        {access.read && access.write && master.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            icon={<Tag size={13} aria-hidden="true" />}
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? k('done') : k('change')}
          </Button>
        )}
      </h3>
      {!access.read ? (
        <div className="flex flex-col items-start gap-1">
          <p className="text-muted-foreground">{k('needsReconnect')}</p>
          {reconnect}
        </div>
      ) : (
        <>
          {names.length === 0 ? (
            <p className="text-muted-foreground">{k('none')}</p>
          ) : (
            <ul className="cx-cat-chips" aria-label={k('current')}>
              {names.map((name) => {
                const preset = presetOf(name, master);
                return (
                  <li key={name} className="cx-cat-chip">
                    <span
                      className="cx-cat-dot"
                      aria-hidden="true"
                      style={preset === null ? undefined : { background: colourVar(preset) }}
                    />
                    {name}
                  </li>
                );
              })}
            </ul>
          )}
          {!access.write && (
            <div className="mt-1.5 flex flex-col items-start gap-1">
              <p className="text-muted-foreground">{k('needsWrite')}</p>
              {reconnect}
            </div>
          )}
          {open && access.write && (
            <div id={listId} role="group" aria-label={k('pick')} className="cx-cat-options">
              {master.map((category) => {
                const on = selected(category.name);
                return (
                  <button
                    key={category.name}
                    type="button"
                    className="cx-cat-option"
                    aria-pressed={on}
                    onClick={() => toggle(category.name)}
                  >
                    <span
                      className="cx-cat-dot"
                      aria-hidden="true"
                      style={
                        category.preset === null
                          ? undefined
                          : { background: colourVar(category.preset) }
                      }
                    />
                    <span className="truncate">{category.name}</span>
                    {on && <Check size={13} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
