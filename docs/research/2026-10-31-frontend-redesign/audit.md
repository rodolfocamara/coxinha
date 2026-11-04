# Coxinha frontend audit (pre-rebuild)

Repo: the repository root, branch `feat/0058-meeting-library` (working tree limpo). Somente leitura; nenhum arquivo do repo foi alterado.
Escopo: `src/` (264 arquivos TS/TSX, ~29.9k linhas, 10 CSS com 1.653 linhas, 99 arquivos de teste com 532 casos).
Método: varredura mecânica (scripts em `/tmp/cx-redesign/*.py|sh`, saídas em `scan.txt` e `tests.txt`) + leitura manual dos arquivos citados. Contagens heurísticas estão marcadas como tal.

## Conclusão

O design system da spec 0095 é uma boa base e deve ser mantido, mas cobre só ~40% dos controles: há **103 `<button>` crus contra 78 `Button/ButtonLink`**, e **20 inputs crus contra 46 primitivos**. As violações se concentram em `board` (38 botões crus, 23 hex), `detection/MeetingReminder` (amber, underline, 9 botões crus), `notes` (menu ad hoc, 8 `text-[Npx]`), `home` (fixture morta) e nas superfícies globais (`CommandPalette`, `DesktopLifecycle`, `DesktopRecoveryDialog`, `AppError`).

O problema estrutural maior não é visual: **não existe camada de dados**. O mesmo domínio é lido por 4 mecanismos (zustand, react-query, hooks caseiros com `useState/useEffect`, CustomEvents de `window`), o status de captura é sondado por **4 loops independentes** (250 ms a 3 s) e a sessão por mais 2, e o IPC é chamado direto de 21 componentes. Um rebuild visual sem consertar isso vai copiar os mesmos bugs de estado.

Nenhum arquivo de produção passa de 400 linhas (o maior é `NoteEditor.tsx`, 394), mas 8 estão entre 300 e 394 e misturam IPC, estado e UI. Testes: ~66 de 99 arquivos são de comportamento ou lógica pura e sobrevivem a um redesign. Cerca de 9 são acoplados a markup ou classes.

---

## 1. Violações de UI

### 1.1 Contagem por área (heurística, exclui `components/ui/` e testes)

| Área | `<button>` cru | Button/ButtonLink | input cru | Input/Select/Field | underline | `text-[Npx]` | outro `-[N]` | hex | paleta crua (amber/black/white) |
|---|---|---|---|---|---|---|---|---|---|
| features/board | 38 | 0 | 5 | 5 | 0 (1 é config TipTap) | 0 | 0 | 23 (CSS+TS) | 0 |
| features/meetings | 14 | 30 | 7 | 23 | 1 | 3 | 1 | 0 | 0 |
| features/sessions | 10 | 22 | 1 | 10 | 1 | 3 | 1 | 1 (CSS) | 0 |
| features/detection | 9 | 0 | 2 | 1 | 2 | 0 | 1 | 0 | 4 (amber) |
| features/notes | 7 | 0 | 2 | 0 | 1 | 8 | 6 | 0 | 1 |
| components/AppShell | 9 | 9 | 0 | 0 | 2 | 3 | 1 | 0 | 1 |
| routes (inclui dev) | 9 | 1 | 0 | 0 | 0 | 8 | 3 | 0 | 0 |
| lib (shell global) | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| features/home | 0 | 0 | 0 | 0 | 0 | 10 | 1 | 0 | 0 |
| features/shell | 2 | 0 | 1 | 0 | 0 | 2 | 4 | 0 | 1 |
| features/settings | 0 | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 |
| features/agenda | 0 | 11 | 0 | 6 | 0 | 0 | 0 | 0 | 0 |
| index.css / ui CSS | - | - | - | - | - | - | - | 3 + 1 | - |
| **Total** | **103** | **78** | **20** | **46** | **7 reais** | **37** | **~30** | **28** | **9** |

Além disso: 55 `font-size: Npx` em CSS (ui.css 17, board.css 15, canvasText.css 7, settings.css 5, index.css 5, select.css 3, boardCards 2, boardNotePanel 1).

Telas migradas (limpas): Agenda, OutlookConnectionCard, CalendarToolbar/PeriodSelector, People (PeopleDirectory/PersonFormSheet), LibraryView/CaptureSection, SessionHeading/SessionRecording, RecordingStatus (parcial).

### 1.2 Ações renderizadas como texto ou link sublinhado (proibido pela 0095)

| Arquivo:linha | O quê |
|---|---|
| `features/detection/MeetingReminder.tsx:53-58` | `<Link className="underline">` "Ver sessão" (navegação como texto) |
| `features/detection/MeetingReminder.tsx:182-188` | `<button className="underline">` "Detalhes" (disclosure como texto) |
| `features/sessions/SessionSidebar.tsx:125-131` | `<button className="underline">` reset de filtro |
| `features/notes/NoteFileSettingsLink.tsx:8` | `<Link to="/settings" hash="rebuild-heading" className="block underline">` (única entrada para "reconstruir índice" a partir de um erro de nota) |
| `features/meetings/RecordingInformation.tsx:67-69` | `<button className="underline">` copiar caminho |
| `components/AppShell/WindowChrome.tsx:60-63` | `<button className="ml-1 underline">` "tentar de novo" |
| `components/AppShell/RecordingStatus.tsx:189-192` | título da sessão como `Link hover:underline` (aceitável como prose, mas é a ação principal do card) |
| `lib/AppError.tsx:27-29` | três `<Link>` sem estilo (texto puro) para Notas/Gravações/Ajustes |
| `routes/NoteDetailRoute.tsx:67-68` | dois `<Link>` sem estilo na tela de erro |
| `features/sessions/CalendarView.tsx:101-108` | `<a class="cx-btn">` montando o visual de Button à mão em vez de `ButtonLink`/`Button` |

