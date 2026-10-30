import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import './ui.css';

type Tone = 'error' | 'warning' | 'info' | 'success';
const icons = { error: XCircle, warning: AlertTriangle, info: Info, success: CheckCircle2 };

type AlertProps = {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

/** Errors announce assertively; other tones are polite status. */
export function Alert({ tone = 'info', children, action, className = '' }: AlertProps) {
  const Icon = icons[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={`cx-alert ${className}`}
    >
      <Icon size={16} aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type EmptyProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, action, icon }: EmptyProps) {
  return (
    <div className="cx-empty">
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <p className="cx-empty-title">{title}</p>
      {description && <p className="cx-empty-description">{description}</p>}
      {action && <div className="cx-empty-action">{action}</div>}
    </div>
  );
}

type BadgeProps = {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  dot?: boolean;
  children: ReactNode;
};

export function Badge({ tone = 'neutral', dot = false, children }: BadgeProps) {
  return (
    <span data-tone={tone} className="cx-badge">
      {dot && <span className="cx-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
