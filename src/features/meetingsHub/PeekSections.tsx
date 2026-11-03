import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { FileCode2, File as FileIcon, Link2, SquareCheck } from 'lucide-react';
import { commands } from '../../lib/bindings';
import { library } from '../meetings/library';
import type { Session } from '../sessions/sessions';
import { items, links, civilDate, type ItemRef } from '../items/items';
import { excerpt, noteLines, transcriptLines } from './peekData';

const heading = (text: string) => <h3 className="ch-peek-h">{text}</h3>;

/** "Resumo": the generated summary (spec 0108), else the start of the notes. */
export function PeekSummary({
  meetingId,
  session,
}: {
  meetingId: string | null;
  session: Session | null;
}) {
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
    enabled: !!noteId && !summary.data && !summary.isPending,
    retry: false,
  });
  const lines = summary.data
    ? noteLines(summary.data.markdown, 8)
    : note.data
      ? noteLines(note.data, 5)
      : [];
  if (!lines.length) return null;
  return (
    <section className="ch-peek-sec">
      {heading(t(summary.data ? 'meetingsHub.home.summary' : 'meetingsHub.home.notesStart'))}
      {lines.map((line, i) => (
        <p key={i} className="ch-peek-line">
          {line}
        </p>
      ))}
    </section>
  );
}

/** A few transcript lines: those matching the search, else the opening ones. */
export function PeekTranscript({
  meetingId,
  query,
  onFull,
}: {
  meetingId: string | null;
  query: string;
  onFull: () => void;
}) {
  const { t } = useTranslation();
  const processing = useQuery({
    queryKey: ['peek-processing', meetingId],
    queryFn: () => library.processing(meetingId!),
    enabled: !!meetingId && library.available(),
    retry: false,
  });
  const lines = excerpt(transcriptLines(processing.data?.report), query);
  if (!lines.length) return null;
  return (
    <section className="ch-peek-sec">
      {heading(t('meetingsHub.home.transcript'))}
      {lines.map((line, i) => (
        <p key={i} className="ch-peek-quote">
          {line}
        </p>
      ))}
      <button type="button" className="ch-peek-link" onClick={onFull}>
        {t('meetingsHub.home.fullTranscript')}
      </button>
    </section>
  );
}

/** Files of the meeting folder and linked activities (spec 0105), names only. */
export function PeekFilesAndLinks({ session, start }: { session: Session; start: Date | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const item: ItemRef = {
    kind: 'meeting',
    id: session.id,
    title: session.title,
    date: civilDate(start),
  };
  const files = useQuery({
    queryKey: ['peek-files', session.id],
    queryFn: () => items.list(item),
    enabled: library.available(),
    retry: false,
  });
  const linked = useQuery({
    queryKey: ['peek-links', session.id],
    queryFn: async () => {
      const [list, notes] = await Promise.all([links.ofSession(session.id), commands.listNotes()]);
      const titles = notes.status === 'ok' ? notes.data : [];
      return list.map((link) => ({
        id: link.note,
        title: titles.find((n) => n.id === link.note)?.title ?? t('meetingsHub.untitled'),
      }));
    },
    enabled: library.available(),
    retry: false,
  });
  const fileList = files.data?.files ?? [];
  const refs = files.data?.references ?? [];
  const acts = linked.data ?? [];
  if (!fileList.length && !refs.length && !acts.length) return null;
  return (
    <section className="ch-peek-sec">
      {heading(t('meetingsHub.home.filesAndActivities'))}
      <div className="ch-peek-chips">
        {fileList.map((file) => (
          <button
            key={file.name}
            type="button"
            className="ch-peek-chip"
            onClick={() => void items.open(item, { kind: 'file', name: file.name })}
          >
            {file.kind === 'html' || file.kind === 'htm' ? (
              <FileCode2 size={12} aria-hidden="true" />
            ) : (
              <FileIcon size={12} aria-hidden="true" />
            )}
            <span className="truncate">{file.name}</span>
          </button>
        ))}
        {refs.map((ref) => (
          <button
            key={ref.target}
            type="button"
            className="ch-peek-chip"
            disabled={ref.missing}
            onClick={() => void items.open(item, { kind: 'reference', target: ref.target })}
          >
            <Link2 size={12} aria-hidden="true" />
            <span className="truncate">{ref.label ?? ref.target.split(/[\\/]/).pop()}</span>
          </button>
        ))}
        {acts.map((act) => (
          <button
            key={act.id}
            type="button"
            className="ch-peek-chip"
            onClick={() => void navigate({ to: '/workspace/$noteId', params: { noteId: act.id } })}
          >
            <SquareCheck size={12} aria-hidden="true" />
            <span className="truncate">{act.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
