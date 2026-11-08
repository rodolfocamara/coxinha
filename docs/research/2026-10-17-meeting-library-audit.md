# Auditoria para biblioteca de reuniões e memória de vozes

## Conclusão

O Coxinha tem uma base desktop/editor aproveitável, mas ainda não entrega
gravação, diarização nem reconhecimento persistente de pessoas. A primeira
entrega deve provar duas reuniões consecutivas: capturar microfone e saída em
trilhas independentes, processar localmente, confirmar identidades na primeira
e sugerir a pessoa correta ou desconhecido na segunda. O editor deixa de ser
pré-requisito do produto. Instalar/abrir a interface não comprova esse fluxo.

Auditoria de 2026-10-17, baseada no código e em provas isoladas. Esta análise
não é uma medição de qualidade acústica nem validação em hardware Windows.

## Estado e preservação

- Cópia de trabalho solicitada: `/home/rcamara/Repos/coxinha`, branch `main`,
  commit `86d146af40583a388fcdff467e4f9f024ec5db01`, sem alterações no início.
- Worktree T3: mesmo commit, branch `t3/compare-repo-meetily-stack`, apenas
  o plano inicial desta conversa não rastreado. Esse plano foi substituído
  pelo escopo deste documento, não deve orientar implementação.
- Cópia Windows: mesmo commit; muitas diferenças reportadas por Git, porém
  `git diff --ignore-space-at-eol --stat`, `git diff --summary` e lista de
  untracked vieram vazios. Nenhum arquivo dessa cópia foi alterado.
- Não existe AGENTS.md dentro do checkout. As instruções fornecidas pelo
  usuário e CLAUDE.md/convenções locais foram lidas. O novo brief prevalece
  sobre prioridades antigas conflitantes.
- Meetily local está no commit `a2cb62e827da7ef59f65064c97233efb2313878e`.
  O launcher instalado confirma a criação explícita de um PCM ALSA/Pulse
  apontando para o monitor do sink; não foi executado nem alterado.
- O resultado da gravação `teste-linux-02` é evidência relatada pelo usuário,
  não reexecutada aqui. Nenhum áudio ou transcrição pessoal foi copiado para
  o repositório.

## Matriz de requisitos

Implementado indica código executável identificado, não aceitação acústica.
Parcial indica infraestrutura/adapter/UX incompletos; ausente indica ausência
do comportamento solicitado no caminho do produto auditado.

| Requisito | Estado | Evidência e limite |
|---|---|---|
| Desktop Rust/Tauri + React/Vite | Implementado | `Cargo.toml`, `src-tauri/Cargo.toml`, `package.json`, `src/App.tsx`; não trocar por Next.js. |
| Gravar microfone e saída Linux/Windows | Ausente | `src-tauri/src/recorder.rs:6,72,103`: TODOs, sem streams ou escrita WAV real. |
| Duas trilhas originais sincronizadas | Ausente | Recorder planeja um único `recording.wav` mono; specs antigas precisam revisão. |
| Seleção, medidores por fonte, pausa/resume, hotplug | Ausente | `RecordingProgress` existe em `events.rs`, mas não há pipeline que produza medições reais. |
| Escrita incremental e recuperação de gravação | Ausente | Há criação de pasta/metadata e registro SQLite, sem áudio/checkpoints/reconciliação completos. |
| Detecção de chamada | Parcial | `call_detector.rs:73` e `:97` devolvem lista vazia. Captura manual de Teams web não depende dessa detecção. |
| Transcrição local pós-reunião | Parcial | Traits/adapters existem; `lib.rs:348` retorna erro explícito. Whisper e Parakeet divergem das APIs travadas. |
| Diarização local | Ausente | `diarizer/pyannote.rs:68` retorna segmentos sem executar o modelo. |
| Identidades persistentes, perfis/amostras e unknown | Ausente | `shared/src/lib.rs` só tem `speaker: Option<String>`; `db.rs` não tem pessoas/amostras/espaços de embeddings. |
| Confirmação/correção/desfazer sem autoaprendizado | Ausente | Não há ledger de decisões humanas ou política de elegibilidade de amostras. |
| Biblioteca independente de notas | Parcial | `MeetingCard.tsx` consome `fixtures.ts`; UI está centrada em blocos dentro do editor. |
| Reprodução sincronizada, revisão de texto/falantes | Ausente | Não há fluxo real de timeline, áudio persistido e correções versionadas. |
| Busca de reuniões por pessoa/data/projeto | Parcial | `db.rs` possui FTS5 de notas; isso não implementa busca de reuniões/pessoas. |
| Resumo local opcional | Parcial | `summarizer.rs` chama genai e escreve Markdown, mas depende de transcript pré-existente e falta integração transacional. |
| API/servidor independentes de Tauri | Ausente | Workspace contém apenas `src-tauri` e `shared`; comandos dependem de estado Tauri. |
| Auth, permissões por reunião, Tailscale HTTPS | Ausente | Sem servidor/auth no código; rede privada não substitui autorização do aplicativo. |
| Fila persistente, upload retomável, backup/restauração | Ausente | Specs futuras existem; não há implementação desses fluxos. |
| Agenda Graph/Google e importação Teams | Ausente | Specs 0024/0025/0048 e fixtures não comprovam OAuth nem importação real. |
| PWA/celular | Ausente | Vite no navegador de desenvolvimento não equivale a PWA e API utilizáveis remotamente. |
| Pacotes Linux e Windows validados | Parcial | Release configurado para Windows; jobs Linux/macOS desativados; nenhuma validação atual de instalador. |

