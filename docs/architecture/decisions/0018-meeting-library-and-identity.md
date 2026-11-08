# ADR-0018: Biblioteca local, truth híbrida e identidade confirmada

- Data: 2026-10-17
- Status: aceito para implementação incremental, aceitação acústica pendente
- Substitui parcialmente ADR-0002, 0004, 0009, 0015 e prioridades de CLAUDE.md.

## Decisão

Linux e Windows são alvos primários. Biblioteca `/meetings` independente de
notas; MeetingBlock é referência opcional. Captura explícita de microfone e
monitor/loopback em originais separados. Nenhum canal prova a identidade de
uma pessoa. Timestamps e gaps descrevem alinhamento; sincronismo/drift só são
aceitos após medição em hardware. Não abrir microfone em background.

`coxinha-core` não depende de Tauri. Domínio, store, jobs, capture e identity
são módulos; CLI e desktop são clientes. Núcleo Rust, worker local opcional
atrás dos jobs se justificado por prova. Rede e downloads seguem opt-in.

Notas continuam arquivos Markdown e `.coxinha/index.db` continua cache.
O domínio novo usa diretório próprio `meeting-library/`: raw e manifest são
artefatos imutáveis após finalizar; `meetings.db` é canônico para metadados,
execuções e correções humanas. `private/profiles.db` é canônico privado para
pessoas, decisões de identidade e amostras, sem entrar na exportação de reunião.
Não existe rebuild dessas decisões a partir do índice. Não importar metadata
ou dados pessoais automaticamente. Backup usa snapshots SQLite consistentes e
cópia dos artefatos fechados; backup durante captura é recusado nesta fatia.

Atribuição humana é Knowledge; embeddings e candidatos são Memory derivados.
Match é read-only, apenas amostras humanas confirmadas e ativas; nunca autolearn.
Espaço inclui modelo/revisão/hash/preprocessing/dimensão. Sem calibração
rastreável, abstém. Score cosseno não é probabilidade. Correção/revogação mantém
originais e histórico e invalida contribuições pela consulta da revisão atual.
Reprocessamento não sobrescreve correções humanas. Perfis nunca são implícitos
no export. Remoção física de dados pessoais exige fluxo explícito posterior.

## Consequências e gates

Migrações transacionais com user_version e rejeição de versão futura em ambos
os bancos. Falha de captura é visível; nenhum fallback para default/duplicação.
Engines e UI serão fechados na próxima fatia. API ONNX pública tem prova CPU,
mas conversão não fixa checkpoint upstream; distribuição dos pesos pendente.
STT CPU Whisper é baseline de API, sem promessa de qualidade PT-BR.
