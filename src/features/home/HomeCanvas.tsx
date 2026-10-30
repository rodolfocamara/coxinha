import { Calendar, FileText, Mail, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from '@tanstack/react-router';

import { useHome, type ThingCard, type ThingCardKind } from './fixtures';

export function HomeCanvas() {
  const { t } = useTranslation();
  const home = useHome();
  const greeting = pickGreeting(t);
  const dateLabel = formatTodayLabel(home.todayIso);

  return (
    <section className="h-full overflow-auto">
      <div className="mx-auto max-w-[960px] px-6 sm:px-12 lg:px-20 pt-12 pb-10">
        <h1 className="text-4xl lg:text-[44px] leading-[1.15] font-semibold tracking-tight">
          {greeting} {home.userFirstName}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {dateLabel} · {t('home.thingsToday.title', { count: home.thingsToday.length })}
        </p>

        <div className="mt-8 flex flex-col gap-2">
          {home.thingsToday.length === 0 ? (
            <p className="text-muted-foreground">{t('home.thingsToday.empty')}</p>
          ) : (
            home.thingsToday.map((card) => <Card key={card.id} card={card} />)
          )}
        </div>

        <h2 className="mt-10 mb-3 text-[11px] uppercase tracking-wider text-muted-foreground/70">
          {t('home.recents.continue')}
        </h2>
        <ul className="flex flex-col">
          {home.recents.map((r) => (
            <li key={r.id}>
              <Link
                to={r.href}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0 hover:bg-secondary/30 transition-colors rounded-sm -mx-2 px-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FileText
                    size={14}
                    aria-hidden="true"
                    className="text-muted-foreground shrink-0"
                  />
                  <span className="truncate">{r.title}</span>
                </span>
                <span className="text-xs text-muted-foreground shrink-0">{r.updatedAtLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Card({ card }: { card: ThingCard }) {
  const navigate = useNavigate();
  return (
    <article
      onClick={() => navigate({ to: card.href })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate({ to: card.href });
        }
      }}
      role="button"
      tabIndex={0}
      className={
        'flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-secondary/60 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        (card.accent ? 'ring-1 ring-primary/40' : '')
      }
    >
      <div
        className="w-9 h-9 rounded-md shrink-0 flex items-center justify-center"
        style={{
          backgroundColor:
            card.kind === 'agent-output' ? 'oklch(var(--accent))' : 'oklch(var(--bg-surface-2))',
          color:
            card.kind === 'agent-output'
              ? 'oklch(var(--fg-on-accent))'
              : 'oklch(var(--fg-primary))',
        }}
        aria-hidden="true"
      >
        <ThingIcon kind={card.kind} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-medium truncate">{card.title}</h3>
        <p className="text-[13px] text-muted-foreground truncate">{card.subtitle}</p>
      </div>
    </article>
  );
}

function ThingIcon({ kind }: { kind: ThingCardKind }) {
  if (kind === 'meeting') return <Calendar size={16} aria-hidden="true" />;
  if (kind === 'email') return <Mail size={16} aria-hidden="true" />;
  return <Sparkles size={16} aria-hidden="true" />;
}

function pickGreeting(t: (key: string) => string): string {
  const h = new Date().getHours();
  if (h < 12) return t('home.greeting.morning');
  if (h < 18) return t('home.greeting.afternoon');
  return t('home.greeting.evening');
}

function formatTodayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}
