# Plano de reconhecimento de pessoas pela voz e agenda

Data: 2026-10-19. Status: revisado pelo Fable 5.1; correções incorporadas pela
revisão principal, pronto para detalhamento em specs, ainda não implementado.
Escopo desta entrega: planejamento; nenhuma funcionalidade abaixo é declarada
concluída por este documento. Complementa [0059](../specs/0059-local-meeting-processing.md),
[ADR-0018](../architecture/decisions/0018-meeting-library-and-identity.md) e o
[plano da biblioteca](2026-10-17-meeting-library.md).
Revisa o recorte da [spec 0048](../specs/0048-calendar-integration.md) para a
biblioteca de reuniões, conforme a reconciliação abaixo.

## Resultado esperado

Manter Tauri/Rust, React/Vite e o core independente. Capturar ou importar uma
reunião, separar as vozes, ouvir um trecho e confirmar quem é a pessoa. Em uma
reunião posterior, sugerir seu nome pela voz quando houver evidência suficiente.
A agenda oferece nomes para a confirmação e contexto para a revisão. O produto
funciona também sem agenda, com convidados inesperados e em reuniões presenciais.

Exemplo: o evento lista Ana, Bruno e Carla. Dois falantes aparecem no áudio.
O usuário ouve o primeiro e confirma Ana; o segundo pode ser Diego, que não foi
convidado. Bruno e Carla continuam apenas convidados. Na reunião seguinte, Ana
pode ser reconhecida mesmo que não esteja no convite. Um nome escolhido somente
pela agenda não constitui reconhecimento acústico nem amostra de treinamento.

## Base existente e lacunas verificadas

| Área | Base existente | Mudança necessária |
| --- | --- | --- |
| Captura | Linux, mic/monitor separados, checkpoints, pausas e recuperação | Medir sincronismo, atraso e drift; distinguir canal silencioso e travado; reteste físico do overflow; WASAPI |
| Processamento | Whisper CPU, ONNX de segmentação/WeSpeaker e jobs persistentes | Alinhamento texto/turnos, agrupamento global, tratamento de sobreposição e avaliação acústica |
| Identidades | UUID de pessoa, aliases, amostras confirmadas, origem, espaço de modelo e revogação | E-mails estruturados, sugestões explicáveis, seleção de trechos limpos e política calibrada |
| Interface | Processar, reproduzir, confirmar/corrigir/revogar | Revisão de agrupamentos, candidatos da agenda, perfis e estado de qualidade |
| Agenda | Não implementada na biblioteca | Ocorrências, vínculo de reunião, candidatos, adapter Graph opt-in e cache local |

O teste documentado produziu quatro grupos para três pessoas e deixou o texto
sem falante por exigir cobertura integral de cada segmento. Sem política de
calibração, o matching atual retorna desconhecido. Esses limites estão em
[aceitação local](../research/2026-10-18-local-processing-acceptance.md).

## Contratos que devem orientar a implementação

1. Separar três entidades: convite do calendário, agrupamento anônimo de voz e
   pessoa persistente. Nenhum vira outro implicitamente. Microfone também não
   significa dono da instalação, pois pode conter várias pessoas presenciais.
2. Manter estados `unknown`, `suggested`, `confirmed`, `rejected` e `revoked`,
   com origem da evidência. Sugestão acústica não tem aparência de confirmação;
   nome importado da agenda aparece como candidato sem evidência acústica.
3. A agenda prioriza a apresentação de candidatos, sem reduzir o limiar acústico
   ou restringir a busca aos convidados. Incluir sempre pessoas conhecidas fora
   do evento e opção de cadastrar outra pessoa. Não inferir presença por aceite,
   quantidade de falantes, ordem dos convidados ou tempo de fala.
4. Confirmar o nome de um falante e autorizar uma amostra para memória são
   decisões distintas. A interface pode oferecer as duas no mesmo diálogo,
   deixando explícito o trecho que será usado. Áudio contaminado pode receber
   rótulo humano na reunião, mas não entrar no perfil de voz.
