# Aceite da captura Linux, 2026-10-18

Esta fatia permite testar gravação e biblioteca. O fluxo completo com
transcrição, diarização e reconhecimento entre reuniões ainda não está pronto.

O primeiro teste físico falhou com overflow. O binário foi corrigido e
revalidado com atraso de disco injetado; é necessário reabrir o aplicativo para
usar a versão nova. [Evidência da correção](2026-10-18-capture-overflow-fix.md).

## Abrir

Na máquina em que o build foi feito:

```sh
cd /home/rcamara/Repos/coxinha
./target/debug/coxinha
```

O build de teste usa `cargo build -p coxinha --bin coxinha --features
tauri/custom-protocol`, após `pnpm build`, e incorpora o frontend. Não precisa
do Vite em execução. Não é AppImage nem pacote portátil para outra máquina.
Para desenvolvimento com recompilação: `pnpm tauri:dev`.

Lançamento normal mostra a janela; `--hidden` preserva o uso via autostart/tray.
Fechar a janela a esconde. Use Sair no menu da bandeja para encerrar o app;
uma captura ativa é finalizada no encerramento normal. Iniciar o app não abre
o microfone. Gravar exige ação explícita.

Os novos dados ficam em `app_data_dir()/meeting-library`, usualmente
`~/.local/share/br.dev.coxinha.app/meeting-library` no Linux. Os dados privados
de identidade ficam em `private/profiles.db`. Não remover esse banco como se
fosse cache. As notas antigas mantêm seu caminho e índice separados.

## Teste curto, de um a dois minutos

1. Na Biblioteca, escolha um microfone físico e o monitor da saída usada pelos
   seus fones. Não escolher uma entrada de loopback da interface como microfone.
   Não há fallback para `default`. Use Atualizar após conectar um dispositivo.
2. Dê um título e inicie. Fale com a saída em silêncio e observe o medidor do
   microfone. Depois fique em silêncio e reproduza um WAV pelo computador;
   observe o medidor da saída. Use fones para reduzir vazamento acústico.
3. Pause, aguarde, retome e pare. Abra a gravação e ouça cada trilha. Sua voz
   deve estar no microfone e o áudio reproduzido no monitor, sem duplicação
   inesperada. Dois players separados não são reprodução sincronizada.
4. Saia pelo menu da bandeja, abra novamente e confira persistência e playback.
5. Em outra gravação curta, desconecte somente uma fonte. Confira o diagnóstico
   e o estado interrompido. Os originais devem continuar disponíveis. Uma
   captura sem áudio não deve aparecer como sucesso.
6. Recuperação de crash foi testada em processo sintético. Para repetir sem
   arriscar reunião real, use as fixtures CLI e os testes documentados no core.
   Capturas deixadas abertas exigem Recuperar; não se tornam sucesso completo.

Relate o título de teste, as fontes escolhidas, qual medidor respondeu e o que
foi ouvido em cada trilha. Não é necessário compartilhar áudio privado para
descrever um problema de seleção/estado. Nenhum resultado de diarização ou
nome de pessoa é esperado nesta versão.

## Evidência e limites

- Frontend: testes de comando, erros e polling fora de ordem; prévia visual no
  navegador, que informa corretamente que captura exige desktop.
- Core: banco/identidade de política, recuperação de processo e falhas de fila.
- Transporte: `tools/test-isolated-capture.py` usa PipeWire/Pulse real com
  dispositivos virtuais e tons de 440/880 Hz, sem usar o áudio da sessão.
- Aceite físico Linux, áudio no WebKit e Windows permanecem pendentes.
- Clock mede chegada dos blocos, não timestamp de hardware. Latência e drift
  não foram compensados. Pausas ficam no journal e são excluídas dos WAVs.
- Tail parcial inferior a 20 ms pode se perder. RIFF para antes de 4 GiB;
  rollover e ensaio prolongado permanecem pendentes.
- Asset protocol concede apenas WAVs fechados/verificados. Requests Range
  recebem blocos limitados pelo Tauri; requests sem Range podem carregar todo
  o arquivo. Memória em playback de gravações longas não foi validada.
- Não há inferência de fala, identificação acústica nem transcrição automática
  na nova interface. Reunião presencial, múltiplos falantes, voz desconhecida,
  sobreposição e correções de identidade ainda exigem a próxima fatia.
