"""Compile only the isolated harness, reusing public dependency rlibs. No Cargo."""
import argparse,os,subprocess,shutil
from pathlib import Path
from contract import digest,write_json
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--out',required=True);a=p.parse_args()
repo=Path(a.repo).resolve();out=Path(a.out).resolve();snapshot=out/'source-snapshot';snapshot.mkdir(exist_ok=True)
records={}
for name in ['dsp.rs','diarization.rs']:
 source=repo/'coxinha-core/src/speech'/name;shutil.copyfile(source,snapshot/name)
 records[str(source.relative_to(repo))]=digest(source)
# Read package artifacts only, never Cargo config, credentials or operator HOME.
deps=repo/'target/debug/deps';extern=[];pins={}
for name in ['anyhow','serde_json','hound','pyannote_rs','ort','uuid']:
 candidates=list(deps.glob(f'lib{name}-*.rlib'))
 if not candidates:raise RuntimeError('missing compiled public dependency '+name)
 f=max(candidates,key=lambda p:p.stat().st_mtime_ns);extern+=['--extern',f'{name}={f}'];pins[name]=dict(path=str(f),sha256=digest(f))
home=out/'isolated-home';home.mkdir(exist_ok=True)
env={'PATH':'/usr/bin:/bin','HOME':str(home),'EVAL_SNAPSHOT':str(snapshot),'LANG':'C.UTF-8'}
cmd=['rustc','--edition=2021','-C','opt-level=1','-L',f'dependency={deps}',*extern,str(repo/'tools/speaker-evaluation/extract.rs'),'-o',str(out/'extract')]
write_json(out/'build-command.json',cmd)
with (out/'build.log').open('w') as log:subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=120)
write_json(out/'extraction-build.json',dict(evaluation_only=True,source_snapshot=records,dependency_artifacts=pins,
  executable_sha256=digest(out/'extract'),compiler=subprocess.check_output(['rustc','--version'],text=True,env=env).strip(),
  rustc_args=cmd,production_files_modified=False))
print('isolated extraction executable built')
