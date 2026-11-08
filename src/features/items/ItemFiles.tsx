import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FileCode2, FileIcon, FolderOpen, Link2, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Input } from '../../components/ui';
import {
  errorText,
  items,
  type ItemFile,
  type ItemFilesData,
  type ItemRef,
  type ItemReference,
  type OpenTarget,
} from './items';

/**
 * Files of a meeting or an activity (spec 0105): included copies live in the
 * item's vault folder; references point at a path or URL left where it is.
 * Opening hands the file to the system (HTML goes to the browser).
 */
export function ItemFiles({ item, heading }: { item: ItemRef; heading?: boolean }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`items.files.${key}`, options);
  const [data, setData] = useState<ItemFilesData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [referencing, setReferencing] = useState(false);
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const fieldId = useId();
  const { kind, id, title, date } = item;

  useEffect(() => {
    let current = true;
    setData(null);
    setError('');
    items
      .list({ kind, id, title, date })
      .then((next) => current && setData(next))
      .catch((e) => current && setError(errorText(e)));
    return () => {
      current = false;
    };
  }, [kind, id, title, date]);

  const run = async (action: () => Promise<ItemFilesData | void>) => {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      if (next) setData(next);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const pickFiles = async () => {
    const picked = await openDialog({ multiple: true, directory: false });
    const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
    if (paths.length) await run(() => items.include(item, paths));
  };
  const pickReference = async () => {
    const picked = await openDialog({ multiple: false, directory: false });
    if (typeof picked === 'string') setTarget(picked);
  };
  const addReference = async () => {
    if (!target.trim()) return;
    if (await run(() => items.reference(item, target.trim()))) {
      setTarget('');
      setReferencing(false);
    }
  };
  const open = (to: OpenTarget) => void run(() => items.open(item, to));

  const files = data?.files ?? [];
  const references = data?.references ?? [];
  const size = (bytes: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language, {
      style: 'unit',
      unit: bytes >= 1_048_576 ? 'megabyte' : 'kilobyte',
      maximumFractionDigits: 1,
    }).format(bytes >= 1_048_576 ? bytes / 1_048_576 : Math.max(0.1, bytes / 1024));

  return (
    <section className="grid gap-3" aria-label={k('title')}>
      <div className="flex flex-wrap items-center gap-1">
        {heading && <h3 className="mr-auto text-sm font-medium">{k('title')}</h3>}
        <Button
          size="sm"
          variant="secondary"
          icon={<Plus size={14} aria-hidden="true" />}
          disabled={busy}
          onClick={() => void pickFiles()}
        >
          {k('include')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Link2 size={14} aria-hidden="true" />}
          aria-expanded={referencing}
          disabled={busy}
          onClick={() => setReferencing((v) => !v)}
        >
          {k('reference')}
        </Button>
        {data?.folder && (
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={() => void run(() => items.reveal(item))}
          >
            {k('reveal')}
          </Button>
        )}
      </div>
      {referencing && (
        <form
          className="grid gap-2 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void addReference();
          }}
        >
          <label htmlFor={fieldId} className="text-xs text-muted-foreground">
            {k('referenceHint')}
          </label>
          <Input
            id={fieldId}
            size="sm"
            value={target}
            placeholder="https://…"
            onChange={(e) => setTarget(e.target.value)}
          />
          <div className="flex gap-1">
            <Button size="sm" type="submit" disabled={busy || !target.trim()}>
              {k('add')}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => void pickReference()}>
              {k('chooseFile')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="ml-auto"
              onClick={() => setReferencing(false)}
            >
              {k('cancel')}
            </Button>
          </div>
        </form>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {data && !files.length && !references.length && (
        <p className="text-sm text-muted-foreground">{k('empty')}</p>
      )}
      {(files.length > 0 || references.length > 0) && (
        <ul className="grid gap-1" aria-label={k('list')}>
          {files.map((file) => (
            <FileRow
              key={`f:${file.name}`}
              file={file}
              size={size(file.bytes)}
              confirming={confirming === file.name}
              busy={busy}
              onOpen={() => open({ kind: 'file', name: file.name })}
              onRemove={() => setConfirming(file.name)}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                void run(() => items.removeFile(item, file.name)).then(() => setConfirming(null))
              }
            />
          ))}
          {references.map((ref) => (
            <ReferenceRow
              key={`r:${ref.target}`}
              reference={ref}
              busy={busy}
              onOpen={() => open({ kind: 'reference', target: ref.target })}
              onRemove={() => void run(() => items.removeReference(item, ref.target))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FileRow(p: {
  file: ItemFile;
  size: string;
  confirming: boolean;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`items.files.${key}`, options);
  const Icon = p.file.kind === 'html' || p.file.kind === 'htm' ? FileCode2 : FileIcon;
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary">
      <Icon size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
        title={k('open', { name: p.file.name })}
        aria-label={k('open', { name: p.file.name })}
        onClick={p.onOpen}
      >
        {p.file.name}
      </button>
      {p.confirming ? (
        <>
          <span className="text-xs text-muted-foreground">{k('confirmRemove')}</span>
          <Button size="xs" variant="danger" disabled={p.busy} onClick={p.onConfirm}>
            {k('remove')}
          </Button>
          <Button size="xs" variant="ghost" onClick={p.onCancel}>
            {k('cancel')}
          </Button>
        </>
      ) : (
        <>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {[p.file.kind.toUpperCase(), p.size].filter(Boolean).join(' · ')}
          </span>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            icon={<Trash2 size={13} aria-hidden="true" />}
            aria-label={k('removeNamed', { name: p.file.name })}
            title={k('removeNamed', { name: p.file.name })}
            onClick={p.onRemove}
          />
        </>
      )}
    </li>
  );
}

function ReferenceRow(p: {
  reference: ItemReference;
  busy: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) => t(`items.files.${key}`, options);
  const name = p.reference.label ?? p.reference.target;
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary">
      <Link2 size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline disabled:no-underline disabled:opacity-60"
        title={p.reference.target}
        aria-label={k('open', { name })}
        disabled={p.reference.missing}
        onClick={p.onOpen}
      >
        {name}
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">
        {p.reference.missing ? k('missing') : k(p.reference.isUrl ? 'link' : 'external')}
      </span>
      <Button
        size="xs"
        variant="ghost"
        iconOnly
        icon={<Trash2 size={13} aria-hidden="true" />}
        aria-label={k('removeNamed', { name })}
        title={k('removeNamed', { name })}
        disabled={p.busy}
        onClick={p.onRemove}
      />
    </li>
  );
}
