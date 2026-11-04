import { expect, it } from 'vitest';
import { invitationText, shownLocation } from './invitationText';

const LINE = '_'.repeat(80);
const SECRET = /FAKE|000 000|ny9|teams\.microsoft|https/i;

const english = [
  LINE,
  'Microsoft Teams meeting',
  'Join on your computer, mobile app or room device',
  'Click here to join the meeting',
  'Join: https://teams.microsoft.com/meet/000?p=FAKE',
  'Meeting ID: 000 000 000',
  'Passcode: FAKE123',
  'Download Teams | Join on the web',
  'Dial in by phone',
  '+1 555 0100,,000# United States, Springfield',
  'Phone conference ID: 000 000#',
  'Find a local number | Reset PIN',
  'Learn More | Meeting options',
  LINE,
].join('\r\n');

const portuguese = [
  LINE,
  'Reunião do Microsoft Teams',
  'Ingressar: https://teams.microsoft.com/meet/000?p=FAKE',
  'ID da Reunião: 000 000 000',
  'Senha: FAKE123',
  LINE,
].join('\n');

const spanish = [
  LINE,
  'Reunión de Microsoft Teams',
  'Unirse: https://teams.microsoft.com/meet/000?p=FAKE',
  'Id. de reunión: 000 000 000',
  'Código de acceso: FAKE123',
  'Marcar por teléfono',
  'Identificador de conferencia telefónica: 000#',
  'Buscar un número local | Restablecer PIN',
  LINE,
].join('\n');

const newerFormat = [
  'Microsoft Teams Need help? <https://aka.ms/JoinTeamsMeeting?omkt=en-US>',
  'Join the meeting now <https://teams.microsoft.com/l/meetup-join/FAKE>',
  'Meeting ID: 000 000 000',
  'Passcode: FAKE123',
  LINE,
  'Dial in by phone',
  '+1 555 0100,,000#',
  'Tenant key: FAKE@teams.ms',
  'Video ID: 000 000',
  LINE,
  'For organizers: Meeting options <https://teams.microsoft.com/FAKE> | Reset dial-in PIN',
  LINE,
  'Org help | Privacy and security',
].join('\n');

it.each([
  ['English', english],
  ['Portuguese', portuguese],
  ['Spanish', spanish],
  ['the newer format', newerFormat],
])('removes the Teams block in %s and shows no preview when nothing remains', (_, block) => {
  expect(invitationText(block)).toBeNull();
});

it.each([
  ['English', english],
  ['Portuguese', portuguese],
  ['Spanish', spanish],
  ['the newer format', newerFormat],
])('keeps what a person wrote around the block in %s', (_, block) => {
  const text = invitationText(`Agenda: rollout dates.\nRead the deck.\n${block}`);
  expect(text).toBe('Agenda: rollout dates.\nRead the deck.');
});

it('keeps text after the closing separator, and paragraph breaks', () => {
  const text = invitationText(`First point.\n\nSecond point.\n${portuguese}\nBring the numbers.`);
  expect(text).toBe('First point.\n\nSecond point.\nBring the numbers.');
});

it('handles a preview flattened into one line', () => {
  const flat = `Agenda: rollout. ${LINE} Microsoft Teams meeting Join: https://teams.microsoft.com/x?p=FAKE Meeting ID: 000 000 Passcode: FAKE123 ${LINE}`;
  expect(invitationText(flat)).toBe('Agenda: rollout.');
  expect(
    invitationText(
      'Reunião do Microsoft Teams Ingressar: https://teams.microsoft.com/x Senha: FAKE'
    )
  ).toBeNull();
});

it('handles a preview cut mid-block at the 255 character limit', () => {
  const cut = `Agenda.\n${LINE}\nMicrosoft Teams meeting\nJoin: https://teams.micro`;
  expect(invitationText(cut)).toBe('Agenda.');
  expect(invitationText(`Agenda.\n${LINE}\nReunião do Microsoft Teams\nSenha: FA`)).toBe('Agenda.');
  expect(invitationText(`Agenda.\n${LINE}`)).toBe('Agenda.');
});

it.each([
  ['Passcode: ny9Xa'],
  ['passcode:ny9Xa'],
  ['Senha: ny9Xa'],
  ['Senha de acesso: ny9Xa'],
  ['Código de acesso: ny9Xa'],
  ['Código de acceso: ny9Xa'],
  ['Contraseña: ny9Xa'],
  ['Clave de acceso: ny9Xa'],
  ['Password: ny9Xa'],
  ['PIN: ny9Xa'],
  ['Meeting ID: ny9Xa'],
  ['ID da Reunião: ny9Xa'],
  ['ID de la reunión: ny9Xa'],
  ['Id. de reunión: ny9Xa'],
  ['Join: https://teams.microsoft.com/l/ny9Xa'],
  ['Entrar https://teams.live.com/meet/ny9Xa'],
  ['https://teams.cloud.microsoft/l/ny9Xa'],
])('never shows a credential, even outside a block: %s', (line) => {
  expect(invitationText(line)).toBeNull();
  const text = invitationText(`Before it. ${line}\nAfter it.`);
  expect(text).not.toMatch(SECRET);
  expect(text).toContain('Before it.');
  expect(text).toContain('After it.');
});

it('keeps ordinary text that only resembles the block', () => {
  const plain = [
    'We will book a Microsoft Teams meeting room next week.',
    'Join us on Friday for the review.',
    'Spin: the new pricing story.',
    'Learn from the last rollout.',
    'Link: https://example.test/deck',
  ].join('\n');
  expect(invitationText(plain)).toBe(plain);
});

it('drops separators without a Teams block and keeps the rest', () => {
  expect(invitationText(`Item one\n${LINE}\nItem two`)).toBe('Item one\nItem two');
  expect(invitationText('____ short ____')).toBe('____ short ____');
});

it('treats markup as text and shows no preview for an empty one', () => {
  expect(invitationText('<img src=x onerror=alert(1)> Agenda')).toBe(
    '<img src=x onerror=alert(1)> Agenda'
  );
  expect(invitationText(null)).toBeNull();
  expect(invitationText(undefined)).toBeNull();
  expect(invitationText('')).toBeNull();
  expect(invitationText('  \r\n \n')).toBeNull();
  expect(invitationText(LINE)).toBeNull();
});

it('hides only the Teams placeholder, and only next to a join button', () => {
  expect(shownLocation('Reuniões do Microsoft Teams', true)).toBeNull();
  expect(shownLocation('Microsoft Teams Meeting', true)).toBeNull();
  expect(shownLocation('Reunión de Microsoft Teams', true)).toBeNull();
  expect(shownLocation('Reuniões do Microsoft Teams', false)).toBe('Reuniões do Microsoft Teams');
  expect(shownLocation('Room 4; Microsoft Teams Meeting', true)).toBe(
    'Room 4; Microsoft Teams Meeting'
  );
  expect(shownLocation('  ', false)).toBeNull();
  expect(shownLocation(null, true)).toBeNull();
});
