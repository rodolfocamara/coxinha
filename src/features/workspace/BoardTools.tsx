import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Frame, SquareCheckBig, StickyNote } from 'lucide-react';
import type { Workspace } from './useWorkspace';

const icon = { size: 18, strokeWidth: 1.5, 'aria-hidden': true } as const;

function typing(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')
  );
}

/**
 * Excalidraw's tool island at the top of the canvas (spec 0112 P6): icon
 * buttons with their number key in the corner. 1 note, 2 activity, 3 area.
 */
export function BoardTools({ ws }: { ws: Workspace }) {
  const { t } = useTranslation();
  const busy = !ws.board || ws.creating === 'busy';
  const tools = [
    {
      key: '1',
      label: t('workspace.toolbar.note'),
      icon: <StickyNote {...icon} />,
      run: () => ws.createNote(),
      disabled: busy,
    },
    {
      key: '2',
      label: t('workspace.toolbar.activity'),
      icon: <SquareCheckBig {...icon} />,
      run: ws.createActivity,
      disabled: busy,
    },
    {
      key: '3',
      label: t('workspace.toolbar.area'),
      icon: <Frame {...icon} />,
      run: ws.addArea,
      disabled: !ws.board,
    },
  ];
  const latest = { tools };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (typing(event.target)) return;
      const tool = latest.tools.find((x) => x.key === event.key);
      if (!tool || tool.disabled) return;
      event.preventDefault();
      tool.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="ws-island ws-tools" role="toolbar" aria-label={t('workspace.toolbar.tools')}>
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          className="ws-tool"
          aria-label={tool.label}
          aria-keyshortcuts={tool.key}
          title={`${tool.label} · ${tool.key}`}
          disabled={tool.disabled}
          onClick={tool.run}
        >
          {tool.icon}
          <kbd aria-hidden="true">{tool.key}</kbd>
        </button>
      ))}
    </div>
  );
}
