import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';

import { useHome } from './fixtures';

export function HomePanel() {
  const { t } = useTranslation();
  const home = useHome();

  return (
    <div className="p-4 flex flex-col gap-6">
      <section>
        <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">
          {t('sidePanel.messages.title')}
        </h4>
        <ul className="flex flex-col gap-2">
          {home.messages.map((m) => (
            <li key={m.id}>
              <Link
                to={m.href}
                className="flex items-start gap-2 p-2 -mx-2 rounded-md hover:bg-secondary/60 transition-colors"
              >
                <Mail
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 text-muted-foreground shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium truncate">{m.fromName}</p>
                  <p className="text-[12px] text-muted-foreground truncate">{m.subject}</p>
                  <p className="text-[12px] text-muted-foreground/80 truncate">{m.excerpt}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">
          {t('sidePanel.news.title')}
        </h4>
        <ul className="flex flex-col gap-1">
          {home.news.map((n) => (
            <li
              key={n.id}
              className={
                'text-[13px] rounded-md px-2 py-1 ' +
                (n.highlighted ? 'text-foreground' : 'text-muted-foreground')
              }
              style={n.highlighted ? { backgroundColor: 'oklch(var(--accent) / 0.16)' } : undefined}
            >
              {n.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
