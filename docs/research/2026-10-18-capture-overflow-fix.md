# Correção do overflow de captura

O teste do usuário falhou com `capture queue overflow; recording interrupted`.
A versão anterior interrompia quando a fila compartilhada ficava cheia, e o
checkpoint síncrono ocupava a mesma rotina que drenava os blocos. As 64 vagas
de 20 ms equivalem a aproximadamente 640 ms para duas fontes simultâneas.

Os metadados locais da tentativa mostraram chegada regular de ambas as fontes,
aproximadamente 20 ms por bloco, sem rajadas, seguida de overflow em 4,71 s.
O áudio pessoal não foi ouvido nem copiado. Não existe medição direta do fsync
da tentativa original; a atribuição ao checkpoint lento é apoiada pela
reprodução controlada abaixo. O teste anterior em tmpfs não cobria esse risco.

## Correção

- CLI e Tauri solicitam checkpoints assíncronos. Há no máximo um em andamento;
  snapshots usam handles abertos separadamente, sem compartilhar offset com o
  escritor de áudio. Finalização e Drop aguardam o job antes do estado final.
- A fila continua com 64 vagas. O leitor preserva um único bloco pendente por
  até dois segundos enquanto aguarda espaço. Não aumenta memória sem limite
  nem descarta amostras para esconder saturação permanente.
- Encerrar drena os blocos completos antes de aguardar os leitores. Isso evita
  deadlock quando um leitor está esperando espaço para seu último bloco.
- Erros reais de fonte, persistência e saturação permanente continuam sendo
  reportados como interrupção. Não há fallback para outra fonte.

## Reprodução e verificação

A fixture `tools/fixtures/delay-fsync.c` atrasa em 750 ms a sincronização do
arquivo `mic.wav` após sua criação inicial. Ela é somente para teste e não
entra no executável. Foi usada com fontes virtuais em PipeWire/Pulse isolado,
gravando em `target/overflow-validation` no Btrfs da instalação.

```sh
mkdir -p target/overflow-validation
cc -shared -fPIC -O2 -o target/overflow-validation/delay-fsync.so tools/fixtures/delay-fsync.c -ldl
LD_PRELOAD="$PWD/target/overflow-validation/delay-fsync.so" python3 tools/test-isolated-capture.py normal --seconds 30 --artifact-parent target/overflow-validation
```

Para comparação, uma cópia isolada do core reintroduziu apenas o checkpoint
síncrono periódico e a falha imediata em fila cheia, conforme a implementação
entregue anteriormente. As versões das dependências vieram do mesmo Cargo.lock.
Esse controle falhou com o mesmo overflow após aproximadamente 1,6 s de áudio.
É uma reconstrução controlada do comportamento, não um commit histórico.

Com a correção e o mesmo atraso:

- Normal: 30 s, finished, 1.438.080 frames no mic e 1.437.120 na saída.
- Pausa: 5 s com pausa de 1 s, finished, 191.040 frames em cada trilha.
- Falha de somente uma fonte: interrupted, código 1 esperado; o microfone
  continuou recebendo enquanto a saída ficou sem blocos.
- Frequências medidas: 440 Hz no microfone virtual e 880 Hz no monitor.
- Core: 17 testes unitários e 1 integração de recuperação passaram.
- Tauri: 82 testes passaram. Clippy core estrito passou; Tauri mantém os dois
  warnings preexistentes de `double_must_use` gerados por `async_trait`.
- Binário standalone reconstruído; boot em dados temporários atingiu ready
  em 0,601 s. Não houve captura pessoal durante essa verificação.

Testes adicionais verificam checkpoint bloqueado por barreira sem impedir
escrita, ordenação/conteúdo exatos, offset de arquivo e stop com fila cheia.
Logs estão em `target/overflow-validation/`: `core-tests.log`,
`tauri-tests.log`, `red-synchronous-control.log`, `green-delayed-sync-30s.log`,
`green-pause-delayed-sync.log`, `green-stall-delayed-sync.log` e `boot/`.

SHA-256 do binário validado:
`82691e06a9f9877714a370c21d516865dbcbcea9b4474aa85f57226c12cc083c`.

## Reteste

Saia do Coxinha pelo menu da bandeja e execute novamente
`/home/rcamara/Repos/coxinha/target/debug/coxinha`. Grave de um a dois minutos
com o mesmo microfone e monitor de saída, pause/retome e ouça as duas trilhas.
A gravação interrompida anterior foi preservada. O resultado em dispositivos
reais ainda depende desse reteste; diarização e identidade continuam pendentes.
