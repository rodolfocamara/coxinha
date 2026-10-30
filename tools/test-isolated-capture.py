#!/usr/bin/env python3
"""Exercise Pulse transport + core with isolated virtual tones, never hardware."""
import argparse
import signal
from contextlib import ExitStack
import json
import os
import pathlib
import subprocess
import time
import tempfile
import shutil
import math
import struct
import wave

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode', choices=['normal', 'pause', 'stall'])
parser.add_argument('--seconds', type=int, default=5, help='Capture duration, 5..300 seconds')
parser.add_argument('--artifact-parent', type=pathlib.Path, help='Existing parent directory for artifacts, to exercise the target filesystem')
parser.add_argument('--binary', type=pathlib.Path, help='Capture CLI binary to verify')
args = parser.parse_args()
if not 5 <= args.seconds <= 300:
    parser.error('--seconds must be 5..300')
mode = args.mode
repo = pathlib.Path(__file__).resolve().parents[1]
binary = args.binary.resolve() if args.binary else repo / 'target/debug/coxinha-meetings'
for command in ['pipewire', 'pactl', 'pw-link', 'pw-dump', 'paplay', 'parec']:
    if not shutil.which(command):
        parser.error(f'Missing local dependency: {command}; no packages are installed automatically')
if not binary.is_file():
    parser.error('Build first: cargo build -p coxinha-core --bin coxinha-meetings')

root = pathlib.Path(tempfile.mkdtemp(prefix='coxinha-isolated-capture-', dir=args.artifact_parent)).resolve()
print(f'Artifacts retained: {root}', flush=True)
# Keep Unix socket paths short even when the library lives on a deep disk path.
runtime = pathlib.Path(tempfile.mkdtemp(prefix='coxinha-audio-runtime-'))
print(f'Private runtime retained: {runtime}', flush=True)
env = dict(os.environ, XDG_RUNTIME_DIR=str(runtime), PIPEWIRE_RUNTIME_DIR=str(runtime), PULSE_SERVER=f'unix:{runtime}/pulse/native', PIPEWIRE_REMOTE='coxinha-test')
config = root / 'isolated.conf'
config.write_text('''
context.properties = { core.daemon = true core.name = coxinha-test support.dbus = false }
context.spa-libs = { audio.convert.* = audioconvert/libspa-audioconvert support.* = support/libspa-support }
context.modules = [
 { name = libpipewire-module-protocol-native }
 { name = libpipewire-module-metadata }
 { name = libpipewire-module-spa-node-factory }
 { name = libpipewire-module-client-node }
 { name = libpipewire-module-adapter }
 { name = libpipewire-module-link-factory }
 { name = libpipewire-module-access args = { access.force = unrestricted } }
 { name = libpipewire-module-protocol-pulse }
]
pulse.properties = { server.address = [ "unix:native" ] }
stream.properties = { adapter.auto-port-config = { mode = dsp } }
context.objects = [
 { factory = metadata args = { metadata.name = default } }
 { factory = spa-node-factory args = { factory.name = support.node.driver node.name = Dummy-Driver node.group = pipewire.dummy priority.driver = 20000 } }
 { factory = adapter args = { factory.name = support.null-audio-sink node.driver = false node.group = pipewire.dummy node.name = synthetic-mic-feed node.description = "Private microphone tone sink" media.class = Audio/Sink audio.position = [ MONO ] adapter.auto-port-config = { mode = dsp monitor = true position = preserve } } }
 { factory = adapter args = { factory.name = support.null-audio-sink node.driver = false node.group = pipewire.dummy node.name = synthetic-output node.description = "Isolated output" media.class = Audio/Sink audio.position = [ MONO ] adapter.auto-port-config = { mode = dsp monitor = true position = preserve } } }
]
''')
processes = []
stopped_recorders = []
files = ExitStack()
def run(args, **kwargs):
    return subprocess.run(args, env=env, check=True, capture_output=True, text=True, timeout=10, **kwargs).stdout
