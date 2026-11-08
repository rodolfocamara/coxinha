import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Globe2, Plus, Tag, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../components/ui';
import { MAX_LABEL, MAX_ZONES, useTimeZones } from '../meetingsHub/timeZones';
import { searchZones, type ZoneOption } from '../meetingsHub/zoneCatalog';
import { SettingsCard, SettingsRow, SettingsSection } from './controls';
import { DirectoryPhotosRow } from './DirectoryPhotosRow';

/** Agenda: extra time zones in the week gutter (spec 0119 P4), and invitees' photos (spec 0117). */
export function CalendarSection() {
  const { t, i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? 'en';
  const s = (key: string, options?: Record<string, unknown>) =>
    t(`people.settings.zones.${key}`, options);
  const { zones, add, remove, move, relabel, localLabel, setLocalLabel } = useTimeZones();
  const [query, setQuery] = useState('');
  const full = zones.length >= MAX_ZONES;
  const options = full
    ? []
    : searchZones(
        query,
        locale,
        zones.map((z) => z.id)
      );

  const pick = (option: ZoneOption) => {
    if (add(option.id, option.label)) setQuery('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (options[0]) pick(options[0]);
  };
  const place = (option: ZoneOption) =>
    option.country ? `${option.country} · ${option.city}` : option.id;

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
                    const name = zone.id;
                    return (
                      <li key={zone.id} className="cx-zone-item">
                        <Input
                          size="sm"
                          value={zone.label}
                          maxLength={MAX_LABEL}
                          aria-label={s('labelFor', { name: zone.id })}
                          onChange={(e) => relabel(zone.id, e.target.value)}
                          className="w-16"
                        />
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
              <form className="cx-zone-form" onSubmit={submit}>
                <Input
                  size="sm"
                  value={query}
                  placeholder={s('placeholder')}
                  aria-label={s('search')}
                  disabled={full}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-w-0 flex-1"
                />
              </form>
              {options.length > 0 && (
                <ul aria-label={s('results')} className="cx-zone-results">
                  {options.map((option) => (
                    <li key={option.id}>
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<Plus size={13} aria-hidden="true" />}
                        aria-label={s('pick', { name: place(option) })}
                        onClick={() => pick(option)}
                      >
                        {place(option)}
                        <span className="text-muted-foreground tabular-nums">
                          {new Date().toLocaleTimeString(locale, {
                            timeZone: option.id,
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {!full && query.trim().length >= 2 && options.length === 0 && (
                <p role="status" className="text-xs text-muted-foreground">
                  {s('noResults')}
                </p>
              )}
              {full && <p className="text-xs text-muted-foreground">{s('full')}</p>}
            </>
          }
        />
        <DirectoryPhotosRow />
      </SettingsCard>
    </SettingsSection>
  );
}