5. Aprender somente com confirmação humana, trecho elegível e espaço de modelo
   compatível. Identidade persistente usa UUID; nomes, e-mails e aliases são
   atributos, nunca chaves acústicas. Não fundir homônimos nem identidades de
   contas diferentes só pelo nome ou por normalização agressiva de e-mail.
6. Correção/revogação invalida amostras e derivados antigos. Qualquer centroide
   será cache recomputável de amostras ativas, por espaço de modelo e revisão.
   Match continua sem mutação. Reprocessar não transfere nomes para novos IDs de
   clusters sem revalidar o vínculo ao áudio; correções anteriores permanecem.
7. Perfis, embeddings, candidatos completos da agenda e logs de reconhecimento
   são privados. Exportação de reunião inclui apenas o conteúdo selecionado,
   nunca a base de vozes, lista completa de convidados ou tokens implicitamente.
8. Captura preserva originais; correções de drift/eco são artefatos derivados
   versionados. Rede permanece desligada até conectar explicitamente a agenda.

Vincular cada agrupamento a `processing_run_id`, trilha e ID local do falante,
em vez de apenas `meeting_id` + rótulo reutilizável. A confirmação aponta para
essa versão e os intervalos originais. Migração deve tratar atribuições legadas
sem adivinhar a execução correspondente. Entre bancos separados, validar
referências e retomada de operações, sem supor foreign keys entre arquivos.

## Sequência de implementação

| Etapa | Entrega e pontos de alteração | Dependência | Evidência exigida |
| --- | --- | --- | --- |
| R0 | Corpus público/consentido e baseline; ampliar `tools/measure-speech-fixtures.py` e fixtures | Nenhuma | Manifest com licenças, hashes, pessoas, sessões e anotações; separar cadastro, calibração e teste |
| R0a | Manifest versionado com coleção de trilhas e proveniência de importação/presencial; atualizar importador, validação de amostras e normalização | R0 | Importar/enroll com uma trilha; ler gravações v1 existentes sem reescrever originais; rejeitar trilha faltante na captura declarada como dupla |
| R1 | Saúde e sincronismo em `coxinha-core/src/capture/`; timestamps/latência disponíveis no adapter, gaps e drift explícitos; diagnósticos na UI | R0 | Duas fontes, disco lento, carga de CPU, pausa, desconexão, crash e sessão longa; alinhamento medido, sem fallback para mic duplicado |
| R2 | Alinhamento em `speech.rs` e clustering em `speech/diarization.rs`; revisão de unir/separar falantes | R0; R1 para áudio capturado | Texto atribuído quando sustentado, unknown em ambiguidade, >4 pessoas e sobreposição; comparar WER/DER e erro de atribuição |
| R3 | Qualidade de amostras, quarentena de eco, perfis derivados e calibração em módulos de identidade/processing; UI de sugestões acústicas e confirmação | R0a e R2; R1 para memória de capturas | Reunião A cadastra, B reconhece, C testa desconhecido; revogação/correção altera a consulta seguinte sem contaminar perfis |
| A1 | Domínio de calendário, e-mails/aliases, snapshots, seleção de ocorrência e UI de candidatos da agenda; fixtures e entrada manual; sem OAuth | Em paralelo a R1/R2; integração final com R3 | Evento correto, convidados ausentes, convidados externos à lista, homônimos, recorrência e mudança de fuso |
| A2 | Adapter Microsoft Graph de leitura e conexão explícita; cache por conta/calendário/janela | A1; autorização específica para ativar OAuth | Contratos HTTP com mocks, paginação, 401/403/429, cancelamento e sincronização parcial; teste real só após conexão autorizada |
| V1 | Fluxo integrado A/B/C, Linux físico e Windows WASAPI; empacotamento com modelos locais | R1-R3 e A1; A2 para aceite Graph | Captura real e revisão humana por SO, separadas de build e testes sintéticos |