## Referências: o que reaproveitar e o que não assumir

Esforço relativo é uma estimativa de integração ao Coxinha, não prazo.
Licenças abaixo são do código raiz; pesos, dependências e arquivos copiados
precisam do próprio registro de licença/proveniência.

| Projeto / revisão | Licença verificada | Capacidade encontrada | Uso recomendado / esforço |
|---|---|---|---|
| [Conversationaly](https://github.com/bykof/conversationaly/tree/0359c12d492fbc6583229547989977ecd7aef723) | MIT, `LICENSE.md` | Fork do Meetily, Tauri/Rust/Next estático, transcribe.cpp e diarização pós-reunião em `frontend/src-tauri/src/audio/diarization.rs`. Sortformer configurado para no máximo 4 speakers. | Referência para adapters/empacotamento, esforço médio. Não resolve >4 pessoas nem memória confirmada de identidades. |
| [Heed](https://github.com/isjunrod/heed/tree/800faf03bfaea7641c4f8800795baca7d5fd0f54) | MIT, `LICENSE` | Bun/Python, caminhos por SO, memória `voices.json` e matching por espaço em `packages/transcription/transcription_server.py`. README mantém paridade Linux pendente e Windows futuro. | Referência para trilhas e UX de identificação, esforço médio/alto. Não copiar sua política de aprendizado automático. |
| [TranscriptionSuite](https://github.com/homelab-00/TranscriptionSuite/tree/541bde94cbd38b51ca79d01faddec0ba9764809c) | GPL-3.0-or-later, `server/backend/pyproject.toml` e `LICENSE` | FastAPI com tokens/admin, engines e servidor separado; documentação Tailscale e notebook em calendário. | Referência arquitetural, esforço alto para transplantar. Não incorporar código ao produto MIT neste recorte; calendário visual não comprova integração Graph/Google. |
| [Meetily](https://github.com/Zackriya-Solutions/meetily/tree/a2cb62e827da7ef59f65064c97233efb2313878e) | MIT, `LICENSE.md` | Captura/processamento/Whisper/Parakeet, SQLite e empacotamento. Linux enumera monitores por nome; backend Python antigo arquivado. | Referência direta Rust, esforço médio. Exigir seleção real de monitor, não duplicar `default` e não descartar originais ao misturar. |
| [Omi](https://github.com/BasedHardware/omi/tree/5448885692559851e00457e9f088155780c81e87) | MIT, `LICENSE` | Clientes móvel/desktop e wearable; quick start documenta conexão ao backend cloud. | Referência futura de fontes/móvel, esforço alto. Código aberto não comprova operação offline padrão. |
| [Handy](https://github.com/cjpais/Handy/tree/9e57a0d7929fcc6417ea0d6e54c1b57f62635edd) | MIT, `LICENSE` | Toolkit de áudio/VAD, dispositivos, modelos e Tauri; manifesto atual usa transcribe-cpp 0.4.0. | Reaproveitamento pontual baixo/médio. Não é prova pronta de biblioteca multitrilha com identidades persistentes. |
| [Speech Note](https://github.com/mkiol/dsnote/tree/53a4402a63793b818910aa7b5eee5af68b5b70ef) | MPL-2.0, `LICENSE`, cabeçalho de `src/recorder.cpp` | C++/Qt, experiência offline Linux e catálogo de motores/empacotamento Flatpak. | Referência de UX/motores; integração de código alta, obrigações por arquivo devem ser preservadas. |
| [AiNotes](https://github.com/rodolfocamara/AiNotes/tree/c76b87f0fc198167fda1593140fc3a8bb601dbc8) | MIT, copyright Rodrigo Avelino | `python/ainotes/recorder.py` captura/mistura com soundcard; transcriber usa faster-whisper; diarizer usa SpeechBrain ECAPA e clustering. | Referência Python, esforço médio. Embedding por segmento de ASR pode atravessar troca de falante; não prova memória persistente nem separação de sobreposição. |

### Achados que mudam a escolha

1. Conversationaly `audio/diarization.rs` e `config.rs::SPEAKER_DIARIZER`
   explicitam limite de quatro speakers. Não serve como única solução para
   o requisito de mais participantes.
2. Heed `transcription_server.py:1886-1891` chama `update_voice` após match
   automático em um caminho final. Outro caminho, `:2056-2059`, já evita isso
   por contaminação observada. O Coxinha deve ter uma única regra: nenhuma
   sugestão alimenta o perfil sem confirmação humana.
3. `pyannote-rs::EmbeddingManager` pode cadastrar desconhecidos automaticamente
   e possui método de melhor match sem limiar. Não deve ser usado como
   cadastro de pessoas; o extrator pode ser reutilizado, a política é do domínio.
4. As menções a ResNet34 e CAM++ nos arquivos existentes são inconsistentes.
   Não atribuir a um binário convertido a licença de outro modelo de nome
   semelhante. Distribuição dos pesos depende de fonte, versão e hash exatos.

## Provas executáveis iniciais

O Sol 6.1 executou provas isoladas, sem modificar código do produto:

- `whisper-rs 0.16.0`: API atual compilou em projeto mínimo. O adapter antigo
  reproduziu quatro E0599; `full_n_segments` retorna i32 e o acesso usa
  `get_segment`, não os antigos `full_get_segment_*`.
- `transcribe-rs 0.3.1`: inspeção da fonte publicada confirma `CpuOnly`, ausência
  de `CoreMl`, `segments: Option<Vec<_>>` e ausência de `result.language`.
  Esta parte é inspeção de API, não build completo do adapter.
- Fixtures artificiais provaram políticas de unknown, comparação apenas de
  espaços compatíveis, uso apenas de amostras confirmadas, correção/remoção.
  São testes da proposta, não do produto e não de precisão acústica.
- Dois WAVs sintéticos de 1 s / 48 kHz têm conteúdos distintos e 48000 frames
  cada. Isso prova o fixture, não captura real ou sincronismo entre dispositivos.
- Linux tem PipeWire/PulseAudio, pactl, pw-record e ffmpeg. Monitores reais
  estão enumeráveis. Não houve gravação de microfone ou mudança de roteamento.
- Não há pesos nos caches usuais examinados; não se afirma inexistência em
  todo o disco. Runtime Python de inferência não está preparado.
- Não há target/toolchain Windows utilizável no ambiente examinado. Wine não
  comprova comportamento WASAPI real.

Logs/probes isolados estão em `/tmp/coxinha-speech-probes-20261017/`.
Baseline frontend: `pnpm install --frozen-lockfile` concluiu, sem alteração do
lockfile; `pnpm typecheck` passou. `pnpm build` falhou porque `vite.config.ts`
configura minifier esbuild, que não está instalado com Vite 8. Vitest inicial
teve 67 passes/16 falhas em Node 26.11.1 por `localStorage` nativo indisponível.
A reexecução com `NODE_OPTIONS=--no-experimental-webstorage` passou os 83
testes em 13 arquivos e isolou o fator de ambiente. Nenhum resultado de CI
remoto foi inferido.

O Sol aprofundou a prova: pyannote-rs 0.3.4 + ort rc.10 executou segmentador
público MIT adaptado e ResNet34 oficial CC BY 4.0, com embedding finito de 256
dimensões e nenhum segmento em silêncio. O relatório
`2026-10-17-speech-engine-probes.md` registra os hashes/licenças por artefato,
as adaptações e a falta do SHA upstream da conversão. Ainda não há prova de
fala/identidade; a escala i16/f32 exige ensaio antes da aprovação acústica.

## Recorte recomendado

O plano é o documento `../plans/2026-10-17-meeting-library.md`. A memória de
vozes pertence ao primeiro fluxo completo; só a infraestrutura de servidor
remoto, agenda, colaboração e assistente fica para as etapas seguintes.
