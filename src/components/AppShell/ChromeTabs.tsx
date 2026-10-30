import clsx from 'clsx';
import { FileText, Plus, X } from 'lucide-react';

export interface ChromeTab {
  id: string;
  label: string;
  active: boolean;
  onActivate?: () => void;
  onClose?: () => void;
}

interface Props {
  tabs: ChromeTab[];
  onNewTab?: () => void;
}

/** Real open-tab state supplied by callers; single routes use the chrome title. */
export function ChromeTabs({ tabs, onNewTab }: Props) {
  return (
    <div role="tablist" className="flex items-center gap-1 min-w-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.active}
          onClick={tab.onActivate}
          className={clsx(
            'group flex items-center gap-1.5 min-w-0 max-w-[220px] h-8 px-2 rounded-md text-sm transition-colors',
            tab.active
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
          )}
        >
          <FileText size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{tab.label}</span>
          {tab.onClose && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                tab.onClose?.();
              }}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0 rounded p-0.5 hover:bg-background/50"
            >
              <X size={12} aria-hidden="true" />
            </span>
          )}
        </button>
      ))}
      {onNewTab && (
        <button
          type="button"
          onClick={onNewTab}
          aria-label="New tab"
          className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 flex items-center justify-center transition-colors"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
