/**
 * Spec 0126 P4: what a person wrote in an invitation, without the block Teams
 * appends. The text is untrusted and stays plain text; a passcode must never
 * survive, so credential labels are removed even outside a detected block.
 */
const SEPARATOR = /\s*_{5,}\s*/g;
const MARK = '\u0000';

const HEADINGS = [
  'microsoft teams meeting',
  'reuni[aã]o do microsoft teams',
  'reuni[oó]n de microsoft teams',
  'dial[- ]in by phone',
  'discar por telefone',
  'ingressar por telefone',
  'marcar por tel[eé]fono',
  'unirse por tel[eé]fono',
].join('|');
const AFTER_HEADING =
  '\\s*(?:$|\\+|join|ingressar|entrar|participar|participe|unirse|[uú]nase|click|clique|haga|meeting id|id |find|localizar|buscar)';
const HELP_HEADING = 'microsoft teams\\s+(?:need help|precisa de ajuda|¿?necesita ayuda)';
const BLOCK_START = `(?:${HEADINGS})(?=${AFTER_HEADING})|${HELP_HEADING}`;
const SPLIT_BLOCK = new RegExp(`(?<=[^\\n])(?:${BLOCK_START})`, 'gimu');
const STARTS_BLOCK = new RegExp(`^(?:${BLOCK_START})`, 'imu');

const BEFORE = '(?<![\\p{L}\\p{N}])';
const CREDENTIAL = new RegExp(
  `${BEFORE}(?:meeting id|id da reuni[aã]o|id de la reuni[oó]n|id\\.? de reuni[oó]n|identificador de reuni[oó]n|` +
    'passcode|password|pwd|senha(?: de acesso)?|c[oó]digo de acesso|c[oó]digo de acceso|contrase[nñ]a|clave(?: de acceso)?|pin|' +
    'phone conference id|id de confer[eê]ncia(?: telef[oô]nica)?|id\\.? de conferencia(?: telef[oó]nica)?|identificador de conferencia(?: telef[oó]nica)?|' +
    'tenant key|chave do locat[aá]rio|clave de(?:l)? inquilino|video id|id de v[ií]deo|id\\.? de v[ií]deo)\\s*:',
  'iu'
);
const TEAMS_LINK =
  /\S*(?:https?:\/\/)?\S*(?:teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|aka\.ms\/jointeamsmeeting)\S*/iu;
const JOIN_PHRASE =
  /join the meeting now|ingressar na reuni[aã]o agora|participar da reuni[aã]o agora|unirse a la reuni[oó]n ahora|click here to join|clique aqui para (?:participar|ingressar)|haga clic aqu[ií] para unirse|join on your computer|join on a video|ingressar no seu computador|participe pelo computador|[uú]nase a trav[eé]s del|unirse a trav[eé]s de/iu;
const FOOTER =
  /^\W*(?:need help|precisa de ajuda|¿?necesita ayuda|learn more|saiba mais|m[aá]s informaci[oó]n|more info|mais informa[cç][oõ]es|meeting options|op[cç][oõ]es de reuni[aã]o|opciones de reuni[oó]n|reset (?:dial-in )?pin|redefinir pin|restablecer pin|find a local number|localizar um n[uú]mero local|buscar un n[uú]mero local|for organizers|para organizadores|privacy and security|privacidade e seguran[cç]a|privacidad y seguridad|org help|system reference)\b/iu;
const LEFTOVER_JOIN = /^\W*(?:join|ingressar|entrar|participar|unirse)\b[^.!?]{0,20}$/iu;
const LOOSE_END = /[\s<([|:–—-]+$/u;

function scrub(line: string): string | null {
  if (FOOTER.test(line)) return null;
  const link = line.search(TEAMS_LINK);
  const cuts = [link, line.search(CREDENTIAL), line.search(JOIN_PHRASE)].filter((at) => at >= 0);
  if (!cuts.length) return line;
  const left = line.slice(0, Math.min(...cuts)).replace(LOOSE_END, '');
  return left && !LEFTOVER_JOIN.test(left) ? left : null;
}

export function invitationText(preview: string | null | undefined): string | null {
  if (!preview) return null;
  const lines = preview
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .replace(SEPARATOR, `\n${MARK}\n`)
    .replace(SPLIT_BLOCK, '\n$&')
    .split('\n');
  const kept: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === MARK) inBlock = false;
    else if (STARTS_BLOCK.test(line)) inBlock = true;
    else if (!inBlock && !line) kept.push('');
    else if (!inBlock) {
      const clean = scrub(line);
      if (clean) kept.push(clean);
    }
  }
  const text = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return /[\p{L}\p{N}]/u.test(text) ? text : null;
}

const TEAMS_LOCATION =
  /^(?:microsoft teams(?: meeting)?|reuni[oõ]es do microsoft teams|reuni[aã]o do microsoft teams|reuni[oó]n de microsoft teams|reuniones de microsoft teams)$/iu;

/** Teams' placeholder says nothing next to a join button; elsewhere it says "online". */
export function shownLocation(location: string | null | undefined, joinable: boolean) {
  const text = location?.trim();
  if (!text) return null;
  return joinable && TEAMS_LOCATION.test(text) ? null : text;
}
