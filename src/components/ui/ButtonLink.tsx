import type { ComponentProps, ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { ButtonVariant } from './Button';
import './ui.css';

type Props = Omit<ComponentProps<typeof Link>, 'children' | 'params'> & {
  /** Route params; `ComponentProps` loses Link's route generics, so they are untyped here. */
  params?: Record<string, string>;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  children?: ReactNode;
};

/** Route navigation with link semantics and the shared button look (spec 0095). */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  params,
  ...rest
}: Props) {
  return (
    <Link
      data-variant={variant}
      data-size={size}
      className={`cx-btn ${className}`}
      params={params as never}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}