Navegação feita com `<button onClick={navigate}>` (sem semântica de link): `features/sessions/SessionList.tsx:85-95` (cada linha de sessão), `features/notes/BacklinksPanel.tsx:65-67`, `features/home/HomeCanvas.tsx:63-67`.

### 1.3 Botões crus que deveriam ser `Button`

Ações comuns (não widgets compostos):

- `features/board/ActivityBoard.tsx`: 158, 196, 207, 215, 225, 338
- `features/board/BoardToolbar.tsx`: 49, 53, 54, 76, 87, 89, 100 (`board-primary` é um primário paralelo ao `Button variant="primary"`)
- `features/board/BoardFields.tsx`: 75, 111, 112, 127; `BoardInspector.tsx`: 43, 131, 142; `BoardNodes.tsx`: 51, 52, 97, 105, 112, 169, 172; `BoardNotePanel.tsx`: 52, 62; `editor/CanvasNote.tsx`: 42, 184; `editor/CanvasTextEditor.tsx`: 65, 74, 82, 92, 104, 112
- `features/detection/MeetingReminder.tsx`: 60, 82, 90, 117, 125, 133, 163, 171, 182 (5 estilos diferentes de botão no mesmo arquivo; `bg-destructive` usado como primário em 84)
- `features/sessions/SessionSidebar.tsx`: 17, 45, 96 (`text-sm p-2 border rounded`), 117, 125; `SessionNotes.tsx`: 39 (`border rounded px-3 py-2`)
- `features/meetings/SpeakerCard.tsx`: 75, 82, 133, 146; `SpeakerReview.tsx`: 94, 170; `SelectedVoiceEnrollment.tsx`: 123, 183, 219; `VoiceComparisonPanel.tsx`: 36. Todos usam o pseudo-primitivo `voiceButton`/`voiceField` de `features/meetings/voiceControls.tsx` (strings de classe exportadas), pendência admitida na própria spec 0095.
- `features/notes/NoteRecovery.tsx`: 62, 73 (classe longa duplicada)
- `lib/DesktopRecoveryDialog.tsx`: 72, 75, 78 (sem estilo nenhum); `lib/DesktopLifecycle.tsx`: 256; `lib/AppError.tsx`: 24; `routes/__root.tsx`: 129; `routes/NoteDetailRoute.tsx`: 70

Widgets compostos com `<button>` cru (aceitável hoje, mas sem primitivo de ListItem/Tab/MenuItem/IconButton, então cada um tem estilo próprio): `AppShell.tsx:81` (marca), `ChromeCap.tsx:46,92`, `ChromeTabs.tsx:22,54`, `RailItem.tsx:49`, `SidebarToggle.tsx:13`, `WindowChrome.tsx:76`, `MeetingCard.tsx:23,104`, `LibraryView.tsx:190`, `NoteActionsMenu.tsx:280,305,344`, `NoteEditorFrame.tsx:67`, `CommandPalette.tsx:326,343`, `SessionList.tsx:227`, `SidebarPeriodFilter.tsx:78`, `CalendarMonth.tsx:70`, `SessionRoute.tsx:76` (tabs), `BoardInspector.tsx:52`.

### 1.4 Inputs crus

`SessionSidebar.tsx:87` (`rounded border bg-background p-2`), `MeetingDetails.tsx:73` (`rounded border px-3 py-2`), `SpeakerCard.tsx:115`, `SpeakerReview.tsx:154`, `SelectedVoiceEnrollment.tsx:147,201` (voiceField), `NoteRecovery.tsx:55` (textarea), `NoteActionsMenu.tsx:138`, `CommandPalette.tsx:228`, `BoardFields.tsx:24,67,97`, `BoardNodes.tsx:75`, `CanvasTextView.tsx:54`, `ProcessingPanel.tsx:117` (file input estilizado à mão), `JointPlaybackControls.tsx:49,60` (range), `SettingsView.tsx:184` e `SettingsSections.tsx:33` (radio), `DetectionSettings.tsx:11` (checkbox). Não existe primitivo para Checkbox, Radio, Switch, Range nem FileInput: cada tela inventa o seu.

### 1.5 Tamanhos e cores arbitrários

