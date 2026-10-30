import { useEffect, useRef, useState } from 'react';
import { editorFocusRequest, type EditorFocusRequest } from '../notes/editorFocusRequest';

export function useBoardEditor(fallback: React.RefObject<HTMLButtonElement | null>) {
  const [editing, setEditing] = useState<{
    id: string;
    cardId?: string;
    focusRequest: EditorFocusRequest;
  } | null>(null);
  const pending = useRef<EditorFocusRequest | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      pending.current?.cancel();
      pending.current = null;
    },
    []
  );
  function begin() {
    pending.current?.cancel();
    const request = editorFocusRequest();
    pending.current = request;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return request;
  }
  function open(id: string, request = begin(), cardId?: string) {
    if (pending.current !== request) return false;
    setEditing({ id, cardId, focusRequest: request });
    return true;
  }
  function close() {
    pending.current?.cancel();
    pending.current = null;
    setEditing(null);
    const target = returnFocus.current;
    if (target?.isConnected && target !== document.body) target.focus();
    else fallback.current?.focus();
  }
  return { editing, begin, open, close };
}
