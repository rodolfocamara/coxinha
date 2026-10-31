import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Headphones, Square } from 'lucide-react';
import { Badge, Button, Field, Input } from '../../components/ui';
import { validVoiceOrigin } from '../meetings/voiceCuration';
import { voiceTime } from '../meetings/voiceControls';
import type { VoiceSample } from './usePersonSamples';

const TRACKS: Record<string, string> = { mic: 'mic', output: 'output' };
function trackLabel(track: string, t: (key: string) => string) {
  return TRACKS[track] ? t(`people.settings.${TRACKS[track]}.title`) : track;
}

export function sampleDate(createdAt: string, locale?: string) {
  const date = new Date(createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * One voice sample in the person's card: where it came from, listen, and a
 * revoke that asks for a reason inline before calling the backend.
 */
export function SampleRow({
  sample,
  meetingTitle,
  playing,
  onListen,
  confirming,
  onRevoke,
  onCancel,
  origin,
  onOrigin,
  onConfirm,
  locked,
}: {
  sample: VoiceSample;
  meetingTitle: string;
  playing: boolean;
  onListen: () => void;
  confirming: boolean;
  onRevoke: () => void;
  onCancel: () => void;
  origin: string;
  onOrigin: (value: string) => void;
  onConfirm: () => void;
  locked: boolean;
}) {
  const { t, i18n } = useTranslation();
  const confirmId = useId();
  const active = sample.state === 'active';
  const title = `${meetingTitle} · ${voiceTime(sample.startMs)}–${voiceTime(sample.endMs)}`;
  return (
    <li className="border-t border-border first:border-t-0">
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className={'truncate text-ui font-medium ' + (active ? '' : 'text-muted-foreground')}>
            {title}
          </p>
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {trackLabel(sample.track, t)} ·{' '}
            {t('people.sample.saved', {
              date: sampleDate(sample.createdAt, i18n?.resolvedLanguage),
            })}
            {!active && (
              <Badge tone={sample.state === 'revoked' ? 'neutral' : 'warning'}>
                {t(`people.sample.states.${sample.state}`)}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={t(playing ? 'people.sample.stop' : 'people.sample.listen')}
            title={t(playing ? 'people.sample.stop' : 'people.sample.listen')}
            aria-pressed={playing}
            icon={
              playing ? (
                <Square size={14} aria-hidden="true" />
              ) : (
                <Headphones size={14} aria-hidden="true" />
              )
            }
            onClick={onListen}
          />
          {active && (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={confirming}
              aria-controls={confirming ? confirmId : undefined}
              disabled={locked}
              onClick={confirming ? onCancel : onRevoke}
            >
              {t('people.sample.revoke')}
            </Button>
          )}
        </div>
      </div>
      {confirming && active && (
        <form
          id={confirmId}
          role="group"
          aria-label={t('people.revoke.title')}
          className="mx-4 mb-3 space-y-3 rounded-lg bg-secondary p-3"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <div>
            <p className="font-medium">{t('people.revoke.title')}</p>
            <p className="text-xs text-muted-foreground">{t('people.revoke.body')}</p>
          </div>
          <Field label={t('people.revoke.reason')} hint={t('people.revoke.reasonHint')} required>
            <Input
              autoFocus
              value={origin}
              disabled={locked}
              onChange={(event) => onOrigin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={onCancel}>
              {t('people.revoke.cancel')}
            </Button>
            <Button
              size="sm"
              type="submit"
              variant="danger"
              disabled={locked || !validVoiceOrigin(origin)}
            >
              {t('people.revoke.confirm')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