- `text-[Npx]` (37): `HomeCanvas.tsx:16,31,92,93` (44px, 11, 14, 13), `HomePanel.tsx:14,30,31,32,41,49`, `NoteHeader.tsx:24` (38px), `NoteActionsMenu.tsx:245,284,288,310,353,355`, `NoteEditorFrame.tsx:82`, `MeetingCard.tsx:54,57,87`, `SessionList.tsx:101,221`, `SessionSidebar.tsx:41`, `Rail.tsx:20`, `RailItem.tsx:26`, `RailSection.tsx:13`, `CommandPalette.tsx:284,353`, dev routes (8).
- Outros arbitrários relevantes: `NoteActionsMenu.tsx:131` (`w-[280px] rounded-[10px] shadow-[...]`, `font-[Newsreader,serif]` em 159, fonte banida pelo DESIGN.md), `CommandPalette.tsx:214-219` (`pt-[14vh] max-w-[560px] rounded-[16px]`), `z-[9999]` em `DesktopLifecycle.tsx:244` e `DesktopRecoveryDialog.tsx:38`, `z-[9998]` em `DesktopLifecycle.tsx:254`, larguras máximas diferentes por tela (`max-w-[1200px]` Session/Library, `[1400px]` Calendar, `[960px]` Home/Note, `1080px` Settings via CSS).
- Paleta crua: `MeetingReminder.tsx:76,111` (`border-amber-500/30 bg-amber-500/10`), `bg-black/50` (`DesktopLifecycle.tsx:244`, `DesktopRecoveryDialog.tsx:38`), `bg-black/30` (`CommandPalette.tsx:214`), `text-white` (`WindowChrome.tsx:82`), `bg-white` (`NoteActionsMenu.tsx:323`). `RecordingStatus.tsx:151,296` usa `bg-[oklch(var(--warning))]` em vez de token Tailwind.
- Hex: `features/board/model.ts:56-61` (4 cores de status), `editor/CanvasTextEditor.tsx:8` (paleta de 5 cores de texto), `board.css:298-307` e `boardCards.css:78-87` (azul, verde, laranja, **roxo `#9b7acc`**, banido no DESIGN.md §2), sombras `#000x` em `board.css`, `select.css:63`, `sidebar.css:31`; `index.css:141` (`color: #28231e`).
- Nenhum `text-red-*` cru foi encontrado. Erros vazam por `<p role="alert">` sem estilo em vários lugares (ver 1.6).

### 1.6 Cabeçalhos, vazio, erro e carregamento inconsistentes

| Tela | Cabeçalho | Vazio | Erro | Carregando |
|---|---|---|---|---|
| Agenda, Calendar, Library, People | `PageHeader` | `EmptyState` | `Alert` | texto `role=status` |
| Settings | `<h1>` próprio em `SettingsFrame.tsx:20`, estilizado por `settings.css` (22px) | n/a | `Alert` | texto |
| Session | `<h1 class="cx-page-title">` em `SessionHeading.tsx:34` | `EmptyState` | `Alert` | `<p role=status>` |
| Nota | `<h1>` 38px em `NoteHeader.tsx:24` | n/a | `<p role=alert>` cru (`NoteEditorFrame.tsx:93`) | `NoteLoadingSkeleton` |
| Board | `<h1 class="sr-only">` (`BoardToolbar.tsx:47`) + `.board-toolbar` | CSS próprio | `<div role=alert>` + `<button>` cru (`ActivityBoard.tsx:158`) | texto |
| Home (/home) | `<h1>` 44px fixture | texto | n/a | n/a |
| Sidebar de sessões | `<h2 text-[11px]>` | `<p>` | `<div role=alert>` + `<button>` cru | `<p>` |
| Erros globais (`AppError`, `NoteDetailError`, startup em `__root`, save em `DesktopLifecycle`) | `<h1>` sem estilo | n/a | `role=alert` cru | overlay ad hoc |

O breadcrumb também é inconsistente: Agenda/Home/Settings fazem `.toLowerCase()` no trail, Calendar/People/Library não, Board não tem trail.

### 1.7 Modais, menus e overlays ad hoc

Só `Sheet` usa Radix Dialog. Fora dele:

- `features/shell/CommandPalette.tsx:214-223`: overlay `fixed inset-0` + `role=dialog aria-modal` manual, sem focus trap do Radix.
- `lib/DesktopRecoveryDialog.tsx:38-42` e `lib/DesktopLifecycle.tsx:230-247`: overlays em portal com `z-[9999]`, foco gerenciado à mão (`querySelector('[role="dialog"] button')` em `DesktopLifecycle.tsx:38`).
- `features/notes/NoteActionsMenu.tsx:129`: `role="menu"` posicionado com `style={{top,right}}`, contém um `<input>` de busca, sem navegação por setas (APG exige), e opções de fonte sem `role=menuitemradio`.
- `features/sessions/SidebarPeriodFilter.tsx:99-103`: popover em portal com `role=dialog` manual.
- `features/board/ActivityBoard.tsx:213`: `role="alertdialog"` reaproveitando a classe `board-toolbar` como confirmação.
- Confirmações destrutivas por `window.confirm`: `features/notes/NoteEditor.tsx:321`, `features/shell/CommandPalette.tsx:64` (diálogo nativo, sem i18n de botões nem estilo).
- `<details>` usado como popover/menu: `board-note-picker` (`BoardToolbar.tsx`), `board-geometry` (`BoardFields.tsx:114`), `settings-advanced` (`SettingsView.tsx:173`).

### 1.8 Strings fixas e lacunas de i18n

Strings fixas na UI de produção:
- `components/AppShell/ChromeTabs.tsx:41` "Close tab", `:57` "New tab"; `components/AppShell/SidePanel.tsx:17` "Context panel"; `features/sessions/SessionList.tsx:104` "REC".
- Atalhos fixos e errados no palette: `CommandPalette.tsx:83` "Ctrl+N" (o atalho real é `Ctrl+Alt+N` / `Ctrl+Alt+Shift+N` / `Super+Shift+N` conforme `src-tauri/src/config.rs:164-181`), `:97` "Win+Shift+A" (só uma das plataformas), `:114` "Ctrl+," (não há handler no frontend).
- `features/notes/NoteEditorFrame.tsx:82`: mostra `⌘.` em nota standalone no Windows (`embedded && !Mac ? 'Ctrl+.' : '⌘.'`), o que viola o invariante Windows-first.
- Fixtures com texto pt-BR/EN fixo renderizadas em produção: `features/home/fixtures.ts`, `features/meetings/fixtures.ts` (via `MeetingCard`).
- Dev routes: dezenas de strings fixas (ok se forem removidas).

