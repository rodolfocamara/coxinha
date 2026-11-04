import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Sparkles } from 'lucide-react';
import { Alert, Button } from '../../components/ui';
import { live } from '../capture/live';
import { library, type MeetingSummary } from '../meetings/library';
import './summaryBlock.css';

const RECHECK_MS = 30_000;

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; summary: MeetingSummary | null; configured: boolean }
  | { kind: 'generating'; summary: MeetingSummary | null }
  | { kind: 'error'; summary: MeetingSummary | null; message: string };

/**
 * Spec 0108: the generated summary above the meeting notes. It is a
 * suggestion from the owner's own model (Memory, ADR 0015), so it says when
 * it was generated and can be regenerated.
 */
export function SummaryBlock({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const k = (key: string, options?: Record<string, unknown>) =>
    t(`meetingsHub.summary.${key}`, options);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    const [summary, settings] = await Promise.all([
      library.summary(meetingId).catch(() => null),
      live.titleSettings().catch(() => null),
    ]);
    const configured = !!settings?.enabled && !!settings.summaries;
    setState((current) =>
      current.kind === 'generating' ? current : { kind: 'ready', summary, configured }
    );
  }, [meetingId]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  // The background loop writes summaries on its own; look again while none.
  const waiting = state.kind === 'ready' && !state.summary && state.configured;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), RECHECK_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  if (state.kind === 'loading') return null;
  const summary = state.summary;
  const generate = () => {
    setState({ kind: 'generating', summary });
    library
      .summarize(meetingId)
      .then((next) => setState({ kind: 'ready', summary: next, configured: true }))
      .catch((error) => setState({ kind: 'error', summary, message: String(error) }));
  };
  const when = summary
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(summary.generatedAt))
    : null;
  const canGenerate = state.kind !== 'ready' || state.configured;

  return (
    <section className="mh-summary" aria-labelledby={`summary-${meetingId}`}>
      <header className="mh-summary-head">
        <h3 id={`summary-${meetingId}`}>
          <Sparkles size={14} aria-hidden="true" />
          {k('title')}
        </h3>
        {when && <span className="text-xs text-muted-foreground">{k('generated', { when })}</span>}
        <span className="flex-1" />
        {canGenerate && (
          <Button
            size="sm"
            variant="ghost"
            disabled={state.kind === 'generating'}
            icon={<RefreshCw size={13} aria-hidden="true" />}
            onClick={generate}
          >
            {state.kind === 'generating'
              ? k('generating')
              : summary
                ? k('regenerate')
                : k('generate')}
          </Button>
        )}
      </header>
      {summary ? (
        <SummaryMarkdown markdown={summary.markdown} />
      ) : state.kind === 'ready' && !state.configured ? (
        <p className="text-sm text-muted-foreground">{k('setup')}</p>
      ) : state.kind !== 'generating' && state.kind !== 'error' ? (
        <p className="text-sm text-muted-foreground">{k('none')}</p>
      ) : null}
      {state.kind === 'error' && (
        <Alert tone="error">{k('failed', { error: state.message })}</Alert>
      )}
    </section>
  );
}

/** Headings, bullets and paragraphs as text: the model's output never becomes HTML. */
export function SummaryMarkdown({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {bullets.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
    bullets = [];
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1].replace(/\*\*/g, ''));
      continue;
    }
    flush();
    if (heading) blocks.push(<h4 key={blocks.length}>{heading[1].replace(/\*\*/g, '')}</h4>);
    else if (line) blocks.push(<p key={blocks.length}>{line.replace(/\*\*/g, '')}</p>);
  }
  flush();
  return <div className="mh-summary-body">{blocks}</div>;
}
