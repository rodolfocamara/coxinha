# Core local de reuniões, spec 0058

API Rust sem Tauri. Desktop integra captura e biblioteca por worker dedicado;
diarização real, calibração acústica e reconhecimento entre reuniões reais seguem
pendentes. Contrato IPC: `docs/research/2026-10-18-library-ui-contract.md`.
Não apontar para `.coxinha` nem importar dados antigos automaticamente.

Teste manual desktop: [roteiro e limites](../docs/research/2026-10-18-capture-acceptance.md).
Transporte virtual reproduzível: [ensaio isolado](../docs/research/2026-10-18-isolated-capture.md).

```sh
cargo test -p coxinha-core --features stt-whisper
cargo run -p coxinha-core --bin coxinha-meetings -- sources
cargo run -p coxinha-core --bin coxinha-meetings -- smoke /tmp/coxinha-smoke
cargo run -p coxinha-core --bin coxinha-meetings -- list /tmp/coxinha-smoke
```

Captura real Linux é ação explícita do operador. Requer `pactl` e `parec`,
compatíveis com PulseAudio/PipeWire. Copiar os nomes exatos de `sources`, uma
entrada e um monitor distinto. Não usa dispositivo default nem muda roteamento.

```sh
cargo run -p coxinha-core --bin coxinha-meetings -- capture ROOT MIC_SOURCE MONITOR_SOURCE SECONDS
```

Comandos no stdin: `pause`, `resume`, `stop`. Arquivos `mic.wav` e `output.wav`
PCM16 mono 48 kHz separados. Pulse pode converter canais/taxa solicitados;
"raw" significa trilhas preservadas antes de mix/ASR, não bytes nativos de ADC.
Fila limitada a 64 blocos de 20 ms compartilhados pelas duas fontes (cerca de
640 ms no total). Cada leitor mantém no máximo um bloco adicional enquanto
aguarda espaço, por até dois segundos. Saturação persistente, EOF ou stall
interrompem com erro; uma fila cheia momentaneamente não descarta o bloco.
Clock comum é monotônico na chegada do bloco; latência e drift de dispositivos
não foram medidos/compensados. Pausas excluem frames dos WAVs e ficam na timeline
`timing.jsonl`. Reprodução deverá usar essa timeline, não concatenar como tempo
contínuo. Bloco parcial de fim do subprocesso pode perder menos de 20 ms; não
usar esta fatia como prova de captura sem perdas. Limite RIFF 4 GiB é falha
explícita, sem rollover silencioso. Windows sem adapter nesta fatia.

Checkpoint periódico roda fora da rotina de recebimento: no máximo um job,
com snapshot e handles independentes. Atualiza header WAV, sync de arquivos
e manifest atômico. Finalizar aguarda o checkpoint antes do estado final. Falha
não finaliza originais como sucesso; `recover ROOT MEETING` repara header de
PCM completo e marca timing do tail como incerto. Bytes parciais recusam
recuperação automática. `smoke-hold ROOT` é fixture sintética de kill/recovery,
com espera de 60 s após escrever o id. Nenhum destes comandos abre microfone.

`backup ROOT DEST` exige captura quiescente e destino externo novo. Usa snapshot
SQLite para reuniões e perfis e copia raw fechado. `export ROOT MEETING DEST`
copia somente manifesto/timing e trilhas originais da reunião; exclui outputs
de inferência por padrão para não exportar embeddings. Não inclui pessoas, amostras nem base
privada. Exportação de texto editado é da próxima fatia. O lock de biblioteca
impede writers paralelos pela API. Não expor os bancos sem autenticação.
Unix protege `private/` com 0700; ACL Windows e criptografia são gates futuros.

STT opt-in: `cargo run -p coxinha-core --features stt-whisper --bin
coxinha-meetings -- transcribe MODEL WAV`. Exige modelo local e WAV derivado
PCM16 mono 16 kHz, escala [-1,1]. Sem download automático. Build/test não
comprovam qualidade de fala. Cada chamada possui modelo/state próprios.
