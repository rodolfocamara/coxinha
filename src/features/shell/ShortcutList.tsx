import { useTranslation } from 'react-i18next';
import type { ShortcutAction } from '../../lib/bindings';
import {
  formatChord,
  SHORTCUTS,
  useSystemChords,
  chordOf,
  type ShortcutEntry,
  type ShortcutScope,
} from '../../lib/shortcuts';
import './shortcuts.css';

const entriesOf = (scope: ShortcutScope): readonly ShortcutEntry[] =>
  SHORTCUTS.filter((entry): boolean => entry.scope === scope && !('listed' in entry));

const isAction = (id: string) => id.replace('system.', '') as ShortcutAction;

/** The table, read aloud: one group per scope, in the order given. */
export function ShortcutList({
  scopes,
  headingLevel = 3,
}: {
  scopes: readonly ShortcutScope[];
  headingLevel?: 2 | 3;
}) {
  const { t } = useTranslation();
  const report = useSystemChords((state) => state.report);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const keysOf = (entry: ShortcutEntry) =>
    entry.scope === 'system'
      ? [formatChord(chordOf(report, isAction(entry.id)))]
      : entry.keys.map((key) => formatChord(key));
  return (
    <div className="cx-shortcut-groups">
      {scopes.map((scope) => (
        <section
          key={scope}
          aria-labelledby={`shortcut-scope-${scope}`}
          data-shortcut-scope={scope}
        >
          <Heading id={`shortcut-scope-${scope}`} className="cx-settings-group-title">
            {t(`shortcuts.scopes.${scope}`)}
          </Heading>
          <ul className="cx-shortcut-list">
            {entriesOf(scope).map((entry) => (
              <li key={entry.id} className="cx-shortcut-row" data-shortcut={entry.id}>
                <span className="min-w-0">{t(entry.label)}</span>
                <span className="cx-shortcut-keys">
                  {keysOf(entry).map((key) => (
                    <kbd key={key} className="cx-kbd">
                      {key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
