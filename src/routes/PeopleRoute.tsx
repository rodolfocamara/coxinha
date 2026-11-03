import { useSearch } from '@tanstack/react-router';
import { PeopleDirectory } from '../features/meetings/PeopleDirectory';

export type PeopleSearch = { person?: string; name?: string };

/** `?person=` (with its name, shown before the page is loaded) opens that person. */
export function validatePeopleSearch(search: Record<string, unknown>): PeopleSearch {
  const out: PeopleSearch = {};
  if (typeof search.person === 'string' && search.person) out.person = search.person;
  if (typeof search.name === 'string') out.name = search.name;
  return out;
}

/** `/people`: renders inside the persistent Shell's main view. */
export function PeopleRoute() {
  const search = validatePeopleSearch(useSearch({ strict: false }) as Record<string, unknown>);
  return (
    <PeopleDirectory
      opened={search.person ? { personId: search.person, name: search.name ?? '' } : undefined}
    />
  );
}
