import { useLayoutEffect, useRef, type ReactNode } from 'react';

type Tab<T extends string> = { id: T; label: ReactNode };

/**
 * ARIA tablist with roving focus (Arrow, Home, End) and a sliding underline.
 * Panels use `${idPrefix}-panel-${id}`; tabs `${idPrefix}-tab-${id}`.
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className = '',
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  idPrefix: string;
  className?: string;
}) {
  const buttons = useRef<Partial<Record<string, HTMLButtonElement | null>>>({});
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = indicator.current;
    const target = buttons.current[value];
    if (!el || !target) return;
    el.dataset.animate = String(placed.current);
    el.style.width = `${target.offsetWidth}px`;
    el.style.transform = `translateX(${target.offsetLeft}px)`;
    placed.current = true;
  });
  return (
    <div role="tablist" aria-label={label} className={`mh-tabs ${className}`}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttons.current[tab.id] = el;
          }}
          id={`${idPrefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={value === tab.id ? 0 : -1}
          className="mh-tab"
          onClick={() => value !== tab.id && onChange(tab.id)}
          onKeyDown={(e) => {
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? tabs.length - 1
                  : e.key === 'ArrowRight'
                    ? (i + 1) % tabs.length
                    : e.key === 'ArrowLeft'
                      ? (i + tabs.length - 1) % tabs.length
                      : null;
            if (next === null) return;
            e.preventDefault();
            onChange(tabs[next].id);
            buttons.current[tabs[next].id]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
      <span ref={indicator} aria-hidden="true" className="cx-indicator mh-tab-indicator" />
    </div>
  );
}
