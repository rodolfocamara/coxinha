import { useEffect, useRef, useState } from 'react';

// Version-stamped reads cannot expose a previous assignment/person/job for a render.
export function useCurationRead<T>(
  enabled: boolean,
  scope: string,
  version: unknown,
  read: () => Promise<T>
) {
  const reader = useRef(read);
  reader.current = read;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    version: unknown;
    attempt: number;
    value?: T;
    error?: string;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = reader.current;
    void load()
      .then((value) => {
        if (live) setResult({ scope, version, attempt, value });
      })
      .catch((e) => {
        if (live) setResult({ scope, version, attempt, error: String(e) });
      });
    return () => {
      live = false;
    };
  }, [enabled, scope, version, attempt]);
  const current =
    enabled && result?.scope === scope && result.version === version && result.attempt === attempt
      ? result
      : undefined;
  return {
    data: current?.value,
    error: current?.error,
    loading: enabled && !current,
    reload: () => setAttempt((n) => n + 1),
  };
}
