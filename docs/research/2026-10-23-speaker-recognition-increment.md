# Validação do incremento de identificação de falantes

Data: 2026-10-23. Estado: incremento implementado e testes locais executados; revisão independente concluída no snapshot R2. Sem aceite de hardware ou de reconhecimento automático.

## Resultado

Implementado o fluxo de importar uma WAV local, processar, revisar falantes, confirmar uma pessoa e cadastrar amostras somente com opt-in explícito. Nomes candidatos são informados manualmente e privados. Não há sincronização Outlook/Graph neste incremento.

O reconhecimento automático permanece `unknown` sem uma política compatível com evidência de calibração. Nenhum limiar de produção foi instalado. A API de política prepara a integração futura, não comprova qualidade acústica.

## Evidência executada

- Frontend: 110 testes passaram, incluindo IPC simulado, separação confirmação/enrollment e respostas assíncronas após troca de reunião. Typecheck e build passaram; não equivalem a aceite desktop.
- Core com motores locais: 40 testes unitários e 1 integração de recuperação passaram. O teste opt-in com embeddings reais passou em cópia temporária: duas vozes cadastradas, três probes desconhecidos sem calibração, correção/revogação e privacidade de exportação.
- Tauri: 87 testes de biblioteca passaram com os motores locais e runtime ONNX explícito. Clippy estrito do core passou. Desktop com frontend embutido iniciou em 0,60 s usando dados isolados; isso comprova boot, não captura nem interação nativa completa.
- Seis cenários com fala pública processados por Whisper tiny + segmentação ONNX + WeSpeaker em CPU, dentro de `unshare -Urn`, sem rede. Modelos locais e hashes do relatório de 2026-10-18 foram mantidos.
- Importação mono v2 preservou os bytes e o SHA-256 da fonte; cenários de duas trilhas continuam no manifest v1.
- Consultas de reconhecimento ficaram `unknown` em todos os cenários, sem modificar amostras ou confirmar nomes.

| Cenário | Segmentos | Com falante | Grupos de voz | Tempo de parede (s) |
|---|---:|---:|---:|---:|
| two-sources | 2 | 1 | 2 | 14.56 |
| mixed-output | 5 | 1 | 4 | 14.24 |
| in-person | 5 | 1 | 4 | 17.18 |
| recurrence | 3 | 2 | 3 | 19.63 |
| portuguese | 2 | 0 | 2 | 13.93 |
| mono-import | 5 | 1 | 4 | 9.51 |

Os tempos são duração de parede da execução local, não benchmark. O agrupamento ainda gerou quatro clusters para três pessoas nas cenas com várias vozes no mesmo canal. Os dois segmentos em português ficaram sem associação de falante; não foram forçados a receber nomes.

WER com a normalização do script existente: duas fontes 0/20, saída mista e presencial simulado 3/32, recorrência 4/42, português 5/21. São amostras pequenas, não uma estimativa de precisão para reuniões.

## Captura isolada

Testes de cinco segundos com fontes virtuais passaram: gravação normal, pausa/retomada e interrupção do transporte da saída. As frequências independentes de 440 Hz e 880 Hz comprovaram fontes distintas. A interrupção de blocos da saída interrompeu a gravação e preservou ambas as trilhas.

O primeiro teste de 30 segundos, contra o binário anterior, falhou com `spa.audiotestsrc: out of buffers`; o Coxinha detectou ausência do microfone e preservou os originais. Isso não reproduziu `capture queue overflow` nem comprova sua correção em hardware. A repetição de 30 segundos contra o binário atual apresentou a mesma falha do gerador virtual. O harness foi corrigido para usar dois WAV players, fontes privadas e clock único. Um ensaio intermediário terminou com todos os frames, mas gerou warning do conversor; foi preservado e não contado como transporte limpo. O ensaio final de 30 s (`4smsvmf7`) teve 29,94 s em cada trilha, 440/880 Hz, sem warning de buffer. Pausa no harness final (`3x79rixl`) passou. O teste de ausência de blocos (`xaqke0ov`) suspende somente o `parec` da saída, validando PID/ancestralidade e retomando no cleanup; passou com a trilha mic continuando por mais de 2 s. Silêncio não é tratado como perda de fonte.

## Artefatos reproduzíveis

- Diretório local não versionado: `target/recognition-validation-20261023/`.
- `run-public-pipeline.py`, `pipeline-summary.json`, `text-metrics.json`, `*-report.json`, logs e `imported.json`.
- SHA-256 do CLI usado na prova de seis cenários: `a8ecd7454b6a71264bfd095874801ff84190a7aa01ee3790f292f8d6fa817105`.
- Biblioteca de prova contém somente fixtures públicas. Dados da instalação do usuário não foram usados.
- Políticas sintéticas de testes unitários nunca devem ser instaladas como calibração real.

