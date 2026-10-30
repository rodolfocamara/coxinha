Leitura concluída. Segue o parecer.

## Veredito: condicional. O plano A–D está na direção certa, mas precisa de 6 emendas de ADR/spec antes de código e de 3 correções de desenho que, se ficarem para depois, viram reescrita.

**Estado real do código** (evidência para a etapa A): a trilha de áudio é 100% stub. `src-tauri/src/recorder.rs` não captura nada, só grava linha no SQLite e `metadata.json`; `diarizer/pyannote.rs` devolve os segmentos sem alterar e loga warning; `transcribe_meeting` em `src-tauri/src/lib.rs:329` retorna `Err("not wired yet")`; o port do Handy (ADR-0014) trouxe só o VAD, sem `recorder.rs` nem `rubato` (`src-tauri/src/audio_toolkit/` tem apenas `vad/`). A tabela `meetings` em `src-tauri/src/db.rs:49` é criada com `IF NOT EXISTS`, sem versionamento de schema. Conclusão: não há "código antigo de captura" a preservar, só contratos em docs. O que precisa ser preservado é notas, storage, shell e os testes existentes.

### Achados por severidade

1. **Bloqueador. Spec 0057 recém-mergeada (PR #23) removeu `/meetings` e declara "meetings são blocos dentro de notas"; o novo brief diz biblioteca de reuniões primeiro.** Contradição direta com a última entrega. Precisa de emenda em `docs/specs/0057-app-shell-rebuild.md` (seção Routes) antes de código, decidindo: rota de biblioteca volta e `MeetingBlock` vira link para ela. O `MeetingRow` das fixtures (`src/features/meetings/fixtures.ts`) guarda `transcriptMd: string`, incompatível com transcrição sincronizada ao áudio, que exige segmentos tipados com tempo, trilha e id de locutor.

2. **Bloqueador. Truth de armazenamento.** CLAUDE.md "Filesystem is canonical", ADR-0002, ADR-0015 Invariante 1 e `docs/architecture/vault-schema.md` dizem que SQLite é índice reconstruível. O plano B propõe SQLite canônico para as novas entidades. Isso exige um ADR que substitua parcialmente 0002 e emende 0015, com a regra híbrida explícita: trilhas originais são artefatos imutáveis em disco com manifesto e hash; metadados, jobs, correções, pessoas e amostras de voz são verdade no SQLite; `rebuild_from_vault` deixa de ser garantia para o domínio de reunião. Sem isso, a cláusula "sem duas verdades" do próprio plano fica indefinida.

3. **Bloqueador. Trilhas separadas vs mix.** Spec 0007 e `vault-schema.md` fixam `recording.wav` 16 kHz mono mixado como artefato canônico. O brief exige originais separados e sincronizados, mix só derivado. A spec 0007 deve ser substituída, não emendada: ela também fixa Windows-only para loopback, mic-only para Linux, e detecção de chamada via `IAudioSessionManager2`, que perde prioridade num cenário Teams web com fones. Correção de desenho que recomendo registrar na nova spec: **diarizar por trilha, não sobre o mix**. Com fones, a trilha de mic contém quase só o usuário e a trilha monitor só os remotos; isso resolve identidade do usuário trivialmente e reduz erro. O caso mic compartilhado em sala vira o único caso multi-locutor na trilha de mic.

4. **Alto. Trait de diarização e ADR-0009 são estreitos demais para identidade persistente.** `Diarizer::diarize(wav, segments) -> segments` (`src-tauri/src/diarizer/mod.rs:22`) só rotula. Identidade exige estágios separados com proveniência: segmentação, embeddings por segmento, clustering intra-reunião, comparação com perfis confirmados. Precisa de ADR novo definindo o modelo: `person`, `voice_sample` (com model_id, versão, hash do modelo, dispositivo, trilha de origem, qualidade), `speaker_assignment` com estado sugerido/confirmado/rejeitado. Encaixe com ADR-0015: a atribuição confirmada é Knowledge (autoria do usuário); o embedding é derivado e re-derivável a partir do trecho de áudio + atribuição, logo pode ser descartado e recalculado quando o modelo muda. Isso implementa de graça "espaços de embedding incompatíveis nunca se comparam" (chave composta por versão do espaço) e "undo não contamina" (apagar a atribuição apaga as amostras derivadas).

5. **Alto. ADR-0004 "Pure Rust, no Python sidecar" vs qualidade de diarização CPU-only em PT.** Candidatos Rust: `pyannote-rs` 0.3.4 (MIT, 0% documentado no docs.rs, API não verificável pela página; modelos segmentation-3.0 MIT porém gated no HF, e wespeaker-voxceleb-resnet34-LM CC-BY-4.0 treinado em VoxCeleb); `speakrs` ainda placeholder. Heed e o seu AiNotes (`/mnt/win/Users/rcamara/Repos/AiNotes/python/ainotes/diarizer.py`, SpeechBrain ECAPA + clustering) resolveram com Python. O próprio brief admite "worker opcional". Recomendo emendar ADR-0004: núcleo Rust, worker local opcional como processo separado atrás da mesma API de jobs. Decisão sua antes da etapa C.

6. **Alto. Captura de áudio de sistema no Linux não é garantida pelo cpal padrão.** O host default do cpal no Linux é ALSA, que não enumera monitores Pulse/PipeWire; foi exatamente isso que exigiu o hack do `alsa.conf` em `/home/rcamara/.local/opt/meetily/launch`. O README do cpal lista hosts opcionais `pipewire` e `pulseaudio`. Probe obrigatório antes da spec: enumerar `*.monitor` via host pipewire do cpal 0.17 e, se falhar, `pipewire-rs` direto. Windows: `wasapi` já é dependência, mas mic via cpal e loopback via wasapi têm relógios distintos; "sincronizado" precisa de tolerância medida e compensação de drift, não só carimbo inicial.

7. **Alto. Pré-requisito ausente: migrações de schema (spec 0004) não existem.** Adicionar 6 a 8 tabelas novas sobre `CREATE TABLE IF NOT EXISTS` sem `user_version` torna qualquer correção posterior destrutiva. Fazer o runner de migração antes das entidades.

8. **Alto. Separação de crates agora, ou a API independente do Tauri vira reescrita.** `db.rs`, `storage.rs`, `config.rs` vivem dentro do crate `coxinha` que depende de `tauri` e usa `tauri::State`. O plano B fala em "domain/core independente" mas não diz quando. Tem que ser o primeiro commit de código: `coxinha-core` (domínio + jobs), `coxinha-store` (SQLite + artefatos), `coxinha-audio` (adapters), `src-tauri` fino. É a única parte do plano onde "evitar rewrite" está realmente em jogo.

9. **Médio. Perfis de voz fora do share por padrão deve ser estrutural.** Recomendo banco SQLite separado (`profiles.db`) para pessoas, amostras e embeddings. Exclusão por arquivo é verificável; exclusão por filtro de query é bug esperando acontecer. LGPD: voz é dado biométrico, portanto sensível (art. 5º, II e art. 11); registrar campo de consentimento/origem por pessoa e caminho de exclusão total. Decisão de produto sua.

10. **Médio. "Zero network in F1" vs download de modelos e modelo gated.** segmentation-3.0 exige conta HF e aceite de termos; o `pyannote-rs` redistribui o ONNX nos releases do GitHub (`scripts/download-models.sh` já aponta para lá). Onboarding precisa de opt-in explícito e preferência por modelos não-gated (sherpa-onnx redistribui 3D-Speaker/wespeaker sob licenças próprias, a confirmar). Atribuição CC-BY-4.0 do wespeaker no app e no README. Confirmar com o agente Sol: restrições do dataset VoxCeleb, licença do `transcribe.cpp` usado pelo Conversationaly, e se `sherpa-rs` (bindings Rust do sherpa-onnx) cobre embedding + diarização offline, o que o tornaria candidato mais forte que `pyannote-rs`.

11. **Médio. Whisper `ggml-base` como default é fraco para PT-BR.** `docs/architecture/meeting-pipeline.md` fixa base/CPU. Para a primeira entrega, benchmark CPU com small, medium, large-v3-turbo e Parakeet TDT v3 (já em `transcribe-rs`, suporta PT) em gravações held-out, com WER reportado. "Sem confiança falsa" vale para STT também: o `confidence: None` atual é honesto, manter até ter métrica calibrada.

12. **Médio. Reuso de transcrição do Teams.** Via Graph exige consentimento de tenant, que o brief proíbe alterar. Alternativa viável sem tenant: importar `.vtt`/`.docx` exportado manualmente do Teams como fonte adicional. Tratar Graph como "desconhecido até validar permissões", não como planejado.

13. **Médio. CI Windows.** `.github/workflows/ci.yml` roda só Ubuntu; `release.yml` usa `windows-latest` com `full-release` (inclui `cuda`), que dificilmente compila. Adicionar job Windows `cargo check --features capture` cedo, antes do adapter WASAPI. As diferenças de EOL em `/mnt/win/.../coxinha` pedem `.gitattributes` com `eol=lf` para parar o ruído.

14. **Baixo. Fixtures com nomes e empresas reais-aparentes** (`src/features/meetings/fixtures.ts`: Rita Menezes, Kathia, HDI). Confirmar que são sintéticos; o brief proíbe transcrições reais no repo.

15. **Baixo. Importar metadados antigos.** Nenhuma reunião real foi gravada pelo código atual (recorder stub). Verificar `~/coxinha/meetings/` do usuário; se vazio, "import de metadata antiga" reduz-se a ler `metadata.json` sem `version` sem quebrar.

### Ordem de implementação proposta

| Etapa | Conteúdo | Gate de saída |
|---|---|---|
| 0. ADRs e specs | ADR truth híbrida (substitui parte de 0002, emenda 0015 e CLAUDE.md); ADR Linux+Windows co-primários (emenda "Windows-first"); ADR captura em trilhas separadas; ADR identidade de locutor e placement Knowledge/Memory; ADR split de crates + worker opcional (emenda 0004); specs novas substituindo 0007/0008; emenda de rotas em 0057 | Revisadas por você |
| 1. Probes executáveis em `tools/probes/`, fora do produto | P1 cpal host pipewire enumera monitor e grava 2 WAVs com relatório de drift; P2 whisper-rs e Parakeet em fixture PT; P3 pyannote-rs vs sherpa-rs: embeddings em fixture multi-locutor sintética; P4 `cargo check` Windows e loopback wasapi no PC Windows | Relatório com números, não "funciona" |
| 2. Fundação | Runner de migração (spec 0004); split de crates; tabelas de reunião/trilha/job/correção; `profiles.db` separado | Testes de migração e de truth |
| 3. Slice Linux | Captura dupla com meters por fonte, pause/resume, troca de dispositivo, checkpoints; job durável STT → diarização por trilha → sugestão de identidade; confirmar; segunda reunião reconhece; biblioteca mínima acessível + CLI de debug | Fluxo completo em Linux com gravação sintética e uma real sua |
| 4. Windows | Adapter WASAPI, mesmo conjunto de testes sintéticos, CI Windows | Aceite em hardware, separado |
| 5. Servidor, mobile, calendário | Depois do slice provado | — |

### Testes de aceitação mínimos a escrever junto das specs

- Duas trilhas sintéticas com clique de sincronismo: desvio após correção abaixo de um limite declarado (sugiro 20 ms em 60 min).
- Kill durante captura: ambas as trilhas reproduzíveis até o checkpoint, manifesto consistente, job retomável.
- Identidade: enrolar A e B em reunião 1; reunião 2 com A, B e C: A e B reconhecidos, C "desconhecido"; rejeitar sugestão errada e verificar que a amostra não entra no perfil; trocar versão de modelo e verificar que nenhuma comparação cruza espaços.
- Calibração: limiar escolhido em gravações held-out com taxa de falso aceite e falso rejeite reportadas na spec, não hardcoded sem fonte.
- Share de reunião: pacote exportado não contém nenhuma linha de `profiles.db`.
- Distinguir em todo relatório: build compilou, sintético passou, captura real passou, aceite seu.

### Decisões que dependem de você

1. Worker Python/opcional permitido como processo separado (emenda ADR-0004)? Recomendo sim, atrás da API de jobs.
2. Rota `/meetings` volta como biblioteca, com `MeetingBlock` apontando para ela? Recomendo sim.
3. `profiles.db` separado e campo de consentimento por pessoa? Recomendo sim.
4. Detecção de chamada (spec 0007) sai do MVP em favor de captura explícita? Recomendo sim.
5. Default de STT para PT: aguardar o benchmark da etapa 1 antes de fixar.

Nenhuma validação de hardware ou de modelo foi feita aqui; os itens 5, 6, 10 e 11 dependem dos probes e da pesquisa de licenças do agente Sol.
