/** Spec 0123 P2: time zones by country, since IANA ids hide the country's name. */
const CATALOG: [region: string, zone: string][] = [
  ['AE', 'Asia/Dubai'],
  ['AR', 'America/Argentina/Buenos_Aires'],
  ['AT', 'Europe/Vienna'],
  ['AU', 'Australia/Sydney'],
  ['AU', 'Australia/Perth'],
  ['BE', 'Europe/Brussels'],
  ['BO', 'America/La_Paz'],
  ['BR', 'America/Sao_Paulo'],
  ['BR', 'America/Manaus'],
  ['CA', 'America/Toronto'],
  ['CA', 'America/Vancouver'],
  ['CH', 'Europe/Zurich'],
  ['CL', 'America/Santiago'],
  ['CN', 'Asia/Shanghai'],
  ['CO', 'America/Bogota'],
  ['CR', 'America/Costa_Rica'],
  ['CZ', 'Europe/Prague'],
  ['DE', 'Europe/Berlin'],
  ['DK', 'Europe/Copenhagen'],
  ['DO', 'America/Santo_Domingo'],
  ['EC', 'America/Guayaquil'],
  ['EG', 'Africa/Cairo'],
  ['ES', 'Europe/Madrid'],
  ['FI', 'Europe/Helsinki'],
  ['FR', 'Europe/Paris'],
  ['GB', 'Europe/London'],
  ['GR', 'Europe/Athens'],
  ['HK', 'Asia/Hong_Kong'],
  ['IE', 'Europe/Dublin'],
  ['IL', 'Asia/Jerusalem'],
  ['IN', 'Asia/Kolkata'],
  ['IT', 'Europe/Rome'],
  ['JP', 'Asia/Tokyo'],
  ['KE', 'Africa/Nairobi'],
  ['KR', 'Asia/Seoul'],
  ['MX', 'America/Mexico_City'],
  ['MX', 'America/Tijuana'],
  ['MX', 'America/Cancun'],
  ['NG', 'Africa/Lagos'],
  ['NL', 'Europe/Amsterdam'],
  ['NO', 'Europe/Oslo'],
  ['NZ', 'Pacific/Auckland'],
  ['PA', 'America/Panama'],
  ['PE', 'America/Lima'],
  ['PL', 'Europe/Warsaw'],
  ['PT', 'Europe/Lisbon'],
  ['PY', 'America/Asuncion'],
  ['RO', 'Europe/Bucharest'],
  ['RU', 'Europe/Moscow'],
  ['SA', 'Asia/Riyadh'],
  ['SE', 'Europe/Stockholm'],
  ['SG', 'Asia/Singapore'],
  ['TR', 'Europe/Istanbul'],
  ['UA', 'Europe/Kyiv'],
  ['US', 'America/New_York'],
  ['US', 'America/Chicago'],
  ['US', 'America/Denver'],
  ['US', 'America/Los_Angeles'],
  ['UY', 'America/Montevideo'],
  ['VE', 'America/Caracas'],
  ['ZA', 'Africa/Johannesburg'],
];

export type ZoneOption = { id: string; label: string; country: string; city: string };

const LIMIT = 8;

const fold = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[_/]/g, ' ').toLowerCase();

const cityOf = (id: string) => id.slice(id.lastIndexOf('/') + 1).replace(/_/g, ' ');

function countryName(region: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(region) ?? region;
  } catch {
    return region;
  }
}

function ianaZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

/** Countries and cities first, then any other IANA name that matches. */
export function searchZones(query: string, locale: string, taken: string[] = []): ZoneOption[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const known = CATALOG.filter(([, id]) => !taken.includes(id)).flatMap(([region, id]) => {
    const country = countryName(region, locale);
    const names = [country, countryName(region, 'en'), cityOf(id), id].map(fold);
    const rank = names.some((n) => n.startsWith(q))
      ? 0
      : names.some((n) => n.includes(q)) || fold(region) === q
        ? 1
        : null;
    if (rank === null) return [];
    return [{ rank, option: { id, label: region, country, city: cityOf(id) } }];
  });
  const options = known.sort((a, b) => a.rank - b.rank).map((k) => k.option);
  const listed = new Set([...taken, ...CATALOG.map(([, id]) => id)]);
  const others = ianaZones()
    .filter((id) => !listed.has(id) && fold(id).includes(q))
    .map((id) => ({ id, label: '', country: '', city: cityOf(id) }));
  return [...options, ...others].slice(0, LIMIT);
}

/** The country code of a catalogued zone ("BR"), for this computer's column. */
export function regionOfZone(id: string | undefined) {
  return CATALOG.find(([, zone]) => zone === id)?.[0] ?? '';
}
