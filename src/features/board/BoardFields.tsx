import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpToLine, X } from 'lucide-react';
import { Button, Field, Input, Select } from '../../components/ui';
import type { BoardItem, Color } from './model';

function NumberField({
  field,
  value,
  onChange,
}: {
  field: 'x' | 'y' | 'width' | 'height';
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [raw, setRaw] = useState(String(Math.round(value)));
  useEffect(() => setRaw(String(Math.round(value))), [value]);
  const min = field === 'width' ? 100 : field === 'height' ? 60 : -1000000;
  const number = Number(raw);
  const valid = raw.trim() !== '' && Number.isFinite(number) && number >= min && number <= 1000000;
  return (
    <label className="ws-number">
      <span>{t(`workspace.fields.${field}`)}</span>
      <input
        type="number"
        value={raw}
        min={min}
        max={1000000}
        aria-invalid={!valid}
        aria-describedby={!valid ? id : undefined}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const n = Number(next);
          if (next.trim() !== '' && Number.isFinite(n) && n >= min && n <= 1000000) onChange(n);
        }}
      />
      {!valid && (
        <span id={id} role="status" className="ws-number-error">
          {t('workspace.fields.numberRange', { min, max: 1000000 })}
        </span>
      )}
    </label>
  );
}

/** Area name and colour. */
export function AreaFields({
  item,
  patch,
}: {
  item: BoardItem;
  patch: (values: Partial<BoardItem>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ws-props-stack">
      <Field
        label={t('workspace.fields.label')}
        hint={item.label.length >= 1000 ? t('workspace.fields.labelLimit') : undefined}
      >
        <Input
          value={item.label}
          maxLength={1000}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </Field>
      <Field label={t('workspace.fields.color')}>
        <Select
          block
          size="sm"
          value={item.color}
          onChange={(e) => patch({ color: e.target.value as Color })}
        >
          {(['neutral', 'orange', 'green', 'blue', 'purple'] as const).map((c) => (
            <option key={c} value={c}>
              {t(`workspace.colors.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** Layer order, exact geometry and "Tirar do quadro" (the note file stays). */
export function LayoutFields({
  item,
  patch,
  layer,
  remove,
}: {
  item: BoardItem;
  patch: (values: Partial<BoardItem>) => void;
  layer: (direction: 'front' | 'back') => void;
  remove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <details className="ws-more">
      <summary>{t('workspace.fields.geometry')}</summary>
      <div className="ws-more-body">
        <div className="ws-geometry">
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <NumberField
              key={`${item.id}-${field}`}
              field={field}
              value={item[field]}
              onChange={(value) => patch({ [field]: value })}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="xs"
            icon={<ArrowUpToLine size={12} aria-hidden="true" />}
            onClick={() => layer('front')}
          >
            {t('workspace.fields.front')}
          </Button>
          <Button
            size="xs"
            icon={<ArrowDownToLine size={12} aria-hidden="true" />}
            onClick={() => layer('back')}
          >
            {t('workspace.fields.back')}
          </Button>
          <Button
            size="xs"
            variant="danger"
            icon={<X size={12} aria-hidden="true" />}
            onClick={remove}
          >
            {t(item.kind === 'area' ? 'workspace.fields.removeArea' : 'workspace.fields.remove')}
          </Button>
        </div>
      </div>
    </details>
  );
}
