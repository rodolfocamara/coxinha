// Spec 0126: one calendar with every state of the meeting detail panel. Only
// active with state detail=1, and named to load last so it replaces the others.
(() => {
  const state = window.__cxState || {};
  if (!state.detail) return;
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const at = (days, hours, minutes = 0) => {
    const now = new Date();
    return `${new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes)
      .toISOString()
      .slice(0, 19)}Z`;
  };
  const firstNames = 'Ana Bruno Carla Diego Elisa Fabio Gabriela Hugo Irene Joao Karina Lucas Marina Nuno Olivia Paulo Queila Rafael Sonia Tiago'.split(' ');
  const lastNames = 'Almeida Barros Cardoso Duarte Esteves Freitas Gomes Henriques'.split(' ');
  const person = (i, response, kind = 'required') => {
    const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`;
    return { name, email: `${name.split(' ')[0].toLowerCase()}@example.test`, response, kind };
  };
  const invited = (...groups) => {
    let i = 0;
    return groups.flatMap(([count, response, kind]) =>
      Array.from({ length: count }, () => person(i++, response, kind))
    );
  };
  const nine = [
    ...invited([1, 'accepted', 'optional'], [5, 'notResponded', 'required'], [3, 'notResponded', 'optional']),
    { name: 'Room 4', email: 'room4@example.test', response: 'accepted', kind: 'resource' },
  ];
  const forty = invited(
    [10, 'accepted', 'required'],
    [4, 'accepted', 'optional'],
    [3, 'tentativelyAccepted', 'required'],
    [4, 'declined', 'optional'],
    [12, 'notResponded', 'required'],
    [7, 'notResponded', 'optional']
  );
  const small = [
    { ...person(0, 'organizer'), name: 'Ana Almeida' },
    person(1, 'accepted'),
    person(2, 'tentativelyAccepted', 'optional'),
    person(3, 'declined'),
    person(4, 'notResponded'),
  ];
  const teamsBlock = [
    '________________________________________________________________________________',
    'Microsoft Teams meeting',
    'Join: https://teams.microsoft.com/meet/000000000000000?p=FAKEFAKEFAKE',
    'Meeting ID: 000 000 000 000 000',
    'Passcode: FAKE000',
    '________________________________',
  ].join('\r\n');
  const blockPt = [
    '________________________________________________________________________________',
    'Reunião do Microsoft Teams',
    'Ingressar: https://teams.microsoft.com/meet/000000000000000?p=FAKEFAKEFAKE',
    'ID da Reunião: 000 000 000 000 000',
    'Senha: FAKE000',
    '________',
  ].join('\n');
  const event = (o) => {
    const responses = o.attendeeResponses ?? [];
    return {
      cancelled: false,
      allDay: false,
      attendees: responses.map(({ name, email }) => ({ name, email })),
      attendeeResponses: responses,
      organizer: responses.length ? { name: 'Ana Almeida', email: 'ana@example.test' } : null,
      categories: [],
      showAs: 'busy',
      ...o,
    };
  };
  const longTitle =
    'Quarterly cross-functional alignment on the platform migration, the regional rollout plan, vendor contract renewals, and everything else that came up during the last steering committee and still has no owner';
  const events = [
    event({ id: 'd-up', title: 'Platform alignment', startsAt: at(0, 14), endsAt: at(0, 15, 20), response: 'accepted', categories: ['Leadership'], location: 'Microsoft Teams Meeting', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x', bodyPreview: `Agenda: rollout dates and who owns the staging environment.\r\nPlease read the deck first.\r\n${teamsBlock}`, attendeeResponses: small }),
    event({ id: 'd-now', title: 'Standup under way', startsAt: at(0, 11, 30), endsAt: at(0, 12, 30), response: 'accepted', isOrganizer: false, joinUrl: 'https://teams.microsoft.com/l/meetup-join/y', bodyPreview: blockPt, attendeeResponses: small }),
    event({ id: 'd-past', title: 'Roadmap review', startsAt: at(-1, 14), endsAt: at(-1, 15, 20), response: 'organizer', isOrganizer: true, categories: ['Leadership'], location: 'Room 4', bodyPreview: `Bring the Q1 numbers.\n${teamsBlock}`, attendeeResponses: nine }),
    event({ id: 'd-transcript', title: 'Only a transcript', startsAt: at(-1, 10), endsAt: at(-1, 11, 22), response: 'organizer', isOrganizer: true, categories: ['Leadership'], location: 'Reuniões do Microsoft Teams', bodyPreview: blockPt, attendeeResponses: nine }),
    event({ id: 'd-empty', title: 'Nothing came out', startsAt: at(-1, 16), endsAt: at(-1, 17), response: 'accepted', attendeeResponses: small, bodyPreview: blockPt }),
    event({ id: 'd-40', title: 'All hands', startsAt: at(1, 9), endsAt: at(1, 10), response: 'tentativelyAccepted', showAs: 'tentative', location: 'Auditorium, 3rd floor, north wing', joinUrl: 'https://teams.microsoft.com/l/meetup-join/z', attendeeResponses: forty }),
    event({ id: 'd-long', title: longTitle, startsAt: at(1, 11), endsAt: at(1, 12), response: 'notResponded', joinUrl: 'https://teams.microsoft.com/l/meetup-join/w', bodyPreview: 'See https://example.test/a/very/long/link/that/has/no/natural/place/to/break/at/all/and/keeps/going/for/a/while', attendeeResponses: small }),
    event({ id: 'd-none', title: 'Focus block', startsAt: at(1, 14), endsAt: at(1, 16) }),
    event({ id: 'd-declined', title: 'Vendor pitch', startsAt: at(2, 10), endsAt: at(2, 11), response: 'declined', joinUrl: 'https://teams.microsoft.com/l/meetup-join/v', attendeeResponses: small }),
  ];
  const recording = (id, title, createdAt) => ({ id, title, createdAt, captureState: 'finished' });
  const session = (o) => ({
    origin: 'manual',
    personal_note: null,
    note_error: null,
    transcript_status: 'none',
    processing_state: null,
    processing: null,
    recording: null,
    live: null,
    status: 'completed',
    created_at: o.starts_at,
    ...o,
  });
  const recorded = (id, title, day, hour, minute, endHour, endMinute, extra = {}) =>
    session({
      id,
      title,
      starts_at: at(day, hour, minute),
      ends_at: at(day, endHour, endMinute),
      meeting_id: `m-${id}`,
      recording: recording(`m-${id}`, title, at(day, hour, minute)),
      transcript_status: 'available',
      processing_state: 'succeeded',
      ...extra,
    });
  const sessions = [
    recorded('d-past', 'Roadmap review', -1, 14, 0, 15, 20, { personal_note: { id: 'n-d-past', relative_path: 'n.md' } }),
    recorded('d-transcript', 'Only a transcript', -1, 10, 0, 11, 22),
    session({ id: 'd-empty', title: 'Nothing came out', starts_at: at(-1, 16), ends_at: at(-1, 17) }),
    recorded('d-match', 'Meeting in Google Chrome', -1, 12, 0, 12, 40),
    session({ id: 'd-prep', title: 'Prepared one', starts_at: at(2, 14), ends_at: at(2, 15), status: 'planned', personal_note: { id: 'n-prep', relative_path: 'p.md' } }),
  ];
  events.push(event({ id: 'd-prep-e', title: 'Prepared one', startsAt: at(2, 14), endsAt: at(2, 15), response: 'accepted', joinUrl: 'https://teams.microsoft.com/l/meetup-join/u', attendeeResponses: small }));
  f.library_sessions = () => sessions;
  f.library_session = ({ sessionId }) => sessions.find((s) => s.id === sessionId) ?? null;
  f.library_list = () => sessions.flatMap((s) => (s.recording ? [s.recording] : []));
  f.calendar_status = () => ({
    account: 'me@example.test',
    syncedAt: at(0, 8),
    events,
    categories: [{ id: 'c1', name: 'Leadership', preset: 4 }],
    masterCategories: [{ id: 'c1', name: 'Leadership', preset: 4 }],
  });
  const ms = 60_000;
  f.library_detail = ({ meetingId }) => ({
    meeting: { ...f.library_list().find((m) => m.id === meetingId), captureState: 'finished' },
    storage: { directory: `/tmp/${meetingId}`, totalBytes: 1, durationMs: 82 * ms, files: [] },
    manifest: null,
    audio: null,
    inference: 'local',
  });
  f.library_meeting_summary = ({ meetingId }) =>
    meetingId === 'm-d-past'
      ? {
          generatedAt: at(-1, 16),
          markdown:
            '## Decisions\n- Ship the staging environment before November 10\n- Keep the regional rollout on the current vendor\n## Risks\n- GPU capacity is still unknown',
        }
      : null;
  const segment = (id, track, speaker, seconds, text) => ({ id, track, speaker, start_ms: seconds * 1000, end_ms: seconds * 1000 + 5000, text });
  const report = (assignments) => ({
    jobs: [{ id: 'j', state: 'succeeded', attempts: 1, error: null }],
    people: [],
    report: {
      job: 'j',
      turns: [],
      warnings: [],
      corrections: {},
      assignments: assignments.map((a, i) => ({ id: `a${i}`, track: 'output', person_id: a.name ? `p${i}` : null, ...a })),
      segments: [
        segment('g1', 'mic', 'S0', 1, 'So this is the part about the WhatsApp channel and how it reaches the brokers.'),
        segment('g2', 'output', 'S1', 12, 'It is a platform only for brokers, the customer has WhatsApp, right, and that is it.'),
        segment('g3', 'output', 'S2', 25, 'What ran on my machine was Docker and Docker Compose for now.'),
      ],
    },
  });
  f.library_processing = ({ meetingId }) => {
    if (meetingId === 'm-d-past')
      return report([
        { speaker: 'S0', state: 'confirmed', name: 'Ana Barros' },
        { speaker: 'S1', state: 'confirmed', name: 'Bruno Barros' },
        { speaker: 'S2', state: 'confirmed', name: 'Outside Guest' },
      ]);
    if (meetingId === 'm-d-transcript' || meetingId === 'm-d-match')
      return report([{ speaker: 'S1', state: 'suggested', name: null }]);
    return { jobs: [], report: null, people: [] };
  };
  const file = (name, kind) => ({ name, kind, bytes: 10, modified: at(-2, 9) });
  f.items_list = ({ item }) =>
    item.id === 'd-past'
      ? {
          folder: '/tmp/d-past',
          files: [file('rollout-plan-final-v3-reviewed-by-everyone-on-the-steering-committee.pdf', 'pdf'), file('brief.html', 'html')],
          references: [{ target: 'https://example.test/deck', label: 'Deck', addedAt: at(-2, 9), isUrl: true, missing: false }],
        }
      : item.id === 'd-prep'
        ? { folder: '/tmp/d-prep', files: [file('agenda.pdf', 'pdf')], references: [] }
        : { folder: null, files: [], references: [] };
  f.links_list = ({ session: id }) => (id === 'd-past' ? [{ session: id, note: 'n-follow', createdAt: at(-1, 16) }] : []);
  f.list_notes = () => [{ id: 'n-follow', title: 'Define GPU capacity with the vendor', path: 'n.md', tags: [], created_at: at(-1, 16), updated_at: at(-1, 16) }];
  f.get_note = ({ id }) => ({
    id,
    title: 'Note',
    path: 'n.md',
    tags: [],
    created_at: at(-2, 9),
    updated_at: at(-2, 9),
    markdown: '## Prep\n- Read the rollout plan\n- Ask about GPU capacity',
  });
  const marks = {};
  const blank = { transcript: false, speakers: { named: 0, unnamed: 0 }, note: false, preparation: false, diagram: false, summary: false, followUps: { linked: 0, actions: 0 }, generatedContent: false };
  const signals = {
    'd-past': { transcript: true, speakers: { named: 3, unnamed: 1 }, note: true, summary: true, followUps: { linked: 1, actions: 3 }, generatedContent: true },
    'd-transcript': { transcript: true, speakers: { named: 0, unnamed: 6 } },
    'd-match': { transcript: true, speakers: { named: 0, unnamed: 2 } },
    'd-prep': { note: true, preparation: true },
  };
  f.library_meeting_signals = () => ({
    summariesOn: false,
    sessions: sessions.map((s) => ({ sessionId: s.id, ...blank, ...signals[s.id], mark: marks[s.id] ?? null })),
  });
  f.library_set_meeting_mark = ({ sessionId, mark }) => {
    marks[sessionId] = mark;
    return null;
  };
  f.calendar_open_link = () => null;
})();
