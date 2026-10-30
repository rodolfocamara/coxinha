import { ReactNode } from 'react';
import { Link, useMatchRoute } from '@tanstack/react-router';
import clsx from 'clsx';

interface Props {
  icon?: ReactNode;
  label: string;
  to?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Force-override active state (fixture-rendered previews). */
  active?: boolean;
}

export function RailItem({ icon, label, to, onClick, trailing, active }: Props) {
  const matchRoute = useMatchRoute();
  const matched =
    active ??
    (to
      ? to === '/'
        ? matchRoute({ to: '/', fuzzy: false }) !== false
        : matchRoute({ to, fuzzy: true }) !== false
      : false);

  const classes = clsx(
    'flex items-center gap-2 w-full min-w-0 shrink-0 h-9 px-2 rounded-md text-[13px] transition-colors truncate focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring',
    matched
      ? 'bg-secondary text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
  );

  const content = (
    <>
      {icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>}
      <span className="truncate flex-1 text-left">{label}</span>
      {trailing && <span className="shrink-0 ml-auto">{trailing}</span>}
    </>
  );

  if (to && !onClick) {
    return (
      <Link to={to} className={classes} aria-current={matched ? 'page' : undefined}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={classes}
      aria-current={matched ? 'page' : undefined}
    >
      {content}
    </button>
  );
}
