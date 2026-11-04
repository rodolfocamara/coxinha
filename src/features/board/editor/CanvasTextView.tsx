import type { JSONContent } from '@tiptap/core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
export function CanvasTextView({
  doc,
  toggle,
}: {
  doc: JSONContent;
  toggle?: (path: number[]) => void;
}) {
  const { t } = useTranslation('board');
  function render(node: JSONContent, path: number[]): ReactNode {
    const key = path.join('.');
    const content = node.content?.map((child, i) => render(child, [...path, i]));
    if (node.type === 'text') {
      let text: ReactNode = node.text;
      for (const mark of node.marks ?? []) {
        if (mark.type === 'bold') text = <strong>{text}</strong>;
        if (mark.type === 'italic') text = <em>{text}</em>;
        if (mark.type === 'strike') text = <s>{text}</s>;
        if (mark.type === 'code') text = <code>{text}</code>;
        if (mark.type === 'textStyle' && /^#[0-9a-f]{6}$/i.test(mark.attrs?.color ?? ''))
          text = <span style={{ color: mark.attrs!.color }}>{text}</span>;
      }
      return <span key={key}>{text}</span>;
    }
    switch (node.type) {
      case 'doc':
        return <div key={key}>{content}</div>;
      case 'paragraph':
        return <p key={key}>{content?.length ? content : <br />}</p>;
      case 'heading':
        return <h3 key={key}>{content?.length ? content : <br />}</h3>;
      case 'bulletList':
        return <ul key={key}>{content}</ul>;
      case 'orderedList':
        return (
          <ol key={key} start={node.attrs?.start}>
            {content}
          </ol>
        );
      case 'taskList':
        return (
          <ul key={key} data-type="taskList">
            {content}
          </ul>
        );
      case 'listItem':
        return <li key={key}>{content}</li>;
      case 'taskItem':
        return (
          <li key={key} data-type="taskItem">
            <label>
              <input
                type="checkbox"
                aria-label={t('completeItem')}
                checked={!!node.attrs?.checked}
                disabled={!toggle}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggle?.(path)}
              />
            </label>
            <div>{content}</div>
          </li>
        );
      case 'blockquote':
        return <blockquote key={key}>{content}</blockquote>;
      case 'codeBlock':
        return (
          <pre key={key}>
            <code>{content}</code>
          </pre>
        );
      case 'horizontalRule':
        return <hr key={key} />;
      case 'hardBreak':
        return <br key={key} />;
      case 'rawBlock':
        return (
          <pre className="canvas-preserved" key={key}>
            {node.attrs?.source}
          </pre>
        );
      case 'rawInline':
        return <span key={key}>{node.attrs?.source}</span>;
      default:
        return null;
    }
  }
  return <>{render(doc, [])}</>;
}
