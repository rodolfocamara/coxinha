import { describe, expect, it } from 'vitest';
import { regionOfZone, searchZones } from './zoneCatalog';

const ids = (query: string, locale = 'pt-BR', taken: string[] = []) =>
  searchZones(query, locale, taken).map((o) => o.id);

describe('searchZones', () => {
  it('finds a zone by country in the app language or in English', () => {
    expect(ids('Israel')).toEqual(['Asia/Jerusalem']);
    expect(ids('méxico')[0]).toBe('America/Mexico_City');
    expect(ids('mexico', 'en')[0]).toBe('America/Mexico_City');
    expect(ids('Alemanha')).toEqual(['Europe/Berlin']);
    expect(ids('Germany')).toEqual(['Europe/Berlin']);
  });

  it('finds a zone by city without accents and by IANA name', () => {
    expect(ids('sao paulo')).toEqual(['America/Sao_Paulo']);
    expect(ids('São Paulo')).toEqual(['America/Sao_Paulo']);
    expect(ids('Asia/Jerusalem')).toEqual(['Asia/Jerusalem']);
    expect(ids('Asia/Tashkent')).toEqual(['Asia/Tashkent']);
  });

  it('labels with the country code and lists each city of a large country', () => {
    const [first] = searchZones('Israel', 'en');
    expect(first).toEqual({
      id: 'Asia/Jerusalem',
      label: 'IL',
      country: 'Israel',
      city: 'Jerusalem',
    });
    expect(ids('Estados Unidos')).toHaveLength(4);
  });

  it('skips what is already listed and waits for two letters', () => {
    expect(ids('Israel', 'pt-BR', ['Asia/Jerusalem'])).toEqual([]);
    expect(ids('i')).toEqual([]);
  });

  it('knows the country of this computer zone', () => {
    expect(regionOfZone('America/Sao_Paulo')).toBe('BR');
    expect(regionOfZone('Mars/Base')).toBe('');
    expect(regionOfZone(undefined)).toBe('');
  });
});
