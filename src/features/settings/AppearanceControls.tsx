import { useRef, type CSSProperties } from 'react';
import { Check, Pipette, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '../../components/ui';
import {
  ACCENT_PRESETS,
  isHexColour,
  type AccentPreset,
  type Appearance,
} from '../../lib/appearance';
import { contrastRatio, oklchToHex, token } from '../../lib/appearance/color';
import { accentTokens, presetColour } from '../../lib/appearance/tokens';
import { useResolvedTheme } from '../../lib/useTheme';

/** A native range (arrows, Home, End and screen readers for free) with its value and reset. */
export function SliderControl({
  name,
  min,
  max,
  step,
  value,
  fallback,
  format,
  resetLabel,
  onChange,
  onReset,
}: {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  fallback: number;
  format: (value: number) => string;
  resetLabel: string;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className="cx-slider">
      <input
        ref={input}
        type="range"
        className="cx-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-labelledby={`${name}-title`}
        aria-describedby={`${name}-desc`}
        aria-valuetext={format(value)}
        style={{ '--progress': `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="cx-slider-value" aria-hidden="true">
        {format(value)}
      </output>
      <button
        type="button"
        className="cx-slider-reset"
        aria-label={resetLabel}
        title={resetLabel}
        hidden={value === fallback}
        onClick={() => {
          onChange(fallback);
          onReset();
          // The button goes idle under the keyboard; carry on from the slider.
          input.current?.focus();
        }}
      >
        <RotateCcw size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Presets and "custom" as one radio group, each swatch painted as this theme draws it. */
export function AccentPicker({
  look,
  onChange,
  onAnnounce,
}: {
  look: Appearance;
  onChange: (next: Partial<Appearance>) => void;
  onAnnounce: (message: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const label = (preset: AccentPreset | 'custom') => t(`people.settings.accent.${preset}`);
  const pick = (accent: Appearance['accent']) => {
    onChange({ accent });
    onAnnounce(t('people.settings.accent.chosen', { name: label(accent) }));
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby="accent-title"
      aria-describedby="accent-desc"
      className="cx-swatches"
    >
      {ACCENT_PRESETS.map((preset) => (
        <label
          key={preset}
          className="cx-swatch"
          title={label(preset)}
          style={{ '--swatch': `oklch(${token(presetColour(preset, theme))})` } as CSSProperties}
        >
          <input
            type="radio"
            className="sr-only"
            name="accent"
            aria-label={label(preset)}
            checked={look.accent === preset}
            onChange={() => pick(preset)}
          />
          {look.accent === preset && <Check size={13} aria-hidden="true" />}
        </label>
      ))}
      <label className="cx-swatch" data-custom title={label('custom')}>
        <input
          type="radio"
          className="sr-only"
          name="accent"
          aria-label={label('custom')}
          checked={look.accent === 'custom'}
          onChange={() => pick('custom')}
        />
        <Pipette size={13} aria-hidden="true" />
      </label>
    </div>
  );
}

/**
 * What the chosen accent looks like as a button and how readable it is, and for
 * a custom colour, the colour itself. The ratio is computed, never assumed.
 */
export function AccentDetails({
  look,
  onChange,
}: {
  look: Appearance;
  onChange: (next: Partial<Appearance>) => void;
}) {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const tokens = accentTokens(look, theme);
  const ratio = contrastRatio(tokens.accent, tokens.onAccent);
  const custom = look.accent === 'custom';
  const onDark = tokens.onAccent.l < tokens.accent.l;
  return (
    <div className="cx-accent-details">
      {custom && (
        <>
          <input
            type="color"
            className="cx-color-input"
            aria-label={t('people.settings.accent.picker')}
            value={look.customAccent}
            onChange={(event) => onChange({ customAccent: event.target.value })}
          />
          <Input
            key={look.customAccent}
            size="sm"
            className="w-[6.5rem]"
            aria-label={t('people.settings.accent.hex')}
            spellCheck={false}
            defaultValue={look.customAccent}
            onChange={(event) => {
              const value = event.target.value.trim();
              if (isHexColour(value)) onChange({ customAccent: value });
            }}
          />
        </>
      )}
      <span
        className="cx-accent-sample"
        style={{ background: oklchToHex(tokens.accent), color: oklchToHex(tokens.onAccent) }}
      >
        {t('people.settings.accent.sample')}
      </span>
      <span role="status" className="text-xs text-muted-foreground">
        {t('people.settings.accent.readable', {
          ratio: ratio.toFixed(1),
          ink: t(`people.settings.accent.${onDark ? 'darkText' : 'lightText'}`),
        })}
        {tokens.adjusted && ` ${t('people.settings.accent.adjusted')}`}
      </span>
    </div>
  );
}
