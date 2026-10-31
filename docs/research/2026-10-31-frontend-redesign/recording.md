# Coxinha: controles e status de gravação (investigação)

Repo: the repository root, branch `feat/0058-meeting-library`. Somente leitura, nenhum arquivo do repo foi alterado.

## Conclusão

1. A gravação tem **5 componentes com ações** (start/pause/stop/switch) e **7 pontos só de status**, cada um com sua própria cópia do estado. São 4 loops de polling independentes de `library_status` mais 3 stores zustand locais ao processo. Não existe evento do backend para mudança de captura.
2. O ícone "REC" preso (problema B) é o badge do `SessionEntry` (`src/features/sessions/SessionList.tsx:44-46`, renderizado nas linhas 92 e 98-106). Ele aparece no sidebar de sessões em todas as telas e na lista do calendário. O ícone **nunca consulta o backend sobre a captura ao vivo**. Ele junta duas fontes que ficam velhas:
   - (a) `sessionCaptureCache`, um ack local ao processo que **nunca é limpo**, combinado com `captureState !== 'finished'`. Qualquer gravação que termina como `interrupted` (stall de 2 s numa fonte, falha do processo filho, overflow, trilha sem frames) deixa o REC aceso até reiniciar o app. **Este é o caminho principal.**
   - (b) `meeting.capture_state = 'recording'` persistido no SQLite. Esse campo só é corrigido por `finish()` ou pelo botão manual "Recuperar". Não há reconciliação no boot, então um crash ou kill durante a gravação deixa REC permanente, mesmo depois de reiniciar.
3. Proposta: um `CaptureController` montado uma vez no `__root`, dono de estado, ações e dispositivos. Uma única UI de controle, o `RecordingDock`, no topo do sidebar (ou na barra quando o sidebar está recolhido). As demais telas só leem `useIsLive(sessionId)` e apontam para o dock. O backend passa a expor `live` por sessão e a reconciliar `capture_state` órfão no boot.

---

## 1. Inventário de todos os lugares

Legenda de fonte: **LS** = `library_status` (IPC, `Worker.active/processing/error` em memória); **CS** = `meeting.capture_state` persistido (SQLite, via `library_sessions`/`library_session`/`library_list`/`library_detail`); **ACK** = `sessionCaptureCache` (zustand); **RCPT** = `useDirectCapture.receipt` (zustand); **DET** = `useMeetingDetection` (zustand).

### 1a. Componentes com ações (controle)

| # | Local (file:line) | O que mostra | Ações | Fonte de estado |
|---|---|---|---|---|
| 1 | `src/components/AppShell/RecordingStatus.tsx:135-280`, variante `sidebar`, montada em `AppShell.tsx:98` | Ponto pulsante (âmbar quando pausado), "Gravando mm:ss", 3 barras de nível (mic, média, saída), título da sessão com link, fase de processamento, erro, links "Abrir biblioteca" e "Ver sessão" | Pause/Resume, Stop, fechar recibo | Poll próprio de LS a cada 500 ms (ativo) ou 2 s (`:35-51`), `useState` local. Título vem de RCPT, senão do `sessionListCache` casado por `meeting_id`/`recording.id`/ACK (`:119-129`). Publica `useRecordingStatusHost.activeMounted` (`:61-66`) |
| 2 | `RecordingStatus.tsx:283-363`, variante `bar`, montada em `AppShell.tsx:113` quando o sidebar está fechado | Pill com o mesmo timer, título, processamento, erro | Pause/Resume, Stop, links | Igual ao #1, mas é outra instância e outro poll a cada remontagem do AppShell (cada rota monta seu próprio `AppShell`) |
| 3 | `src/features/sessions/SessionRecording.tsx:159-197`, linha de transporte da página da sessão (`routes/SessionRoute.tsx:111`) | Texto de estado: "Gravando", "Gravação pausada", `library.state.<CS>` ("Captura aberta"/"Salva"/"Interrompida") ou "Detalhes pendentes" | Pause/Resume, Stop (somente se `ownsActive`) | Poll próprio de LS a cada 1 s (`:76-98`). `ownsActive` = `(session.meeting_id ?? ACK) === LS.active.meetingId` (`:133-134`). Texto de fallback vem de CS (`:163-165`) |
| 4 | `SessionRecording.tsx:235-293` → `CaptureSection` (`:246-273`), painel "Captura" expansível | Seletores de mic/saída, "Atualizar dispositivos", "Padrões do sistema", medidores `<meter>` com diagnóstico, "Gravando · Ns", aviso "outra captura ativa", "gravação existe", link para `/meetings` | Start (via `startSessionCapture`), Pause, Stop (só com `showActions=!ownsActive`) | Status do #3 por prop. Dispositivos via `useCaptureDevices` local. `desktop` derivado de CS e ACK (`:250-255`) |
| 5 | `src/features/meetings/LibraryView.tsx:141-162` → `CaptureSection` (`src/features/meetings/CaptureSection.tsx:38-211`), rota `/meetings` | Campo de título, seletores, refresh de dispositivos, medidores, `RecordingInformation` (tempo e bytes), "Gravando · Ns" | Start (`library.start`, sem sessão), Pause, Stop, Importar WAV | `useState` local. LS é lido **uma vez no mount** (`:40-56`) e o poll de 250 ms só roda se já havia captura ativa ou processamento (`:57-82`). Uma captura iniciada depois em outra tela fica invisível aqui até clicar em "Atualizar" |
| 6 | `src/features/detection/MeetingReminder.tsx`, montado em `AppShell.tsx:114` | `Reminder` (`:147-203`): "Chamada detectada"; `EndedCallReminder` (`:70-102`): "A chamada terminou"; `NextCallReminder` (`:104-145`): "Nova chamada"; banner de recibo "Gravação iniciada: {título}" (`:41-64`) | Gravar agora (cria sessão e inicia), Parar e salvar, Continuar gravando, Iniciar nova (stop seguido de start), Mesma reunião, Dispensar | DET (poll de 3 s de `call_detection_status` + LS em `CallDetectionController.tsx:20-31`; **erro de LS é tratado como gravando**, `:24`). Também usa RCPT e `activeMounted` |