A1 antecipa a agenda em relação ao roadmap anterior: ela entra no fluxo de
identificação, sem esperar servidor/PWA. R3 pode ser validada com arquivos
importados enquanto o aceite físico de R1 estiver pendente. R1 não pode ser
declarada concluída apenas porque esse caminho por arquivos passou.

### R0a: fontes importadas e presença física

Hoje `CaptureManifest.tracks` fixa duas trilhas e `enroll` valida arquivos
`mic.wav`/`output.wav`; o importador também exige dois WAVs mono 48 kHz. Isso
não atende um arquivo presencial único. Introduzir um manifest v2 com coleção
de trilhas identificadas, papel (`mic`, `output`, `imported`), origem, taxa,
frames, checksum e transformação derivada. Suportar primeiro uma ou duas trilhas,
sem inventar uma saída silenciosa para satisfazer o schema antigo.

Separar origem `capture`/`import` do papel da trilha. Presencial pode usar um
único mic; na captura dupla, perder uma fonte continua falha e não vira modo
presencial silenciosamente. Adaptar `SampleProvenance`, o importador, o worker
e as validações de `enroll` ao novo contrato. Preservar manifest e JSON de
proveniência legados com leitor versionado/projeção explícita, sem reescrever
histórico ou recalcular evidência como se fosse nova. Exigir checksum do
original e intervalo válido também para importados. O teste cobre importação,
transcrição, confirmação, cadastro e reconhecimento posterior com uma trilha.

### R1 e R2: áudio utilizável antes de atribuir nomes

Não considerar dois leitores iniciados juntos como sincronizados. Registrar
clock/timestamp disponível, latência conhecida ou desconhecida, taxas, frames,
reinícios e gaps; usar sinais de referência para medir offset e drift. Quando o
adapter não expuser evidência suficiente, manter `alignment=unmeasured` e limitar
as operações que dependem de correlação entre canais. Nunca corrigir o WAV bruto.

Alinhar segmentos por sobreposição na mesma trilha, agregando duração por
falante sem contar intervalos duas vezes. Medir cobertura e disputa entre
candidatos; sem evidência suficiente, abster. Não atribuir pelo vizinho mais
próximo atravessando silêncio. Avaliar timestamps de palavras para dividir frases
que atravessam trocas de falante, sem inventar alinhamento de palavras ausente.

Avaliar agrupamento global após coletar embeddings da reunião contra o greedy
atual, com amostras sem sobreposição. Não impor quatro participantes nem obrigar
um nome por cluster: uma pessoa pode ter sido fragmentada em vários clusters.
A decisão de adotar AHC/VBx ou outro componente depende da prova, licença,
memória, tempo em CPU e métricas; não reimplementar um algoritmo inteiro sem
avaliar componentes portáveis. Sortformer/CoreML não será a nova base Linux.

### R3: memória de vozes corrigível

Adicionar avaliação de duração útil, silêncio, clipping, ruído, sobreposição e
eco com motivos de rejeição por trecho. Diferenciar `clean`, `contaminated` e
`unmeasured`; falta de medição não prova limpeza. Elegibilidade depende de
critérios validados para a fonte. Em duas trilhas com alinhamento desconhecido,
não declarar ausência de eco nem cadastrar automaticamente trechos duvidosos.

Persistir versão da política, evidência de calibração, modelo/preprocessing e
revisão dos perfis em cada sugestão. Logs locais de top-k, distâncias, abstenções
e decisões humanas servem à avaliação, com retenção limitada e sem áudio/tokens.
UI mostra “sugerido pela voz”, “convidado da agenda” e “confirmado por você”.

Planejar migração de `profiles.db` v2 para a próxima versão disponível:
`calibration_policy` com espaço, versão/hash, critérios, conjunto de evidência
e data de fixação; cada sugestão referencia política/espaço, score, margem,
revisão dos perfis e execução. Hoje `assignment` preserva apenas a geração dos
perfis e não a evidência de matching. Staleness deve considerar troca/revogação
da política, não só `profile_revision`; confirmação humana não expira por isso.
Testar migração transacional e recuperação antes de usar os bancos existentes.

