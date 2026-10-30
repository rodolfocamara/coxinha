import { createContext, useContext, useId, type ReactNode } from 'react';
import './ui.css';

type FieldControl = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
};

const FieldContext = createContext<FieldControl | null>(null);

/** Props a control should spread so its Field's label, hint and error describe it. */
export function useFieldControl(): Partial<FieldControl> {
  return useContext(FieldContext) ?? {};
}

type Props = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/** Label above, hint and error below (DESIGN.md §4 Inputs). */
export function Field({ label, hint, error, required, className = '', children }: Props) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`cx-field ${className}`}>
      {/* The marker is CSS-only so the accessible name stays the plain label;
          `required` on the control carries the semantics. */}
      <label className="cx-field-label" htmlFor={id} data-required={required || undefined}>
        {label}
      </label>
      <FieldContext.Provider
        value={{
          id,
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
          required,
        }}
      >
        {children}
      </FieldContext.Provider>
      {hint && (
        <p id={hintId} className="cx-field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="cx-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
