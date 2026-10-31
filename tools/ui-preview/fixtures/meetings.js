// Reuniões fixtures (spec 0096 P4): recording detail, processing report with
// speaker turns (one speaker still to confirm), participant context and the
// personal note of the 1:1.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const state = (window.__cxState = window.__cxState || {});
  const min = 60_000;
  const storage = (ms, dir) => ({
    directory: `/home/rodolfo/coxinha/recordings/${dir}`,
    totalBytes: Math.round(ms * 32),
    durationMs: ms,
    files: [
      { name: 'mic.wav', bytes: Math.round(ms * 16) },
      { name: 'output.wav', bytes: Math.round(ms * 16) },
    ],
  });
  const details = {
    'm-weekly': { captureState: state.capture === 'recording' || state.capture === 'paused' ? 'recording' : 'finished', ms: 12 * min },
    'm-rita': { captureState: 'finished', ms: 32 * min + 10_000 },
    'm-daily': { captureState: 'finished', ms: 14 * min + 2_000 },
    'm-interview': { captureState: 'interrupted', ms: 31 * min + 10_000 },
  };
  f.library_detail = ({ meetingId }) => {
    const d = details[meetingId] ?? { captureState: 'finished', ms: 10 * min };
    const meeting = f.library_list().find((m) => m.id === meetingId) ?? {
      id: meetingId,
      title: 'Gravação',
      createdAt: new Date().toISOString(),
    };
    return {
      meeting: { ...meeting, captureState: d.captureState },
      storage: storage(d.ms, meetingId),
      manifest: null,
      audio: null,
      inference: 'local',
    };
  };
  f.library_recover = ({ meetingId }) => {
    details[meetingId] = { ...details[meetingId], captureState: 'finished' };
    return f.library_detail({ meetingId });
  };
  const turn = (id, track, speaker, startMin, endMin) => ({
    id,
    track,
    speaker,
    start_ms: Math.round(startMin * min),
    end_ms: Math.round(endMin * min),
  });
  const segment = (id, track, speaker, startSec, text) => ({
    id,
    track,
    speaker,
    start_ms: startSec * 1000,
    end_ms: startSec * 1000 + 7000,
    text,
  });
  const ritaReport = {
    job: 'j-rita',
    turns: [
      turn('t1', 'mic', 'S0', 0, 3.8),
      turn('t2', 'output', 'S1', 3.8, 9.6),
      turn('t3', 'mic', 'S0', 9.6, 15.4),
      turn('t4', 'output', 'S1', 15.4, 22.2),
      turn('t5', 'mic', 'S0', 22.4, 27),
      turn('t6', 'output', 'S2', 27, 29.6),
    ],
    segments: [
      segment('g1', 'mic', 'S0', 4, 'Bom, a ideia hoje é fechar o contrato da API v2 e ver quem fica com a revisão.'),
      segment('g2', 'output', 'S1', 11, 'Eu posso pegar. Só preciso que segurança olhe a parte de tokens antes de sexta.'),
      segment('g3', 'output', 'S2', 19, 'Dá para marcar essa revisão na quinta de manhã.'),
      segment('g4', 'mic', 'S0', 27, 'Fechado. Eu mando o rascunho hoje ainda.'),
    ],
    warnings: [],
    corrections: {},
    assignments: [
      { id: 'a1', speaker: 'S0', track: 'mic', person_id: 'p-rc', state: 'confirmed', name: 'Rodolfo Camara' },
      { id: 'a2', speaker: 'S1', track: 'output', person_id: 'p-rs', state: 'confirmed', name: 'Rita Souza' },
    ],
  };
  f.library_processing = ({ meetingId }) => {
    if (meetingId === 'm-rita')
      return {
        jobs: [{ id: 'j-rita', state: 'succeeded', attempts: 1, error: null }],
        report: ritaReport,
        people: [
          { id: 'p-rc', name: 'Rodolfo Camara' },
          { id: 'p-rs', name: 'Rita Souza' },
          { id: 'p-ml', name: 'Marcos Lima' },
        ],
      };
    if (meetingId === 'm-interview')
      return {
        jobs: [{ id: 'j-int', state: 'failed', attempts: 1, error: 'o arquivo de modelo mudou desde a configuração' }],
        report: null,
        people: [],
      };
    return { jobs: [], report: null, people: [] };
  };
  f.library_recognition = () => ({
    job: 'j-rita',
    calibrationStatus: 'uncalibrated',
    profileGeneration: 1,
    speakers: [
      { speaker: 'S2', track: 'output', state: 'suggested', reason: 'similar', personId: 'p-ml', name: 'Marcos Lima', policyId: null, cosineSimilarity: 0.81 },
    ],
  });
  const contexts = {
    'm-rita': [
      { name: 'Rita Souza', email: 'rita@example.com' },
      { name: 'Rodolfo Camara', email: 'rodolfo@example.com' },
    ],
  };
  f.library_participant_context = ({ meetingId }) => contexts[meetingId] ?? [];
  f.library_set_participant_context = ({ meetingId, participants }) => {
    contexts[meetingId] = participants;
    return participants;
  };
  f.library_voice_profiles_page = () => ({ items: [], nextCursor: null });
  f.library_enrollment_candidates = () => [];
  f.library_ensure_personal_note = ({ sessionId }) => ({
    ...f.library_session({ sessionId }),
    personal_note: { id: 'n-rita', relative_path: 'meetings/1-1-rita.md' },
  });
  f.library_import_audio = ({ title }) => ({
    meeting: { id: 'm-imported', title, createdAt: new Date().toISOString(), captureState: 'finished' },
    storage: storage(51 * min, 'm-imported'),
    manifest: null,
    audio: null,
    inference: 'local',
  });
  f.library_update_session = ({ sessionId, input }) => ({ ...f.library_session({ sessionId }), ...input });
})();
