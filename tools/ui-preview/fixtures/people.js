// People, voice samples and settings fixtures (spec 0096 P6). Mirrors the
// prototype: Rita with samples from the 1:1 and the weekly, Rodolfo, Marcos
// without samples and Juliana with two.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const state = (window.__cxState = window.__cxState || {});
  const generation = () => state.voiceGeneration ?? 7;
  const people = [
    { personId: 'p-juliana', name: 'Juliana Alves' },
    { personId: 'p-marcos', name: 'Marcos Lima' },
    { personId: 'p-rita', name: 'Rita Souza' },
    { personId: 'p-rodolfo', name: 'Rodolfo Camara' },
  ];
  const space = { model: 'wespeaker-resnet34', revision: 'r2', model_hash: 'a1b2c3d4', preprocessing: 'fbank80', dimension: 256 };
  const sample = (personId, sampleId, meetingId, startMs, endMs, createdAt, stateName = 'active') => ({
    sampleId, assignmentId: `as-${personId}-${meetingId}`, assignmentRevision: 1, currentAssignmentRevision: 1,
    state: stateName, spaceId: 'sp1', space, meetingId, track: 'output', startMs, endMs, createdAt,
    revokedAt: stateName === 'revoked' ? '2026-10-29 10:00:00' : null,
  });
  const samples = (state.voiceSamples = state.voiceSamples || {
    'p-rita': [
      sample('p-rita', 's1', 'm-rita', 11_000, 23_000, '2026-10-28 16:20:00'),
      sample('p-rita', 's2', 'm-rita', 242_000, 253_000, '2026-10-28 16:21:00'),
      sample('p-rita', 's3', 'm-weekly', 760_000, 771_000, '2026-10-24 10:30:00'),
      sample('p-rita', 's4', 'm-daily', 30_000, 38_000, '2026-10-20 09:40:00', 'revoked'),
    ],
    'p-rodolfo': [
      sample('p-rodolfo', 's5', 'm-weekly', 4_000, 11_000, '2026-10-24 10:05:00'),
      sample('p-rodolfo', 's6', 'm-rita', 27_000, 40_000, '2026-10-28 16:22:00'),
    ],
    'p-juliana': [
      sample('p-juliana', 's7', 'm-daily', 61_000, 70_000, '2026-10-20 09:41:00'),
      sample('p-juliana', 's8', 'm-daily', 120_000, 131_000, '2026-10-20 09:42:00'),
    ],
    'p-marcos': [],
  });
  f.library_voice_profiles_page = () => ({
    profileGeneration: generation(),
    profiles: people.map((p) => {
      const active = (samples[p.personId] ?? []).filter((s) => s.state === 'active');
      return { ...p, activeSamples: active.length, sampleMeetings: new Set(active.map((s) => s.meetingId)).size };
    }),
    nextCursor: null,
    scannedRows: people.length,
  });
  f.library_person_samples_page = ({ personId }) => ({
    profileGeneration: generation(),
    personId,
    samples: samples[personId] ?? [],
    nextCursor: null,
    scannedRows: (samples[personId] ?? []).length,
  });
  f.library_revoke_voice_sample = ({ personId, sampleId }) => {
    const row = (samples[personId] ?? []).find((s) => s.sampleId === sampleId);
    if (row) Object.assign(row, { state: 'revoked', revokedAt: '2026-10-31 12:00:00' });
    state.voiceGeneration = generation() + 1;
    return null;
  };
  f.library_create_person = ({ name }) => {
    const personId = `p-${name.toLowerCase().replace(/\W+/g, '-')}`;
    people.push({ personId, name });
    samples[personId] = [];
    state.voiceGeneration = generation() + 1;
    return personId;
  };
})();
