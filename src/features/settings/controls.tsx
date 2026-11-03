import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SECTION_ICONS } from './icons';
import './settings.css';

/** A titled group of setting cards; `id` is the deep-link target (`/settings#<id>`). */
export function SettingsSection({
  id,
  headingId,
  title,
  description,
  children,
}: {
  id: string;
  /** Kept equal to the pre-0096 heading ids so old deep links still land here. */
  headingId: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const Icon = SECTION_ICONS[id];
  return (
    <section id={id} data-settings-section aria-labelledby={headingId} className="mb-[1.375rem]">
      <h2
        id={headingId}
        className="flex items-center gap-2 text-[0.9375rem] font-semibold outline-none"
      >
        {Icon && <Icon size={16} aria-hidden="true" className="text-primary-ink" />}
        {title}
      </h2>
      {description && <p className="mt-0.5 mb-2.5 text-muted-foreground">{description}</p>}
      {children}
    </section>
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
  const Title = heading ? 'h3' : 'p';
  return (
    <div className="cx-settings-row">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,16.875rem)] items-center gap-4 px-4 py-[0.8125rem] @max-[38rem]:grid-cols-1 @max-[38rem]:gap-2">
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
        <div className="flex min-w-0 items-center justify-end gap-2 @max-[38rem]:justify-start">
          {control}
        </div>
      </div>
      {below && <div className="space-y-2 px-4 pb-[0.8125rem]">{below}</div>}
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