Ações de backend chamadas: `library_start`, `library_start_session`, `library_pause`, `library_stop` (wrapper em `src/features/meetings/library.ts:138-142`, `src/features/sessions/sessionCapture.ts:13-30`, `src/features/detection/directCapture.ts:46-161`).

### 1b. Pontos só de status (indicadores)

| # | Local (file:line) | O que mostra | Fonte |
|---|---|---|---|
| 7 | `src/features/sessions/SessionList.tsx:44-46, 92, 98-106` (`SessionEntry`), usado em `SessionSidebar.tsx:134` (dentro de `Rail`, ou seja, em todas as telas) e em `CalendarView.tsx:166,179,194` | Badge vermelho pulsante **"REC"** + `ring-1 ring-primary/40` na linha | `CS === 'recording'` **OU** (`ACK` presente **E** `CS !== 'finished'`). **Não lê LS.** |
| 8 | `SessionList.tsx:47-50, 135, 167` | Ícone Mic/MicOff + tooltip `library.state.<CS>` ("Captura aberta" para CS órfão) | CS, `meeting_id`, ACK |
| 9 | `SessionRecording.tsx:228-234` → `RecordingInformation.tsx:29-58` | Tempo decorrido ao vivo, bytes, fase de processamento | LS (só se `ownsActive`) ou `detail.storage` |
| 10 | `src/features/meetings/LibraryView.tsx:199` | Linha da lista: "data · Captura aberta/Salva/Interrompida" | CS via `library_list` (recarregado só após ações ou quando o poll vê `!active`) |
| 11 | `src/features/meetings/RecordingDetail.tsx:84, 146-163, 75-81` | Texto `library.state.<CS>`; botão **Recuperar** quando CS ∈ {recording, interrupted} e não há captura ativa; `RecordingInformation` | CS de `library_detail`, `status` repassado por prop pelo pai (LibraryView ou SessionRecording) |
| 12 | `src/features/meetings/ProcessingPanel.tsx:161, 171-175, 229` | "Captura em andamento" (`captureBusy`) e desabilita "Processar" | `status.active` do pai |
| 13 | `RecordingStatus.tsx:106, 257-260, 322-325` | Card ou pill de **erro** "Falha na gravação" que **fica visível sem captura ativa** | `LS.error`, que é pegajoso: `Worker.error` só é zerado num start bem-sucedido (`src-tauri/src/library/capture.rs:44`) e é setado em toda interrupção (`src-tauri/src/library.rs:284, 292, 327`) |

