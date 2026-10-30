# Library UI IPC contract, 2026-10-18

All commands use `invoke` from Tauri. Errors reject with a human-readable string.
Linux requires pactl/parec. Enumeration opens no recording. No inference or identity
stage is available in this slice. Poll status every 250 ms while active.

```ts
type Meeting = { id: string; title: string; createdAt: string; captureState: 'new'|'recording'|'finished'|'interrupted' };
type Source = { name: string; description: string; monitor: boolean };
type Meter = { peak: number; lastBlockMs: number | null; error: string | null };
type Status = { active: null | { meetingId: string; paused: boolean; elapsedMs: number; mic: Meter; output: Meter }; error: string | null };
type Track = { source: string; file: string; frames: number; first_arrival_ns: number|null; last_arrival_ns: number|null; sha256: string|null };
type Detail = { meeting: Meeting; manifest: null | { version: number; meeting: string; state: string; sample_rate: number; channels: number; clock: string; alignment: string; tracks: Track[] }; audio: { mic: string; output: string } | null; inference: 'unavailable' };
```

| Command | Arguments | Result |
|---|---|---|
| library_list | none | Meeting[] |
| library_sources | none | Source[] |
| library_start | `{ title, micSource, outputSource }` | Status |
| library_status | none | Status |
| library_pause | `{ paused: boolean }` | Status |
| library_stop | none | Status |
| library_recover | `{ meetingId: string }` | Detail |
| library_detail | `{ meetingId: string }` | Detail |

Detail audio paths exist only for closed, checksum-verified tracks. Pass each path
through `convertFileSrc(path)` from `@tauri-apps/api/core` and assign to an HTML
`audio` element. Tauri asset protocol supports ranged audio, with each Range
limited to 1000 KiB in the pinned Tauri implementation. A request without Range
loads the whole file into memory; bounded playback memory is not guaranteed in
this slice. Real WebKit playback acceptance is pending. Scope is granted per
verified WAV, never the library directory. Separate players represent separate raw track sample timelines;
pauses are excluded from WAVs. The manifest states alignment uncertainty. Do not
present simultaneous players as synchronized wall-clock playback.

Recovery is explicit for inactive recordings left recording/interrupted. Raw
originals and checksums are preserved. Failures remain visible in `Status.error`;
`library_start` clears the previous capture error. Stop can produce interrupted
state when audio has not arrived on both tracks. The list and detail are durable
in app data `meeting-library`, independent of the notes vault.

A verificação de outra gravação e a recuperação exigem captura parada: checksum
pode ler arquivos grandes e não pode bloquear o worker de áudio. O detalhe da
captura ativa permanece consultável, com `audio: null`. Captura tem checkpoint
por segundo. Encerramento normal do aplicativo para e finaliza a captura; kill
abrupto exige recuperação explícita na próxima execução.
