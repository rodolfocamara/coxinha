import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  Copy,
  CopyPlus,
  Link as LinkIcon,
  Search,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';

export type NoteFont = 'default' | 'serif' | 'mono';

export interface NoteActionsMenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Rendered in the footer. Caller formats and counts. */
  footer?: {
    wordCount: number;
    lastEditedBy?: string;
    lastEditedAt?: string;
  };

  /** Session notes expose only actions that keep their identity and workspace. */
  allowDuplicateAndDelete?: boolean;

  // Real actions
  onCopyLink: () => void;
  onCopyContents: () => void;
  onDuplicate: () => void;
  onMoveToTrash: () => void;
  onUndo: () => void;

  // Preferences
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  smallText: boolean;
  onSmallTextChange: (on: boolean) => void;
  fullWidth: boolean;
  onFullWidthChange: (on: boolean) => void;
}

/**
 * Focused page-actions dropdown: font picker at the top, active
 * note actions, layout toggles, undo, and word-count footer.
 */
export function NoteActionsMenu({
  open,
  onClose,
  anchorRef,
  footer,
  allowDuplicateAndDelete = true,
  onCopyLink,
  onCopyContents,
  onDuplicate,
  onMoveToTrash,
  onUndo,
  font,
  onFontChange,
  smallText,
  onSmallTextChange,
  fullWidth,
  onFullWidthChange,
}: NoteActionsMenuProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        right: Math.max(12, window.innerWidth - rect.right),
      });
    }
    const id = setTimeout(() => searchRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target as HTMLElement)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  const q = query.trim().toLowerCase();
  const filter = useMemo(() => (label: string) => !q || label.toLowerCase().includes(q), [q]);

  if (!open || !position) return null;

  function run(cb: () => void) {
    return () => {
      cb();
      onClose();
    };
  }

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('noteMenu.title')}
      className="fixed z-50 w-[280px] max-h-[min(80vh,560px)] overflow-y-auto rounded-[10px] border border-border bg-popover text-popover-foreground shadow-[0_10px_28px_rgb(0_0_0_/_0.18)]"
      style={{ top: position.top, right: position.right, paddingTop: 8, paddingBottom: 8 }}
      data-testid="note-actions-menu"
    >
      <div className="px-3 pt-1.5 pb-2">
        <div className="flex items-center gap-1.5 rounded-md bg-background border border-input focus-within:border-primary/60 px-2.5 py-1">
          <Search size={12} className="text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('noteMenu.search')}
            aria-label={t('noteMenu.search')}
            className="flex-1 bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {q.length === 0 && (
        <div className="flex items-stretch justify-between px-4 pt-1 pb-2.5 gap-1">
          <FontPickerOption
            label={t('noteMenu.font.default')}
            fontClassName="font-sans"
            active={font === 'default'}
            onClick={() => onFontChange('default')}
          />
          <FontPickerOption
            label={t('noteMenu.font.serif')}
            fontClassName="font-[Newsreader,serif]"
            active={font === 'serif'}
            onClick={() => onFontChange('serif')}
          />
          <FontPickerOption
            label={t('noteMenu.font.mono')}
            fontClassName="font-mono"
            active={font === 'mono'}
            onClick={() => onFontChange('mono')}
          />
        </div>
      )}

      <Divider />

      <Group>
        {filter(t('noteMenu.copyLink')) && (
          <Row
            icon={<LinkIcon size={14} aria-hidden="true" />}
            label={t('noteMenu.copyLink')}
            hint="Ctrl+L"
            onClick={run(onCopyLink)}
          />
        )}
        {filter(t('noteMenu.copyContents')) && (
          <Row
            icon={<Copy size={14} aria-hidden="true" />}
            label={t('noteMenu.copyContents')}
            onClick={run(onCopyContents)}
          />
        )}
        {allowDuplicateAndDelete && filter(t('noteMenu.duplicate')) && (
          <Row
            icon={<CopyPlus size={14} aria-hidden="true" />}
            label={t('noteMenu.duplicate')}
            hint="Ctrl+D"
            onClick={run(onDuplicate)}
          />
        )}
        {allowDuplicateAndDelete && filter(t('noteMenu.moveToTrash')) && (
          <Row
            icon={<Trash2 size={14} aria-hidden="true" />}
            label={t('noteMenu.moveToTrash')}
            onClick={run(onMoveToTrash)}
          />
        )}
      </Group>

      <Divider />

      <Group>
        {filter(t('noteMenu.smallText')) && (
          <ToggleRow
            icon={<Type size={14} aria-hidden="true" />}
            label={t('noteMenu.smallText')}
            value={smallText}
            onChange={onSmallTextChange}
          />
        )}
        {filter(t('noteMenu.fullWidth')) && (
          <ToggleRow
            icon={<ArrowLeftRight size={14} aria-hidden="true" />}
            label={t('noteMenu.fullWidth')}
            value={fullWidth}
            onChange={onFullWidthChange}
          />
        )}
      </Group>

      <Divider />

      <Group>
        {filter(t('noteMenu.undo')) && (
          <Row
            icon={<Undo2 size={14} aria-hidden="true" />}
            label={t('noteMenu.undo')}
            hint="Ctrl+Z"
            onClick={run(onUndo)}
          />
        )}
      </Group>

      {footer && q.length === 0 && (
        <>
          <Divider />
          <div
            className="flex flex-col gap-0.5 px-3.5 pt-2 pb-1 text-[11px] text-muted-foreground"
            data-testid="note-actions-footer"
          >
            <span>{t('noteMenu.footer.wordCount', { count: footer.wordCount })}</span>
            {footer.lastEditedBy && (
              <span>{t('noteMenu.footer.lastEditedBy', { name: footer.lastEditedBy })}</span>
            )}
            {footer.lastEditedAt && <span>{footer.lastEditedAt}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border my-1" aria-hidden="true" />;
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0">{children}</div>;
}

function Row({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-2 mx-1 rounded-md px-3 py-1.5 text-[13px] text-foreground text-left transition-colors hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none"
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  value: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={value}
      onClick={() => onChange?.(!value)}
      className="flex items-center gap-2 mx-1 rounded-md px-3 py-1.5 text-[13px] text-foreground text-left transition-colors hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none"
    >
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span
        aria-hidden="true"
        className={clsx(
          'relative w-6 h-3.5 rounded-full transition-colors shrink-0',
          value ? 'bg-primary' : 'bg-border'
        )}
      >
        <span
          className={clsx(
            'absolute top-[1px] w-3 h-3 rounded-full bg-white transition-[left] shadow-sm',
            value ? 'left-[11px]' : 'left-[1px]'
          )}
        />
      </span>
    </button>
  );
}

function FontPickerOption({
  label,
  fontClassName,
  active,
  onClick,
}: {
  label: string;
  fontClassName: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex-1 flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/60'
      )}
      aria-pressed={active}
    >
      <span className={clsx('text-[22px] leading-none', fontClassName)}>Ag</span>
      <span
        className={clsx('text-[11px]', active ? 'font-semibold text-foreground' : 'font-normal')}
      >
        {label}
      </span>
    </button>
  );
}
