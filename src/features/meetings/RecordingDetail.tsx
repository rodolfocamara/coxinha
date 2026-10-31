import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBoundedPlayback } from './useBoundedPlayback';
import { useJointPlayback } from './useJointPlayback';
import { JointPlaybackControls } from './JointPlaybackControls';
import { RecordingInformation } from './RecordingInformation';
import { ProcessingPanel } from './ProcessingPanel';
import { library, type LibraryDetail, type CaptureStatus } from './library';
import { Alert, Button } from '../../components/ui';
export function RecordingDetail({
  detail,
  status,
  onStatus,
  onRecover,
  showProcessing = true,
  processingPanelId,
  compact = false,
  people = false,
  playbackScope,
  onTranscript,
  onRevealAudio,
  audioExpanded = true,
  audioPanelId,
  showRecover = true,
  seekRef,
}: {
  detail: LibraryDetail;
  status: CaptureStatus;
  onStatus: (status: CaptureStatus) => void;
  onRecover: () => Promise<void>;
  showProcessing?: boolean;
  processingPanelId?: string;
  compact?: boolean;
  people?: boolean;
  playbackScope?: string;
  onTranscript?: () => void;
  onRevealAudio?: () => void;
  audioExpanded?: boolean;
  audioPanelId?: string;
  /** False when the screen offers recovery elsewhere (Reuniões finding banner). */
  showRecover?: boolean;
  /** Lets a parent (speaker lanes) seek the same players the transcript uses. */
  seekRef?: React.RefObject<((track: string, seconds: number) => void) | null>;
}) {
  const { t } = useTranslation();
  const key = (name: string) => t(`library.${name}`);
  const players = useRef<Record<string, HTMLAudioElement | null>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [separate, setSeparate] = useState(false);
  const view = people ? 'people' : processingPanelId ? 'transcript' : 'legacy';
  const joint = useJointPlayback(
    players,
    `${detail.meeting.id}:${playbackScope ?? view}:${audioExpanded}:${JSON.stringify(detail.audio)}`
  );
  const playback = useBoundedPlayback(
    players,
    `${detail.meeting.id}:${playbackScope ?? view}:${showProcessing}:${audioExpanded}`,
    showProcessing || people || audioExpanded,
    () => setError(key('playbackError'))
  );
  const [seekReveal, setSeekReveal] = useState(false);
  const [seekFocus, setSeekFocus] = useState<{ meeting: string; track: string } | null>(null);
  const audioVisible = audioExpanded || seekReveal;
  useLayoutEffect(() => {
    if (seekFocus?.meeting === detail.meeting.id && audioVisible) {
      players.current[seekFocus.track]?.focus();
      setSeekFocus(null);
    }
  }, [seekFocus, audioVisible, detail.meeting.id]);
  useLayoutEffect(() => {
    setSeekReveal(false);
    setSeekFocus(null);
    setSeparate(false);
  }, [detail.meeting.id]);
  const active = status.active;
  const seek = (track: string, start: number) => {
    const player = players.current[track];
    if (!player) {
      setError(key('playbackError'));
      return;
    }
    setError(null);
    // Preserve legacy full-track listening when it already owns playback.
    if (joint.active.current) joint.release();
    if (playback.current) playback.stop();
    setSeparate(true);
    player.currentTime = start;
    if (!audioVisible) {
      if (onRevealAudio) onRevealAudio();
      else setSeekReveal(true);
    }
    setSeekFocus({ meeting: detail.meeting.id, track });
  };
  useLayoutEffect(() => {
    if (!seekRef) return;
    seekRef.current = seek;
    return () => {
      seekRef.current = null;
    };
  });
  const errorText = (error: unknown) => String(error);
  return (
    <section className={compact ? 'space-y-2' : 'space-y-4'}>
      {error && <Alert tone="error">{error}</Alert>}
      {!compact && (
        <RecordingInformation
          storage={active?.meetingId === detail.meeting.id ? active.storage : detail.storage}
          processing={
            status.processing?.meetingId === detail.meeting.id ? status.processing.phase : undefined
          }
        />
      )}
      <>
        {!compact && <p className="text-sm">{key(`state.${detail.meeting.captureState}`)}</p>}
        {detail.audio && (
          <div id={audioPanelId} hidden={!audioVisible} className="space-y-2">
            <JointPlaybackControls
              playback={joint}
              beforePlay={() => {
                playback.stop();
                setError(null);
              }}
              multiple={Object.keys(detail.audio).length > 1}
            />
            <details
              open={separate}
              onToggle={(event) => {
                setSeparate(event.currentTarget.open);
                if (event.currentTarget.open && joint.active.current) joint.release();
              }}
            >
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {t('recordingInfo.separate')}
              </summary>
              <p className="text-sm text-muted-foreground">{key('playbackNotice')}</p>
              <div className={compact ? 'grid gap-3 grid-cols-1 xl:grid-cols-2' : 'space-y-4'}>
                {Object.entries(detail.audio).map(([kind, path]) => (
                  <div key={`${detail.meeting.id}-${kind}`}>
                    <p className="text-sm mb-1">{key(kind)}</p>
                    <audio
                      ref={(element) => {
                        players.current[kind] = element;
                      }}
                      aria-label={
                        kind === 'imported'
                          ? t('library.trackPlayback', { track: key(kind) })
                          : key(`${kind}Playback`)
                      }
                      onPlay={() => {
                        if (!joint.active.current) {
                          joint.claimIndividual();
                          playback.nativePlay(kind);
                        }
                      }}
                      onLoadedMetadata={joint.refresh}
                      onDurationChange={joint.refresh}
                      controls
                      tabIndex={0}
                      preload="metadata"
                      src={library.audioUrl(path)}
                      className="w-full min-w-0 max-w-full"
                      onError={() => setError(key('playbackError'))}
                    />
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        {detail.manifest?.tracks.some((track) => track.frames === 0) && (
          <Alert tone="warning">{key('emptyTrack')}</Alert>
        )}
        {detail.manifest && (!compact || audioVisible) && (
          <p className="text-xs text-muted-foreground break-words">{detail.manifest.alignment}</p>
        )}
        {showRecover &&
          ['recording', 'interrupted'].includes(detail.meeting.captureState) &&
          !active && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onRecover();
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {key('recover')}
            </Button>
          )}
        <div
          hidden={!showProcessing && !people}
          id={people ? 'session-panel-people' : processingPanelId}
          role={processingPanelId ? 'tabpanel' : undefined}
          aria-labelledby={
            processingPanelId
              ? people
                ? 'session-tab-people'
                : 'session-tab-transcript'
              : undefined
          }
          tabIndex={processingPanelId ? 0 : undefined}
        >
          <ProcessingPanel
            key={detail.meeting.id}
            meetingId={detail.meeting.id}
            closed={['finished', 'interrupted'].includes(detail.meeting.captureState)}
            status={status}
            onStatus={onStatus}
            view={view}
            playback={{
              ...playback,
              play: (excerpt) => {
                setError(null);
                joint.release();
                playback.play(excerpt);
              },
            }}
            onTranscript={onTranscript}
            onSeek={seek}
          />
        </div>
      </>
    </section>
  );
}
