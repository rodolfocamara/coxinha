# Plano: biblioteca local de reuniões com memória de vozes

Atualização 2026-10-19: o [plano de reconhecimento e agenda](2026-10-19-speaker-recognition-and-calendar.md)
detalha o fechamento da fatia C. Agenda passa a integrar a confirmação de
identidades antes de servidor/PWA, como fonte de candidatos. Engines locais e
o ciclo de confirmação/revogação já possuem provas em arquivos; calibração,
qualidade acústica, reteste físico de captura e Windows continuam pendentes.

Status: revisado pelo Fable 5.1, com condições incorporadas abaixo.
Implementação local autorizada com Sol 6.1. Auditoria e provas iniciais:
`../research/2026-10-17-meeting-library-audit.md`.

Atualização 2026-10-18: fundação A/B e interface de captura Linux implementadas
com Sol 6.1; Gemini Personal 3.8 Flash High verificou baseline e roteiro.
Transporte de duas fontes virtuais, pausa e interrupção passaram. Próximo gate
humano é captura/playback Linux em dispositivo real. Engines, memória de vozes
acústica, Windows e distribuição continuam pendentes; não é o MVP concluído.
[Aceite desta fatia](../research/2026-10-18-capture-acceptance.md).

## Direção de produto

Linux e Windows são alvos da primeira entrega. A biblioteca de reuniões é a
entrada principal; notas/segundo cérebro evoluem depois. Preservar as notas
existentes e a stack Tauri/Rust + React/Vite/TanStack. Sem bots em chamadas.

O menor fluxo completo é:

1. Selecionar microfone e saída explicitamente, com medidores independentes.
2. Gravar trilhas originais separadas e sincronizadas, pausar/retomar/finalizar,
   detectar falhas de fonte e recuperar gravações interrompidas.
3. Processar localmente depois da reunião: STT, diarização, embeddings.
4. Reproduzir por timestamp e corrigir texto/agrupamentos de falantes.
5. Confirmar uma pessoa e selecionar amostras limpas para seu perfil.
6. Em outra reunião, sugerir a pessoa conhecida ou desconhecido, mantendo
   sugestão separada de confirmação e sem autoaprendizado.

Um gravador sem os passos 3-6 não é esta entrega completa. Foundations podem
ser incrementais, mas não serão apresentados como MVP concluído.

## Arquitetura proposta para validar

- Core de reuniões independente do runtime Tauri, utilizado por adapters de
  desktop, CLI de diagnóstico e, depois, HTTP. Não embutir regras em commands.
- SQLite transacional para novas entidades de reuniões, execuções, correções,
  pessoas e amostras. Trilhas originais em arquivos imutáveis com manifest,
  tamanho/hash/checkpoints e vínculo explícito. Não migrar/apagar notas antigas.
- ADR deve distinguir a base nova do índice de notas reconstruível. Não tornar
  o atual `.coxinha/index.db` parcialmente canônico sem impedir sua exclusão
  como cache e definir backup/restauração. Formato novo versionado e importador
  explícito dos metadata legados; não manter duas fontes de verdade.
- Captura local na máquina com dispositivos. Servidor remoto nunca tenta
  capturar o áudio do cliente. Transporte/upload e processamento são módulos
  distintos. Preservar frames, taxas, primeiro timestamp monotônico, gaps,
  pausas e drift; dois processos iniciados juntos não bastam para sincronismo.
- Jobs persistentes com idempotência por artefato/config/modelo/versão, etapas
  retomáveis e falhas explícitas. Resultados de cada execução são separados
  das correções humanas, que não são sobrescritas pelo reprocessamento.
- Motores substituíveis e pesos explícitos. Primeiro candidato de STT:
  whisper-rs CPU corrigido. Seleção final de diarização/embedding depende de
  prova executável e proveniência dos pesos. Worker Python só se a prova
  justificar o custo de empacotamento frente à alternativa Rust/ONNX.
- Memória de vozes separada de clustering dentro da reunião. Pessoa tem
  identificador estável, aliases/e-mails e múltiplas amostras confirmadas.
  Cada amostra registra áudio/intervalo/trilha, dispositivo, qualidade,
  modelo+hash+preprocessing+dimensão e origem da confirmação.
- Match é consulta sem mutação. Exigir espaço compatível, vetores finitos,
  amostra suficiente, limiar calibrado e margem entre candidatos. Similaridade
  não é porcentagem de confiança. Sem calibração, abster ou apresentar
  candidatos explicitamente experimentais, nunca nomes confirmados.