Catálogos:
- `en.json` tem 693 chaves, `pt-BR.json` 623: **70 faltam em pt-BR**, 31 delas usadas no código. O **command palette inteiro** (`palette.*`), `brand.name`, `meeting.block.*` e `sidePanel.*` aparecem em inglês para usuário pt-BR (fallback `en`).
- ~70 chaves de `en.json` parecem não usadas (`calendar` 15, `noteMenu` 13, `sidebar` 12, `library` 7, ...). É uma heurística: chaves montadas dinamicamente podem gerar falso positivo.
- O board tem um i18n paralelo: `features/board/locale.ts` (209 linhas) registra um namespace `board` em TS, fora dos JSON.
- `locales/en.test.ts` checa só 5 grupos de chaves legadas. Não há teste de paridade en/pt-BR.
- Datas: ~25 chamadas `toLocale*String` espalhadas, metade com `undefined` (locale do SO: `AgendaView.tsx:113,144,147,181`, `LibraryView.tsx:199`, `OutlookConnectionCard.tsx:65`, `HomeCanvas.tsx:115`, `NoteHeader.tsx:45`, `MeetingCard.tsx:134`) e metade com `i18n.language`. O idioma das datas pode divergir do idioma da UI.

### 1.9 Acessibilidade

- `MeetingReminder.tsx:110`: `NextCallReminder` usa `aria-label={t('meetingDetection.endedTitle')}`, o rótulo errado (copiado do banner "chamada encerrada").
- `ChromeTabs.tsx:20-50`: `role=tablist/tab` sem `tabpanel` e com uma aba só (o componente só aparece com >1 aba, o que nunca acontece). Há `role="button"` aninhado dentro de `<button>` (`:38-41`, HTML inválido) com `tabIndex=-1` (inalcançável por teclado).
- `NoteActionsMenu.tsx`: menu sem setas/Home/End, input dentro de `role=menu`.
- Navegação por `<button>` em vez de link (1.2). O leitor de tela anuncia "botão" para destinos.
- Ícones sem `aria-hidden`: `BoardToolbar.tsx:50,55`, `ActivityBoard.tsx:339` (`<Plus size={16} />`), `SessionList.tsx:80-82`.
- `SettingsView.tsx:174-234`: o fieldset de troca de vault está todo `disabled` e o "Salvar" tem `disabled={true}` fixo. A UI completa aparece, mas não funciona (o código `onSave` está morto).
- Erros de startup e save (`__root.tsx:126`, `DesktopLifecycle.tsx:254`) usam `role=alert` com botão sem estilo e sem foco.
- Itens positivos: `Field` liga `aria-describedby/invalid`, `Sheet` devolve o foco, os botões de janela têm label, há skip-link (`AppShell.tsx:63`) e as sessões usam `aria-current`.

---

## 2. Estrutura de código

### 2.1 Tamanho (regra do repo: refatorar perto de ~400)

Nenhum arquivo de produção passa de 400. Próximos do limite:

| Arquivo | Linhas | Mistura |
|---|---|---|
| `features/notes/NoteEditor.tsx` | 394 | schema BlockNote + prefs em localStorage + upload de anexo via `invoke` + delete com `window.confirm` + duplicação + menu + 7 `useEffect` |
| `lib/bindings.ts` | 376 | gerado (tauri-specta), isento |
| `features/board/ActivityBoard.tsx` | 368 | load/save, confirmação de reload, toolbar, viewport, 8 `useState` |
| `components/AppShell/RecordingStatus.tsx` | 364 | loop de polling próprio + stop/pause IPC + 2 variantes de layout + join com caches de sessão |
| `features/notes/NoteActionsMenu.tsx` | 361 | menu ad hoc + busca + fontes + toggles |
| `features/shell/CommandPalette.tsx` | 359 | dialog ad hoc + busca + ações + delete |
| `features/sessions/SessionRecording.tsx` | 338 | polling próprio + 6 chamadas IPC + UI |
| `features/meetings/ProcessingPanel.tsx` | 311 | IPC + formulário + edição de segmentos |
| `features/settings/SettingsView.tsx` | 307 | 6 chamadas IPC (specta `commands` e `invoke` cru misturados) + 5 seções |

Arquivos acima de 400 fora de produção: `board/ActivityBoard.test.tsx` (447), `sessions/SessionWorkspace.test.tsx` (408), `notes/NoteEditor.persistence.test.tsx` (399), `board/board.css` (400), `locales/en.json` (849).

### 2.2 Componentes que misturam busca de dados, IPC e apresentação

IPC chamado direto do componente (21 arquivos .tsx): `RecordingStatus`, `AgendaView`, `BoardNotePanel`, `CanvasNote`, `CanvasTextEditor`, `CallDetectionController`, `LibraryView` (10 chamadas), `PeopleDirectory`, `PersonVoiceSamples`, `ProcessingPanel`, `SelectedVoiceEnrollment`, `NoteEditor`, `SessionHeading`, `SessionNotes`, `SessionRecording` (6), `SessionSidebar`, `SettingsView` (6), `AppError`, `DesktopLifecycle` (8), `NoteDetailRoute`, `SessionRoute`.

