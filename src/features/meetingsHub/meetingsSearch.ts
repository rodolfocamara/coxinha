export type MeetingsSearch = { tab?: 'review' | 'month'; event?: string; recording?: string };

/** Search params of `/meetings` and `/meetings/$sessionId`; unknown values are dropped. */
export function validateMeetingsSearch(search: Record<string, unknown>): MeetingsSearch {
  const out: MeetingsSearch = {};
  if (search.tab === 'review' || search.tab === 'month') out.tab = search.tab;
  if (typeof search.event === 'string' && search.event) out.event = search.event;
  if (typeof search.recording === 'string' && search.recording) out.recording = search.recording;
  return out;
}