- Correção/desfazer/remoção invalida contribuições e sugestões derivadas;
  nenhuma média sem rastrear amostras removíveis. Perfis privados; exportar
  reunião não inclui embeddings nem base de vozes por padrão.

## Fatias de execução

### A. Auditoria, seleção e contratos

Concluir matriz e provas, decidir pesos e motores com licenças, registrar ADR
que substitui Windows-first, mono-only e notes-first das specs antigas.
Escrever spec de biblioteca/memória com contratos e casos de falha antes de
alterar comportamento. Fable valida antes da implementação Sol.

### B. Primeira fatia implementável e verificável

Core/storage/job/provenance mínimo, correção do adapter Whisper, captura
Linux mic+monitor sem fallback para entrada duplicada, WAVs/checkpoints e
diagnóstico. Windows com adapter WASAPI equivalente e teste de build onde
disponível. Provar falha/recuperação e não apenas um WAV feliz.

### C. Fechar o menor fluxo completo

Engine real de diarização e extração de embeddings selecionado na fatia A;
cadastro de pessoas/amostras confirmadas, unknown, correção/remoção e matching
entre duas reuniões. UI mínima de biblioteca com reprodução, revisão e
confirmação, desvinculada de criar uma nota. Busca textual e exportação
TXT/Markdown/JSON/SRT/VTT compatíveis com os artefatos reais.

### D. Distribuição e aceitação

Pacotes Linux/Windows, seleção explícita de modelos, diagnósticos, CPU-only e
documentação de instalação. Ensaios reais por sistema com dados consentidos.
Não habilitar pipeline incompleto por padrão nem rotular teste sintético como
reconhecimento real. Nada de push/merge/deploy automático nesta autorização.

## Depois da prova vertical, ainda no roadmap do produto

- Servidor pessoal independente, auth e permissões por reunião, fila/worker,
  uploads retomáveis, backup/restauração e HTTPS via Tailscale. Acesso remoto
  só é habilitado com autenticação; Tailscale não substitui autorização.
- PWA responsiva para consultar/ouvir/pesquisar/enviar. Gravação móvel testada
  por plataforma; sem promessa de captura de outros apps ou background.
- Graph/Outlook foi antecipado para o fluxo de identificação no plano de
  2026-10-19; Google vem depois. Por ocorrência/fuso, convidados são candidatos,
  nunca prova de presença. Teams transcript é fonte adicional, importada quando
  autorizada/disponível, sem excluir captura local.
- Compartilhamento explícito, múltiplos usuários e isolamento de perfis.
- Resumos/templates, decisões/ações com referências, busca conversacional
  citada, tradução/vocabulário, marcadores e trechos compartilháveis.
- MCP, CRM/tarefas/webhooks, streaming, app móvel nativo e wearable depois.
  Saídas externas sempre dependem de configuração/autorização explícitas.
- Catálogo Granola/Fireflies/PLAUD/Notta/Tactiq/Omi com fontes por capacidade
  será desenvolvido nessa etapa; não assumir paridade entre esses produtos.

## Validação e medidas

- Separar build, teste unitário/sintético, captura real, inferência real e
  aceitação do usuário em todos os relatórios.
- Corpus de reuniões disjuntas para cadastro/calibração/teste, incluindo PT-BR,
  outros idiomas, duas fontes, várias pessoas na saída, presencial no mesmo
  mic, unknown/recorrente, mais de quatro participantes, overlap, silêncio,
  ruído, troca de dispositivo e falha/reabertura.
- Medir WER/CER quando houver transcrição de referência; DER/JER com política
  de overlap/collar declarada; false accept/reject de identidade, taxa de
  nomes errados e cobertura de sugestões. Não inventar porcentagens/meta
  atingida antes de medir. Abstenção é preferível à atribuição errada.
- Pausa/resume e drift: medir alinhamento por timestamps/sinais conhecidos,
  duração e gaps, inclusive em sessões longas; buffers e memória limitados.
- Testar correção/remoção e reprocessamento na reunião seguinte, verificando
  que sugestões nunca viram amostras e modelos incompatíveis não se misturam.
- Validar backup/restauração antes de chamar distribuição confiável.

## Limites de autorização

Trabalho local reversível está autorizado. Não apagar dados, publicar/deploy,
alterar consentimentos, criar credenciais ou mandar mensagens externas. Não
colocar dados do tenant, tokens, transcrições pessoais ou perfis no Git.
Os estados antigos de Graph relatados pelo usuário não são evidência atual;
revalidar somente quando a fatia de integração chegar e sem alterar grants.

