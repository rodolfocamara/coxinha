import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { matchChoices, resolveTyped, type Choice, type Pick } from './personChoices';
import { voiceField } from './voiceControls';

const MAX_SHOWN = 50;

/**
 * "Quem é?" (spec 0110 P1): a WAI-ARIA combobox over people and invitees
 * that also offers to create the typed name.
 */
export function PersonCombobox({
  label,
  choices,
  text,
  onText,
  onPick,
  onSubmit,
  disabled,
}: {
  label: string;
  choices: Choice[];
  text: string;
  onText: (text: string) => void;
  onPick: (pick: Pick) => void;
  /** Enter with the list closed. */
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = resolveTyped(choices, text);
  const options: Pick[] = [
    ...matchChoices(choices, text).slice(0, MAX_SHOWN),
    ...(typed?.kind === 'new' ? [typed] : []),
  ];
  const optionId = (index: number) => `${listId}-${index}`;
  function pick(option: Pick) {
    onPick(option);
    setOpen(false);
    setActive(-1);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) =>
        open ? (i + step + options.length) % options.length : step > 0 ? 0 : options.length - 1
      );
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        pick(options[active]);
      } else if (open && options.length === 1) {
        e.preventDefault();
        pick(options[0]);
      } else {
        setOpen(false);
        onSubmit?.();
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }
  const expanded = open && options.length > 0;
  return (
    <div className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        className={voiceField}
        placeholder={t('speakerNaming.placeholder')}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-card p-1 text-sm shadow-lg"
      >
        {expanded &&
          options.map((option, index) => (
            <li
              key={option.id}
              id={optionId(index)}
              data-value={option.id}
              role="option"
              aria-selected={index === active}
              className="flex cursor-pointer items-baseline gap-2 rounded px-2 py-1.5 aria-selected:bg-accent hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(option)}
            >
              {option.kind === 'new' ? (
                <>
                  <UserPlus size={13} aria-hidden="true" className="self-center text-primary-ink" />
                  <span>{t('speakerNaming.create', { name: option.label })}</span>
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate">{option.label}</span>
                  <OptionMeta option={option} />
                </>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

function OptionMeta({ option }: { option: Choice }) {
  const { t } = useTranslation();
  if (option.kind === 'person' && !option.invitee) return null;
  const email = option.kind === 'invitee' ? option.invitee.email : null;
  return (
    <span className="ml-auto shrink-0 text-xs text-muted-foreground" title={email ?? undefined}>
      {t('speakers.invitee')}
    </span>
  );
}