Calibrar em sessões disjuntas, com pessoas conhecidas e desconhecidas, idiomas,
microfones e canais distintos. Medir nomes errados, falsos aceites/rejeições,
cobertura, abstenção e intervalos de incerteza; não usar acurácia isolada nem
contar milhares de frames correlacionados como milhares de pessoas. Fixar a
política antes do conjunto de teste. Sem evidência suficiente, manter unknown.
Limiar cosseno e margem não são porcentagens de confiança.

Antes de avaliar o conjunto reservado, registrar orçamento de atribuições
erradas, cobertura mínima útil e tamanho/evidência necessários para liberar a
política. Escolher esses critérios a partir do baseline e do risco de confundir
pessoas, sem ajustá-los depois de ver o teste. Não aceitar uma política que
"acerta" apenas porque sempre abstém. Limitar sua validade aos modelos e
condições de áudio avaliados; fora desse domínio, informar a limitação e abster.
Vozes recorrentes usam sessões diferentes nas partições; identidades reservadas
como desconhecidas não podem entrar no cadastro ou na calibração supervisionada.

## Agenda como fonte de nomes

### Domínio e armazenamento

Introduzir `CalendarProvider`, `CalendarOccurrence`, `MeetingEventLink` e
`ParticipantCandidate` no core, sem dependência de Graph no domínio. O adapter
de rede fica fora da captura/inferência. Pessoas e `person_contact` ficam na
base privada; associação entre contato externo e pessoa é auditável e corrigível.
Convite novo não cria perfil de voz. Conservar valor original de e-mail e
normalização conservadora; colisões pedem escolha humana.

Cache de calendário privado e separado dos artefatos públicos de reunião,
com escopo de conta, calendário, versão e momento de consulta. No vínculo local,
guardar snapshot mínimo da ocorrência escolhida, incluindo título, intervalo,
fuso e origem. Alterar ou excluir o evento remoto não apaga gravação nem muda
identidade confirmada; atualizar o snapshot visível requer política explícita.
Trocar o evento da gravação invalida os candidatos da agenda anteriores, sem
revogar decisões humanas sobre a voz.

Propor ocorrência por intervalo temporal; em empate, atraso ou eventos
simultâneos, pedir seleção. Permitir escolher outra ocorrência ou nenhuma.
Identificar por provedor/conta/caixa postal/ID imutável do evento; o calendário
atual é localização e escopo da consulta, não parte imutável da identidade.
Mover o evento de calendário não deve duplicar seu vínculo. Preservar também
`iCalUId`, `seriesMasterId`, `type`, `originalStart`, UTC e fuso quando presentes.
Não usar só título, dia ou ID da série. Eventos recorrentes movidos/cancelados
e cópias de um mesmo convite em contas diferentes precisam de casos de teste.

Organizador e convidados alimentam candidatos; salas, recursos e listas de
distribuição não viram pessoas automaticamente. Não expandir diretório ou grupo
com permissões adicionais. Edição do nome do convite não renomeia a pessoa
persistente. Ausência de um evento numa consulta parcial ou fora da janela não
prova cancelamento; conservar o vínculo e sinalizar a situação da fonte.

Separar estados `linked`, `remote_missing_in_window`, `remote_removed` e
`cancelled`. Ausência após leitura completa da janela produz somente
`remote_missing_in_window`; falha parcial mantém o snapshot desatualizado.
Cancelar exige evidência específica, como `isCancelled` ou ocorrência
identificada em `cancelledOccurrences` da série. Guardar `occurrenceId` quando
disponível; a correlação auxiliar usa conta/caixa postal/`seriesMasterId` e
`originalStart`, nunca o início já alterado. Ambiguidade não funde ocorrências.
Um tombstone `@removed` do delta não prova sozinho cancelamento: também pode
se referir a mudanças fora da janela. Interpretá-lo no escopo da consulta e
conservar o motivo da ausência sem alterar o histórico local.

