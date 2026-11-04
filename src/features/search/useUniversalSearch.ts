import { useEffect, useState } from 'react';
import { MIN_QUERY, universalSearch, type UniversalAnswer } from './universalSearch';

export const SEARCH_DEBOUNCE_MS = 200;
const EMPTY: UniversalAnswer = { notes: [], meetings: [], events: [], people: [] };

/**
 * The backend answer for `query` once typing pauses; null until it arrives
 * or when the query is too short. A failed call answers nothing.
 */
export function useUniversalSearch(query: string, enabled: boolean) {
  const q = query.trim();
  const [answer, setAnswer] = useState<{ query: string; answer: UniversalAnswer } | null>(null);
  useEffect(() => {
    if (!enabled || q.length < MIN_QUERY) return;
    let alive = true;
    const timer = setTimeout(() => {
      universalSearch(q)
        .then((result) => alive && setAnswer({ query: q, answer: result }))
        .catch(() => alive && setAnswer({ query: q, answer: EMPTY }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, enabled]);
  // An answer for an older query never shows under the current one.
  const current = enabled && answer?.query === q ? answer.answer : null;
  return { answer: current, pending: enabled && q.length >= MIN_QUERY && !current };
}
