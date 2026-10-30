import { Select } from '../../components/ui/Select';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  SquareDashed,
  FilePlus2,
  PanelRight,
  ListTree,
  Check,
  LoaderCircle,
} from 'lucide-react';
export function BoardToolbar({
  inspectorToggle,
  dirty,
  error,
  notes,
  existing,
  setExisting,
  addNote,
  addArea,
  addText,
  inspectorOpen,
  outlineOpen,
  setInspectorOpen,
  setOutlineOpen,
  save,
}: {
  inspectorToggle: Ref<HTMLButtonElement>;
  dirty: boolean;
  error: unknown;
  notes: { id: string; title: string }[];
  existing: string;
  setExisting: (value: string) => void;
  addNote: (id?: string) => Promise<void>;
  addArea: () => void;
  addText: () => void;
  inspectorOpen: boolean;
  outlineOpen: boolean;
  setInspectorOpen: (value: boolean) => void;
  setOutlineOpen: (value: boolean) => void;
  save: () => void;
}) {
  const { t } = useTranslation('board');
  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      <div className="board-toolbar" role="toolbar" aria-label={t('tools')}>
        <button className="board-primary" onClick={() => void addNote()}>
          <Plus size={16} />
          {t('newNote')}
        </button>
        <button onClick={addText}>{t('addText')}</button>
        <button onClick={addArea}>
          <SquareDashed size={15} />
          {t('area')}
        </button>
        <details className="board-note-picker">
          <summary>
            <FilePlus2 size={15} />
            {t('addNote')}
          </summary>
          <div className="board-note-popover">
            <Select
              aria-label={t('addNote')}
              value={existing}
              onChange={(e) => setExisting(e.target.value)}
            >
              <option value="">{t('chooseNote')}</option>
              {notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title || t('untitled')}
                </option>
              ))}
            </Select>
            <button disabled={!existing} onClick={() => void addNote(existing)}>
              {t('addNote')}
            </button>
          </div>
        </details>
        <div className="board-toolbar-end">
          <span className="board-save-state" role="status" title={t(dirty ? 'unsaved' : 'saved')}>
            {dirty ? <LoaderCircle size={13} /> : <Check size={13} />}
            <span>{t(dirty ? 'unsaved' : 'saved')}</span>
          </span>
          {(dirty || !!error) && (
            <button onClick={() => save()}>{t(error ? 'retry' : 'save')}</button>
          )}
          <button
            aria-label={t('outline')}
            aria-expanded={inspectorOpen && outlineOpen}
            onClick={() => {
              setInspectorOpen(true);
              setOutlineOpen(true);
            }}
          >
            <ListTree size={16} />
            <span>{t('outlineShort')}</span>
          </button>
          <button
            ref={inspectorToggle}
            aria-label={t('inspector')}
            aria-expanded={inspectorOpen}
            onClick={() => {
              setInspectorOpen(!inspectorOpen);
              setOutlineOpen(false);
            }}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