Duas gerações de wrapper IPC convivem:
1. `lib/bindings.ts` (specta, tipado, `Result<T,E>`) cobre só notas, config, meetings legados e tags.
2. `invoke<T>('cmd')` cru com tipos escritos à mão em `features/meetings/library.ts` (18 comandos), `voiceCuration.ts` (8), `agenda/calendar.ts` (6), `sessions/sessions.ts` (5), `board/persistence.ts` (4) e `lib/store.ts` (9, **duplicando** `commands.listNotes/getNote/createNote/updateNote/deleteNote` que já existem em bindings).

### 2.3 Lógica duplicada

| Duplicação | Onde |
|---|---|
| Polling de `library.status()` (4 loops independentes) | `RecordingStatus.tsx:30-58` (500/2000 ms), `LibraryView.tsx:57-77` (250 ms), `SessionRecording.tsx:76-91` (1000 ms), `CallDetectionController.tsx:13-45` (3000 ms). Mais `directCapture.ts:71` sob demanda. Numa sessão com gravação ativa rodam 5 pollers ao mesmo tempo (os 3 acima + detalhe da sessão a 3 s via react-query em `SessionRoute.tsx:30-36` + lista de sessões a 3 s em `sessions.ts:73`). |
| `library.sources()` | `LibraryView` (2x), `useCaptureDevices`, `SessionRecording`, `directCapture` |
| `library.pause/stop` + estado `busy/stopping` | `RecordingStatus`, `LibraryView`, `SessionRecording` (2x), `CaptureSection` |
| Formatação mm:ss | `RecordingStatus.tsx:109`, `SpeakerCard.tsx:176`, `voiceControls.tsx:6` (`voiceTime`), `ProcessingPanel.tsx:306` (`formatTime`, idêntico a `voiceTime`), `RecordingInformation.tsx:8` (`audioTime`, hh:mm:ss), `CaptureSection.tsx:147` (`Ns`, um terceiro formato) |
| Formatação de data/hora | ~25 chamadas inline (1.8), `formatRelative` local em `SettingsView.tsx:294`, `formatNoteMeta` em `NoteHeader.tsx` |
| Leitura de nota | `useAppStore` (`invoke('get_note')`), react-query `['note',id]` (`commands.getNote` em `NoteDetailRoute`, `CanvasNote`), `['board-note',id]` (`BoardNotePanel`), `['session-note',id]` (`SessionNotes`), os dois últimos espelhando em `['note',id]` com `setQueryData` |
| Hooks caseiros de "fetch + loading + error + retry" (reimplementam react-query, que já está instalado) | `useCurationRead`, `useVoiceInventoryPages`, `useProcessing`, `useOutlookConnection`, `useCaptureDevices`, `sessions.ts/useSessions` (cache zustand com geração e TTL manual) |
| Classes de botão e campo | `voiceControls.tsx` (`voiceButton`, `voiceField`), constantes `button/field/speakerButton` locais em SpeakerReview/SelectedVoiceEnrollment/SpeakerCard, classe longa repetida em `NoteRecovery.tsx:64,75` |
| Prefs em localStorage | 7 chaves com 5 implementações (`theme.ts`, `panels.ts`, `sidebar.ts`, `sidebarPreferences.ts`, `meetingDetection.ts`, `NoteEditor.tsx:40-55`, `useOutlookConnection.ts`) |

### 2.4 Gestão de estado inconsistente por domínio

| Domínio | Mecanismos em uso |
|---|---|
| Notas | zustand `useAppStore` + react-query (3 chaves) + `saveQueue/noteSessions` + evento `coxinha-save-error` |
| Sessões | zustand `sessionListCache` com polling e TTL manual + react-query `['session',id]` com polling + evento `coxinha:sessions-changed` + zustand `sessionCaptureCache` + zustand `useSessionNavigation` (filtros) |
| Captura/gravação | `useState` local em 4 componentes (cada um com seu poller) + zustand `useDirectCapture` + zustand `useRecordingStatusHost` (flag "o banner está montado?" para coordenar dois componentes) |
| Pessoas/vozes | hooks caseiros (`useVoiceInventoryPages`, `useCurationRead`) + `useState` |
| Calendário Outlook | `useOutlookConnection` (7 `useState` + localStorage) |
| Shell | zustand `useSidePanel`, `useSidebar`, eventos `coxinha:open-map` e `coxinha:open-palette` em `window` |

São 10 stores zustand, 5 chaves react-query, 6 hooks caseiros, 5 CustomEvents e 7 chaves de localStorage. O canal `events` do tauri-specta (push do Rust) só é usado para `navigate` e tema. Captura e processamento poderiam ser eventos em vez de polling.

### 2.5 Camadas e acoplamento

- `components/AppShell` (shell compartilhado) importa features: `Rail.tsx:3` → `SessionSidebar`, `AppShell.tsx:1` → `MeetingReminder`, `RecordingStatus.tsx:4-7` → `meetings/library`, `detection/directCapture`, `sessions/sessionCapture`, `sessions/sessions`.
- Domínio mal alocado: People (`PeopleDirectory`, `PersonFormSheet`, `VoiceProfilesPanel`) vive em `features/meetings`. `sessions` importa 5 módulos de `meetings` e 3 de `notes`. `settings` importa `agenda` e `detection`.
- Dois editores ricos diferentes: BlockNote (notas) e TipTap (texto do board), cada um com markdown, foco e persistência próprios.

