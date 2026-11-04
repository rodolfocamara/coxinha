import { useTranslation } from 'react-i18next';
import { audioTime } from './RecordingInformation';
import type { useJointPlayback } from './useJointPlayback';
import { Pause, Play } from 'lucide-react';
import { Button } from '../../components/ui';

export function JointPlaybackControls({
  playback,
  beforePlay,
  multiple,
}: {
  playback: ReturnType<typeof useJointPlayback>;
  beforePlay: () => void;
  multiple: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="space-y-2 border-b border-border py-3"
      role="group"
      aria-label={t('recordingInfo.listen')}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          icon={
            playback.playing ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )
          }
          disabled={!playback.ready}
          onClick={() => {
            if (playback.playing) playback.stop();
            else {
              beforePlay();
              playback.play();
            }
          }}
        >
          {t(playback.playing ? 'recordingInfo.pause' : 'recordingInfo.listen')}
        </Button>
        <span className="text-xs tabular-nums">
          {audioTime(playback.time)} / {audioTime(playback.duration)}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs">
          {t('recordingInfo.volume')}
          <input
            className="w-20 accent-primary"
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={1}
            onChange={(e) => playback.volume(Number(e.target.value))}
          />
        </label>
      </div>
      <input
        className="w-full accent-primary"
        type="range"
        aria-label={t('recordingInfo.position')}
        min={0}
        max={playback.duration || 0}
        step={0.1}
        value={playback.time}
        disabled={!playback.ready}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />
      {!playback.ready && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('recordingInfo.loadingAudio')}
        </p>
      )}
      {playback.issue && (
        <p className="text-xs" role="alert">
          {t(`recordingInfo.${playback.issue}`)}
        </p>
      )}
      {multiple && (
        <p className="text-xs text-muted-foreground">{t('recordingInfo.jointNotice')}</p>
      )}
    </div>
  );
}
