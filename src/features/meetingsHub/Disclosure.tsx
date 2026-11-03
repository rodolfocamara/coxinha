import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import './meetingPeople.css';

/** A button that shows its state, not a `<details>`: the state is asserted in tests. */
export function Disclosure({
  label,
  trailing,
  defaultOpen,
  children,
}: {
  label: ReactNode;
  /** Shown only while collapsed: what the hidden content holds. */
  trailing?: ReactNode;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="ch-disclosure">
      <button
        type="button"
        className="ch-disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={13} aria-hidden="true" />
        <span className="ch-disclosure-label">{label}</span>
        {!open && trailing}
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