### 2.6 Código morto, só de dev ou fixture em produção

| Item | Situação |
|---|---|
| `routes/DevMenuPreviewRoute.tsx` (90), `routes/DevShellPreviewRoute.tsx` (197) | só em DEV (`router.tsx:131-133`), sem teste, cheias de strings fixas e `text-[Npx]`. Citadas só na spec 0057. |
| `/home` → `routes/HomeRoute.tsx` + `features/home/*` (HomeCanvas 120, HomePanel 61, fixtures 150) | nenhuma entrada em produção (só testes fazem `push('/home')`). Dados de fixture com `console.debug`. |
| `features/meetings/MeetingBlock.tsx` + `MeetingCard.tsx` + `fixtures.ts` | **o schema BlockNote de produção** (`NoteEditor.tsx:22,36`) registra um bloco "meeting" que renderiza dados de fixture. `slashCommand.ts` (o único jeito de inserir o bloco) não é importado. |
| `features/meetings/slashCommand.ts` | inalcançável |
| `features/agenda/fixtures.ts` (`__isFixture`, `useAgenda`) | inalcançável |
| `features/board/BoardNotePanel.tsx` + `boardNotePanel.css` | inalcançável (só o teste importa) |
| `features/agenda/AgendaPanel.tsx` | painel lateral com 3 parágrafos estáticos |
| `components/AppShell/ChromeTabs.tsx` | só renderiza com >1 aba, o que nenhuma rota passa. `onClose/onNewTab` nunca são fornecidos. |
| `voiceCuration.profiles()` / `.samples()` | sem consumidor (só as versões paginadas são usadas) |
| UI de troca de vault em `SettingsView.tsx:173-234` | totalmente desabilitada |
| `sessions/calendarFixtures.ts` | só teste. Ok, mas deveria ir para `src/test/fixtures`. |
| Exports sem uso em produção | `board/model.ts: emptyBoard, BoardEdge`, `BoardNodes.tsx: CardNode, AreaNode`, `sessionDates.ts: localDay, DateRange`, `CalendarToolbar.tsx: applyCalendarPeriod`, `meetingDetection.ts: focusMainWindow`, `MeetingDetails.tsx: nearbyInvitations`, `directCapture.ts: invitedPeople`, `noteFileErrors.ts: isMissingNoteFile`, `sidebar.ts: createSidebarStore, SIDEBAR_STORAGE_KEY`, `theme.ts: systemTheme, THEME_STORAGE_KEY`, `SessionRoute.tsx: SessionWorkspace`, mais tipos (`ChromeCapProps`, `RecordingStatusProps`, `InventoryPage`, ...). Vários existem só para teste. |
| `window.__coxinha` (`App.tsx:31-39`) | handle de dev para Playwright. `tools/capture-screenshots.mjs` não o usa. |

---

## 3. Rotas e navegação

Router: TanStack com `createMemoryHistory` (`router.tsx:146`). Não há barra de endereço, `validateSearch` nem search params. Árvore plana (profundidade máxima 2 em `/notes/$noteId`).

| Rota | Componente | Como se chega |
|---|---|---|
| `/` | `NotesIndexRoute` → `ActivityBoard` | rail "Atividades", botão da marca (`coxinha:open-map`), IPC `home`, rota inicial |
| `/notes` | **mesmo** `ActivityBoard` (duplicata de `/`) | após deletar nota (palette e editor), links de `AppError` e `NoteDetailError`. O rail não marca nada como ativo aqui (`RailItem` usa `fuzzy:false` para `/`). |
| `/notes/$noteId` | `NoteDetailRoute` | **só palette** (busca/nova nota), hotkey global `notes-new`, backlinks, duplicar. Não há lista de notas na UI fora do palette. |
| `/home` | `HomeRoute` (fixtures) | **nenhuma** entrada em produção |
| `/agenda` | `AgendaRoute` | sem item no rail. Chega-se por Settings > Integrações (botão), `CalendarView.tsx:63` e `SessionHeading.tsx:111` (ButtonLink), palette, hotkey global `agenda` |
| `/calendar` | `CalendarRoute` | rail |
| `/meetings` | `MeetingsRoute` → `LibraryView` | rail "Gravações", `RecordingStatus`, `SessionRecording.tsx:285`, IPC `meetings`, e IPC `toggle-recording`, que **só navega** (`__root.tsx:82-84`) em vez de alternar a gravação |
| `/people` | `PeopleRoute` | rail |
| `/sessions/$sessionId` | `SessionRoute` | linhas da sidebar (`<button>` + navigate), calendário, `RecordingStatus`, `MeetingReminder`, criação na sidebar |
| `/settings` (+hash) | `SettingsRoute` | rail, palette, `NoteFileSettingsLink` (`#rebuild-heading`, link sublinhado), Agenda "Configurar" (`#integrations-heading`), `AppError` |
| `/dev/menu-preview`, `/dev/shell-preview` | dev | só DEV, por URL |

