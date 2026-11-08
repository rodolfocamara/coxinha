import { expect, it } from 'vitest';
import i18n from '../../lib/i18n';
import { voiceCurationErrorCode, voiceCurationErrorText } from './voiceCurationError';
const codes = [
  'voice_curation_capacity_exceeded',
  'voice_curation_refresh_required',
  'voice_curation_busy',
  'voice_curation_inventory_row_invalid',
  'voice_curation_cursor_invalid',
];
for (const locale of ['en', 'pt-BR'])
  it.each(codes)(`localizes exact first-line %s with guidance in ${locale}`, async (code) => {
    await i18n.changeLanguage(locale);
    expect(voiceCurationErrorCode(new Error(`${code}\nsafe detail`))).toBe(code);
    const text = voiceCurationErrorText(`Error: ${code}\nsafe detail`, i18n.t);
    expect(text).not.toContain(code);
    expect(text).not.toContain('safe detail');
    expect(text.length).toBeGreaterThan(30);
  });
it('does not treat a code embedded in arbitrary details or partial names as the stable first line', () => {
  for (const value of [
    'other failure\nvoice_curation_busy',
    'voice_curation_busy_extra',
    'voice_curation_busy: arbitrary',
  ])
    expect(voiceCurationErrorCode(value)).toBeUndefined();
  expect(voiceCurationErrorText('Existing ordinary error', i18n.t)).toBe('Existing ordinary error');
});