Relacionados, mas não são indicador de captura:
- `src/components/AppShell/Rail.tsx:36-39`: item de navegação com ícone Mic, "Gravações".
- `src/routes/__root.tsx:82-84`: o atalho `toggle-recording` só navega para `/meetings`, não alterna nada.
- `src/features/sessions/SessionHeading.tsx:108` e `SessionList.tsx:137,169`: `session.status` "Ativa" é um campo manual da sessão, sem ligação com a captura, mas pode ser lido como "gravando".
- Backend morto: `src-tauri/src/recorder.rs` (stub `start_recording`/`stop_recording`, `src-tauri/src/lib.rs:410-430`, exposto em `src/lib/bindings.ts:74-84` e não usado pela UI). O evento `RecordingProgress` (`src-tauri/src/events.rs:40`) é declarado e nunca emitido.
- Plataforma: a captura só existe em Linux (`src-tauri/src/library/capture.rs:55-59`). Em Windows, LS.active é sempre `null`.

Contagem: 13 pontos de UI em 10 arquivos (`RecordingStatus.tsx`, `AppShell.tsx`, `SessionRecording.tsx`, `CaptureSection.tsx`, `LibraryView.tsx`, `RecordingDetail.tsx`, `RecordingInformation.tsx`, `ProcessingPanel.tsx`, `MeetingReminder.tsx`, `SessionList.tsx`). Ações de captura aparecem em 6 superfícies distintas, e seletores de dispositivo e medidores em 2 (sessão e biblioteca).

---

## 2. Fontes de verdade

### Backend

| Fonte | Onde | Significado | Escrita / limpeza |
|---|---|---|---|
| `Worker.active` (memória) | `src-tauri/src/library.rs:55-71, 169-179` | **Única verdade de "gravando agora"** e de qual `meetingId` | Setado no start (`capture.rs:45`). `take()` em `finish` (`library.rs:281`), inclusive quando `finish` falha. Auto-finish(true) em erro de `pump` (`library.rs:326-328`) |
| `Worker.processing` | `library.rs:65` | Job de inferência ativo | `pump_processing` |
| `Worker.error` / `finalization_failed` | `library.rs:69-70, 279-302` | Último erro de captura (pegajoso) | Limpo só em start OK e em recover |
| `meeting.capture_state` (SQLite) | `coxinha-core/src/schema.sql:3` | `new → recording → finished/interrupted` | `recording` no start (`coxinha-core/src/capture/recording.rs:103`). `finished/interrupted` em `Recording::finish` (`:301-304`). `interrupted` em recover (`:343-346, 381-384`). **Nenhuma reconciliação no boot**: `Library::open` só chama `recover_jobs` (`library.rs:79-82`) |
| `raw/<id>/manifest.json` `.state` | `recording.rs:78-87, 294-300` | Estado durável da captura | Base para `recover_capture` |
| `session.recording` | `src-tauri/src/library/sessions.rs:42-46, 66-69` | Cópia literal do CS por sessão | Calculado no List/Detail, **sem cruzar com `self.active`**, embora o worker o tenha em mãos |
| `session.processing` | `sessions.rs:85-93` | Processamento ao vivo por sessão | Esse campo é cruzado com o worker; a captura não é |

Eventos: **nenhum** para captura. Só existem `navigate`, `call_detected`, `desktop-*`. Tudo é polling.

Efeito colateral de CS órfão: `jobs.rs:40` impede a reivindicação de qualquer job `local-processing` enquanto existir um `meeting` com `capture_state='recording'`, e `store.rs:224-230` bloqueia o backup. Uma linha órfã trava o processamento de todas as reuniões, sem aviso.

### Frontend

| Fonte | Onde | Escopo | Limpeza |
|---|---|---|---|
| `useState<CaptureStatus>` por componente | `RecordingStatus.tsx:19`, `SessionRecording.tsx:31`, `LibraryView.tsx:27` | Por instância, cada uma com seu poll (500/2000 ms, 1000 ms, 250 ms condicional) | Sem compartilhamento. Um Stop numa tela só aparece nas outras no próximo tick |
| `useMeetingDetection.recording` | `src/features/detection/meetingDetection.ts:38, 94-110` | Global, poll de 3 s | Erro de LS vira `recording=true` (`CallDetectionController.tsx:24`) |
| `sessionCaptureCache` (ACK) | `src/features/sessions/sessionCapture.ts:6-8, 25-27` | Global ao processo, `Map<sessionId, meetingId>` | **Nunca é limpo**. O teste `sessionCapture.test.ts:10-24` fixa que acks de s1 e s2 coexistem: o desenho é "esta sessão é dona do meeting X", não "está gravando" |
| `useDirectCapture.receipt` | `directCapture.ts:18-23` | Global | Limpo só em `stopDetectedCallRecording`/`switchToDetectedCall` ou ao fechar manualmente. **Não é limpo** por Stop no `RecordingStatus`, na sessão, na biblioteca ou por interrupção |
| `useRecordingStatusHost.activeMounted` | `directCapture.ts:163-165` | Global | Espelha `status.active` do `RecordingStatus` |
| `sessionListCache` | `src/features/sessions/sessions.ts:35-82` | Global, refetch de 3 s enquanto houver `useSessions` montado; invalidado por `coxinha:sessions-changed` | Só `directCapture` dispara o evento após start/stop. Stop pelo `RecordingStatus` não dispara |
| react-query `['session', id]` | `src/routes/SessionRoute.tsx:30-36` | Página da sessão, `refetchInterval` de 3 s | Separado do `sessionListCache`; podem divergir em até 3 s |