Problemas:
- **Não há navegação para trás.** Memory history sem botão Voltar, sem Alt+Left, sem botão "voltar" do mouse e sem `history.back` em lugar nenhum. O breadcrumb (`Breadcrumb.tsx`) é texto estático, não clicável. Depois de Agenda → Settings#integrations, a única volta é pelo rail.
- Estado de visão fora da URL: abas da sessão (`SessionRoute.tsx:27`, `useState<Tab>`) voltam para "notes" a cada navegação. A gravação selecionada em `LibraryView` (`selected`) não tem deep link. Os filtros do calendário vivem num store zustand.
- Dois sistemas de hash: `navigate({hash})` do router e `<a href="#id">` nativo (`SettingsFrame.tsx:26`, `CalendarView.tsx:101,136`).
- Notas standalone dependem do palette, e o palette está em inglês para pt-BR (1.8), com atalhos exibidos errados.

---

## 4. Arquitetura de testes

99 arquivos, 532 casos. Classificação heurística (consultas por papel/rótulo contra `querySelector`/classe/testid):

| Tipo | Arquivos | Mantém num rebuild? |
|---|---|---|
| Lógica pura (sem render) | 28 | Sim, integralmente (`sessionDates`, `recordedDates`, board `model/hierarchy/geometry/markdown/persistence`, `saveQueue`, `noteSessions`, `notePersistence`, `noteFileErrors`, `lifecycle`, `theme`, `nativeTheme`, `directCapture`, `voiceCuration`, `library.audio`, `sessionCapture`, `editorFocus`, ...) |
| Comportamento (só role/label/text) | 38 | Em boa parte, desde que os nomes acessíveis e os papéis se mantenham. Destaques: `SessionWorkspace` (73 consultas por role), `SpeakerReview`, `AgendaView`, `MeetingDetection`, `SessionCaptureNavigation`, `navigation-audit`, os hooks `useBoundedPlayback/useJointPlayback/useProcessing/useVoiceInventoryPages/useCaptureDevices`. |
| Quase só comportamento (poucas asserções de classe) | 24 | Sim, removendo as asserções `toHaveClass('cx-btn')` / `not.toHaveClass('underline')` (`RecordingStatus.test:177-184`, `LibraryView.test:195,203`, `SessionHeading.test:81-87`, `CalendarNavigation.test:356-358`, `SessionRecording.test:349`, `SessionSidebar.test:64`) |
| Misto | 6 | Parcial: `NoteEditor.persistence` (20 testids), `NoteEditor.embedded` (testid + `parentElement`), `RecordingDetail.speakers` (10 querySelector), `CalendarToolbar` (asserta `items-end`, `order-last`, `basis-full`), `SessionNavigation`, `CanvasNote` |
| Acoplado a markup | 3 | Reescrever: `WindowCorners.test` (19 asserções de classe, lê CSS como fonte), `WindowResize.test` (32 testids), `NoteHeader.test` (`className.toContain('cx-display')`) |

Outros acoplamentos que quebram num rebuild mesmo nos testes "de comportamento":
- **Estrutura de módulos via `vi.mock`**: `library` (13 arquivos), `voiceCuration` (8), `lib/store` (8), `routes/__root` (6), `WindowFrame/WindowChrome/RecordingStatus` (5 cada), `board/ActivityBoard` (5), `notes/NoteEditor` (4), `MeetingBlock` (4). Renomear ou mover esses módulos quebra dezenas de testes. Um rebuild deveria mockar **na fronteira IPC** (`@tauri-apps/api/core` via `mockIPC`, já usado em 32 arquivos) e não em módulos internos.
- **Copy**: 39 arquivos usam o i18n real em inglês e consultam por texto ("Meeting title"). Trocar copy em `en.json` quebra testes. 15 arquivos mockam `react-i18next` com `t = key`, o que é estável.
- **Papel semântico**: testes que buscam `getByRole('button', {name})` para destinos vão quebrar quando a navegação virar `link`. Isso é desejável, mas precisa entrar no plano.
- 11 arquivos montam o router inteiro (`createAppRouter`). São bons testes de fluxo, mas caros (motivo do `testTimeout` de 15 s).
- `components/ui/primitives.test.tsx` e `layering.test.ts` são a base de contrato do design system: manter.
- `locales/en.test.ts` é fraco (5 grupos legados). Substituir por um teste de paridade en/pt-BR e de chaves usadas.

---

## 5. Lista priorizada

### Manter (fundação boa)

1. **Primitivos `src/components/ui/*` + `ui.css` + estratégia `@layer`** (`Button`, `ButtonLink`, `Field/useFieldControl`, `Input`, `Textarea`, `Select`, `Card*`, `PageHeader`, `Alert`, `EmptyState`, `Badge`, `Sheet`) e seus testes. Completar com `IconButton`, `Checkbox/Radio/Switch`, `Dialog/ConfirmDialog`, `DropdownMenu/Popover` (Radix), `Tabs`, `ListItem/NavItem`, `Banner`, `Kbd`, `Spinner/Skeleton`.
2. **Tokens em `src/index.css`** (OKLCH + `@theme`) e `lib/theme.ts`, `nativeTheme.ts`, `useTheme.ts` com testes.
3. **Wrappers IPC**: `lib/bindings.ts` (gerado), `meetings/library.ts`, `meetings/voiceCuration.ts`, `agenda/calendar.ts`, `sessions/sessions.ts` (só o objeto `sessions`), `board/persistence.ts`. Consolidar em `src/lib/ipc/` e, de preferência, migrar os comandos crus para tauri-specta.
4. **Lógica pura e seus testes**: `sessionDates`, `recordedDates`, board `model/hierarchy/boardGeometryChanges/resizeBounds/boardDrag/editor/markdown`, `saveQueue`, `noteSessions`, `notePersistence`, `noteFileErrors`, `lifecycle`, `editorFocus*`, `speakerExcerpt`, `voiceCurationError`, a lógica de `directCapture` e `meetingDetection`.
5. **Hooks de mídia com testes de comportamento**: `useBoundedPlayback`, `useJointPlayback`, `useCaptureDevices`, `useProcessing`.
6. **Protocolo de flush/recuperação** de `DesktopLifecycle` (lógica), e `WindowFrame`/`useWindowChrome` (janela nativa, resize, cantos), trocando só a pele.
7. **Os 66 arquivos de teste de lógica e comportamento**, depois de tirar as asserções de classe.

