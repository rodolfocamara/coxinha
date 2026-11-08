import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '../../components/ui';
import { live, type TitleSuggestion } from '../capture/live';

/**
 * "título sugerido · Desfazer" (spec 0097 P4, ADR 0015): the title came from
 * the LLM, is labelled as such and can be dismissed in one click.
 */
export function TitleSuggestionNote({ meetingId, title }: { meetingId: string; title: string }) {
  const { t } = useTranslation();
  const [suggestion, setSuggestion] = useState<TitleSuggestion | null>(null);
  useEffect(() => {
    let alive = true;
    live
      .suggestion(meetingId)
      .then((value) => alive && setSuggestion(value))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meetingId, title]);
  if (!suggestion?.applied || suggestion.dismissed || suggestion.title !== title) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles size={13} aria-hidden="true" />
      <span
        title={t('meetingsHub.suggested.source', {
          model: suggestion.model,
          host: suggestion.endpointHost,
        })}
      >
        {t('meetingsHub.suggested.label')}
      </span>
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          void live
            .dismissSuggestion(meetingId)
            .then(setSuggestion)
            .catch(() => {})
        }
      >
        {t('meetingsHub.suggested.undo')}
      </Button>
    </span>
  );
}
