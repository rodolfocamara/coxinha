import { useState } from 'react';
import { Star, Share2, Link as LinkIcon, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AppShell, SavedIndicator, type ChromeTab } from '../components/AppShell';
import { MeetingCard } from '../features/meetings/MeetingCard';

/**
 * Dev-only route exercising the new AppShell primitives on
 * synthetic fixture data. Lets Playwright + humans validate
 * the three-column layout without booting the full app or
 * wiring any route migration.
 *
 * Only compiled in DEV builds (see `router.tsx`).
 */
export function DevShellPreviewRoute() {
  const { t } = useTranslation();
  const [activeCanvas, setActiveCanvas] = useState<'empty' | 'home' | 'meeting'>('home');

  const tabs: ChromeTab[] = [
    {
      id: 'preview',
      label: activeCanvas === 'home' ? 'Home preview' : 'Shell scaffold',
      active: true,
    },
  ];

  return (
    <AppShell
      trail={['dev', 'shell-preview']}
      tabs={tabs}
      chromeRight={
        <>
          <SavedIndicator label={t('chrome.saved')} />
          <button
            type="button"
            className="h-7 px-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60"
          >
            Share
          </button>
          <IconBtn icon={<LinkIcon size={14} aria-hidden="true" />} label="Copy link" />
          <IconBtn icon={<Star size={14} aria-hidden="true" />} label="Favorite" />
          <IconBtn icon={<MoreHorizontal size={14} aria-hidden="true" />} label="More" />
          <IconBtn icon={<Share2 size={14} aria-hidden="true" />} label="Share" />
        </>
      }
      sidePanel={<PreviewPanel />}
    >
      <section className="h-full overflow-auto">
        <div className="mx-auto max-w-[760px] px-24 pt-12 pb-10">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setActiveCanvas('home')}
              className={
                'px-3 py-1 rounded-md text-sm ' +
                (activeCanvas === 'home'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              Home canvas
            </button>
            <button
              type="button"
              onClick={() => setActiveCanvas('meeting')}
              className={
                'px-3 py-1 rounded-md text-sm ' +
                (activeCanvas === 'meeting'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              Meeting card
            </button>
            <button
              type="button"
              onClick={() => setActiveCanvas('empty')}
              className={
                'px-3 py-1 rounded-md text-sm ' +
                (activeCanvas === 'empty'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              Empty canvas
            </button>
          </div>
          {activeCanvas === 'home' ? (
            <HomePreview />
          ) : activeCanvas === 'meeting' ? (
            <MeetingPreview />
          ) : (
            <EmptyPreview />
          )}
        </div>
      </section>
    </AppShell>
  );
}

function HomePreview() {
  return (
    <>
      <h1 className="text-[48px] leading-[1.1] font-semibold tracking-tight">Bom dia, Rodolfo</h1>
      <p className="mt-2 text-muted-foreground">terça · 22 de abril · 3 coisas pra você hoje</p>
      <div className="mt-8 flex flex-col gap-2">
        <Card
          title="Reunião em 40min — IT Weekly Status"
          subtitle="Sofia já preparou o resumo dos pontos em aberto"
        />
        <Card
          title="Rita Menezes respondeu o e-mail de endossos"
          subtitle="2 dúvidas respondidas, fluxo ainda aguardando"
        />
        <Card
          title="Sofia terminou o resumo da call da Kathia"
          subtitle="14 minutos, 3 decisões, 2 pendências atribuídas"
        />
      </div>
    </>
  );
}

function EmptyPreview() {
  return (
    <div className="py-16 text-muted-foreground">Empty canvas — just the shell, nothing else.</div>
  );
}

function MeetingPreview() {
  return (
    <>
      <h1 className="text-[32px] leading-[1.15] font-semibold tracking-tight">VC 15/jan</h1>
      <p className="mt-2 text-muted-foreground">
        Note containing a MeetingBlock — fixture-backed preview.
      </p>
      <div className="mt-6">
        <MeetingCard meetingId="it-weekly-status" />
      </div>
      <div className="mt-4">
        <MeetingCard meetingId="does-not-exist" />
      </div>
    </>
  );
}

function Card({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <article className="flex items-center gap-3 p-3 rounded-md border border-border bg-card hover:bg-secondary/60 transition-colors">
      <div
        className="w-9 h-9 rounded-md shrink-0 flex items-center justify-center text-primary-foreground"
        style={{ backgroundColor: 'oklch(var(--accent))' }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <h3 className="text-[14px] font-medium truncate">{title}</h3>
        <p className="text-[13px] text-muted-foreground truncate">{subtitle}</p>
      </div>
    </article>
  );
}

function PreviewPanel() {
  return (
    <div className="p-4 flex flex-col gap-4">
      <section>
        <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">
          Fontes relacionadas
        </h4>
        <ul className="flex flex-col gap-1 text-sm">
          <li className="text-muted-foreground">fast.com.br/sofia</li>
          <li className="text-muted-foreground">status.npv/assinaturas</li>
        </ul>
      </section>
      <section>
        <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-2">
          Conversas IA
        </h4>
        <p className="text-sm text-muted-foreground">Sofia está ociosa. Invoque com Cmd+J.</p>
      </section>
    </div>
  );
}

function IconBtn({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 flex items-center justify-center"
    >
      {icon}
    </button>
  );
}