### Reescrever

1. **Camada de dados única**: react-query para tudo que é leitura IPC (sessões, pessoas/vozes paginadas com `useInfiniteQuery`, calendário, biblioteca, nota com uma só chave), um **store de captura único** alimentado por um poller só (ou por eventos Tauri) e consumido por RecordingStatus, Library, SessionRecording, Detection e MeetingReminder. Remover `sessionListCache`, `useRecordingStatusHost`, os CustomEvents e os hooks caseiros. Unificar `useAppStore` sobre `commands.*`.
2. **AppShell e navegação**: shell sem imports de features (slots), um `PageHeader` por rota, breadcrumb clicável ou botão Voltar com histórico (Alt+Left, botão do mouse), Agenda no rail ou num grupo claro, abas da sessão e item selecionado da biblioteca na URL (search params), remover `/notes` duplicado, decidir onde ficam as notas standalone (lista ou board).
3. **Board** (`ActivityBoard`, `BoardToolbar`, `BoardFields`, `BoardInspector`, `BoardNodes`, `CanvasTextEditor`, `board.css`, `boardCards.css`): 38 botões crus, 23 hex, roxo banido, i18n próprio em `locale.ts`. É a maior superfície fora do sistema.
4. **Notas**: dividir `NoteEditor.tsx` (schema, prefs, anexos, ações), `NoteActionsMenu` → Radix DropdownMenu, `NoteHeader` com token tipográfico em vez de `text-[38px]`, delete com `ConfirmDialog` em vez de `window.confirm`.
5. **Superfícies globais**: `CommandPalette` (Radix Dialog, atalhos reais vindos da config, strings pt-BR), `MeetingReminder` (primitivo `Banner` com tom warning e `Button`s), `DesktopRecoveryDialog`/overlay de save (Dialog), `AppError`/`NoteDetailError`/erro de startup (EmptyState + Button).
6. **Curadoria de voz** (`SpeakerCard`, `SpeakerReview`, `SelectedVoiceEnrollment`, `VoiceComparisonPanel`, `voiceControls.tsx`) migrada para os primitivos. Mover People para `features/people`.
7. **Settings**: dividir `SettingsView` por seção, trocar `settings.css` por primitivos, esconder a troca de vault até existir.
8. **Formatação**: `src/lib/format.ts` com `formatDuration`, `formatDate/DateTime/Relative` (sempre `i18n.resolvedLanguage`) e `formatBytes`, substituindo as 6 variantes de mm:ss e as ~25 chamadas `toLocale*`.
9. **i18n**: completar as 70 chaves pt-BR, migrar `board/locale.ts` para JSON com namespace, apagar chaves mortas, teste de paridade.
10. **Testes acoplados**: `WindowCorners`, `WindowResize`, `NoteHeader`, `CalendarToolbar` (classes) e os mocks de módulo interno, passando a mockar na fronteira IPC.

### Apagar

1. `routes/DevMenuPreviewRoute.tsx`, `routes/DevShellPreviewRoute.tsx` e suas entradas em `router.tsx` (substituir, se necessário, por uma página de catálogo dos primitivos).
2. `/home`: `routes/HomeRoute.tsx`, `features/home/*` (HomeCanvas, HomePanel, fixtures) e `HomeCanvas.test.tsx`. Ajustar `router.test.ts`/`navigation-audit.test.tsx`.
3. `features/meetings/MeetingBlock.tsx`, `MeetingCard.tsx`, `fixtures.ts`, `slashCommand.ts`, `MeetingCard.test.tsx`, e o bloco `meeting` do schema BlockNote (o markdown não serializa esse bloco, então não deve haver nota em disco com ele; vale confirmar no vault).
4. `features/agenda/fixtures.ts`. Também `AgendaPanel.tsx`, se o side panel sair.
5. `features/board/BoardNotePanel.tsx`, `boardNotePanel.css`, `BoardNotePanel.persistence.test.tsx` (inalcançáveis).
6. `components/AppShell/ChromeTabs.tsx` (nunca renderiza) e as props `tabs` das rotas, se o chrome for refeito.
7. `voiceCuration.profiles/samples` não paginados, exports sem uso (2.6), ~70 chaves mortas de `en.json`.
8. UI desabilitada de troca de vault (`SettingsView.tsx:173-234`) até a feature existir.
9. Rota `/notes` index duplicada (redirecionar para `/`).

---

## Pendências e incertezas

- As contagens de `<button>`, i18n e chaves sem uso vêm de regex. Os números exatos podem variar alguns por cento. Os itens com linha citada foram conferidos manualmente.
- Não rodei a suíte nem o app (a tarefa era somente leitura). O status "686 testes passando" é o registrado na spec 0095 R1.
- Não sei se o vault real contém blocos `meeting` (item 3 de Apagar): convém um `grep` no vault antes de remover o tipo do schema.
