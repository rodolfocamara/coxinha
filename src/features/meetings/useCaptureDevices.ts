import { useCallback, useRef, useState } from 'react';
import { library, type Source } from './library';

export function selectDevice(sources: Source[], current: string, monitor: boolean, reset = false) {
  if (!reset && sources.some((s) => s.name === current && s.monitor === monitor)) return current;
  return sources.find((s) => s.monitor === monitor && s.is_default)?.name ?? '';
}

/** Defaults resolve to explicit device names; discovering devices never starts capture. */
export function useCaptureDevices() {
  const [sources, updateSources] = useState<Source[]>([]);
  const [mic, setMic] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const setSources = useCallback((next: Source[], reset = false) => {
    updateSources(next);
    setMic((current) => selectDevice(next, current, false, reset));
    setOutput((current) => selectDevice(next, current, true, reset));
  }, []);
  const refreshSources = async (reset = false) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      setSources(await library.sources(), reset);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  return { sources, setSources, mic, setMic, output, setOutput, loading, failed, refreshSources };
}
