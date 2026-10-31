import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { validVoiceOrigin, type ProfilesPage } from './voiceCuration';
import { voiceCurationErrorText } from './voiceCurationError';
import { ChevronRight } from 'lucide-react';
import { Alert, Button, Field, Input } from '../../components/ui';
import { voiceTime } from './voiceControls';
import { VoiceSpaceInfo } from './VoiceSpaceInfo';
import { usePersonSamples } from '../people/usePersonSamples';

/** Collapsible sample inventory for one person (meeting speaker review). */
export function PersonVoiceSamples({
  person,
  version,
  disabled,
  act,
  generation,
  onStale,
}: {
  person: ProfilesPage['profiles'][number];
  generation: number | null;
  onStale: () => void;
  version: unknown;
  disabled: boolean;
  act: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const k = (name: string) => t(`voiceCuration.${name}`);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const samples = usePersonSamples({
    personId: person.personId,
    enabled: open,
    version,
    generation,
    onStale,
    disabled,
    act,
  });
  const { query, stats, busy, locked, error } = samples;
  useEffect(() => {
    if (query.stale) setOrigin('');
  }, [query.stale]);
  async function revoke(sampleId: string) {
    const attempted = validVoiceOrigin(origin) && !locked;
    await samples.revoke(sampleId, origin);
    if (attempted) setOrigin('');
  }
  return (
    <details
      className="group rounded-md border border-border bg-card"
      onToggle={(e) => {
        if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
      }}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-ui font-medium break-words hover:bg-secondary">
        <ChevronRight
          size={14}
          aria-hidden="true"
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        {person.name} · {person.personId}
      </summary>
      {open && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          {query.loading && (
            <p role="status" className="text-ui text-muted-foreground">
              {k('loading')}
            </p>
          )}
          {query.stale && <Alert tone="warning">{k('staleView')}</Alert>}
          {!!error && <Alert tone="error">{voiceCurationErrorText(error, t)}</Alert>}
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || busy || query.loading}
            onClick={() => {
              setOrigin('');
              samples.restart();
            }}
          >
            {k(query.stale ? 'restartSamples' : 'refresh')}
          </Button>
          {query.loaded && (
            <>
              <p role="status" className="text-ui">
                {t(
                  `voiceCuration.${query.more ? 'samplesLoadedPartial' : 'samplesLoadedComplete'}`,
                  { count: query.items.length }
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`voiceCuration.${query.more ? 'loadedCountsPartial' : 'loadedCountsComplete'}`, {
                  active: stats.active,
                  revoked: stats.revoked,
                  invalidated: stats.invalidated,
                })}
              </p>
              {query.items.length === 0 && !query.more && (
                <p role="status" className="text-ui text-muted-foreground">
                  {k('noSamples')}
                </p>
              )}
              {stats.groups.length === 0 && (
                <p className="text-ui text-muted-foreground">{k('noLoadedActiveSpace')}</p>
              )}
              {stats.groups.map(([key, group]) => (
                <div key={key} className="space-y-1">
                  <VoiceSpaceInfo space={group.space} />
                  <p className="text-xs">
                    {t(
                      `voiceCuration.${query.more ? 'loadedSpacePartial' : 'loadedSpaceComplete'}`,
                      { count: group.count, duration: voiceTime(group.duration) }
                    )}
                  </p>
                </div>
              ))}
              <Field label={k('revokeOrigin')} hint={k('revokeHelp')}>
                <Input
                  value={origin}
                  disabled={locked}
                  required
                  onChange={(e) => setOrigin(e.target.value)}
                />
              </Field>
              {query.items.map((sample) => (
                <div
                  key={sample.sampleId}
                  className="space-y-2 border-t border-border pt-3 text-xs break-words"
                >
                  <p>
                    {sample.sampleId} · {t(`voiceCuration.sampleStates.${sample.state}`)}
                  </p>
                  <VoiceSpaceInfo space={sample.space} />
                  <p>
                    {sample.meetingId} · {t(`library.${sample.track}`)} ·{' '}
                    {voiceTime(sample.startMs)}–{voiceTime(sample.endMs)}
                  </p>
                  <p>
                    {k('sampleRevision')}: {sample.assignmentRevision} /{' '}
                    {sample.currentAssignmentRevision}
                  </p>
                  <p>
                    {k('createdUtc')}: {sample.createdAt} UTC
                  </p>
                  {sample.state === 'revoked' && (
                    <p>
                      {k('revokedUtc')}:{' '}
                      {sample.revokedAt ? `${sample.revokedAt} UTC` : k('unknownDate')}
                    </p>
                  )}
                  {sample.state === 'active' && (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={locked || !validVoiceOrigin(origin)}
                      onClick={() => void revoke(sample.sampleId)}
                    >
                      {k('revokeSample')}
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
          {query.more && (
            <Button
              size="sm"
              disabled={disabled || busy || query.loading || query.stale}
              onClick={query.loadMore}
            >
              {k('loadMoreSamples')}
            </Button>
          )}
        </div>
      )}
    </details>
  );
}
