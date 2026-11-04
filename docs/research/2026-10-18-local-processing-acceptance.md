# Processamento local: implementação e evidências de 2026-10-18

O Coxinha agora processa gravações fechadas com Whisper CPU, segmentação ONNX e embeddings WeSpeaker. Há transcrição, agrupamentos anônimos, confirmação/correção/revogação de identidades e histórico de versões na biblioteca. A inferência executou com fala pública em inglês e português, inclusive em namespace sem rede. **Ainda não é o aceite do MVP:** a separação de falantes errou agrupamentos, a atribuição de frases ficou conservadoramente desconhecida e o reconhecimento automático entre reuniões exige calibração.

## O que mudou

- Jobs persistentes idempotentes, retry e retomada após reinício como pendente, sem iniciar inferência automaticamente. Modelos, parâmetros normalizados, implementação e conteúdo participam da identidade do job.
- Validação de arquivos e inferência fora do worker que possui SQLite. Captura e processamento mutuamente exclusivos nesta entrega. Status/listagem continuam respondendo.
- Reamostragem FIR 48→16 kHz, normalização de amplitude e trilhas originais preservadas. Segmentação usa waveform normalizado diretamente no ONNX, evitando o desvio de escala observado no helper upstream.
- Artefatos públicos sem vetores. Candidatos e amostras em `private/profiles.db`; migração transacional v1→v2. Exportação contém áudio/manifesto/transcrição selecionada, não base de vozes.
- Confirmação e cadastro de amostras explícitos; unknown não pode virar uma pessoa em bloco. Correção/revogação invalidam contribuições anteriores. Falha no cadastro em lote revoga novas amostras já inseridas.
- Reprocessamento cria outra versão quando entradas/configuração mudam. Correções anteriores continuam acessíveis no seletor de versões. Nomes confirmados não são transferidos automaticamente a novos clusters.
- UI com seleção de perfil local, navegação por timestamps/trechos de voz, pessoas, confirmação, correções e histórico. Configuração técnica fica recolhida. Fontes remotas do Google foram removidas; a revisão no navegador não observou recursos externos.

## Modelos e runtime usados

