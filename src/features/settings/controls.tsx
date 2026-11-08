import { createContext, useContext, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SettingsSectionId } from './settingsIndex';
import './settings.css';

/** The page on screen; null outside the layout, where a section always shows. */
export const ActiveSettingsPage = createContext<SettingsSectionId | null>(null);

/** One settings page: title, one line of description, and its own scroll (spec 0129 P1). */
export function SettingsSection({
  id,
  headingId,
  title,
  description,
  children,
}: {
  id: SettingsSectionId;
  headingId: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const active = useContext(ActiveSettingsPage);
  return (
    <section
      id={id}
      data-settings-section
      aria-labelledby={headingId}
      hidden={active !== null && active !== id}
      className="cx-settings-page"
    >
      <div className="@container cx-settings-page-body">
        <header>
          <h1 id={headingId} tabIndex={-1} className="cx-settings-page-title">
            {title}
          </h1>
          {description && <p className="mt-0.5 text-muted-foreground">{description}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}

/** A card of rows, under a title where one helps, with a note under it where one is needed. */
export function SettingsGroup({
  title,
  note,
  children,
}: {
  title?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      {title && <h2 className="cx-settings-group-title">{title}</h2>}
      <SettingsCard>{children}</SettingsCard>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return <div className="cx-glass overflow-hidden rounded-[14px]">{children}</div>;
}

/**
 * One setting: title and a one-line description on the left, the control on
 * the right. Controls label themselves with `${name}-title` / `${name}-desc`.
 * `below` renders full width under the row (alerts, results, details).
 */
export function SettingsRow({
  name,
  title,
  description,
  control,
  below,
  titleId,
  heading = false,
  icon: Icon,
}: {
  name: string;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  below?: ReactNode;
  /** Override the title id (legacy deep-link anchors such as `rebuild-heading`). */
  titleId?: string;
  /** Render the title as a heading (deep-link targets inside a section). */
  heading?: boolean;
  /** Leading glyph that names the setting at a glance. */
  icon?: LucideIcon;
}) {
  const Title = heading ? 'h2' : 'p';
  return (
    <div className="cx-settings-row">
      <div className="cx-settings-row-grid items-center gap-4 px-4 py-[0.8125rem]">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <span className="cx-settings-row-icon" aria-hidden="true">
              <Icon size={15} />
            </span>
          )}
          <div className="min-w-0">
            <Title id={titleId ?? `${name}-title`} className="font-medium outline-none">
              {title}
            </Title>
            {description && (
              <p id={`${name}-desc`} className="text-xs break-words text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        <div data-settings-control className="flex min-w-0 items-center gap-2">
          {control}
        </div>
      </div>
      {below && <div className="cx-settings-row-below space-y-2">{below}</div>}
    </div>
  );
}

/** On/off switch over a native checkbox (keyboard, forms and screen readers for free). */
export function Switch({
  checked,
  onChange,
  name,
  disabled,
  labelledBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  name: string;
  disabled?: boolean;
  /** Title id when the row overrides it (legacy anchors). */
  labelledBy?: string;
}) {
  return (
    <label className="cx-switch">
      <input
        type="checkbox"
        className="cx-switch-input"
        checked={checked}
        disabled={disabled}
        aria-labelledby={labelledBy ?? `${name}-title`}
        aria-describedby={`${name}-desc`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cx-switch-track" aria-hidden="true" />
    </label>
  );
}

/** Equal-width segmented radio group with a sliding thumb (transform only). */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${name}-title`}
      aria-describedby={`${name}-desc`}
      className="cx-segmented"
      style={{ '--count': options.length, '--index': index } as React.CSSProperties}
    >
      <span className="cx-segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <label key={option.value} className="cx-segmented-option" data-on={option.value === value}>
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
