// Spec 0124: Outlook's details on the agenda's events, and what sessions have.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const at = (days, hours, minutes = 0) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hours, minutes)
      .toISOString()
      .slice(0, 19) + 'Z';
  };
  const people = [
    ['Rita Souza', 'accepted', 'required'],
    ['Marcos Lima', 'tentativelyAccepted', 'required'],
    ['Juliana Alves', 'declined', 'optional'],
    ['Bruno Dias', 'notResponded', 'optional'],
    ['Sala 4', 'accepted', 'resource'],
  ].map(([name, response, kind]) => ({ name, email: `${name[0]}@example.com`, response, kind }));
  const invited = {
    attendees: people.map(({ name, email }) => ({ name, email })),
    attendeeResponses: people,
    organizer: { name: 'Rita Souza', email: 'rita@example.com' },
    cancelled: false,
    allDay: false,
  };
  const extra = [
    { id: 'x1', title: 'Recusada', startsAt: at(1, 9), endsAt: at(1, 10), response: 'declined', categories: [] },
    { id: 'x2', title: 'Provisória', startsAt: at(1, 11), endsAt: at(1, 12), showAs: 'tentative', response: 'tentativelyAccepted' },
    { id: 'x3', title: 'Livre', startsAt: at(1, 13), endsAt: at(1, 14), showAs: 'free' },
    { id: 'x4', title: 'Com Teams', startsAt: at(1, 15), endsAt: at(1, 16), response: 'accepted', showAs: 'busy', location: 'Sala 4', joinUrl: 'https://teams.microsoft.com/l/meetup-join/x', bodyPreview: 'Pauta: revisar o roadmap.\nLeia o documento antes.' },
    { id: 'x5', title: 'Meia hora', startsAt: at(1, 17), endsAt: at(1, 17, 30) },
  ].map((event) => ({ ...invited, ...event }));
  const status = f.calendar_status;
  f.calendar_status = (...args) => {
    const snapshot = status(...args);
    return { ...snapshot, events: [...snapshot.events, ...extra] };
  };
  f.calendar_open_link = () => null;
  const marks = {};
  const full = { transcript: true, speakers: { named: 2, unnamed: 1 }, note: true, preparation: true, diagram: true, summary: true, followUps: { linked: 1, actions: 3 }, generatedContent: true };
  f.library_meeting_signals = () => ({
    summariesOn: false,
    sessions: f.library_sessions().map((s, i) => ({
      sessionId: s.id,
      transcript: false,
      speakers: { named: 0, unnamed: 0 },
      note: false,
      preparation: false,
      diagram: false,
      summary: false,
      followUps: { linked: 0, actions: 0 },
      generatedContent: false,
      ...(i % 2 ? {} : full),
      mark: marks[s.id] ?? null,
    })),
  });
  f.library_set_meeting_mark = ({ sessionId, mark }) => {
    marks[sessionId] = mark;
    return null;
  };
})();