### Onde discordam

1. LS diz `active=null`, mas CS diz `recording`: crash, kill, falha de `Recording::finish` (checkpoint, digest ou IO), já que `active` é retirado antes do UPDATE (`library.rs:281-294`). O REC acende pelo ramo `CS==='recording'`.
2. LS `null`, CS `interrupted` e ACK presente: o REC acende pelo ramo ACK. **Caso principal do problema B.**
3. LS `null` e RCPT presente: o `MeetingReminder` volta a mostrar "Gravação iniciada: X" depois do stop, porque `activeMounted` cai para false e o recibo continua lá (`MeetingReminder.tsx:41`).
4. LS `null` com `error` setado: o `RecordingStatus` continua com o card "Falha na gravação" (`:106`) até o próximo start.
5. `LibraryView` mostra "sem captura" e Start habilitado enquanto outra tela grava; o backend rejeita com "capture already active".
6. LS indisponível (fila `try_send` de 16 cheia, `library.rs:158-162`): a detecção assume "gravando" e o `RecordingStatus` mostra "falha", ao mesmo tempo.
7. `sessionListCache` e `['session', id]` usam refetches diferentes (até 3 s cada), então sidebar e página da sessão podem mostrar estados diferentes.

---

## 3. Causa raiz do problema B

Decisão do ícone (`src/features/sessions/SessionList.tsx:43-46`):

```ts
const acknowledgedMeeting = useAcknowledgedSessionCapture(session.id);
const isRecording =
  session.recording?.captureState === 'recording' ||
  (!!acknowledgedMeeting && session.recording?.captureState !== 'finished');
```

`session.recording.captureState` vem literalmente de `meeting.capture_state` (`src-tauri/src/library/sessions.rs:66-69`). `acknowledgedMeeting` vem de `sessionCaptureCache` (`src/features/sessions/sessionCapture.ts:6-8`), que só recebe `set` (`:25-27`) e nunca `delete`. Busca no repo inteiro: só há escrita em `startSessionCapture`.

### Caminho A, no mesmo processo (principal)

1. Uma sessão inicia a captura pela página da sessão (`SessionRecording.tsx:269`) ou pela detecção (`directCapture.ts:95`). Nos dois casos `startSessionCapture` grava ACK `sessionId → meetingId`.
2. A captura termina como `interrupted`. Isso acontece sozinho quando uma fonte fica 2 s sem blocos, o processo `parec` cai ou há overflow (`coxinha-core/src/capture/pulse.rs:160-191` → `library.rs:326-328` `finish(true)`), ou no Stop quando alguma trilha ficou com 0 frames (`pulse.rs:243`). Também acontece por desligamento com `allow_interrupted`.
3. LS passa a `active=null`, o `RecordingStatus` some (ou vira card de erro, item 13) e CS vira `interrupted`.
4. No `SessionEntry`: `false || (true && 'interrupted' !== 'finished')` dá **`true`**. O REC fica aceso até reiniciar o app. O mesmo acontece se `session.recording` vier `null` por algum motivo (`undefined !== 'finished'`).

Raciocínio hermético: com `sessionCaptureCache = {S→M}`, `session.recording = {captureState:'interrupted'}` e LS `active:null`, a expressão vale `true`. Nenhum código observa LS nesse cálculo, então nada pode apagar o badge. Não existe teste do badge REC: nenhum teste referencia "REC" ou `isRecording`. O CLAUDE.md exige teste por critério de aceite.

Evidência fraca de frequência: o único meeting no banco local Linux (`~/.local/share/br.dev.coxinha.app/meeting-library/meetings.db`, lido em modo `ro&immutable`, só contagem) está `interrupted`.