## Revisão independente e resolução

Rodada antiga cancelada por mudança de escopo. Fable concluiu a rodada
`coxinha-meeting-library-fable-r2-20261017` com veredito condicional.
Parecer integral em `../research/2026-10-17-fable-plan-review.md`;
provas posteriores em `../research/2026-10-17-speech-engine-probes.md`.

Condições aceitas para implementação:

1. Antes de código, escrever ADR e spec substituindo os contratos conflitantes
   de 0007/0008, as prioridades de CLAUDE.md, partes de 0002/0015 e o trecho de
   0057 que proíbe biblioteca independente. `/meetings` volta como biblioteca;
   blocos em notas passam a ser referências opcionais. O novo brief já decide
   essa questão de produto, sem necessidade de confirmação adicional.
2. Banco canônico novo para reuniões, separado do índice reconstruível de
   notas. `profiles.db` privado para pessoas/amostras/embeddings, excluído da
   exportação de reuniões por construção. Migrações transacionais/versionadas
   antes de criar entidades; versões futuras recusadas, backup consistente.
3. Domínio novo em crate sem dependência de Tauri, desde o primeiro código.
   Começar com um `coxinha-core` modular (store/jobs/identity/capture), extraindo
   crates adicionais só quando necessário. Não mover todo o editor/storage
   antigo para satisfazer uma divisão artificial em três crates.
4. Diarização por trilha, timeline comum e reconciliação de speakers sem
   misturar previamente os originais. Microfone não prova a identidade do
   dono: presença de outras pessoas/eco exige a mesma confirmação e abstenção.
5. Separar diarização, embeddings e identidade persistente. `person`,
   `voice_sample`, `embedding_space` e `speaker_assignment` não se reduzem a
   uma string de nome. Confirmações são autoria humana; embeddings são
   derivados. Correções e revogações precisam propagar sem apagar áudio.
6. Captura explícita é prioritária. Detecção automática de chamada e calendário
   podem vir depois e não bloqueiam Teams web/PWA com fones. Não abrir microfone
   permanentemente só para obedecer ao requisito antigo de warm capture.
7. Núcleo Rust; processo worker opcional é permitido no desenho, mas não será
   adicionado apenas por suposição de qualidade. A prova Rust/ONNX já executou
   um par público sem credenciais, reduzindo a necessidade imediata de Python.
8. Não fixar Whisper base como promessa de qualidade PT. Adapter CPU corrigido
   é baseline funcional; seleção/padrão de modelo depende de avaliação real.
   Não inventar limite de erro ou tolerância de drift já atingidos.

Limites do parecer tratados com evidência posterior:

- A API pyannote-rs foi verificada em fonte e execução pelo Sol, não apenas no
  docs.rs. Par público ONNX + WeSpeaker ResNet34 executou em CPU, 256 dimensões.
- A conversão pública do segmentador declara fonte/licença, mas não fixa SHA
  dos pesos originais. Registrar essa lacuna e hashes do binário; não declarar
  reprodução integral. Não embutir pesos no Git nem redistribuir instaladores
  antes de fechar a atribuição/proveniência exigida.
- Silêncio não valida escala de amplitude, diarização nem identificação.
  Investigar normalização i16/f32 antes de aceitar o adapter com fala.
- Não assumir que features PipeWire/Pulse de outra versão do CPAL existem na
  0.17 travada. Consultar fonte da versão e provar enumeração; um adapter Pulse
  explícito é aceitável se reduzir dependências e funcionar com PipeWire.
- Não executar `.gitattributes`/normalização em massa na cópia Windows. EOL é
  contexto preservado, não pré-requisito do fluxo.
- Critérios de proteção/remoção de perfis são requisitos de produto; esta
  revisão técnica não constitui parecer jurídico nem certificação LGPD.

Baseline adicional: Node 26.11.1. Typecheck passou; build frontend falhou
porque Vite 8 foi configurado com minifier esbuild sem essa dependência.
Vitest inicial teve 67 passes e 16 falhas por Web Storage nativo do Node.
Reexecução com `NODE_OPTIONS=--no-experimental-webstorage` passou 83/83 em 13
arquivos. Corrigir/estabilizar a baseline antes de atribuir regressões ao
trabalho novo.

Nenhum código do produto foi alterado antes desta validação. Os próximos
commits locais de implementação devem manter explícitas as condições acima
e os gates acústicos/hardware não satisfeitos.