## Limites e próximas validações

- Calibrar com sessões realmente independentes, incluindo pessoas desconhecidas e variação de dispositivo. Os clipes de recorrência atuais pertencem aos mesmos capítulos de audiolivros.
- Medir e melhorar agrupamento, alinhamento de texto e atribuições erradas de nome; não há DER/JER válido sem gabarito de atividade de fala.
- Validar captura física prolongada, ruído, sobreposição, desconexão e recuperação no Linux. Windows/WASAPI continua pendente.
- Importação aceita WAV mono PCM16 a 48 kHz, incluindo chunks WAV legais; outros formatos exigem conversão local explícita.
- OAuth Microsoft, ocorrência de agenda e importação Teams continuam fora deste incremento. Nenhum consentimento ou credencial foi alterado.
- Não houve commit, push, deploy nem atualização da instalação existente.

## Executável para teste manual

`target/recognition-validation-20261023/launch-demo` abre um desktop compilado com
frontend embutido e dados em `desktop-data/`, `desktop-vault/` e diretórios
irmãos dentro da própria pasta de validação. Não precisa de Vite. A instalação
anterior e a biblioteca pessoal não são abertas.

```bash
/home/rcamara/Repos/coxinha/target/recognition-validation-20261023/launch-demo
```

1. Abrir Reuniões. As duas reuniões `Demo:` usam somente áudios públicos já processados.
2. Ouvir os trechos, cadastrar uma pessoa com nome e origem da confirmação e confirmar um falante. Manter o cadastro de amostra desmarcado para testar apenas o nome.
3. Se quiser testar a memória, marcar explicitamente o cadastro de amostra e confirmar. Revogar ou corrigir depois deve invalidar sua contribuição.
4. Na reunião seguinte, conferir que o sistema mostra desconhecido sem calibração. Isso é o comportamento esperado, não um reconhecimento automático já aprovado.
5. Informar nomes/e-mails em candidatos manuais. Usar um candidato apenas preenche o cadastro; não confirma presença nem reconhece a voz.
6. Para importar, escolher `target/processing-validation/fixtures/in-person/mic.wav`, ou outro WAV mono PCM16/48 kHz. Para processar, selecionar `target/processing-validation/local-models.json`. Esse arquivo aponta para os modelos locais existentes.

Se houver falha ao cadastrar uma amostra, o nome já confirmado continua visível
e o erro informa que o cadastro da voz falhou. Identificações antigas sem trilha
ficam em uma seção separada com revogação explícita.

O CLI final inclui ainda a validação de cardinalidade e caminhos antes de
recuperar gravações v1. Essa correção teve testes próprios e não altera o motor
usado na prova acústica. SHA-256 final:
`ea9ed2fe971b5f223fd6f631c0dba187848a3a26d1d3f77d2310bbd3e9ad8340`.
Desktop final: `017d003f82d1228245aac242ebb4309279073d8d247628ab261cef0a045e17dd`.

## Revisão independente e disposição dos achados

Fable revisou dois snapshots. Na R1 encontrou passagem ausente da trilha no IPC,
um teste desatualizado de symlink, ausência de revogação visível para legados e
hashing repetido por amostra. Os quatro foram corrigidos e a R2 confirmou as
correções, sem novo achado alto ou médio. Os relatórios integrais e patches
estão em `review-r1/` e `review-r2/` nos artefatos locais.

Pendências menores aceitas neste recorte:

- Um turno sobreposto faz recusar o lote de enrollment inteiro. É uma abstenção
  conservadora; seleção individual de trechos elegíveis continua futura.
- Se um cliente enviar uma trilha explícita onde o falante não existe, o pedido
  é rejeitado, mas a mensagem ainda diz para informar uma trilha explícita.
- O limite configurável padrão de processamento é 30 minutos, embora a importação
  aceite até duas horas. A configuração de prova usa 7200 segundos.
- Instalação de política é uma API interna que exige evidência declarada; não
  verifica empiricamente o corpus. Não está exposta na interface ou no CLI.

O apontamento de documentação em português foi rejeitado: as convenções do
repositório, linhas 13–17, permitem `.md` em `docs/` para leitores humanos.

Após congelar R2, foi acrescentada validação de cardinalidade e dos caminhos
fixos antes de recuperar v1, incluindo rejeição de symlinks. Esse delta não foi
revisto pelo Fable. A revisão root leu o código e executou quatro testes de
recuperação; todos passaram, incluindo preservação byte a byte de um arquivo
externo diante de symlink. Evidência: `root-recovery-check.log`.
