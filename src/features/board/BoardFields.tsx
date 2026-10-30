import { Select } from '../../components/ui/Select';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('board');
  const id = useId();
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);
  const min = field === 'width' ? 100 : field === 'height' ? 60 : -1000000;
  const number = Number(raw);
  const valid = raw.trim() !== '' && Number.isFinite(number) && number >= min && number <= 1000000;
  return (
    <label>
      {t(field)}
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
        <span id={id} role="status">
          {t('numberRange', { min, max: 1000000 })}
        </span>
      )}
    </label>
  );
}
export function BoardFields({
  item,
  patch,
  open,
  canOpen,
  remove,
  layer,
}: {
  item: BoardItem;
  patch: (values: Partial<BoardItem>) => void;
  open: () => void;
  canOpen: boolean;
  remove: () => void;
  layer: (direction: 'front' | 'back') => void;
}) {
  const { t } = useTranslation('board');
  return (
    <fieldset aria-label={t('selection')}>
      {item.kind === 'area' ? (
        <label>
          {t('label')}
          <input
            value={item.label}
            maxLength={1000}
            onChange={(e) => patch({ label: e.target.value })}
          />
          {item.label.length >= 1000 && <span role="status">{t('labelLimit')}</span>}
        </label>
      ) : (
        <button disabled={!canOpen} onClick={open}>
          {t('open')}
        </button>
      )}
      {item.kind === 'area' ? (
        <label>
          {t('color')}
          <Select
            aria-label={t('color')}
            value={item.color}
            onChange={(e) => patch({ color: e.target.value as Color })}
          >
            {(['neutral', 'orange', 'green', 'blue', 'purple'] as const).map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </Select>
        </label>
      ) : item.kind === 'card' ? (
        <label>
          {t('progress')}
          <input
            type="number"
            min={0}
            max={100}
            step={5}
            value={item.progress ?? 0}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              if (Number.isInteger(n) && n >= 0 && n <= 100) patch({ progress: n });
            }}
          />
        </label>
      ) : null}
      <div className="board-layer-actions">
        <button onClick={() => layer('front')}>{t('front')}</button>
        <button onClick={() => layer('back')}>{t('back')}</button>
      </div>
      <details className="board-geometry">
        <summary>{t('geometry')}</summary>
        <div className="board-geometry-grid">
          {(['x', 'y', 'width', 'height'] as const).map((field) => (
            <NumberField
              key={`${item.id}-${field}`}
              field={field}
              value={item[field]}
              onChange={(value) => patch({ [field]: value })}
            />
          ))}
        </div>
      </details>
      <button className="board-remove" onClick={remove}>
        {t('remove')}
      </button>
    </fieldset>
  );
}
