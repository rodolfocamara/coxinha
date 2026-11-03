import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { commands } from '../../lib/bindings';
import { items as itemStore, links, civilDate, type ItemRef } from '../items/items';
import { library } from '../meetings/library';
import type { Session } from '../sessions/sessions';
import { excerpt, noteLines, transcriptLines } from './peekData';

/** One query for the page and the peek, whichever renders first. */
export function useProcessing(meetingId: string | null) {
  return useQuery({
    queryKey: ['peek-processing', meetingId],
    queryFn: () => library.processing(meetingId!),
    enabled: !!meetingId && library.available(),
    retry: false,
  });
}

export function confirmedSpeakers(report: {
  assignments: { state: string; name: string | null }[];
}) {
  return [
    ...new Set(
      report.assignments.flatMap((a) => (a.state === 'confirmed' && a.name ? [a.name] : []))
    ),
  ];
}

/** What a meeting produced, read once for the sections that lay it out. */
export function useMeetingOutcome(
  meetingId: string | null,
  session: Session | null,
  start: Date | null
) {
  const { t } = useTranslation();
  const summary = useQuery({
    queryKey: ['meeting-summary', meetingId],
    queryFn: () => library.summary(meetingId!).catch(() => null),
    enabled: !!meetingId && library.available(),
    retry: false,
  });
  const noteId = session?.personal_note?.id ?? null;
  const note = useQuery({
    queryKey: ['peek-note', noteId],
    queryFn: async () => {
      const result = await commands.getNote(noteId!);
      return result.status === 'ok' ? result.data.markdown : null;
    },
    // isLoading, not isPending: a meeting not recorded yet has its summary query disabled.
    enabled: !!noteId && !summary.data && !summary.isLoading,
    retry: false,
  });
  const processing = useProcessing(meetingId);
  const item: ItemRef | null = session
    ? { kind: 'meeting', id: session.id, title: session.title, date: civilDate(start) }
    : null;
  const files = useQuery({
    queryKey: ['peek-files', session?.id ?? null],
    queryFn: () => itemStore.list(item!),
    enabled: !!item && library.available(),
    retry: false,
  });
  const linked = useQuery({
    queryKey: ['peek-links', session?.id ?? null],
    queryFn: async () => {
      const [list, notes] = await Promise.all([links.ofSession(session!.id), commands.listNotes()]);
      const titles = notes.status === 'ok' ? notes.data : [];
      return list.map((link) => ({
        id: link.note,
        title: titles.find((n) => n.id === link.note)?.title ?? t('meetingsHub.untitled'),
      }));
    },
    enabled: !!session && library.available(),
    retry: false,
  });
  const report = processing.data?.report ?? null;
  return {
    item,
    source: summary.data ? ('summary' as const) : note.data ? ('notes' as const) : null,
    lines: summary.data
      ? noteLines(summary.data.markdown, 8)
      : note.data
        ? noteLines(note.data, 5)
        : [],
    transcript: excerpt(transcriptLines(report), ''),
    files: files.data?.files ?? [],
    references: files.data?.references ?? [],
    activities: linked.data ?? [],
    confirmed: report ? confirmedSpeakers(report) : [],
    ready: !(
      summary.isLoading ||
      note.isLoading ||
      processing.isLoading ||
      files.isLoading ||
      linked.isLoading
    ),
  };
}

export type MeetingOutcome = ReturnType<typeof useMeetingOutcome>;
