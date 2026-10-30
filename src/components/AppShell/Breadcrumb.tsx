interface Props {
  trail: string[];
}

export function Breadcrumb({ trail }: Props) {
  if (trail.length === 0) return null;
  return (
    <nav className="flex items-center gap-1.5 text-sm min-w-0 text-muted-foreground">
      {trail.map((seg, i) => {
        const isLast = i === trail.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-muted-foreground/60">/</span>}
            <span className={isLast ? 'truncate text-foreground' : 'truncate'} title={seg}>
              {seg}
            </span>
          </span>
        );
      })}
    </nav>
  );
}
