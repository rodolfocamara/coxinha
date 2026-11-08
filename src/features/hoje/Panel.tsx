import type { ReactNode } from 'react';
import { ChevronRight, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';

type Props = {
  id: string;
  title: ReactNode;
  span: 3 | 4 | 6 | 8;
  /** Extra header content between the title and the action (pill, total). */
  extra?: ReactNode;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
};

/** A glass panel on the Hoje grid; the title labels the region. */
export function Panel({ id, title, span, extra, action, children }: Props) {
  return (
    <section className="cx-glass cx-hoje-panel" data-span={span} aria-labelledby={id}>
      <h2 className="cx-hoje-panel-head">
        <span id={id}>{title}</span>
        {extra}
        {action && (
          <Button
            variant="ghost"
            size="xs"
            className="cx-hoje-panel-action"
            onClick={action.onClick}
          >
            {action.label}
            <ChevronRight size={13} aria-hidden="true" />
          </Button>
        )}
      </h2>
      {children}
    </section>
  );
}

/** Load failure inside one panel; the rest of the page keeps working. */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="cx-hoje-error">
      <span>{message}</span>
      <Button size="xs" icon={<RotateCw size={12} aria-hidden="true" />} onClick={onRetry}>
        {t('hoje.retry')}
      </Button>
    </div>
  );
}

export function PanelEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="cx-hoje-empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function PanelLoading() {
  const { t } = useTranslation();
  return (
    <p className="cx-hoje-empty" role="status">
      {t('hoje.loading')}
    </p>
  );
}
