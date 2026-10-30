import type { TFunction } from 'i18next';
const codes = [
  'voice_curation_capacity_exceeded',
  'voice_curation_refresh_required',
  'voice_curation_busy',
  'voice_curation_inventory_row_invalid',
  'voice_curation_cursor_invalid',
] as const;
export function voiceCurationErrorCode(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const firstLine = text
    .split(/\r?\n/, 1)[0]
    .replace(/^Error:\s*/, '')
    .trim();
  return codes.find((code) => code === firstLine);
}
export function voiceCurationErrorText(error: unknown, t: TFunction) {
  const code = voiceCurationErrorCode(error);
  return code ? t(`voiceCuration.errors.${code}`) : String(error);
}
