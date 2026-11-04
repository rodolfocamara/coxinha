import type { HTMLAttributes, ReactNode } from 'react';
import './ui.css';

type Section = HTMLAttributes<HTMLElement> & { children?: ReactNode };

export function Card({ className = '', children, ...rest }: Section) {
  return (
    <section className={`cx-card ${className}`} {...rest}>
      {children}
    </section>
  );
}

type HeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading id, so the Card can be `aria-labelledby` it. */
  titleId?: string;
  level?: 2 | 3;
};

export function CardHeader({ title, description, actions, titleId, level = 2 }: HeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className="cx-card-header">
      <div className="min-w-0">
        <Heading id={titleId} className="cx-card-title">
          {title}
        </Heading>
        {description && <p className="cx-card-description">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({
  className = '',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`cx-card-body ${className}`}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <footer className="cx-card-footer">{children}</footer>;
}

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
};

/** One per route: the view title, its purpose and the region's primary actions. */
export function PageHeader({ title, description, actions, titleId }: PageHeaderProps) {
  return (
    <header className="cx-page-header">
      <div className="min-w-0">
        <h1 id={titleId} className="cx-page-title">
          {title}
        </h1>
        {description && <p className="cx-page-description">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
