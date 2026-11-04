# Spec 0058: Biblioteca local de reuniões e memória de vozes

- Status: em implementação, fundação e interface de captura Linux; não concluída
- Data: 2026-10-17
- ADR: [0018](../architecture/decisions/0018-meeting-library-and-identity.md)
- Plano: [biblioteca](../plans/2026-10-17-meeting-library.md)

## Contratos

Biblioteca independente `/meetings`; nenhuma nota obrigatória. Core sem Tauri.
Linux+Windows com mic e output explícitos, originais separados, manifest
versionado, checkpoints, pausas/gaps e timestamps monotônicos por bloco.
Tempo de entrega ao processo não é timestamp de hardware: declarar incerteza,
não afirmar drift compensado. Buffers limitados e falha explícita se saturados.
Captura manual; deteção de chamadas futura. Raw fechado nunca é sobrescrito.

`meetings.db` canônico separado de `.coxinha/index.db`; `private/profiles.db`
privado. Migração transacional versionada, futuras versões recusadas; backup
consistente de ambos e cópia de arquivos fechados. Sem migração legada automática.
Jobs idempotentes por hash de entrada/config/modelo/versão; execuções novas
não apagam outputs anteriores nem edições humanas. Recuperar jobs interrompidos
explicitamente. Artefatos pertencem à reunião, com checksum e caminhos relativos.

Pessoa estável, espaços versionados, múltiplas amostras com trecho/trilha/hash,
dispositivo/qualidade/origem da confirmação. Apenas confirmação explícita
ativa amostra. Microfone não prova dono. Matching read-only, unknown sem
calibração, limiar e margem calibráveis sem default anunciado como calibrado.
Rejeitar NaN/infinito/zero/dimensão/modelo/preprocessing incompatíveis. Revogar
ou corrigir preserva originais/histórico e muda a próxima consulta. Exportação
de reunião não contém profiles.db, vetores ou decisões privadas.

## Aceitação por fatia

| Critério | Prova exigida | Estado inicial |
|---|---|---|
| A contratos e emendas históricas | ADR/spec antes do código | nesta rodada |
| B migrações/reabertura/future-version | testes bancos temporários e rollback | nesta rodada |
| B jobs/artefatos/correções | idempotência, falha, recovery, checksums | nesta rodada |
| B identidade | fixtures de política, correção/revogação, espaços isolados | nesta rodada, não acústico |
| B captura Linux | CLI explícita, filas/checkpoint/pause/gaps, recovery sintético | nesta rodada; hardware pendente |
| B Whisper | compile feature/API e validação WAV | nesta rodada; fala pendente |
| C motores reais e UI biblioteca | diarização por trilha, playback/revisão e confirmação | próxima rodada |
| C segunda reunião | conhecidos e unknown, held-out, métricas reais | pendente |
| D Windows | build nativo, WASAPI e captura real com drift medido | pendente |
| D export/backup | privacidade estrutural e restauração | fundação testada; UX pendente |

Nenhum checklist done será preenchido por silêncio/seno/vetores sintéticos.
Não há limite acústico/drift afirmado antes de medir. Servidor/Tailscale,
calendário, PWA e compartilhamento ficam após fluxo local completo.

## Incremento de 2026-10-18

Biblioteca desktop independente implementada como tela inicial. IPC para listar
fontes/reuniões, iniciar, pausar, retomar, parar, recuperar e ouvir trilhas
fechadas. Worker possui Store e captura; não executa áudio no runtime da UI.
Os medidores e a detecção de stall são independentes por fonte. Respostas de
polling anteriores a comandos não podem desfazer o estado novo na interface.
Nenhuma transcrição/diarização/identidade é simulada pela biblioteca.

Transporte Linux exercitado em servidor PipeWire/Pulse isolado, sem hardware:
440 Hz em mic e 880 Hz em monitor; pausa e stall de somente uma fonte testados.
Isso fecha a prova de transporte virtual da fatia B e parte da UI da fatia C.
Captura/playback nos dispositivos reais, drift, Windows e o fluxo acústico
entre duas reuniões continuam pendentes. [Roteiro de aceite](../research/2026-10-18-capture-acceptance.md).
Evidência consolidada: [relatório de testes e limites](../reports/2026-10-18-library-capture.html).

## Evidência da primeira rodada

Relatório: [2026-10-17](../reports/2026-10-17-meeting-library.html).
Core e CLI implementados sem Tauri, 12 testes unitários e 1 integração com
encerramento real de processo sintético. Frontend baseline 83/83 e build;
Whisper feature check no Tauri passou. Não há aceite de captura real Linux,
Windows, inferência de fala ou segunda reunião. Próxima fatia fecha adapters
de engines e UX da biblioteca; não ativar pipeline incompleto por padrão.

## Incremento posterior de 2026-10-18: processamento

A spec [0059](0059-local-meeting-processing.md) implementa a próxima fatia: inferência local real, jobs, histórico/correções e confirmação/revogação de vozes. [Evidências e limites](../research/2026-10-18-local-processing-acceptance.md). O estado antigo de engines indisponíveis descrito acima é histórico; build `local-processing` agora as inclui. Captura física, qualidade acústica, reconhecimento calibrado e Windows não estão aceitos.
