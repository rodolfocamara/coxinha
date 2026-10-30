import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { AppShell, SavedIndicator } from '../components/AppShell';
import { NoteActionsMenu, type NoteFont } from '../features/notes/NoteActionsMenu';
import { NoteHeader } from '../features/notes/NoteHeader';

/**
 * Dev-only route that mounts the Note chrome + NoteActionsMenu on
 * synthetic fixture data — no Tauri IPC required. Lets Playwright
 * (and humans) validate the Notion-style menu's visual without
 * having to boot the real app and create a note.
 *
 * The route only exists in DEV builds (see `router.tsx`).
 */
export function DevMenuPreviewRoute() {
  const [menuOpen, setMenuOpen] = useState(true);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [font, setFont] = useState<NoteFont>('default');
  const [smallText, setSmallText] = useState(false);
  const [fullWidth, setFullWidth] = useState(false);

  return (
    <AppShell
      trail={['dev', 'menu-preview']}
      tabs={[{ id: 'menu-preview', label: 'menu-preview', active: true }]}
      chromeRight={<SavedIndicator label="Saved" />}
    >
      <section className="relative h-full overflow-auto bn-container cursor-text">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More actions"
          title="More actions (Ctrl+.)"
          data-testid="note-actions-trigger"
          className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-md border border-border bg-secondary/60 hover:bg-secondary px-2 py-1.5 text-foreground transition-colors shadow-sm"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
          <kbd className="font-mono text-[10px] text-muted-foreground">⌘.</kbd>
        </button>
        <div className="mx-auto max-w-[760px] px-24 pt-12 pb-10">
          <NoteHeader
            title="Review Q2 — produto"
            tags={['meeting', 'produto', 'review']}
            updatedAt="2026-04-21T15:03:00Z"
          />
          <p className="mt-4 text-foreground leading-7">
            Primeira reunião com a Trinca para alinhar o modelo de onboarding da Coxinha. Objetivo:
            transformar a "pasta do usuário" em um destino — onboarding como promessa, não como
            tour.
          </p>
          <h2 className="cx-display text-[20px] mt-6 mb-2">Decisões</h2>
          <ul className="list-disc pl-6 text-foreground leading-7">
            <li>Vamos chamar o produto de "capsule" internamente até o naming final.</li>
            <li>
              Onboarding não deve fazer tour da UI — deve entregar uma primeira nota útil nos
              primeiros 20 segundos.
            </li>
            <li>
              O AI só aparece quando invocado — Cmd+J, barra lateral ou sugestão inline. Nunca como
              pop-up.
            </li>
          </ul>
        </div>
        <NoteActionsMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          anchorRef={menuButtonRef}
          footer={{
            wordCount: 522,
            lastEditedBy: 'Rodolfo Câmara',
            lastEditedAt: 'Today at 3:27 PM',
          }}
          onCopyLink={() => console.info('copy link')}
          onCopyContents={() => console.info('copy contents')}
          onDuplicate={() => console.info('duplicate')}
          onMoveToTrash={() => console.info('move to trash')}
          onUndo={() => console.info('undo')}
          font={font}
          onFontChange={setFont}
          smallText={smallText}
          onSmallTextChange={setSmallText}
          fullWidth={fullWidth}
          onFullWidthChange={setFullWidth}
        />
      </section>
    </AppShell>
  );
}
