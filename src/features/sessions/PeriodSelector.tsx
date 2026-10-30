import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { Button, Field, Input, Select } from '../../components/ui';
import { customRange, parseCivilDate, type Period, type PeriodKind } from './sessionDates';

/**
 * Period preset plus an inline custom-range editor. In the toolbar (not compact)
 * the root uses `display: contents`, so the select joins the parent filter row and
 * the editor wraps onto its own bottom-aligned row (`order-last basis-full`).
 */
export function PeriodSelector({
  period,
  onChange,
  label,
  compact = false,
}: {
  period: Period;
  onChange: (period: Period) => void;
  label: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(period.start ?? '');
  const [end, setEnd] = useState(period.end ?? '');
  const [error, setError] = useState(false);
  useEffect(() => {
    setEditing(false);
    setError(false);
    setStart(period.start ?? '');
    setEnd(period.end ?? '');
  }, [period.kind, period.start, period.end]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const applied = t('sessionCalendar.appliedPeriod', {
    period: t(`sessionCalendar.period.${period.kind}`),
    start: parseCivilDate(period.start ?? '')?.toLocaleDateString(locale) ?? '',
    end: parseCivilDate(period.end ?? '')?.toLocaleDateString(locale) ?? '',
  });
  const invalid = error
    ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` }
    : { 'aria-invalid': undefined, 'aria-describedby': undefined };
  function cancel() {
    setEditing(false);
    setError(false);
    setStart(period.start ?? '');
    setEnd(period.end ?? '');
  }
  return (
    <div className={compact ? 'space-y-3 px-2' : 'contents'}>
      <Field label={label} className={compact ? '' : 'min-w-44'}>
        <Select
          block
          size={compact ? 'sm' : 'md'}
          value={editing ? 'custom' : period.kind}
          onChange={(e) => {
            const kind = e.target.value as PeriodKind;
            setError(false);
            setEditing(kind === 'custom');
            if (kind === 'custom') {
              setStart(period.start ?? '');
              setEnd(period.end ?? '');
            } else onChange({ kind });
          }}
        >
          {(['all', 'today', 'week', 'month', 'last30', 'custom'] as const).map((kind) => (
            <option key={kind} value={kind}>
              {t(`sessionCalendar.period.${kind}`)}
            </option>
          ))}
        </Select>
      </Field>
      {period.kind === 'custom' && !editing && (
        <Button
          variant="ghost"
          size={compact ? 'sm' : 'md'}
          icon={<Pencil size={14} aria-hidden="true" />}
          onClick={() => setEditing(true)}
        >
          {applied}
        </Button>
      )}
      {editing && (
        <form
          className={compact ? 'space-y-2' : 'order-last basis-full space-y-2'}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!customRange(start, end)) {
              setError(true);
              return;
            }
            onChange({ kind: 'custom', start, end });
            setError(false);
            setEditing(false);
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('sessionCalendar.from')} className="w-40">
              <Input
                type="date"
                size="sm"
                min="0001-01-01"
                max="9999-12-31"
                value={start}
                {...invalid}
                onChange={(e) => setStart(e.target.value)}
              />
            </Field>
            <Field label={t('sessionCalendar.through')} className="w-40">
              <Input
                type="date"
                size="sm"
                min="0001-01-01"
                max="9999-12-31"
                value={end}
                {...invalid}
                onChange={(e) => setEnd(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" type="submit">
                {t('sessionCalendar.apply')}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancel}>
                {t('sessionCalendar.cancel')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{applied}</p>
          {error && (
            <p id={`${id}-error`} role="alert" className="cx-field-error">
              {t('sessionCalendar.invalidRange')}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
