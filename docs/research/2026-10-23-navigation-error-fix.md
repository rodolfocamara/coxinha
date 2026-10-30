# Correção de navegação após clique

Data: 2026-10-23. Corrigido um defeito reproduzível; a ligação com o clique relatado pelo usuário ainda depende da mensagem ou da tela onde ocorreu.

## Causa e correção

O menu da biblioteca obtinha `it-weekly-status` e `kathia-hdi-endossos` de fixtures e os oferecia como links para notas reais. `get_note` recebe UUID no backend; esses slugs são inválidos. O loader rejeitava o pedido e a tela padrão de erro do roteador substituía todo o AppShell, incluindo a navegação.

- `src/components/AppShell/Rail.tsx:30`: a lista padrão não deriva mais das fixtures. Notas recentes continuam vindo do store real; previews podem fornecer itens explicitamente.
- `src/features/home/fixtures.ts:127`: Home usa notas reais e listas vazias para recursos ainda não conectados. Dados fictícios permanecem disponíveis para testes, sem serem mostrados como estado real.
- `src/features/home/HomeCanvas.tsx`: navegação interna usa Link do roteador em memória, evitando carregar URLs como novas páginas do WebView.
- `src/router.tsx:58` e `src/routes/NoteDetailRoute.tsx:50`: erro de nota mantém o shell, oferece retorno à biblioteca/lista de notas e permite tentar novamente.

## Provas

A reprodução usa componentes e roteador reais, bindings gerados e transporte IPC simulado com erro de argumento UUID inválido ou nota inexistente. Não é execução nativa do comando IPC.

Os testes verificam remoção dos links fictícios, erro recuperável, navegação de saída, abertura de uma nota real, navegação pelos recentes da Home e retry que passa de rejeição a editor carregado. A suíte inteira final passou: 116 testes em 19 arquivos. Typecheck, build frontend e build desktop offline passaram. O novo desktop iniciou em 0,50 s com dados de smoke separados.

A aplicação que o usuário estava usando não foi encerrada. O launcher `target/recognition-validation-20261023/launch-demo` aponta agora para `coxinha-desktop-navigation-v2`, usando os mesmos dados de demonstração. O executável e o launcher anteriores foram preservados.

SHA-256 do desktop final: `c348c728551cff00305beae62f6f0c6668ec43cc8254474b91876ab34e028bb1`. O smoke de 0,50 s foi feito no primeiro binário corrigido (`6c5bacc...`); os dois ajustes finais foram recompilados e testados, sem repetir o boot.
Artefatos de revisão e smoke: `target/navigation-validation-20261023/`.

## Aceite pendente

Confirmar a mensagem e o clique do relato original. Não confundir esta reprodução com prova de que todo erro possível de interface foi resolvido. Nenhuma gravação, perfil, consentimento ou instalação existente foi removido; nenhum commit, push ou deploy foi feito.

## Revisão Fable

A revisão confirmou a remoção da causa reproduzida, não apenas uma tela de erro, e executou 9 testes de navegação mais typecheck. Apontou dois resíduos: título vazio gerava link sem nome acessível e o painel Home ainda continha um anchor de navegação interna. Ambos foram corrigidos depois da revisão. A nota sem título agora usa `sidebar.untitled`; um teste clica especificamente o link da Home e comprova a abertura pelo UUID real. HomePanel usa Link do roteador. Os testes focados finais passaram (10), assim como os 116 da suíte completa, typecheck e ambos os builds.

O texto técnico de erro permanece visível para diagnóstico. A mensagem do incidente original ainda não foi informada; a revisão não confirma qual elemento o usuário clicou.