### Caminho B, persistido (sobrevive a restart)

1. CS só sai de `recording` via `Recording::finish` ou `recover_capture`.
2. Em crash, kill -9, queda de energia ou erro dentro de `Recording::finish` (`recording.rs:290-304`, antes do UPDATE), o CS fica `recording`.
3. `Library::open` não reconcilia (`library.rs:79-82`, só `recover_jobs`).
4. `library_sessions` repassa CS sem cruzar com `Worker.active` (`sessions.rs:66-69`), e o REC acende pelo primeiro ramo, **para sempre**. A única saída é abrir o detalhe e clicar em "Recuperar" (`RecordingDetail.tsx:146`), que fica escondido no painel "Captura" da sessão ou em `/meetings`.
5. Efeito extra: `jobs.rs:40` trava todo o processamento local enquanto existir essa linha.

### Agravantes, que não causam mas prolongam

- Stop pelo `RecordingStatus` não dispara `coxinha:sessions-changed` (`RecordingStatus.tsx:68-85`), então o sidebar leva até 3 s para refletir.
- O recibo não é limpo, e o banner "Gravação iniciada" reaparece depois do stop (`MeetingReminder.tsx:41`).

### Como confirmar

1. Caminho A: teste de unidade em `SessionList` com `sessionCaptureCache={s1→m1}` e `session.recording.captureState='interrupted'` (ou `null`), esperando que o REC não apareça. Hoje falha. Na prática: gravar uma sessão, desconectar ou mutar a fonte de saída por mais de 2 s e ver o REC continuar no sidebar.
2. Caminho B: com o app rodando e `library_status.active == null`, rodar `SELECT id, capture_state FROM meeting WHERE capture_state='recording'` (read-only). Qualquer linha é órfã. Teste Rust: criar uma `Recording`, dropar sem `finish`, reabrir `Library::open` e conferir que CS continua `recording`.

---

## 4. Modelo alvo

### Princípio

Uma verdade (`Worker.active` no backend), um assinante no frontend, um componente de controle. Nas outras telas, só leitura com link para o controle.

### Backend (mudanças mínimas)

1. **Snapshot único** `CaptureSnapshot { phase: idle|recording|paused|stopping|processing|needs_recovery, meetingId, sessionId, elapsedMs, mic, output, error }`, devolvido por `library_status` e por toda ação.
2. **Evento `capture_changed`** emitido em start, pause, stop, auto-interrupção, finish e recover. Medidores continuam por poll de cerca de 4 Hz **só enquanto** `phase` for `recording` ou `paused`. Isso elimina 3 dos 4 pollers.
3. **`live` por sessão**: em `SessionAction::List/Detail`, `value["live"] = self.active.id == session.meeting_id` (o mesmo padrão já usado para `processing` em `sessions.rs:85-93`).
4. **Reconciliação no boot**: em `Library::open`, todo `capture_state='recording'` é órfão por definição, porque nenhuma captura sobrevive ao processo. Rodar `recover_capture`, que preserva os bytes brutos e marca `interrupted`, ou expor `needs_recovery`. Isso destrava `jobs.rs:40`. Mexe em invariante de dados, então precisa de ADR.
5. Limpar `Worker.error` quando o usuário reconhece o erro, ou modelá-lo como `phase: needs_recovery` com `meetingId`.
6. Remover o stub `recorder.rs` (`start_recording`/`stop_recording`) e o `RecordingProgress` morto, ou registrar a decisão.

### Frontend: limites dos componentes

```
src/features/capture/
  captureStore.ts        zustand: snapshot, devices {sources, mic, output}, busy, receipt, lastError
  CaptureController.tsx  headless, montado 1x em routes/__root.tsx (ao lado de CallDetectionController)
                         - assina `capture_changed` + poll de fallback; único chamador de library_status
                         - ações single-flight: start({sessionId?|title}), pause(bool), stop(), switchTo(call)
                         - em toda transição: invalida sessionListCache + query ['session', id] + ['library']
                         - em stop/interrupção: limpa receipt; não existe ACK separado
  selectors.ts           useCapture(), useIsLive(sessionId), useLiveSessionId(), useCaptureBusy()
  RecordingDock.tsx      ÚNICA UI com controles (evolui RecordingStatus):
                         timer, ponto, medidores, título→sessão, Pause/Resume, Stop e salvar,
                         popover "Fontes" (seletores + atualizar + padrões, usando useCaptureDevices
                         movido para o store), Start "Gravar sessão atual"/"Gravação avulsa",
                         estados needs_recovery (botão Recuperar) e erro
  LiveBadge.tsx          read-only: ponto + "Gravando"/"Pausado"; clique foca o dock
```

