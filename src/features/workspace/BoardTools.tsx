import { useTranslation } from 'react-i18next';
import { Frame, SquareCheckBig, StickyNote } from 'lucide-react';
import { shortcutAria, shortcutHint, useShortcut } from '../../lib/shortcuts';
import type { Workspace } from './useWorkspace';

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const;

/**
 * Excalidraw's tool island at the top of the canvas (spec 0112 P6): icon
 * buttons with their number key in the corner. 1 note, 2 activity, 3 area.
 */
export function BoardTools({ ws }: { ws: Workspace }) {
  const { t } = useTranslation();
  const busy = !ws.board || ws.creating === 'busy';
  const tools = [
    {
      id: 'board.newNote',
      label: t('workspace.toolbar.note'),
      icon: <StickyNote {...icon} />,
      run: () => ws.createNote(),
      disabled: busy,
    },
    {
      id: 'board.newActivity',
      label: t('workspace.toolbar.activity'),
      icon: <SquareCheckBig {...icon} />,
      run: ws.createActivity,
      disabled: busy,
    },
    {
      id: 'board.newArea',
      label: t('workspace.toolbar.area'),
      icon: <Frame {...icon} />,
      run: ws.addArea,
      disabled: !ws.board,
    },
  ] as const;
  useShortcut('board.newNote', () => tools[0].run(), { enabled: !tools[0].disabled });
  useShortcut('board.newActivity', () => tools[1].run(), { enabled: !tools[1].disabled });
  useShortcut('board.newArea', () => tools[2].run(), { enabled: !tools[2].disabled });
  return (
    <div className="ws-island ws-tools" role="toolbar" aria-label={t('workspace.toolbar.tools')}>
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="ws-tool"
          aria-label={tool.label}
          aria-keyshortcuts={shortcutAria(tool.id)}
          title={`${tool.label} · ${shortcutHint(tool.id)}`}
          disabled={tool.disabled}
          onClick={tool.run}
        >
          {tool.icon}
          <kbd aria-hidden="true">{shortcutHint(tool.id)}</kbd>
        </button>
      ))}
    </div>
  );
}
