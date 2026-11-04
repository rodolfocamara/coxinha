import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import './propertySheet.css';

/** Spec 0126 P9: rows of label and value, under an optional group title. */
export function PropGroup({
  title,
  headingClassName = 'ch-peek-h',
  children,
  ...rest
}: {
  title?: string;
  headingClassName?: string;
  children: ReactNode;
} & ComponentProps<'section'>) {
  return (
    <section className="ch-prop-group" {...rest}>
      {title && <h3 className={headingClassName}>{title}</h3>}
      <dl className="ch-props">{children}</dl>
    </section>
  );
}

function Label({ icon: Icon, label, id }: { icon: LucideIcon; label: string; id?: string }) {
  return (
    <dt id={id}>
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
    </dt>
  );
}

export function PropRow({
  icon,
  label,
  children,
  action,
  quiet = false,
  title,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  action?: ReactNode;
  /** An answer that is absent or negative recedes; what exists keeps the ink. */
  quiet?: boolean;
  title?: string;
  tone?: string;
}) {
  return (
    <div className="ch-prop" data-tone={tone}>
      <Label icon={icon} label={label} />
      <dd className="ch-prop-value" data-quiet={quiet || undefined} title={title}>
        <span className="ch-prop-text">{children}</span>
        {action}
      </dd>
    </div>
  );
}

/** A value that opens what it counts, across both columns; collapsed until asked. */
export function PropDisclosure({
  icon,
  label,
  summary,
  children,
  action,
  quiet = false,
  title,
}: {
  icon: LucideIcon;
  label: string;
  summary: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  quiet?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="ch-prop">
      <Label icon={icon} label={label} id={`${id}-label`} />
      <dd className="ch-prop-value" data-quiet={quiet || undefined}>
        <button
          type="button"
          id={`${id}-toggle`}
          className="ch-prop-toggle"
          aria-expanded={open}
          aria-controls={`${id}-more`}
          aria-labelledby={`${id}-label ${id}-toggle`}
          title={title}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ch-prop-text">{summary}</span>
          <ChevronRight size={13} aria-hidden="true" />
        </button>
        {action}
      </dd>
      <dd id={`${id}-more`} className="ch-prop-more" hidden={!open}>
        {children}
      </dd>
    </div>
  );
}

/** A compact text action at the end of a row; `name` says in full what the short label does. */
export function PropAction({
  children,
  name,
  onClick,
}: {
  children: ReactNode;
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ch-peek-link ch-prop-action"
      aria-label={name}
      title={name}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PropDash() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t('meetingDetail.values.none')}</span>
    </>
  );
}
