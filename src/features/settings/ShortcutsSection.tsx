import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppWindow,
  CalendarDays,
  CircleDot,
  FilePlus,
  ListVideo,
  type LucideIcon,
} from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import type { AppConfig, ShortcutAction, ShortcutFailure } from '../../lib/bindings';
import {
  defaultChord,
  formatChord,
  loadSystemChords,
  rebindSystemChord,
  shortcutEntry,
  SHORTCUTS,
  systemShortcutId,
  useSystemChords,
} from '../../lib/shortcuts';
import { ShortcutList } from '../shell/ShortcutList';
import { ChordCapture } from './ChordCapture';
import { SettingsCard, SettingsGroup, SettingsRow, SettingsSection } from './controls';

// Display order matches the user's mental model (create → navigate → record),
// not the struct field order.
const ROWS: ReadonlyArray<[ShortcutAction, LucideIcon]> = [
  ['new_note', FilePlus],
  ['open_app', AppWindow],
  ['agenda', CalendarDays],
  ['meetings', ListVideo],
  ['toggle_recording', CircleDot],
];

const IN_APP = [...new Set(SHORTCUTS.map((entry) => entry.scope))].filter(
  (scope) => scope !== 'system'
);

type Refusal = { chord: string; failure: ShortcutFailure; detail: string | null; kept: string };

function SystemChordRow({
  action,
  icon,
  fallback,
}: {
  action: ShortcutAction;
  icon: LucideIcon;
  fallback?: string;
}) {
  const { t, i18n } = useTranslation();
  const status = useSystemChords((state) =>
    state.report?.statuses.find((item) => item.action === action)
  );
  const fallbackDefault = defaultChord(action);
  const chord = status?.chord ?? (fallback || fallbackDefault);
  const title = t(shortcutEntry(systemShortcutId(action)).label);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const changeButton = useRef<HTMLButtonElement>(null);

  const failureText = (failure: ShortcutFailure, of: string, other?: string | null) =>
    t(`shortcuts.settings.failure.${failure}`, {
      chord: formatChord(of),
      other: other ? t(shortcutEntry(systemShortcutId(other as ShortcutAction)).label) : '',
    });

  async function apply(next: string) {
    setCapturing(false);
    setBusy(true);
    setRefusal(null);
    try {
      const change = await rebindSystemChord(action, next);
      if (!change.ok && change.failure)
        setRefusal({ chord: next, failure: change.failure, detail: change.detail, kept: chord });
    } catch {
      setRefusal({ chord: next, failure: 'failed', detail: null, kept: chord });
    } finally {
      setBusy(false);
      requestAnimationFrame(() => changeButton.current?.focus());
    }
  }

  const received = status
    ? status.lastFiredMs
      ? t('shortcuts.settings.received', {
          time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(
            status.lastFiredMs
          ),
        })
      : t('shortcuts.settings.notReceived')
    : undefined;
  const startupFailure = status?.failure && !refusal;
  const below =
    refusal || startupFailure || status?.conflict ? (
      <>
        {refusal && (
          <Alert tone="error">
            {failureText(
              refusal.failure,
              refusal.chord,
              refusal.failure === 'duplicate' ? refusal.detail : null
            )}{' '}
            {t('shortcuts.settings.kept', { chord: formatChord(refusal.kept) })}
          </Alert>
        )}
        {startupFailure && (
          <Alert tone="error">
            {t('shortcuts.settings.inactive', { chord: formatChord(chord) })}{' '}
            {failureText(status.failure!, chord)}
          </Alert>
        )}
        {status?.conflict && (
          <Alert tone="warning">
            {t('shortcuts.settings.conflict', {
              chord: formatChord(chord),
              owner: status.conflict,
            })}
          </Alert>
        )}
      </>
    ) : undefined;

  return (
    <SettingsRow
      name={`shortcut-${action}`}
      icon={icon}
      title={title}
      description={received}
      below={below}
      control={
        capturing ? (
          <ChordCapture
            label={t('shortcuts.settings.captureLabel', { action: title })}
            onChord={(next) => void apply(next)}
            onCancel={() => {
              setCapturing(false);
              requestAnimationFrame(() => changeButton.current?.focus());
            }}
          />
        ) : (
          <>
            <kbd className="cx-kbd">{formatChord(chord)}</kbd>
            <Button
              ref={changeButton}
              size="sm"
              disabled={busy}
              aria-label={t('shortcuts.settings.changeLabel', { action: title })}
              onClick={() => {
                setRefusal(null);
                setCapturing(true);
              }}
            >
              {t('shortcuts.settings.change')}
            </Button>
            {chord !== fallbackDefault && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('shortcuts.settings.resetLabel', { action: title })}
                onClick={() => void apply(fallbackDefault)}
              >
                {t('shortcuts.settings.reset')}
              </Button>
            )}
          </>
        )
      }
    />
  );
}

/** Atalhos (spec 0128 P4, P6): the chords that can change, then everything else. */
export function ShortcutsSection({ shortcuts }: { shortcuts: AppConfig['shortcuts'] }) {
  const { t } = useTranslation();
  const wayland = useSystemChords((state) => state.report?.wayland ?? false);
  useEffect(() => {
    const refresh = () => void loadSystemChords(true);
    refresh();
    // A chord tested from another window comes back through here.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  return (
    <SettingsSection
      id="shortcuts"
      headingId="shortcuts-heading"
      title={t('people.settings.sections.shortcuts')}
      description={t('people.settings.descriptions.shortcuts')}
    >
      <SettingsGroup
        title={t('shortcuts.settings.system')}
        note={wayland ? t('shortcuts.settings.wayland') : t('shortcuts.settings.note')}
      >
        {ROWS.map(([action, icon]) => (
          <SystemChordRow key={action} action={action} icon={icon} fallback={shortcuts?.[action]} />
        ))}
      </SettingsGroup>
      <div>
        <h2
          id="shortcuts-all-heading"
          tabIndex={-1}
          className="cx-settings-group-title outline-none"
        >
          {t('shortcuts.settings.all')}
        </h2>
        <SettingsCard>
          <div className="px-4 py-3">
            <ShortcutList scopes={IN_APP} />
          </div>
        </SettingsCard>
      </div>
    </SettingsSection>
  );
}
