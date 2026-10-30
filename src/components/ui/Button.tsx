import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  /** Leading icon; for `iconOnly` buttons pass an `aria-label`. */
  icon?: ReactNode;
  iconOnly?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconOnly = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      className={`cx-btn ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
