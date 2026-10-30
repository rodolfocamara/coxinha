import { useCaptureDevices } from './useCaptureDevices';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef, useState } from 'react';
import { CaptureSection } from './CaptureSection';
import { RecordingDetail } from './RecordingDetail';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { library, type CaptureStatus, type LibraryDetail, type LibraryMeeting } from './library';
import { Alert, Button, EmptyState, PageHeader } from '../../components/ui';

export function LibraryView() {
  const { t } = useTranslation();
  const key = (name: string) => t(`library.${name}`);
  const desktop = library.available();
  const {
    sources,
    setSources,
    mic,
    setMic,
    output,
    setOutput,
    loading: devicesLoading,
    failed: devicesFailed,
    refreshSources,
  } = useCaptureDevices();
  const [meetings, setMeetings] = useState<LibraryMeeting[]>([]);
  const [status, setStatus] = useState<CaptureStatus>({ active: null, error: null });
  const [detail, setDetail] = useState<LibraryDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectionRequest = useRef(0);
  const captureRevision = useRef(0);
  const actionPending = useRef(false);
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
  async function refresh() {
    setMeetings(await library.list());
  }
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    const revision = captureRevision.current;
    Promise.allSettled([library.sources(), library.list(), library.status()]).then(([s, m, c]) => {
      if (!live) return;
      if (s.status === 'fulfilled') setSources(s.value);
      if (m.status === 'fulfilled') setMeetings(m.value);
      if (c.status === 'fulfilled' && revision === captureRevision.current) setStatus(c.value);
      const failures = [s, m, c].filter((r) => r.status === 'rejected');
      if (failures.length)
        setError(failures.map((r) => errorText((r as PromiseRejectedResult).reason)).join('; '));
    });
    return () => {
      live = false;
    };
  }, [desktop, setSources]);
  useEffect(() => {
    if (!desktop || (!status.active && !status.processing)) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = captureRevision.current;
      try {
        if (actionPending.current) return;
        const next = await library.status();
        if (live && revision === captureRevision.current && !actionPending.current) {
          setStatus(next);
          if (!next.active) await refresh();
        }
      } catch (e) {
        if (live && revision === captureRevision.current && !actionPending.current)
          setError(errorText(e));
      } finally {
        if (live) timer = setTimeout(poll, 250);
      }
    };
    timer = setTimeout(poll, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [desktop, status.active?.meetingId, status.processing?.meetingId]);
  async function select(id: string, clearError = true) {
    const request = ++selectionRequest.current;
    setSelected(id);
    setDetail(null);
    if (clearError) setError(null);
    try {
      const next = await library.detail(id);
      if (request === selectionRequest.current) setDetail(next);
    } catch (e) {
      if (request === selectionRequest.current) setError(errorText(e));
    }
  }
  async function act(action: () => Promise<CaptureStatus>) {
    captureRevision.current++;
    actionPending.current = true;
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      await refresh();
      if (selected) await select(selected, false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function importAudio() {
    setBusy(true);
    setError(null);
    try {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'WAV', extensions: ['wav'] }],
      });
      if (!path) return;
      const imported = await library.importAudio(title.trim(), path);
      ++selectionRequest.current;
      setSelected(imported.meeting.id);
      setDetail(imported);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const active = status.active;
  return (
    <div className="meeting-library h-full overflow-auto bg-card">
      <div className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 space-y-5">
        <PageHeader title={key('title')} description={key('intro')} />
        {!desktop && <Alert tone="info">{key('desktopRequired')}</Alert>}
        {(error || status.error) && (
          <Alert tone="error">{[error, status.error].filter(Boolean).join(' · ')}</Alert>
        )}
        <CaptureSection
          desktop={desktop}
          sources={sources}
          devicesLoading={devicesLoading}
          devicesFailed={devicesFailed}
          onRefreshDevices={() => void refreshSources()}
          onSystemDefaults={() => void refreshSources(true)}
          status={status}
          busy={busy}
          title={title}
          mic={mic}
          output={output}
          setTitle={setTitle}
          setMic={setMic}
          setOutput={setOutput}
          onImport={() => void importAudio()}
          onStart={() => void act(() => library.start(title.trim(), mic, output))}
          onPause={() => {
            if (active) void act(() => library.pause(!active.paused));
          }}
          onStop={() => void act(library.stop)}
        />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section aria-label={key('recordings')} className="min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight">{key('recordings')}</h2>
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={14} aria-hidden="true" />}
                disabled={!desktop || busy}
                onClick={() =>
                  void act(async () => {
                    const [sourcesResult, statusResult] = await Promise.allSettled([
                      library.sources(),
                      library.status(),
                    ]);
                    if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value);
                    else setError(errorText(sourcesResult.reason));
                    if (statusResult.status === 'rejected') throw statusResult.reason;
                    return statusResult.value;
                  })
                }
              >
                {key('refresh')}
              </Button>
            </div>
            {!meetings.length && <EmptyState title={key('empty')} />}
            {meetings.map((m) => (
              <button
                key={m.id}
                disabled={busy}
                className={`w-full text-left rounded-sm border-b border-border px-3 py-4 hover:bg-secondary/60 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected === m.id ? 'bg-secondary' : ''}`}
                aria-pressed={selected === m.id}
                onClick={() => void select(m.id)}
              >
                <span className="block font-medium break-words">{m.title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground mt-1">
                  {new Date(m.createdAt).toLocaleString()} · {key(`state.${m.captureState}`)}
                </span>
              </button>
            ))}
          </section>
          <section
            aria-label={key('detail')}
            className="min-w-0 border-t border-border pt-8 space-y-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 xl:pl-12"
          >
            {detail ? (
              <RecordingDetail
                detail={detail}
                status={status}
                onStatus={(next) => {
                  captureRevision.current++;
                  setStatus(next);
                }}
                onRecover={async () => {
                  setDetail(await library.recover(detail.meeting.id));
                  await refresh();
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {key(selected ? 'loading' : 'selectRecording')}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