| Artefato | Revisão / origem | Licença declarada | SHA-256 |
|---|---|---|---|
| ggml-tiny.bin multilíngue | [ggerganov/whisper.cpp @5359861](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1) | MIT | `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` |
| segmentation.onnx | [onnx-community @733a93b](https://huggingface.co/onnx-community/pyannote-segmentation-3.0/tree/733a93b6473d019a773298e08cefa686894b1854) | MIT | `057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25` |
| wespeaker.onnx | [WeSpeaker @f0c48c2](https://huggingface.co/WeSpeaker/wespeaker-voxceleb-resnet34-LM/tree/f0c48c298fd835726c27956a5d617bad7115627e) | CC BY 4.0 | `7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068` |
| libonnxruntime.so.1.22.0 | [Microsoft ONNX Runtime v1.22.0, Linux x64 CPU](https://github.com/microsoft/onnxruntime/releases/tag/v1.22.0) | MIT | `3da6146e14e7b8aaec625dde11d6114c7457c87a5f93d744897da8781e35c673` |

Arquivo oficial do runtime: SHA-256 `8344d55f93d5bc5021ce342db50f62079daf39aaafb5d311a451846228be49b3`. Notices/licenças do pacote estão no diretório extraído. Nenhum peso é incorporado ao Git. A revisão exata do checkpoint upstream usado na conversão ONNX do segmentador continua não declarada pelo conversor; não apresentar cadeia de reprodução integral. Não usamos CAM++ da release pyannote-rs. Código usa whisper-rs 0.16.0, pyannote-rs 0.3.4 e ort =2.0.0-rc.10.

## Inferência real

Amostras LibriSpeech/OpenSLR, CC BY 4.0, derivadas de audiolivros LibriVox; atribuição a Vassil Panayotov, Daniel Povey e contribuidores/narradores. IDs, transcrições e hashes em `tools/fixtures/librispeech-provenance.json`. Revisão HF `71cacbfb7e2354c4226d01e70d77d5fca3d04ba1`. Três pessoas: 6930, 1320 e 260. Os áudios foram organizados com silêncio entre trechos para testar cenários; não são reuniões reais nem prova de captura.

| Cenário | Tempo CPU observado | Texto / turnos | Resultado acústico |
|---|---:|---|---|
| Duas fontes, duas vozes | 7,57 s | 2 / 2 | 2 clusters distintos |
| Três pessoas na saída | 7,76 s | 5 / 6 | 4 clusters para 3 pessoas; 2 turnos curtos desconhecidos |
| Recorrência, outras frases | 9,35 s | 3 / 3 | 3 clusters; embeddings comparados separadamente abaixo |
| Três pessoas no mesmo microfone simulado | 6,84 s | 5 / 6 | Mesmo erro de fragmentação, não prova presencial |
| Português, duas fontes | 7,61 s | 2 / 2 | 2 clusters; transcrição com erros |

As frases transcritas permaneceram sem speaker vinculado: o algoritmo só atribui texto quando um turno conhecido cobre integralmente o intervalo. Whisper inclui bordas/silêncios mais amplos; o alinhamento entre texto e turnos ainda precisa evolução. A UI permite navegar pelos turnos e confirmar a voz independentemente da frase.

WER deste conjunto minúsculo, casefold, apóstrofos removidos, pontuação descartada, números não expandidos: duas fontes 0/20; saída misturada 3/32; recorrência 4/42; presencial simulado 3/32; português 5/21 (23,8%). Reprodução: `python tools/measure-speech-fixtures.py`. Não comparar esses números a benchmarks completos. Não medimos DER/JER: os clipes LibriSpeech não trazem RTTM de atividade dentro de cada frase, e as bordas dos clipes não substituem esse gabarito.

Português: [FalaBrasil/LapsBM @7f11b24](https://huggingface.co/datasets/falabrasil/lapsbm/tree/7f11b2475de614bea20dc8d083d9493560947961), licença MIT declarada no card. Pacotes `data/test/LapsBM-F004/LapsBM-F004.tar.gz` (SHA `00c19dfac46c1651a4d14929e7ac0bd5d9be5f3e348bad7b2d6c8e4fdd3174a8`) e `data/test/LapsBM-M001/LapsBM-M001.tar.gz` (SHA `81c740f1d3f3810dd2b1c2a3acbb746466de09547c937bde3765378a23d76e54`). Usadas somente frases 0061 e 0001, convertidas de 22,05 para 48 kHz. Gabarito e hashes individuais em `target/processing-validation/fixtures/portuguese/truth.json`. Não usamos arquivos pessoais.

## Memória de vozes

Teste opt-in `coxinha-core/tests/identity_fixture.rs` usa backup isolado da biblioteca de fixtures. Duas vozes confirmadas na primeira reunião; outras frases e uma pessoa nova na segunda.

| Candidato posterior | Similaridade com perfil 1 | Similaridade com perfil 2 |
|---|---:|---:|
| Pessoa recorrente 1 | 0,8667 | 0,2194 |
| Pessoa recorrente 2 | 0,2303 | 0,8670 |
| Pessoa nova | 0,1786 | 0,2799 |

São similaridades cosseno, não probabilidades. **Todos os resultados de reconhecimento permaneceram unknown sem calibração**, inclusive as duas recorrências. Nenhum nome foi sugerido automaticamente. Não derivamos limiar de produção desses seis pares. A política permissiva usada exclusivamente para testar invalidação por correção/revogação não é instalada no produto. Não há aceite de taxa de falsa atribuição de nome.

Confirmar/cadastrar, corrigir/revogar, excluir perfis da exportação e preservar perfis/histórico no backup passaram. Evidência: `target/processing-validation/identity-lifecycle-evidence.json`.

## Testes e provas distintas

- Core: 30 testes + 1 integração de processo com `local-processing`; padrão 26 + 1, conjunto alternativo, não somar ambos. Teste opt-in com embeddings reais passou separadamente.
- Tauri: 86 testes com engines e runtime explícito. Sem `ORT_DYLIB_PATH`, quatro testes legados do Silero falham por biblioteca nativa ausente; repetidos com o runtime oficial acima, 86/86 passaram. O pipeline novo carrega o runtime pelo perfil JSON.
- Frontend: 99 testes; cinco testes focados repetidos após ajuste final de rótulo/aviso. Build TypeScript/Vite passou; aviso preexistente de chunk acima de 500 kB permanece.
- Clippy estrito do core, formatação e `git diff --check` passaram. Build desktop com frontend embutido e engines CPU passou.
- Processo real de inferência em `unshare --user --map-root-user --net`, sem interfaces configuradas: exit 0, 7,68 s. Downloads foram feitos antes e explicitamente pelo preparo de fixtures; o produto não baixa modelos.
- Revisão visual usou UI real com IPC simulado e relatório público produzido pela CLI. Não é prova de integração WebKit/IPC, reprodução nativa nem captura física.
- Boot isolado do standalone sem abrir microfone é registrado em `target/processing-validation/boot/result.json`; hash do executável final também fica nesse arquivo.

Logs completos e WAVs ficam sob `target/processing-validation/`, ignorados pelo Git. A biblioteca real do usuário não foi processada nem modificada pelos testes.

## Como testar quando estiver disponível

1. Feche a instância anterior pelo menu de saída e execute `/home/rcamara/Repos/coxinha/target/debug/coxinha`. A cópia estável desta rodada também está em `target/processing-validation/coxinha-desktop`.
2. Na biblioteca, selecione uma gravação fechada. Para uma interrompida, recupere primeiro se ainda faltar fechamento/checksum.
3. Em **Processamento local**, abra `/home/rcamara/Repos/coxinha/target/processing-validation/local-models.json` e clique em processar. Os arquivos já estão preparados nesta máquina. O perfil é específico de Linux x64.
4. Compare texto e áudio, navegue nos trechos de cada voz. Cadastre uma pessoa e a origem da confirmação; confirme somente após ouvir. Corrija/desfaça e confira o histórico.
5. Reconhecimento automático entre reuniões continuará desconhecido. Esta rodada permite testar o cadastro e a manutenção da memória, não promete nomes automáticos calibrados.

Preparação reproduzível em outra pasta Linux x64: `python tools/prepare-speech-fixtures.py --download --output /CAMINHO/VALIDACAO`. Sem `--download`, exige artefatos locais previamente conferidos. Para recompilar: `npm run build` e `cargo build -p coxinha --features local-processing,tauri/custom-protocol`.

## Próximas entregas e limites

Prioridade: melhorar diarização e alinhamento texto/turnos; avaliação anotada de overlap, ruído e mais pessoas; correção manual de unir/separar falantes; calibração de reconhecimento com dados separados; UX de modelos persistente; empacotamento de runtime por plataforma. O segmentador tem três slots locais e até duas vozes simultâneas em sua saída, apesar de o agrupamento entre janelas não impor quatro participantes totais. Não há validação de reuniões longas/drift nem sobreposição real nesta rodada; limite configurável de 2 h para inferência e consumo de memória ainda precisam ensaio prolongado.

A captura física após a correção de overflow continua pendente do usuário. WASAPI/Windows ainda não implementado/testado. Servidor/Tailscale, agenda/Graph/Teams, pesquisa/compartilhamento completo, PWA e distribuição instalável continuam no plano, após o fluxo local e seus limites acústicos. Nenhum deploy, consentimento de tenant, publicação, commit ou push foi feito.

Executável final desta rodada: SHA-256 `069f1bc319ce646199239a56f96806cc9d7f483ec494dc8f3e07a54f4ee674ec`. Boot isolado: backend pronto em 0,401 s, processo vivo, nenhuma captura iniciada. Isso não comprova reprodução nativa nem aceite do usuário.