### Microsoft Graph primeiro

Usar `calendarView` por janela limitada para receber ocorrências e exceções.
Solicitar IDs imutáveis e persistir o escopo da caixa postal; IDs não são globais
entre contas. Buscar somente campos necessários com `$select` e seguir
`@odata.nextLink` sem reconstruí-lo; não avançar o estado de sincronização após
leitura parcial. Validar origem dos links antes de enviar credenciais.

Planejar OAuth de aplicativo próprio, cliente público com PKCE, sem segredo
embutido no desktop. Tokens no cofre do sistema, jamais SQLite comum, logs ou
Git. Começar com permissão delegada `Calendars.ReadBasic`, que a documentação
lista como mínima para calendarView; confirmar os campos no teste de contrato
e no tenant autorizado. Se faltarem dados, justificar qualquer ampliação
separadamente. Não reutilizar a autorização do conector Microsoft 365 de
Claude/Anthropic como cliente OAuth do Coxinha.

Primeira sincronização: atualização explícita de uma janela limitada, com cache
offline e indicador de desatualização. Tratar 401, 403 e throttling sem laço
infinito, sem descartar cache válido nem apresentar ausência como agenda vazia.
Delta sync fica posterior: é por calendário/janela, usa token opaco e possui
contrato de permissão próprio; não assumir equivalência com calendarView.

Desconectar encerra acesso e invalida credenciais pelo fluxo explícito. Informar
o que fica no cache e oferecer sua remoção separadamente, sem apagar reuniões
ou perfis. Não criar app registration, credencial, consentimento ou acesso real
ao tenant nesta fase de planejamento. Nenhuma escrita de evento ou mensagem.

### Transcrições do Teams

Prever no job a resolução de fonte: se houver vínculo Teams, conexão e permissão
específica já autorizadas, consultar disponibilidade da transcrição antes de
transcrever novamente. 403, ausência ou processamento remoto ainda pendente
permitem seguir localmente com motivo registrado. Evitar duplicação por origem,
ID e hash. Permissões de calendário não autorizam transcrições de reuniões.
Texto e nomes do Teams preservam sua origem; não geram embeddings nem associação
confirmada de voz automaticamente. A agenda não deve bloquear esse pipeline
quando offline. Implementação completa desse importador terá spec própria.

## Reaproveitamento e decisões de escopo

A spec 0048 permanece referência para a futura experiência de agenda/notas,
mas A1/A2 substituem seu recorte para a biblioteca: Microsoft primeiro, cache
privado separado e atualização explícita, sem polling de 15/2 minutos ou
Google como pré-requisito. O cache remoto continua derivado; vínculos e
snapshots humanos são canônicos e não podem desaparecer ao limpar cache.
Eventos são autoridade apenas sobre o convite remoto, nunca sobre presença
ou voz. Preservar o provider abstrato, leitura offline, acessibilidade e .ics
como fixtures/importação explícita posterior; A1 usa fixtures normalizadas e
entrada manual, sem tornar o parser .ics pré-requisito. Sem fallback de tokens
em arquivo texto. Revisar a spec 0024 de OAuth Microsoft e a 0023 de cofre antes
de A2; spec 0025/Google, polling .ics e criação automática de notas ficam fora.

Referência: `pasrom/meeting-transcriber` em
`a4f6af6df2674bc4e18097084a128af469823fab`, licença MIT.
Adaptar ideias e testes de `DiarizationProcess`, `TimelineAnchor`,
`ChannelFaultMonitor`, `EchoBleedDetector`, `EchoEmbeddingQuarantine` e
`RecognitionStats`. Cada trecho derivado deve registrar arquivo, commit,
licença, atribuição e mudanças. Recalibrar parâmetros; não transportar valores
do corpus do autor como política validada do Coxinha.

