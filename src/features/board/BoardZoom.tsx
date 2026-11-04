import { useTranslation } from 'react-i18next';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Panel, useReactFlow, useViewport } from '@xyflow/react';

const icon = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** Excalidraw's zoom island (spec 0112 P6): − 100% +, then fit. The percentage resets to 100%. */
export function BoardZoom() {
  const { t } = useTranslation();
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <Panel position="bottom-left" className="ws-island ws-zoom">
      <button
        type="button"
        className="ws-tool"
        aria-label={t('workspace.canvas.zoomOut')}
        title={t('workspace.canvas.zoomOut')}
        onClick={() => void flow.zoomOut({ duration: 120 })}
      >
        <Minus {...icon} />
      </button>
      <button
        type="button"
        className="ws-tool ws-zoom-level"
        aria-label={t('workspace.canvas.resetZoom')}
        title={t('workspace.canvas.resetZoom')}
        onClick={() => void flow.zoomTo(1, { duration: 120 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="ws-tool"
        aria-label={t('workspace.canvas.zoomIn')}
        title={t('workspace.canvas.zoomIn')}
        onClick={() => void flow.zoomIn({ duration: 120 })}
      >
        <Plus {...icon} />
      </button>
      <span className="ws-island-sep" aria-hidden="true" />
      <button
        type="button"
        className="ws-tool"
        aria-label={t('workspace.canvas.fitView')}
        title={t('workspace.canvas.fitView')}
        onClick={() => void flow.fitView({ maxZoom: 1, duration: 200 })}
      >
        <Maximize {...icon} />
      </button>
    </Panel>
  );
}
