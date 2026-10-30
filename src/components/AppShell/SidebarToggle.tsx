import { forwardRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const SidebarToggle = forwardRef<
  HTMLButtonElement,
  { expanded: boolean; onClick: () => void }
>(function SidebarToggle({ expanded, onClick }, ref) {
  const { t } = useTranslation();
  const label = t(expanded ? 'chrome.collapseSidebar' : 'chrome.expandSidebar');
  const Icon = expanded ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={expanded ? 'workspace-sidebar' : undefined}
      className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  );
});