try:
    log = files.enter_context(open(root / 'pipewire.log', 'w'))
    server = subprocess.Popen(['pipewire', '-c', str(config)], env=env, stdout=log, stderr=log)
    processes.append(server)
    for _ in range(50):
        if (runtime / 'pulse/native').exists(): break
        if server.poll() is not None: raise RuntimeError('isolated daemon exited')
        time.sleep(.1)
    else:
        raise RuntimeError('Timed out waiting for isolated Pulse socket')
    # Remap a private sink monitor into a non-monitor source. This avoids the
    # audiotestsrc SPA generator exhausting its buffers on longer runs.
    run(['pactl', 'load-module', 'module-remap-source',
         'master=synthetic-mic-feed.monitor', 'source_name=synthetic-mic',
         'channels=1', 'channel_map=mono', 'remix=no'])
    (root/'sources.json').write_text(run(['pactl', '--format=json', 'list', 'sources']))
    sources = json.loads((root/'sources.json').read_text())
    mic_source = next(source for source in sources if source['name'] == 'synthetic-mic')
    assert mic_source.get('monitor_of_sink') in [None, 4294967295], mic_source
    (root/'remap-graph.json').write_text(run(['pw-dump']))
    run(['pw-link', 'synthetic-mic-feed:monitor_MONO', 'input.synthetic-mic:input_MONO'])
    for name, frequency, sink in [('mic-tone', 440, 'synthetic-mic-feed'), ('output-tone', 880, 'synthetic-output')]:
        tone_path = root/f'{name}.wav'
        with wave.open(str(tone_path), 'wb') as tone:
            tone.setparams((1, 2, 48000, 0, 'NONE', 'not compressed'))
            second = b''.join(struct.pack('<h', round(10000*math.sin(2*math.pi*frequency*n/48000))) for n in range(48000))
            for _ in range(args.seconds + 15):
                tone.writeframes(second)
        player = subprocess.Popen(['paplay', f'--device={sink}', f'--property=node.name={name}', str(tone_path)], env=env,
            stdout=subprocess.DEVNULL, stderr=files.enter_context(open(root/f'{name}.log', 'w')))
        processes.append(player)
        for _ in range(50):
            if f'{name}:output_MONO' in run(['pw-link', '-o']): break
            time.sleep(.02)
        else:
            raise RuntimeError(f'Timed out waiting for isolated {name} port')
        run(['pw-link', f'{name}:output_MONO', f'{sink}:playback_MONO'])
    capture = subprocess.Popen([str(binary),'capture',str(root/'library'),'synthetic-mic','synthetic-output.monitor',str(args.seconds)], env=env, stdin=subprocess.PIPE, stdout=files.enter_context(open(root/'capture.log','w')),stderr=subprocess.STDOUT,text=True)
    processes.append(capture)
    for _ in range(500):
        ports=run(['pw-link','-i']).splitlines()
        recorder_ports=[p for p in ports if p.startswith('parec:')]
        if len(recorder_ports)>=2: break
        time.sleep(.02)
    else:
        raise RuntimeError('Timed out waiting for both recorder ports')
    graph=json.loads(run(['pw-dump']))
    targets = {}
    recorder_pids = {}
    for obj in graph:
        props=obj.get('info',{}).get('props',{})
        if props.get('node.name')=='parec':
            port=next(x['id'] for x in graph if x.get('type')=='PipeWire:Interface:Port' and str(x.get('info',{}).get('props',{}).get('node.id'))==str(obj['id']))
            source = props.get('target.object')
            if source == 'synthetic-output': source = 'synthetic-output.monitor'
            if source not in ['synthetic-mic', 'synthetic-output.monitor']: raise RuntimeError(f'Unexpected isolated recorder target: {source!r}')
            targets[source] = str(port)
            client = next((item for item in graph if str(item.get('id')) == str(props.get('client.id'))), {})
            recorder_pid = props.get('application.process.id') or client.get('info', {}).get('props', {}).get('application.process.id')
            if recorder_pid is not None:
                recorder_pids[source] = int(recorder_pid)
            target='synthetic-mic:capture_MONO' if source == 'synthetic-mic' else 'synthetic-output:monitor_MONO'
            run(['pw-link',target,str(port)])
    assert set(targets) == {'synthetic-mic', 'synthetic-output.monitor'}, targets
    if mode == 'pause':
        time.sleep(1)
        capture.stdin.write('pause\n'); capture.stdin.flush()
        time.sleep(1)
        capture.stdin.write('resume\n'); capture.stdin.flush()
    if mode == 'stall':
        time.sleep(1)
        # Unlinking a running PipeWire stream produces valid silence, not a
        # transport stall. Stop only the private output reader instead.
        recorder_pid = recorder_pids['synthetic-output.monitor']
        command = pathlib.Path(f'/proc/{recorder_pid}/cmdline').read_bytes().split(b'\0')
        assert pathlib.Path(os.fsdecode(command[0])).name == 'parec', command
        ancestor = recorder_pid
        for _ in range(16):
            parent_line = next(line for line in pathlib.Path(f'/proc/{ancestor}/status').read_text().splitlines() if line.startswith('PPid:'))
            ancestor = int(parent_line.split()[1])
            if ancestor == capture.pid:
                break
            if ancestor <= 1:
                raise RuntimeError('Refusing to stop a recorder outside the isolated capture CLI')
        else:
            raise RuntimeError('Recorder ancestry could not be verified')
        (root/'stall-injection.json').write_text(json.dumps({
            'method': 'SIGSTOP isolated output parec child', 'readerPid': recorder_pid,
            'capturePid': capture.pid, 'source': 'synthetic-output.monitor'
        }, indent=2) + '\n')
        os.kill(recorder_pid, signal.SIGSTOP)
        stopped_recorders.append(recorder_pid)
    capture.wait(timeout=args.seconds + 30)
    assert capture.returncode == (1 if mode=='stall' else 0), (root/'capture.log').read_text()
    manifest=json.loads(next((root/'library'/'raw').glob('*/manifest.json')).read_text())
    assert manifest['state']==('interrupted' if mode=='stall' else 'finished')
    if mode=='pause':
        events=[json.loads(line) for line in next((root/'library'/'raw').glob('*/timing.jsonl')).read_text().splitlines()]
        assert sum(e['kind']=='pause' for e in events)==1
        assert sum(e['kind']=='resume' for e in events)==1
        assert all(args.seconds-1.5 < t['frames']/48000 < args.seconds-0.5 for t in manifest['tracks'])
    measured = []
    for path in sorted((root/'library'/'raw').glob('*/*.wav')):
        with wave.open(str(path),'rb') as wav:
            rate = wav.getframerate()
            frames = wav.getnframes()
            samples = struct.unpack('<' + 'h' * min(frames,rate*2), wav.readframes(min(frames,rate*2)))
            # Count positive zero crossings in the middle second, avoiding stream startup.
            segment = samples[rate:rate*2] if len(samples) >= rate*2 else samples
            crossings = [i - a / (b-a) for i, (a,b) in enumerate(zip(segment, segment[1:])) if a <= 0 < b]
            dominant = (len(crossings)-1) * rate / (crossings[-1]-crossings[0]) if len(crossings) > 1 else 0
            expected = 440 if path.name == 'mic.wav' else 880
            assert abs(dominant-expected) < 1, (path.name, dominant)
            measured.append({'track': path.name, 'frames': frames, 'frequencyHz': round(dominant, 2)})
    if mode == 'stall':
        log_text = (root/'capture.log').read_text()
        assert 'Output source stalled' in log_text and 'Mic source stalled' not in log_text, log_text
        tracks = {t['file']: t for t in manifest['tracks']}
        assert tracks['mic.wav']['frames'] > tracks['output.wav']['frames']
        assert tracks['mic.wav']['last_arrival_ns'] > tracks['output.wav']['last_arrival_ns'] + 2_000_000_000
    if mode == 'normal':
        assert all(args.seconds - .5 < track['frames'] / 48000 < args.seconds + .5 for track in measured), measured
    transport_warnings = [line for line in (root/'pipewire.log').read_text().splitlines() if 'out of buffers' in line.lower()]
    report = {'mode': mode, 'seconds': args.seconds, 'exitCode': capture.returncode, 'state': manifest['state'], 'tracks': measured, 'transportWarnings': transport_warnings, 'cleanTransport': not transport_warnings,
              'scope': 'isolated virtual Pulse transport and core only; no hardware or Tauri UI acceptance'}
    (root/'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    # A warning alone does not prove lost frames. Preserve measured durations
    # separately, while requiring a clean daemon for this harness regression.
    assert not transport_warnings, 'Capture measurements retained; daemon reported buffer warnings (not proof of frame loss)'

finally:
    # A stopped process cannot handle TERM; resume it before any teardown.
    for recorder_pid in stopped_recorders:
        try:
            os.kill(recorder_pid, signal.SIGCONT)
        except ProcessLookupError:
            pass
    for p in reversed(processes):
        if p.poll() is None:
            p.terminate()
            try: p.wait(timeout=5)
            except subprocess.TimeoutExpired: p.kill(); p.wait()

        if p.stdin:
            p.stdin.close()
    files.close()