Posição na shell: `RecordingDock` no topo do sidebar quando expandido (onde hoje está `RecordingStatus variant="sidebar"`, `AppShell.tsx:98`). Com o sidebar recolhido, vira um pill compacto na `ChromeCap` (`AppShell.tsx:113`), que expande para o dock ao clicar. Fica sempre montado, inclusive idle, com um botão "Gravar" discreto, para o usuário ter um lugar fixo onde procurar.

### O que cada tela mostra

| Tela | Hoje | Alvo |
|---|---|---|
| Sidebar e calendário (`SessionEntry`) | REC por CS ou ACK | `LiveBadge` só se `useIsLive(session.id)`, derivado do snapshot ou do `live` do backend. CS `interrupted` ou órfão vira ícone de atenção "Precisa recuperar", nunca REC |
| Página da sessão (`SessionRecording`) | Transporte + `CaptureSection` completa + poll de 1 s | Linha de status read-only (`LiveBadge` ou "Salva/Interrompida") + **um** botão "Gravar esta sessão" que chama `controller.start({sessionId})` com as fontes do store. Sem seletores, sem medidores, sem pause/stop: "Controles no painel de gravação" foca o dock. Mantém playback e transcrição |
| Biblioteca (`/meetings`, `LibraryView`) | `CaptureSection` completa | Só lista, detalhe e **Importar WAV**. Remove `CaptureSection`. A linha com CS órfão mostra "Precisa recuperar" |
| `RecordingDetail` | Estado + Recuperar | Recuperar só quando `phase` for `needs_recovery` ou CS `interrupted` sem SHA. O status vem do store, não de prop |
| `ProcessingPanel` | `status.active` por prop | `useCaptureBusy()` |
| `MeetingReminder` | Banner com ações próprias + recibo | Continua como prompt contextual (detecção), mas os botões chamam `controller.*`. O recibo é absorvido pelo dock, sem banner duplicado |
| Atalho `toggle-recording` | Navega para `/meetings` | `controller.toggle()` ou foca o dock |

### Fluxo de dados

`Worker.active` → evento `capture_changed` / `library_status` → `CaptureController` → `captureStore` → seletores → (`RecordingDock` com ações | `LiveBadge`, `SessionEntry`, `SessionRecording`, `ProcessingPanel` só leitura). Ações saem só de `RecordingDock` e `MeetingReminder`, sempre via `controller.*`, e o controller invalida os caches de sessão.

Remove: `sessionCaptureCache` (ACK), `useRecordingStatusHost`, os `useState<CaptureStatus>` locais, os polls de `SessionRecording` e `LibraryView`, e o `library.status()` próprio em `CallDetectionController` (passa a ler o store).

### Decisões que dependem do Rodolfo

1. **Start na página da sessão**: manter um botão "Gravar esta sessão" que delega ao controller, ou começar só pelo dock? Recomendo manter o botão, porque é o contexto natural, desde que não traga seletores nem transporte. Isso substitui o critério do spec 0092 ("Pause/Resume e Stop ao lado do estado da reunião atual"), que precisa ser revisto num spec novo.
2. **Reconciliação no boot**: recuperar automaticamente (marcar `interrupted` e preservar o bruto) ou só sinalizar `needs_recovery` e esperar clique? Recomendo automático, porque ninguém retoma uma captura depois de crash e a linha órfã trava o processamento. Precisa de ADR, por mexer em estado persistido.
3. **Evento vs. poll**: adicionar o evento `capture_changed`, que é pequeno e testável, ou centralizar o poll no controller como primeiro passo? Recomendo o poll centralizado primeiro (resolve B e a divergência sem tocar no Rust) e o evento em seguida.

### Correção mínima para B (se quiser antes do redesign)

- `SessionList.tsx:44-46`: `isRecording = liveMeetingId != null && liveMeetingId === (session.meeting_id ?? ack)`, com `liveMeetingId` vindo de um store de LS compartilhado. Hoje dá para ler o status do `RecordingStatus` expondo-o num zustand.
- `sessionCapture.ts`: apagar o ACK quando LS deixar de ter aquele `meetingId` ativo.
- Backend: reconciliação no boot + `live` por sessão.
- Testes: badge com ACK + `interrupted`, ACK + `recording: null`, CS `recording` órfão sem LS.
