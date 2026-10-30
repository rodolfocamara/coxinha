import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { library } from '../meetings/library';
import {
  acceptDetectionStatus,
  useMeetingDetection,
  type DetectionStatus,
} from './meetingDetection';
// Serialize preference changes so a delayed enable cannot overtake disable.
let preferenceWrite: Promise<unknown> = Promise.resolve();
export function CallDetectionController() {
  const enabled = useMeetingDetection((s) => s.enabled);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (status: DetectionStatus, recording = false) => {
      if (live) acceptDetectionStatus(status, recording);
    };
    const poll = async () => {
      try {
        const status = await invoke<DetectionStatus>('call_detection_status');
        // A busy/unavailable library cannot be assumed idle.
        const capture = await library.status().catch(() => ({ active: true, processing: true }));
        publish(status, !!capture.active || !!capture.processing);
      } catch {
        if (live) useMeetingDetection.setState({ failed: true });
      } finally {
        if (live) timer = setTimeout(() => void poll(), 3000);
      }
    };
    const synchronize = () => {
      preferenceWrite = preferenceWrite
        .catch(() => {})
        .then(() => invoke<DetectionStatus>('set_call_detection_enabled', { enabled }));
      void preferenceWrite
        .then((status) => {
          const current = status as DetectionStatus;
          publish(current, true);
          if (live && enabled && current.supported) void poll();
        })
        .catch(() => {
          if (live) {
            useMeetingDetection.setState({ failed: true });
            timer = setTimeout(synchronize, 3000);
          }
        });
    };
    synchronize();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return null;
}
