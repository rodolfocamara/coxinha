# Prova isolada de transporte de captura

`tools/test-isolated-capture.py` verifica o transporte Pulse e o core com fontes
virtuais determinísticas. Não comprova microfone físico, monitor real, UI Tauri,
latência, correção de drift, transcrição, diarização ou identidade.

Dependências locais: Python 3 (somente stdlib), PipeWire com protocolo Pulse,
`pactl`, `parec`, `paplay`, `pw-cli`, `pw-link` e `pw-dump` no PATH. A configuração
mínima foi adaptada de `/usr/share/pipewire/minimal.conf` instalado (1.6.9),
sem módulos ALSA/udev e sem session manager. Nada é instalado automaticamente.

Na raiz do repositório:

```sh
cargo build -p coxinha-core --bin coxinha-meetings
python3 tools/test-isolated-capture.py normal
python3 tools/test-isolated-capture.py pause
python3 tools/test-isolated-capture.py stall
python3 tools/test-isolated-capture.py normal --seconds 30 --artifact-parent target
```

Cada execução cria um diretório temporário próprio e imprime seu caminho.
`--artifact-parent` escolhe o filesystem dos WAVs e logs. O runtime dos sockets
fica em outro diretório temporário curto, evitando o limite de caminho Unix.
`--binary` permite escolher o executável CLI sob teste, sem substituir o atual.
`XDG_RUNTIME_DIR`, `PIPEWIRE_RUNTIME_DIR`, `PIPEWIRE_REMOTE` e `PULSE_SERVER`
apontam exclusivamente para esse ambiente. Nenhuma fonte ou saída padrão do
servidor real é usada. A única fonte é um tom virtual de 440 Hz e a saída recebe
um WAV de 880 Hz. IDs de nodes e portas são obtidos do grafo privado; o cenário
stall desconecta exclusivamente a porta correspondente ao target de saída.

O teste captura cinco segundos por padrão, configurável de 5 a 300 segundos.
`pause` envia pausa de um segundo e exige um
par pause/resume no timing e aproximadamente quatro segundos em cada WAV.
`stall` interrompe somente o link do monitor, exige falha de captura e manifest
interrupted, mantendo mais frames de microfone que de saída. Todos os modos
medem frequência por cruzamentos de zero interpolados, sem NumPy.

Os subprocessos criados são encerrados no `finally`; arquivos são preservados.
O diretório contém `report.json`, logs, config, tom e biblioteca com manifest,
timing e WAVs. O relatório impresso contém somente modo, estado, código de saída,
frames e frequência por trilha. O script não grava dumps de grafo ou metadados
do host. Remoção dos artefatos fica a cargo do operador.

Execução de 2026-10-18: normal terminou com estado finished; pause terminou
finished com 190080/191040 frames; stall retornou código 1 e interrupted com
144000 frames de mic e 46080 de saída. Os tons medidos foram 440/880 Hz.
São evidências sintéticas de transporte e isolamento, não aceite acústico.

O ensaio original usou `/tmp` (tmpfs), sem a latência de persistência do Btrfs
usado pela instalação. A regressão de checkpoint lento está documentada em
[correção de overflow](2026-10-18-capture-overflow-fix.md). Não tratar tmpfs
como equivalente ao disco da instalação ao validar captura contínua.
