import { ColoredNoteEditor } from './ColoredNoteEditor';
import { hasCanvasColors } from '../board/editor/markdown';
import type { EditorFocusRequest } from './editorFocusRequest';
import { compressImage } from './compressImage';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/shadcn/style.css';
import { invoke } from '@tauri-apps/api/core';

import { type NoteContent } from '../../lib/bindings';
import { noteSaveQueue } from '../../lib/noteSessions';
import { beginEditorUpload, isExitLocked, subscribeExitLock } from '../../lib/lifecycle';
import { logNewNoteTrace, mark } from '../../lib/perf';
import { useAppStore } from '../../lib/store';
import { useResolvedTheme } from '../../lib/useTheme';
import { meetingBlockSpec } from '../meetings/MeetingBlock';
import { isInteractiveClickTarget } from './editorFocus';
import { type NoteFont } from './NoteActionsMenu';
import { NoteRecovery } from './NoteRecovery';
import { useNoteRecovery } from './useNoteRecovery';
import { NoteEditorFrame, type NoteEditorVariant } from './NoteEditorFrame';
import { en, pt } from '@blocknote/core/locales';

// Schema extends BlockNote's defaults with our custom MeetingBlock.
// Created once at module scope so useCreateBlockNote doesn't rebuild
// it on every render (spec 0057).
const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    meeting: meetingBlockSpec,
  },
});

const PREF_FONT_KEY = 'coxinha:note-font';
const PREF_SMALL_KEY = 'coxinha:note-small';
const PREF_FULLWIDTH_KEY = 'coxinha:note-full-width';

function readPrefString<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  return (allowed as readonly string[]).includes(raw ?? '') ? (raw as T) : fallback;
}

function readPrefBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

interface Props {
  variant?: NoteEditorVariant;
  focusRequest?: EditorFocusRequest;
  noteId: string;
  /**
   * Pre-resolved content for the note. Routes load this ahead of
   * render via TanStack Query; the component stays a dumb editor
   * that receives what it needs to render instead of owning the
   * fetch. Tests can render it directly with a fixture.
   */
  content: NoteContent;
}

export function NoteEditor({ noteId, content, variant = 'standalone', focusRequest }: Props) {
  // Placed at the top of the component body so the mark captures
  // the end of the Suspense wait (the loader resolves before this
  // render fires). Harmless if this isn't a new-note flow —
  // `logNewNoteTrace` bails when the `hotkey` mark is missing.
  mark('editor-suspended');
  const queryClient = useQueryClient();
  const deleteNote = useAppStore((s) => s.deleteNote);
  const duplicateNote = useAppStore((s) => s.duplicateNote);
  const navigate = useNavigate();
  const { ready, recovery, retry, save } = useNoteRecovery(noteId, content, queryClient);
  if (recovery)
    return <NoteRecovery snapshot={recovery.snapshot} error={recovery.error} retry={retry} />;
  if (!ready) return <NoteLoadingSkeleton />;
  if (hasCanvasColors(ready.markdown))
    return (
      <ColoredNoteEditor key={noteId} noteId={noteId} content={ready} focusRequest={focusRequest} />
    );
  const metadata = queryClient.getQueryData<NoteContent>(['note', noteId])?.note ?? content.note;

  return (
    <EditorInner
      key={noteId}
      variant={variant}
      focusRequest={focusRequest}
      noteId={noteId}
      initialMarkdown={ready.markdown}
      title={metadata.title}
      tags={metadata.tags ?? []}
      updatedAt={metadata.updated_at as unknown as string}
      onSave={save}
      onDelete={async () => {
        await deleteNote(noteId);
        await navigate({ to: '/notes' });
      }}
      onDuplicate={async () => {
        const copy = await duplicateNote(noteId);
        await navigate({ to: '/notes/$noteId', params: { noteId: copy.id } });
      }}
    />
  );
}

