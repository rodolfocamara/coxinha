import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pencil, Search } from 'lucide-react';
import { Button, Input, Textarea } from '../../components/ui';
import { buildLanes } from '../meetingsHub/lanes';
import { mediaClock } from '../meetingsHub/format';
import { library, type ProcessingReport } from './library';
import { findHits, groupSegments, shownText, type Hit } from './transcriptReader';

type Segment = ProcessingReport['segments'][number];
type Speaker = { name: string; colour: string; confirmed: boolean };

/**
 * The transcript as something to read (spec 0109): speaker turns, a time that
 * seeks the audio, find-in-transcript, and corrections opened one line at a time.
 */
export function TranscriptReader({
  meetingId,
  report,
  busy,
  act,
  onSeek,
  initialQuery = '',
  versionSelector,
}: {
  meetingId: string;
  /** Spec 0122: opens found at the universal search's text. */
  initialQuery?: string;
  report: ProcessingReport;
  busy: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
  onSeek: (track: string, seconds: number) => void;
  versionSelector?: ReactNode;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`library.processing.reader.${key}`, options);
  const [query, setQuery] = useState(initialQuery);
  const [current, setCurrent] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const { lanes, totalMs } = useMemo(() => buildLanes(report), [report]);
  const hits = useMemo(() => findHits(report, query), [report, query]);
  const groups = useMemo(() => groupSegments(report.segments), [report.segments]);
  const end = Math.max(totalMs, ...report.segments.map((s) => s.end_ms), 0);

  const speaker = (segment: Segment): Speaker => {
    const lane = lanes.find((l) => l.track === segment.track && l.speaker === segment.speaker);
    if (!lane)
      return {
        name: t('library.processing.anonymous'),
        colour: 'var(--color-muted-foreground)',
        confirmed: false,
      };
    return lane.name
      ? { name: lane.name, colour: `oklch(var(--p${lane.hue}))`, confirmed: true }
      : {
          name: t('meetingsHub.lanes.unknown', { n: lane.index }),
          colour: 'var(--color-warning)',
          confirmed: false,
        };
  };

  useEffect(() => {
    list.current
      ?.querySelector('mark[data-current]')
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [current, hits]);

  const step = (by: number) => {
    if (!hits.length) return;
    setCurrent((n) => (n + by + hits.length) % hits.length);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <span>
          {k('speakers', { count: lanes.length })} · {mediaClock(end)}
        </span>
        {versionSelector && <div className="ml-auto min-w-56">{versionSelector}</div>}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            className="pl-8"
            aria-label={k('find')}
            placeholder={k('find')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCurrent(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
            }}
          />
        </div>
        {query.trim() && (
          <>
            <span className="min-w-16 text-center text-sm text-muted-foreground" aria-live="polite">
              {hits.length
                ? k('matches', { current: current + 1, total: hits.length })
                : k('noMatches')}
            </span>
            <Button
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={k('previous')}
              disabled={!hits.length}
              icon={<ChevronUp size={15} aria-hidden="true" />}
              onClick={() => step(-1)}
            />
            <Button
              size="sm"
              iconOnly
              variant="ghost"
              aria-label={k('next')}
              disabled={!hits.length}
              icon={<ChevronDown size={15} aria-hidden="true" />}
              onClick={() => step(1)}
            />
          </>
        )}
      </div>
      <div ref={list} className="space-y-5" aria-label={k('label')} role="list">
        {groups.map((group) => {
          const who = speaker(group.segments[0]);
          return (
            <section key={group.key} role="listitem" aria-label={who.name} className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <i
                  aria-hidden="true"
                  className="inline-block size-2 rounded-full"
                  // A ring, not a dot, while nobody confirmed who this voice is.
                  style={
                    who.confirmed
                      ? { background: who.colour }
                      : { boxShadow: `inset 0 0 0 1.5px ${who.colour}` }
                  }
                />
                {who.name}
              </p>
              {group.segments.map((segment) => (
                <Line
                  key={segment.id}
                  report={report}
                  segment={segment}
                  speaker={who.name}
                  hits={hits}
                  current={hits[current]}
                  editing={editing === segment.id}
                  busy={busy}
                  onEdit={(open) => setEditing(open ? segment.id : null)}
                  onSeek={onSeek}
                  onSave={async (text) => {
                    let saved = false;
                    await act(async () => {
                      await library.editSegment(meetingId, `${report.job}:${segment.id}`, text);
                      saved = true;
                    });
                    if (saved) setEditing(null);
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Line({
  report,
  segment,
  speaker,
  hits,
  current,
  editing,
  busy,
  onEdit,
  onSeek,
  onSave,
}: {
  report: ProcessingReport;
  segment: Segment;
  speaker: string;
  hits: Hit[];
  current: Hit | undefined;
  editing: boolean;
  busy: boolean;
  onEdit: (open: boolean) => void;
  onSeek: (track: string, seconds: number) => void;
  onSave: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`library.processing.reader.${key}`, options);
  const text = shownText(report, segment);
  const corrected = report.corrections?.[segment.id] != null;
  const [draft, setDraft] = useState(text);
  const time = mediaClock(segment.start_ms);
  const ranges = hits.filter((h) => h.segment === segment.id);

  const parts: ReactNode[] = [];
  let at = 0;
  for (const hit of ranges) {
    const [from, to] = hit.range;
    if (from > at) parts.push(text.slice(at, from));
    const isCurrent = current?.segment === hit.segment && current.range[0] === from;
    parts.push(
      <mark
        key={from}
        data-current={isCurrent || undefined}
        className={`rounded-sm px-0.5 text-foreground ${isCurrent ? 'bg-primary/45 ring-1 ring-primary' : 'bg-primary/20'}`}
      >
        {text.slice(from, to)}
      </mark>
    );
    at = to;
  }
  parts.push(text.slice(at));

  return (
    <div className="group grid grid-cols-[3.5rem_1fr_auto] items-start gap-x-2">
      <button
        type="button"
        className="mt-1 justify-self-start rounded-sm px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={k('seek', { time, speaker })}
        onClick={() => onSeek(segment.track, segment.start_ms / 1000)}
      >
        {time}
      </button>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            autoFocus
            aria-label={k('correction')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(text);
                onEdit(false);
              }
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy || draft === text}
              onClick={() => void onSave(draft)}
            >
              {k('save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(text);
                onEdit(false);
              }}
            >
              {k('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="text-base leading-7 whitespace-pre-wrap break-words">{parts}</p>
          {corrected && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">{k('corrected')}</summary>
              <p>{k('original', { text: segment.text })}</p>
            </details>
          )}
        </div>
      )}
      {!editing && (
        <Button
          size="sm"
          iconOnly
          variant="ghost"
          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
          aria-label={k('correct', { time })}
          icon={<Pencil size={13} aria-hidden="true" />}
          onClick={() => {
            setDraft(text);
            onEdit(true);
          }}
        />
      )}
    </div>
  );
}
