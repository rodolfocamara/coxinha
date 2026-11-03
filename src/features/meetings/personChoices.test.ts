import { describe, expect, it } from 'vitest';
import {
  matchChoices,
  mergeParticipants,
  nameKey,
  personChoices,
  resolveTyped,
} from './personChoices';

const people = [
  { id: 'p-ana', name: 'Ana Souza' },
  { id: 'p-joao-1', name: 'João' },
  { id: 'p-joao-2', name: 'Joao' },
];
const choices = personChoices(people, [{ name: 'Bruno Lima', email: 'bruno@x.com' }]);

describe('personChoices', () => {
  it('folds case, accents and spacing', () => {
    expect(nameKey('  JOÃO   da Silva ')).toBe('joao da silva');
  });

  it('matches names and invitee e-mails', () => {
    expect(matchChoices(choices, 'souz').map((c) => c.id)).toEqual(['p-ana']);
    expect(matchChoices(choices, 'BRUNO@').map((c) => c.id)).toEqual(['invitee:0']);
    expect(matchChoices(choices, '')).toHaveLength(4);
  });

  it('resolves one exact name, a new name, and never a homonym', () => {
    expect(resolveTyped(choices, ' ana   souza')).toMatchObject({ kind: 'person', id: 'p-ana' });
    expect(resolveTyped(choices, 'bruno lima')).toMatchObject({ kind: 'invitee' });
    expect(resolveTyped(choices, '  Carla   Dias ')).toEqual({
      kind: 'new',
      id: 'new:carla dias',
      label: 'Carla Dias',
    });
    expect(resolveTyped(choices, 'joao')).toBeNull();
    expect(resolveTyped(choices, 'João (p-joao-1)')).toMatchObject({ id: 'p-joao-1' });
    expect(resolveTyped(choices, '   ')).toBeNull();
  });

  it('merges participant lists once by e-mail, then name', () => {
    expect(
      mergeParticipants(
        [
          { name: 'Ana', email: 'ANA@x.com' },
          { name: 'Bruno', email: null },
        ],
        [
          { name: 'Ana Souza', email: 'ana@x.com' },
          { name: ' bruno ', email: 'b@x.com' },
          { name: ' ', email: null },
        ]
      )
    ).toEqual([
      { name: 'Ana', email: 'ANA@x.com' },
      { name: 'Bruno', email: null },
    ]);
  });
});
