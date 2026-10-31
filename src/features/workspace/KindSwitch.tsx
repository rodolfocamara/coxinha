import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type Kind = 'text' | 'card';

/** Segmented "Nota | Atividade" with a sliding thumb; arrow keys move the choice. */
export function KindSwitch({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  const { t } = useTranslation();
  const thumb = useRef<HTMLSpanElement>(null);
  const buttons = useRef<Record<Kind, HTMLButtonElement | null>>({ text: null, card: null });
  useLayoutEffect(() => {
    const el = thumb.current;
    const target = buttons.current[value];
    if (!el || !target) return;
    el.style.width = `${target.offsetWidth}px`;
    el.style.transform = `translateX(${target.offsetLeft - 2}px)`;
    // Animate only changes, never the first placement.
    requestAnimationFrame(() => el.setAttribute('data-animate', 'true'));
  }, [value]);
  const option = (kind: Kind, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={value === kind}
      tabIndex={value === kind ? 0 : -1}
      ref={(el) => {
        buttons.current[kind] = el;
      }}
      className="ws-seg-option"
      onClick={() => value !== kind && onChange(kind)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const next: Kind = kind === 'text' ? 'card' : 'text';
        onChange(next);
        buttons.current[next]?.focus();
      }}
    >
      {label}
    </button>
  );
  return (
    <div className="ws-seg" role="radiogroup" aria-label={t('workspace.editor.kind')}>
      <span ref={thumb} className="ws-seg-thumb cx-indicator" aria-hidden="true" />
      {option('text', t('workspace.kind.note'))}
      {option('card', t('workspace.kind.activity'))}
    </div>
  );
}
