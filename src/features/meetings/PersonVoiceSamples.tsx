import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  voiceCuration,
  validVoiceOrigin,
  type ProfilesPage,
  type PersonSamples,
} from './voiceCuration';
import { useVoiceInventoryPages } from './useVoiceInventoryPages';
import { voiceCurationErrorText } from './voiceCurationError';
import { ChevronRight } from 'lucide-react';
import { Alert, Button, Field, Input } from '../../components/ui';
import { voiceTime } from './voiceControls';
import { VoiceSpaceInfo } from './VoiceSpaceInfo';

function loadedStats(samples: PersonSamples['samples']) {
  const groups = new Map<
    string,
    { space: PersonSamples['samples'][number]['space']; count: number; duration: number }
  >();
  let revoked = 0;
  let invalidated = 0;
  let active = 0;
  for (const sample of samples) {
    if (sample.state === 'revoked') {
      revoked++;
      continue;
    }
    if (sample.state === 'invalidated') {
      invalidated++;
      continue;
    }
    active++;
    const space = sample.space;
    const key = JSON.stringify([
      space.model,
      space.revision,
      space.model_hash,
      space.preprocessing,
      space.dimension,
    ]);
    const group = groups.get(key) ?? { space, count: 0, duration: 0 };
    group.count++;
    group.duration += sample.endMs - sample.startMs;
    groups.set(key, group);
  }
  return { active, revoked, invalidated, groups: [...groups.entries()] };
}
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
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const query = useVoiceInventoryPages(
    open,
    person.personId,
    version,
    async (cursor) => {
      const page = await voiceCuration.samplesPage(person.personId, cursor);
      if (page.personId !== person.personId) throw new Error('voice_curation_refresh_required');
      return { ...page, items: page.samples };
    },
    (sample) => sample.sampleId,
    { generation, onStale }
  );
  useEffect(() => {
    if (query.stale) setOrigin('');
  }, [query.stale]);
  const stats = loadedStats(query.items);
  const locked = disabled || busy || !query.fresh;
  async function revoke(sampleId: string) {
    if (
      locked ||
      pending.current ||
      !validVoiceOrigin(origin) ||
      !query.items.some((sample) => sample.sampleId === sampleId && sample.state === 'active')
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await act(async () => {
        try {
          await voiceCuration.revoke(person.personId, sampleId, origin.trim());
        } catch (failure) {
          setError(failure);
          throw failure;
        } finally {
          setOrigin('');
          query.invalidate();
        }
      });
    } catch (failure) {
      setError(failure);
    } finally {
      pending.current = false;
      setBusy(false);
    }
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
          {!!(error || query.error) && (
            <Alert tone="error">{voiceCurationErrorText(error || query.error, t)}</Alert>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || busy || query.loading}
            onClick={() => {
              setOrigin('');
              setError(null);
              query.restart();
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
