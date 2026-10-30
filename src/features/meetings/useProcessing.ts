import { useEffect, useRef, useState } from 'react';
import { library, type CaptureStatus, type ProcessingDetail } from './library';

export function useProcessing(meetingId: string, status: CaptureStatus) {
  const [job, setJob] = useState('');
  const [loaded, setLoaded] = useState<{
    meetingId: string;
    job: string;
    value: ProcessingDetail;
  } | null>(null);
  const data = loaded?.meetingId === meetingId && loaded.job === job ? loaded.value : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const pending = useRef(false);
  const processing = status.processing;
  useEffect(() => {
    let live = true;
    const current = ++revision.current;
    setError(null);
    library
      .processing(meetingId, job || undefined)
      .then((value) => {
        if (live && current === revision.current) setLoaded({ meetingId, job, value });
      })
      .catch((e) => {
        if (live && current === revision.current) setError(String(e));
      });
    return () => {
      live = false;
      ++revision.current;
    };
  }, [meetingId, processing?.meetingId, processing?.phase, processing?.job, job, attempt]);

  async function act(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    const current = revision.current;
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    try {
      await action();
    } catch (e) {
      failure = String(e);
    }
    // Confirmation can persist before optional enrollment fails. Always reconcile.
    try {
      if (current === revision.current) {
        const next = await library.processing(meetingId, job || undefined);
        if (current === revision.current) setLoaded({ meetingId, job, value: next });
      }
    } catch (e) {
      failure ??= String(e);
    } finally {
      if (current === revision.current) setError(failure);
      pending.current = false;
      setBusy(false);
    }
  }
  return { job, setJob, data, busy, error, act, retry: () => setAttempt((n) => n + 1) };
}
