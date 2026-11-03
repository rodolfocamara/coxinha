import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Globe2, Plus, Tag, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../components/ui';
import { MAX_LABEL, MAX_ZONES, useTimeZones } from '../meetingsHub/timeZones';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';

const ZONE_LIST = 'settings-time-zone-list';

function knownZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

/** Agenda: extra time zones in the week gutter, like Outlook's (spec 0119 P4). */
export function CalendarSection() {
  const { t } = useTranslation();
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`people.settings.zones.${key}`, options);
  const { zones, add, remove, move, localLabel, setLocalLabel } = useTimeZones();
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(false);
  const full = zones.length >= MAX_ZONES;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!add(id, label)) return setError(true);
    setError(false);
    setId('');
    setLabel('');
  };

  return (
    <SettingsSection
      id="calendar"
      headingId="calendar-heading"
      title={t('people.settings.sections.calendar')}
      description={t('people.settings.descriptions.calendar')}
    >
      <SettingsCard>
        <SettingsRow
          name="local-zone"
          icon={Tag}
          title={s('localTitle')}
          description={s('localHint')}
          control={
            <Input
              size="sm"
              value={localLabel}
              maxLength={MAX_LABEL}
              aria-labelledby="local-zone-title"
              aria-describedby="local-zone-desc"
              onChange={(e) => setLocalLabel(e.target.value)}
              className="w-24"
            />
          }
        />
        <SettingsRow
          name="time-zones"
          icon={Globe2}
          title={s('title')}
          description={s('hint', { count: MAX_ZONES })}
          below={
            <>
              {zones.length > 0 && (
                <ol aria-labelledby="time-zones-title" className="cx-zone-list">
                  {zones.map((zone, index) => {
                    const name = zone.label || zone.id;
                    return (
                      <li key={zone.id} className="cx-zone-item">
                        {zone.label && <b>{zone.label}</b>}
                        <span className="font-mono text-muted-foreground">{zone.id}</span>
                        <span className="ml-auto flex gap-1">
                          <Button
                            size="xs"
                            variant="ghost"
                            iconOnly
                            icon={<ArrowUp size={13} aria-hidden="true" />}
                            aria-label={s('up', { name })}
                            disabled={index === 0}
                            onClick={() => move(zone.id, -1)}
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            iconOnly
                            icon={<ArrowDown size={13} aria-hidden="true" />}
                            aria-label={s('down', { name })}
                            disabled={index === zones.length - 1}
                            onClick={() => move(zone.id, 1)}
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            iconOnly
                            icon={<X size={13} aria-hidden="true" />}
                            aria-label={s('remove', { name })}
                            onClick={() => remove(zone.id)}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
              <form className="cx-zone-form" onSubmit={submit} aria-label={s('addLabel')}>
                <Input
                  size="sm"
                  value={id}
                  list={ZONE_LIST}
                  placeholder={s('placeholder')}
                  aria-label={s('zone')}
                  aria-invalid={error || undefined}
                  disabled={full}
                  onChange={(e) => {
                    setId(e.target.value);
                    setError(false);
                  }}
                  className="min-w-0 flex-1 font-mono"
                />
                <Input
                  size="sm"
                  value={label}
                  maxLength={MAX_LABEL}
                  aria-label={s('label')}
                  disabled={full}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-24"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={full || !id.trim()}
                  icon={<Plus size={13} aria-hidden="true" />}
                >
                  {s('add')}
                </Button>
                <datalist id={ZONE_LIST}>
                  {knownZones().map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
              </form>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {s('invalid')}
                </p>
              )}
              {full && <p className="text-xs text-muted-foreground">{s('full')}</p>}
            </>
          }
        />
      </SettingsCard>
    </SettingsSection>
  );
}