Não portar SwiftUI, CATap, engines CoreML, o formato de perfis por nome nem a
atribuição de convidados por tempo de fala. Preservar UUIDs, proveniência e
revogação do Coxinha. Licença do código não substitui licença/proveniência de
cada peso; artefatos legados não cobertos por declaração do fornecedor ficam
fora da distribuição até verificação. Não incorporar projetos inteiros.

Servidor/Tailscale, PWA, Google Calendar, resumos e streaming ficam depois desse
fluxo. Windows continua requisito da entrega multiplataforma; seu adapter pode
avançar em paralelo após fixar contratos de R1. Implementação com Sol 6.1 em
fatias delimitadas; revisão independente do Fable nas mudanças de identidade e
agenda. Não produzir estimativa de prazo antes das provas de clustering e captura.

## Critérios de aceite do fluxo

- [ ] A registra vozes confirmadas; B sugere recorrentes; C com desconhecidos
  mantém unknown quando necessário. Avaliar também sessões presenciais.
- [ ] Um arquivo de trilha única percorre o ciclo de importação e memória;
  manifests/proveniências legados continuam legíveis sem adulterar originais.
- [ ] Convidado ausente nunca ganha fala por causa da agenda; pessoa fora do
  convite pode ser reconhecida; homônimos e e-mails conflitantes não se fundem.
- [ ] Ruído/eco/sobreposição não entram silenciosamente no perfil; não atribuir
  identidade errada para aumentar artificialmente a cobertura.
- [ ] Correção, revogação, exclusão de amostra e troca de modelo afetam o match
  seguinte; candidatos antigos e caches derivados não sobrevivem como válidos.
- [ ] Troca/revogação da política invalida sugestões antigas sem apagar
  confirmações humanas; falha de migração não altera versão ou dados originais.
- [ ] Reprocessar preserva correções e versões; captura interrompida recupera
  originais sem gravação duplicada; exportação não inclui perfis/candidatos.
- [ ] Recorrência, exceção movida, cancelamento, DST, conta trocada e Graph
  indisponível passam em testes; desconexão não interrompe a biblioteca local.
- [ ] Métricas incluem WER/CER, DER/JER com collar/overlap declarados, erro de
  atribuição de nome, cobertura, latência/CPU/memória e sincronismo por fonte.
- [ ] Build, testes sintéticos, inferência em arquivos reais, captura física e
  aceitação humana são registrados separadamente em Linux e Windows.

## Fontes e próximos documentos

- [Microsoft calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0).
- [Microsoft event](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0).
- [IDs imutáveis do Outlook](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
- [Delta por janela](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0).
- [OAuth com authorization code e PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
- [Referência de implementação](https://github.com/pasrom/meeting-transcriber/tree/a4f6af6df2674bc4e18097084a128af469823fab).
- [Escopo de licença dos modelos](https://huggingface.co/FluidInference/speaker-diarization-coreml/blob/df2625ac79a7ac6b65ad868fee6d80f320da4232/NOTICE.md).

Antes do código, abrir specs numeradas disponíveis para R1/R2, R3 e A1/A2 com
os testes acima, migrações transacionais e compatibilidade dos bancos existentes.
Registrar ADR do uso de agenda como evidência contextual sem autoridade sobre
identidade e da revisão da spec 0048; manter a revisão de modelos como condição
de distribuição.

## Revisão independente

Fable 5.1 considerou os princípios corretos, com dois bloqueios de planejamento:
fonte de trilha única e conflito com a spec 0048. Ambos estão tratados em R0a e
na reconciliação de escopo. Também foram incorporados estados de ausência do
evento, persistência/invalidação da política e separação das dependências de
UI acústica/agenda. A interpretação de `@removed` foi refinada pela revisão
principal contra a documentação Graph: remoção da janela não implica
cancelamento. Esta revisão valida o plano, não o comportamento implementado.
