import { useTranslation } from 'react-i18next';
import type { EmbeddingSpace } from './voiceCuration';
export function VoiceSpaceInfo({ space }: { space: EmbeddingSpace }) {
  const { t } = useTranslation();
  return (
    <details className="text-xs break-all">
      <summary className="cursor-pointer">
        {t('voiceCuration.space')} · {space.model} · {space.revision} · {space.dimension}
      </summary>
      <dl className="space-y-1 text-muted-foreground">
        <dt>{t('voiceCuration.modelHash')}</dt>
        <dd>{space.model_hash}</dd>
        <dt>{t('voiceCuration.preprocessing')}</dt>
        <dd>{space.preprocessing}</dd>
      </dl>
    </details>
  );
}
