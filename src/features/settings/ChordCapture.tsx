import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { captureChord } from '../../lib/shortcuts';

/**
 * Takes the next chord pressed. Tab leaves, so the keyboard is never trapped,
 * and Escape cancels; every other key stays here, away from the app's shortcuts.
 */
export function ChordCapture({
  label,
  onChord,
  onCancel,
}: {
  label: string;
  onChord: (chord: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [problem, setProblem] = useState<'needsModifier' | 'unsupported' | null>(null);
  useEffect(() => button.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') return onCancel();
    const captured = captureChord(event.nativeEvent);
    if (captured.kind === 'chord') onChord(captured.chord);
    else if (captured.kind !== 'waiting') setProblem(captured.kind);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="cx-chord-capture"
        aria-label={label}
        onBlur={onCancel}
        onKeyDown={onKeyDown}
      >
        {t('shortcuts.settings.pressNow')}
      </button>
      <span role="status" className="text-xs text-muted-foreground">
        {problem && t(`shortcuts.settings.${problem}`)}
      </span>
    </>
  );
}
