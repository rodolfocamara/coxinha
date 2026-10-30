import { useEffect, useRef, useSyncExternalStore, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { useTranslation } from 'react-i18next';
import { isExitLocked, subscribeExitLock } from '../../../lib/lifecycle';
import type { EditorFocusRequest } from '../../notes/editorFocusRequest';
import { canvasExtensions } from './extensions';
const palette = ['#d95d57', '#b97816', '#328768', '#447fbe', '#9c6cc1'];
export function CanvasTextEditor({
  initial,
  change,
  focusRequest,
  close,
}: {
  initial: JSONContent;
  change: (doc: JSONContent) => void;
  focusRequest?: EditorFocusRequest;
  close: () => void;
}) {
  const { t } = useTranslation('board');
  const latest = useRef(change);
  latest.current = change;
  const locked = useSyncExternalStore(subscribeExitLock, isExitLocked, isExitLocked);
  const [selection, setSelection] = useState(false);
  const editor = useEditor({
    extensions: canvasExtensions(),
    content: initial,
    immediatelyRender: false,
    onUpdate: ({ editor }) => latest.current(editor.getJSON()),
    onSelectionUpdate: ({ editor }) => setSelection(!editor.state.selection.empty),
    editorProps: {
      attributes: {
        class: 'canvas-text ProseMirror nodrag nopan nowheel',
        role: 'textbox',
        'aria-label': t('activityText'),
        'aria-multiline': 'true',
      },
    },
  });
  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);
  useEffect(() => {
    if (editor)
      focusRequest?.focus(() => editor.commands.focus('start', { scrollIntoView: false }));
  }, [editor, focusRequest]);
  if (!editor) return null;
  return (
    <div
      className="canvas-editing"
      onKeyDownCapture={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div
        className="canvas-text-tools"
        role="toolbar"
        aria-label={t('textTools')}
        onMouseDown={(e) => e.preventDefault()}
      >
        <button
          type="button"
          disabled={locked}
          aria-pressed={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-label={t('bold')}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          disabled={locked}
          aria-pressed={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          {t('bullets')}
        </button>
        <button
          type="button"
          disabled={locked}
          aria-pressed={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          {t('checklist')}
        </button>
        {selection &&
          palette.map((color) => (
            <button
              key={color}
              type="button"
              disabled={locked}
              style={{ color }}
              aria-label={t('textColor', { color })}
              onClick={() => editor.chain().focus().setColor(color).run()}
            >
              ●
            </button>
          ))}
        {selection && (
          <button
            type="button"
            disabled={locked}
            onClick={() => editor.chain().focus().unsetColor().run()}
          >
            {t('resetColor')}
          </button>
        )}
        <button type="button" onClick={close} aria-label={t('finishEditing')}>
          ✓
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