function EditorInner({
  variant,
  focusRequest,
  noteId,
  initialMarkdown,
  title,
  tags,
  updatedAt,
  onSave,
  onDelete,
  onDuplicate,
}: {
  variant: NoteEditorVariant;
  focusRequest?: EditorFocusRequest;
  noteId: string;
  initialMarkdown: string;
  title: string;
  tags: string[];
  updatedAt: string;
  onSave: (md: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const theme = useResolvedTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const [font, setFont] = useState<NoteFont>(() =>
    readPrefString<NoteFont>(PREF_FONT_KEY, ['default', 'serif', 'mono'], 'default')
  );
  const [smallText, setSmallText] = useState(() => readPrefBool(PREF_SMALL_KEY, false));
  const [fullWidth, setFullWidth] = useState(() => readPrefBool(PREF_FULLWIDTH_KEY, false));

  useEffect(() => {
    window.localStorage.setItem(PREF_FONT_KEY, font);
  }, [font]);
  useEffect(() => {
    window.localStorage.setItem(PREF_SMALL_KEY, smallText ? '1' : '0');
  }, [smallText]);
  useEffect(() => {
    window.localStorage.setItem(PREF_FULLWIDTH_KEY, fullWidth ? '1' : '0');
  }, [fullWidth]);
  const completedUploads = useRef<
    Array<{ url?: string; blockId?: string; observed: boolean; finish: () => void }>
  >([]);
  const blockExists = useRef<(id: string) => boolean>(() => false);
  const editor = useCreateBlockNote({
    ...(variant === 'embedded'
      ? { dictionary: i18n?.resolvedLanguage?.startsWith('pt') ? pt : en }
      : {}),
    schema: editorSchema,
    uploadFile: async (file: File, blockId?: string) => {
      const finishUpload = beginEditorUpload(noteId);
      const upload = {
        blockId,
        observed: !!blockId && blockExists.current(blockId),
        finish: finishUpload,
        url: undefined as string | undefined,
      };
      completedUploads.current.push(upload);
      try {
        const compressed = await compressImage(file);
        const arrayBuffer = await compressed.arrayBuffer();
        const bytes = Array.from(new Uint8Array(arrayBuffer));

        const relPath = await invoke<string>('save_attachment', {
          filename: compressed.name,
          bytes,
        });

        const url = `coxinha://attachments/${relPath.replace(/^attachments\//, '')}`;
        upload.url = url;
        return url;
      } catch (error) {
        completedUploads.current = completedUploads.current.filter((item) => item !== upload);
        finishUpload();
        throw error;
      }
    },
  });

  blockExists.current = (id) => !!editor.getBlock(id);
  const exitLocked = useSyncExternalStore(subscribeExitLock, isExitLocked);
  const initializing = useRef(true);
  const lastMarkdown = useRef<string | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<{ error: unknown } | null>(null);
  const [duplicateFailed, setDuplicateFailed] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const initialContentRef = useRef(initialMarkdown);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (initialContentRef.current.length > 0) {
        const blocks = await editor.tryParseMarkdownToBlocks(initialContentRef.current);
        if (cancelled) return;
        editor.replaceBlocks(editor.document, blocks);
      }
      if (cancelled) return;
      lastMarkdown.current = editor.blocksToMarkdownLossy(editor.document);
      initializing.current = false;
      setInitialized(true);
      if (variant === 'standalone') editor.focus();

      mark('editor-ready');
      logNewNoteTrace();
    })().catch(() => window.dispatchEvent(new Event('coxinha-save-error')));
    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    if (initialized && variant === 'embedded') focusRequest?.focus(() => editor.focus());
  }, [initialized, variant, focusRequest, editor]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const queueRef = useRef(noteSaveQueue(noteId, (md) => saveRef.current(md)));
  const flushNow = useMemo(
    () => async () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await queueRef.current!.flush();
    },
    []
  );
  const debouncedSave = useMemo(
    () => () => {
      if (initializing.current) return;
      const markdown = editor.blocksToMarkdownLossy(editor.document);
      completedUploads.current = completedUploads.current.filter((upload) => {
        if (upload.observed && upload.blockId && !blockExists.current(upload.blockId)) {
          upload.finish();
          return false;
        }
        return true;
      });
      if (markdown === lastMarkdown.current) return;
      lastMarkdown.current = markdown;
      const serialized = Promise.resolve(markdown);
      queueRef.current!.change(serialized);
      void serialized
        .then((md) => {
          completedUploads.current = completedUploads.current.filter((upload) => {
            const removed =
              upload.observed && !!upload.blockId && !blockExists.current(upload.blockId);
            if (!removed && (!upload.url || !md.includes(upload.url))) return true;
            upload.finish();
            return false;
          });
        })
        .catch(() => {});
      void serialized.catch(() => window.dispatchEvent(new Event('coxinha-save-error')));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void flushNow().catch(() => {
          window.dispatchEvent(new Event('coxinha-save-error'));
        });
      }, 500);
    },
    [flushNow, editor]
  );
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      void flushNow().catch(() => window.dispatchEvent(new Event('coxinha-save-error')));
    },
    [flushNow]
  );

  // Ctrl+. (or Cmd+. on mac) toggles the actions menu — mirrors
  // Notion's shortcut. Gated on Ctrl/Cmd so it doesn't fight the
  // editor's own typing of a period.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== '.') return;
      e.preventDefault();
      setMenuOpen((v) => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function focusEditorOnDeadSpace(e: React.MouseEvent<HTMLElement>) {
    // Clicks inside the editor surface or on interactive chrome
    // (title, tags, header buttons) already do the right thing —
    // only rescue clicks that landed on the dead padded area.
    if (isInteractiveClickTarget(e.target)) return;
    const doc = editor.document;
    const last = doc[doc.length - 1];
    if (last) editor.setTextCursorPosition(last, 'end');
    editor.focus();
  }

  async function copyContentsToClipboard() {
    const md = await editor.blocksToMarkdownLossy(editor.document);
    await navigator.clipboard.writeText(md);
  }

  async function copyLinkToClipboard() {
    await navigator.clipboard.writeText(`coxinha://notes/${noteId}`);
  }

  async function confirmAndDelete() {
    const label = title || t('sidebar.untitled');
    if (!window.confirm(t('palette.deleteConfirm', { title: label }))) return;
    try {
      await onDelete();
    } catch (error) {
      setDeleteFailure({ error });
    }
  }

  const wordCount = useMemo(
    () =>
      initialMarkdown
        .replace(/[#>*`_~\-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean).length,
    [initialMarkdown]
  );

  return (
    <NoteEditorFrame
      variant={variant}
      noteId={noteId}
      title={title}
      tags={tags}
      updatedAt={updatedAt}
      font={font}
      smallText={smallText}
      fullWidth={fullWidth}
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      menuButtonRef={menuButtonRef}
      deleteFailure={deleteFailure}
      duplicateFailed={duplicateFailed}
      onMouseDown={focusEditorOnDeadSpace}
      menu={{
        open: menuOpen,
        onClose: () => setMenuOpen(false),
        anchorRef: menuButtonRef,
        footer: { wordCount },
        onCopyLink: () => void copyLinkToClipboard(),
        onCopyContents: () => void copyContentsToClipboard(),
        onDuplicate: () => void onDuplicate().catch(() => setDuplicateFailed(true)),
        onMoveToTrash: () => void confirmAndDelete(),
        onUndo: () => editor.undo(),
        font,
        onFontChange: setFont,
        smallText,
        onSmallTextChange: setSmallText,
        fullWidth,
        onFullWidthChange: setFullWidth,
      }}
    >
      <BlockNoteView
        editor={editor}
        editable={initialized && !exitLocked}
        onChange={debouncedSave}
        data-note-id={noteId}
        theme={theme}
      />
    </NoteEditorFrame>
  );
}

export function NoteLoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="p-8 space-y-3 animate-pulse">
      <span className="sr-only">{t('editor.loading')}</span>
      <div className="h-8 w-1/2 bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-full bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-5/6 bg-muted rounded" aria-hidden="true" />
      <div className="h-4 w-4/6 bg-muted rounded" aria-hidden="true" />
    </div>
  );
}
