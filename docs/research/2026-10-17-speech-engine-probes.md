# Provas de fala Coxinha, 2026-10-17

## Conclusão

O menor caminho local é manter Whisper CPU via whisper-rs 0.16, corrigir seu adapter e separar a execução do Tauri. Faster-whisper é alternativa substituível em worker Python, mas adiciona runtime/empacotamento. Há agora prova de execução CPU do pyannote-rs com ResNet34 oficial público e segmentador ONNX público adaptado apenas no nome da saída; detalhes e limites na revisão adicional abaixo. Diarização e reconhecimento persistente ainda não têm prova acústica nesta máquina. Não aprovar qualidade, limiar nem identidade por testes sintéticos.

Antes de implementar: Fable deve validar contratos de captura, jobs, memória de vozes e autorização local. O core deve funcionar por API/CLI sem janela Tauri; biblioteca de reuniões e pessoas independente do editor. Servidor remoto/Tailscale fica para depois do fluxo local.

## Código e versões pesquisados em fontes primárias

| Componente | Revisão consultada | Licença do código |
|---|---|---|
| [speechbrain/speechbrain](https://github.com/speechbrain/speechbrain/tree/c0241278f93ef02cd5191f03caf4e5f8e1292bf6) | `c0241278f93ef02cd5191f03caf4e5f8e1292bf6` | Apache-2.0 |
| [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio/tree/b749285c5cdd4636b2edc7f766f1352c8dde9369) | `b749285c5cdd4636b2edc7f766f1352c8dde9369` | MIT |
| [thewh1teagle/pyannote-rs](https://github.com/thewh1teagle/pyannote-rs/tree/e23bd292298750ca8441039ae588afd5e4351c49) | `e23bd292298750ca8441039ae588afd5e4351c49` | MIT |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper/tree/9e472ae9de8bb374552f531f752654554b76b2d6) | `9e472ae9de8bb374552f531f752654554b76b2d6` | MIT |
| [handy-computer/transcribe.cpp](https://github.com/handy-computer/transcribe.cpp/tree/b61b7f936e4e728f8999a8c3e98c7112e700410e) | `b61b7f936e4e728f8999a8c3e98c7112e700410e` | MIT |

Crates efetivamente travados: whisper-rs 0.16.0 (Unlicense), whisper-rs-sys 0.15.0, transcribe-rs 0.3.1 (MIT), pyannote-rs 0.3.4 (MIT). Fonte publicada dos três primeiros adapters em `crates/`, baixada de crates.io; não confundir código MIT dos wrappers com licença dos pesos. CLAUDE.md foi lido; nenhum arquivo do produto foi alterado.

## APIs e defeitos encontrados

- Whisper: `full_n_segments()` retorna i32 diretamente. Adapter chama `.map_err()`. Métodos `full_get_segment_text/t0/t1` não existem na API pública 0.16; usar `get_segment()` e métodos do segmento. O comentário GGUF está incorreto para arquivos ggml citados.
- Parakeet: 0.3.1 tem `OrtAccelerator::CpuOnly`, não `Cpu`; não tem `CoreMl`. `TranscriptionResult.segments` é `Option<Vec<TranscriptionSegment>>`; não existe `result.language`. Load/transcribe_with/Quantization existem. Não basta habilitar feature atual.
- Pyannote: implementação do produto apenas retorna segmentos sem speakers. API real é `get_segments(&[i16], sample_rate, model_path)`; extractor `compute(&[i16])` retorna iterador f32. Sketch `segment()` está incorreto.
- `EmbeddingManager::search_speaker` insere desconhecido automaticamente enquanto há capacidade, e `get_best_speaker_match` força melhor pessoa sem threshold. Não usar como memória central de pessoas. Ele não oferece isolamento por versão, proveniência, correção ou remoção.
- transcribe.cpp fornece C API em include/transcribe.h, implementação C++17 e build CMake Linux/Windows. O catálogo atual inclui muitos motores e não constitui prova local. Não foi compilado neste estudo.
- faster-whisper possui WhisperModel(local_path, device="cpu", compute_type="int8", local_files_only=True); segmentos são lazy. Não usar identificador remoto em runtime offline.
- pyannote.audio usa PyTorch e pipeline community-1; obter pesos requer aceite/token no Hugging Face. Deve desativar telemetria explicitamente antes de qualquer execução offline.
- SpeechBrain oferece EncoderClassifier/encode_batch e SpeakerRecognition; ECAPA do model card tem 192 dimensões (`lin_neurons: 192`). Isso é configuração primária, não dimensão medida numa inferência local.

## Modelos, licenças e limites

| Modelo | Revisão Hugging Face consultada | Licença declarada / acesso |
|---|---|---|
| [pyannote/segmentation-3.0](https://huggingface.co/pyannote/segmentation-3.0/tree/e66f3d3b9eb0873085418a7b813d3b369bf160bb) | `e66f3d3b9eb0873085418a7b813d3b369bf160bb` | mit / gated=auto |
| [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1/tree/3533c8cf8e369892e6b79ff1bf80f7b0286a54ee) | `3533c8cf8e369892e6b79ff1bf80f7b0286a54ee` | cc-by-4.0 / gated=auto |
| [speechbrain/spkrec-ecapa-voxceleb](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/0f99f2d0ebe89ac095bcc5903c4dd8f72b367286) | `0f99f2d0ebe89ac095bcc5903c4dd8f72b367286` | apache-2.0 / gated=False |
| [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120) | `536b0662742c02347bc0e980a01041f333bce120` | mit / gated=False |
| [nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3/tree/541d1f99c6b0c3cd0b11a95167540bb8edefd82b) | `541d1f99c6b0c3cd0b11a95167540bb8edefd82b` | cc-by-4.0 / gated=False |
| [pyannote/wespeaker-voxceleb-resnet34-LM](https://huggingface.co/pyannote/wespeaker-voxceleb-resnet34-LM/tree/837717ddb9ff5507820346191109dc79c958d614) | `837717ddb9ff5507820346191109dc79c958d614` | cc-by-4.0 / gated=False |

Os binários segmentation-3.0.onnx e wespeaker_en_voxceleb_CAM++.onnx distribuídos em releases do pyannote-rs não foram baixados. O README do produto mistura resnet34 e CAM++; são modelos distintos. Não atribuir automaticamente a licença/revisão do ResNet ao CAM++ convertido. Proveniência/licença exatas do artefato convertido CAM++ ainda não estão demonstradas; bloquear sua distribuição até resolver. Dimensão WeSpeaker não foi medida; deve ser obtida do modelo escolhido e validada, nunca assumida por nome.

## Provas executáveis e ambiente

- `python invariants.py`: PASS para unknown, consulta sem auto-cadastro, bloqueio de versão/dimensão incompatível, só confirmado participa, correção e remoção. Vetores artificiais de 2 dimensões; prova apenas invariantes de política. Não há clustering acústico nem calibração real.
- ffmpeg lavfi gerou duas ondas de 1 s, 440/880 Hz em WAVs independentes 48 kHz. Python wave confirmou 48000 frames em ambas e conteúdos distintos. Prova formato/timeline sintética; não prova drift de dispositivos reais.
- `cargo check --manifest-path api-probe/Cargo.toml`: PASS em 44.59 s, log em api-build.log. Compilou whisper-rs e assinatura nova, sem Tauri/modelos/áudio pessoal. `cargo check ... --bin current_adapter`: FAIL esperado, exit 101, quatro erros de API do adapter atual reproduzidos em current-adapter-build.log.
- Python atual: numpy disponível; torch, faster_whisper, speechbrain, pyannote, onnxruntime ausentes. Não foram instalados globalmente. Nenhum peso localizado em ~/coxinha e caches usuais Hugging Face/Whisper. Não se conclui inexistência em todo o disco.
- Linux: pactl, pw-record e ffmpeg disponíveis. `pactl info` mostrou PipeWire 1.6.9 via compatibilidade PulseAudio; `pactl list short sources` mostrou microfones e monitores de sinks em 48 kHz. Nenhuma captura real nem mudança de configuração.
- Windows: wine existe; toolchain Rust instalada somente x86_64-unknown-linux-gnu; rustup e MinGW gcc ausentes. Nenhum teste WASAPI de hardware possível nesta sessão. Wine não prova WASAPI loopback real.

## Contratos recomendados para o plano

1. Captura produz mic.wav e output.wav separados, manifest com relógio monotônico, timestamp do primeiro frame, taxa, frames, gaps e correção explícita de drift. Começar dois recorders juntos não garante sincronização. Windows usa WASAPI input/loopback; Linux usa entrada/monitor PipeWire. Troca de dispositivo e suspensão devem produzir gap/erro visível, nunca áudio silencioso fingindo sucesso.
2. Jobs locais versionados: normalização, STT, diarização por reunião, embeddings e sugestões de identidade. Persistir inputs/outputs/checksums e erro por etapa para reprocessar sem recapturar. Overlap não deve ser reduzido cegamente a uma pessoa.
3. Memory guarda múltiplas amostras por pessoa: model family/revision/hash, preprocessing revision, dimension, source meeting/track/time range/hash, created/confirmed timestamps e estado. Só confirmação humana torna amostra elegível. Match sugere; nunca treina por match.
4. Comparar apenas mesmo espaço de embedding e versão de preprocessing, norma não zero e valores finitos. Similaridade é score cosseno, não probabilidade/confiança. Unknown com limiar calibrável e margem entre candidatos; abster se evidência insuficiente.
5. Correção e desfazer precisam invalidar resultados derivados/caches e refletir na próxima busca; remoção exclui amostra da memória ativa. Não incorporar nomes em centroides sem rastrear contribuições removíveis.
6. Calibrar threshold em amostras consentidas de reuniões distintas, com unknowns, canais/dispositivos distintos e português. Medir false accept/reject, DER/JER e WER separadamente. Não sei a qualidade acústica desse conjunto antes dessa avaliação.

## Pendências reais

Adapter do produto precisa correção antes do build com feature; pesos e proveniência das conversões ainda precisam seleção/pin/hash; captura sincronizada Linux e Windows exige ensaio de hardware autorizado; nenhuma transcrição/diarização/identificação acústica foi executada. Nenhum modelo grande ou gated foi baixado, nenhum termo aceito, nenhuma chave/cloud ou microfone real usado.


## Revisão adicional: par ONNX público, 2026-10-17

Conclusão: há um par público que roda no pyannote-rs CPU sem credencial/aceite, com licenças declaradas e hashes exatos dos artefatos. Ele usa ResNet34 oficial WeSpeaker, não o CAM++ da release. O segmentador deriva de pyannote/segmentation-3.0 por conversão publicada pelo onnx-community. A proveniência declarada e o artefato convertido são demonstrados; a revisão exata dos pesos upstream usada nessa conversão não consta no card. Se o requisito for reprodução byte a byte desde o checkpoint upstream com SHA fixo, essa exigência ainda está bloqueada. Não apresentar a conversão como auditada/reproduzível integralmente.

| Artefato | Origem/revisão | Licença declarada | SHA-256 do arquivo | Acesso/prova |
|---|---|---|---|---|
| `onnx/model.onnx`, 5,986,908 bytes | [onnx-community/pyannote-segmentation-3.0 @733a93b6473d019a773298e08cefa686894b1854](https://huggingface.co/onnx-community/pyannote-segmentation-3.0/tree/733a93b6473d019a773298e08cefa686894b1854) | MIT no card; base pyannote/segmentation-3.0 também MIT | `057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25` | Download anônimo e CPU ORT executado. Card inclui script torch.onnx.export. Não exigiu aceite/token. |
| `segmentation-output-renamed.onnx`, derivado local | Arquivo acima, somente nome de tensor logits para output | MIT herdada; registrar modificação/distribuição | `0eeb4bf82ea240763699fc9ac3fbdd4c4bfdf9af92e33e7eaf9b77511fdc37a3` | onnx.checker passou; saída numericamente idêntica bit a bit na fixture de ruído sintético; pyannote-rs aceitou. |
| `voxceleb_resnet34_LM.onnx`, 26,530,309 bytes | [WeSpeaker oficial @f0c48c298fd835726c27956a5d617bad7115627e](https://huggingface.co/WeSpeaker/wespeaker-voxceleb-resnet34-LM/tree/f0c48c298fd835726c27956a5d617bad7115627e) | CC BY 4.0 no card; respeitar atribuição | `7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068` | Download anônimo e extração via pyannote-rs CPU passou, 256 dimensões finitas. |
| `segmentation-3.0.onnx`, 5,983,836 bytes | [Release pyannote-rs v0.1.0](https://github.com/thewh1teagle/pyannote-rs/releases/tag/v0.1.0) | Release não declara licença específica dos pesos nem revisão upstream | `b78fc48113bb46fd247ae6a9aea737079550c647638db961df7e0e1e9f4ba62e` | Público; baixado só para comparar. Entradas input e saída output. Não é mesmo arquivo nem conjunto de inicializadores do onnx-community. Não adotar sem fechar proveniência. |
| `wespeaker_en_voxceleb_CAM++.onnx`, 29,292,684 bytes | Mesma release v0.1.0 | Não demonstrada para esse artefato | Não baixado/não medido | Release contém CAM++, não ResNet34. Não substituir licença de um modelo pela de outro. |
| `embedding_model.ckpt`, 83,316,686 bytes | [SpeechBrain ECAPA @0f99f2d0ebe89ac095bcc5903c4dd8f72b367286](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/tree/0f99f2d0ebe89ac095bcc5903c4dd8f72b367286) | Apache 2.0 | LFS SHA-256 publicado: `0575cb64845e6b9a10db9bcb74d5ac32b326b8dc90352671d345e2ee3d0126a2` | Público; metadados consultados, peso não baixado nem executado. 192 dimensões segundo YAML. |

Fontes de código complementares: [WeSpeaker @9fecd6cb4f47475d01761d87c826298dff4ef18c](https://github.com/wenet-e2e/wespeaker/tree/9fecd6cb4f47475d01761d87c826298dff4ef18c), Apache 2.0; [Silero VAD @1e261b036686cd0017d500ee96acd1c4ba572a9d](https://github.com/snakers4/silero-vad/tree/1e261b036686cd0017d500ee96acd1c4ba572a9d), MIT. Licença do toolkit não substitui os cards dos modelos.

### Prova executada

Ambiente Python isolado `onnx-venv`: onnxruntime 1.31.0, onnx e numpy. Segmentador input `[B,C,T]`, output `[B,frames,7]`, inferência zero `[1,1,160000]` resultou `[1,589,7]`, finita. ResNet34 input `feats [B,T,80]`, output `embs [B,256]`, inferência zero finita. A adaptação logits→output foi verificada em ruído determinístico e não modifica cálculo.

`cargo run --manifest-path pyannote-probe/Cargo.toml`: PASS com `pyannote-rs =0.3.4` e `ort =2.0.0-rc.10`, em 7.16 s após dependências já parcialmente compiladas. Resultado: embedding_dim=256, segments=0 para 10 s de zeros. Log `pyannote-cpu-pinned.log`. Sem pin direto, Cargo selecionou ort rc.14 e a crate falhou com 24 erros; log `pyannote-cpu-build.log`. O produto já fixa rc.10, preservar esse contrato.

Total de pesos baixados nessa etapa: 38,501,053 bytes, dentro do limite de 200 MB. Nenhum áudio pessoal ou WAV de fala pública foi usado. Silêncio/ruído/seno testam plumbing, formato e invariantes; não WER, DER, reconhecimento, thresholds ou robustez. A amplitude/preprocessamento de `get_segments` merece validação específica: o código converte i16 diretamente para f32, enquanto export upstream recebe waveform float. Zeros não detectam esse desvio. Não liberar qualidade antes de validar escala, framing, overlap e timeline com fala consentida/licenciada.

### Comparação com worker SpeechBrain

| Opção | Evidência local | Custo/limite |
|---|---|---|
| pyannote-rs + segmentador público adaptado + ResNet34 oficial | Build e execução CPU reais, sem aceite/token, hashes acima, 256 dimensões | Menor runtime Rust/ORT já usado; conversão do segmentador não fixa checkpoint upstream; precisa validar preprocessamento e qualidade. |
| Worker isolado SpeechBrain ECAPA + Silero VAD | ECAPA público Apache 2.0 e Silero MIT com fontes consultadas; sem execução local dessa combinação | Exige PyTorch/torchaudio/worker Python; VAD segmenta fala mas não faz diarização de pessoas por si só; requer janelamento/overlap/clustering próprios. Não elimina desenho/calibração nem prova acústica. |

Recomendação para Fable: aprovar adapter opcional do par ONNX com manifesto de artefatos/pins/licenças e teste de ausência de rede, mantendo qualidade/identidade atrás de confirmação humana e unknown. Se exigir cadeia criptográfica completa até pesos upstream antes de usar qualquer derivado, bloquear o segmentador convertido e resolver essa proveniência primeiro. Não transplantar auto-update de vozes de Heed nem limite de 4 speakers de Sortformer como política do produto.
