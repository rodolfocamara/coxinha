import { useEffect, useState } from 'react';
import { library, type LibraryDetail, type ProcessingDetail } from '../meetings/library';
import { useCaptureStore } from '../capture/captureStore';

/**
 * Audio detail and the latest processing result of one recording. The detail
 * reloads when the capture state changes; processing reloads when this
 * meeting's processing phase moves.
 */
export function useMeetingMedia(meetingId: string | null, captureState: string | undefined) {
  const phase = useCaptureStore((s) =>
    s.status?.processing && s.status.processing.meetingId === meetingId
      ? `${s.status.processing.phase}:${s.status.processing.job ?? ''}`
      : ''
  );
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [processing, setProcessing] = useState<ProcessingDetail | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setDetail(null);
    setDetailFailed(false);
    if (meetingId)
      library
        .detail(meetingId)
        .then((value) => current && setDetail(value))
        .catch(() => current && setDetailFailed(true));
    return () => {
      current = false;
    };
  }, [meetingId, captureState, attempt]);

  useEffect(() => {
    let current = true;
    if (!meetingId) {
      setProcessing(null);
      return;
    }
    library
      .processing(meetingId)
      .then((value) => current && setProcessing(value))
      .catch(() => current && setProcessing(null));
    return () => {
      current = false;
    };
  }, [meetingId, phase, captureState, revision]);

  return {
    detail,
    setDetail,
    detailFailed,
    retryDetail: () => setAttempt((n) => n + 1),
    processing,
    reloadProcessing: () => setRevision((n) => n + 1),
  };
}
