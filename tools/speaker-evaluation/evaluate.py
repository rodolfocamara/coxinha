"""Frozen calibration followed by independent held-out scoring. No installer."""
import argparse
import datetime
import json
import math
import os
import subprocess
from pathlib import Path
from contract import (digest,write_json,verify_file,verify_models,validate_split,
                       PREPROCESSING,cosine,rank,candidate,metrics)

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def distribution(values):
 a=sorted(values)
 if not a:return None
 return dict(n=len(a),minimum=a[0],p05=a[round((len(a)-1)*.05)],median=a[round((len(a)-1)*.5)],
             p95=a[round((len(a)-1)*.95)],maximum=a[-1],mean=sum(a)/len(a))

def run_extract(out,config,rows,label,mode='oracle'):
 inputs=[dict(id=r['id'],path=str(out/r['path'])) for r in rows]
 write_json(out/(label+'-input.json'),inputs)
 env={'PATH':'/usr/bin:/bin','HOME':str(out/'isolated-home'),'XDG_CONFIG_HOME':str(out/'isolated-home/config'),
      'XDG_DATA_HOME':str(out/'isolated-home/data'),'XDG_CACHE_HOME':str(out/'isolated-home/cache'),
      'ORT_DYLIB_PATH':config['models']['onnxruntime']['path'],'OMP_NUM_THREADS':'1','LANG':'C.UTF-8'}
 cmd=[str(out/'extract'),str(out/'models.json'),str(out/(label+'-input.json')),str(out/(label+'-embeddings.json')),mode]
 write_json(out/(label+'-command.json'),cmd)
 with (out/(label+'.log')).open('w') as log:subprocess.run(cmd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=240)
 data=json.loads((out/(label+'-embeddings.json')).read_text())
 if len(data['rows'])!=len(rows):raise ValueError('incomplete extraction')
 by_id={r['id']:r for r in data['rows']}
 return [dict(r,**{k:v for k,v in by_id[r['id']].items() if k!='id'}) for r in rows]

def frozen_verify(out,freeze):
 for name,expected in freeze['files'].items():verify_file(out/name,expected)

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',required=True);args=p.parse_args();out=Path(args.out).resolve()
 # Refuse overwriting a completed experiment; regeneration uses a new output dir.
 if (out/'freeze.json').exists():raise ValueError('already frozen; do not overwrite evaluation')
 config=json.loads((out/'models.json').read_text());verify_models(config,PREPROCESSING)
 corpus=json.loads((out/'corpus.json').read_text());criteria=json.loads((out/'criteria.json').read_text())
 if criteria['preprocessing']!=PREPROCESSING:raise ValueError('preprocessing contract')
 rows=corpus['rows'];validate_split(rows)
 for r in rows:verify_file(out/r['path'],r['sha256']);verify_file(out/r['wav16_path'],r['wav16_sha256'])
 # Snapshot all tool code before any acoustic extraction/scoring.
 tools=Path(__file__).resolve().parent
 (out/'harness-snapshot').mkdir(exist_ok=True)
 for f in tools.glob('*'):
  if f.is_file(): (out/'harness-snapshot'/f.name).write_bytes(f.read_bytes())
 names=['criteria.json','corpus.json','models.json','extraction-build.json','extract',
        'participant-mappings.json','source-snapshot/dsp.rs','source-snapshot/diarization.rs']
 names += [str(f.relative_to(out)) for f in (out/'harness-snapshot').iterdir() if f.is_file()]
 freeze=dict(evaluation_only=True,frozen_before_scoring_at=now(),files={n:digest(out/n) for n in sorted(names)})
 write_json(out/'freeze.json',freeze);freeze_hash=digest(out/'freeze.json')
 enroll=run_extract(out,config,[r for r in rows if r['split']=='enrollment'],'enrollment')
 calibration=run_extract(out,config,[r for r in rows if r['split']=='calibration'],'calibration')
 ranked=[rank(r,enroll) for r in calibration];selected,sweep=candidate(ranked,criteria)
 write_json(out/'calibration-sweep.json',dict(evaluation_only=True,rows=sweep))
 write_json(out/'calibration-scores.json',dict(evaluation_only=True,rows=ranked))
 chosen=dict(evaluation_only=True,not_a_production_policy=True,freeze_sha256=freeze_hash,
    selected_at=now(),test_not_scored=True,**selected)
 write_json(out/'candidate.json',chosen);candidate_hash=digest(out/'candidate.json')
 print('candidate frozen from calibration',chosen,flush=True)
 frozen_verify(out,freeze);verify_models(config,PREPROCESSING)
 # Only now run held-out acoustic extraction. No test threshold sweep exists.
 test=run_extract(out,config,[r for r in rows if r['split']=='test'],'test')
 test_ranked=[rank(r,enroll) for r in test]
 t,m=chosen['threshold'],chosen['margin']
 same=[];cross=[];pairs=[]
 for query in test:
  for anchor in enroll:
   score=cosine(query['embedding'],anchor['embedding']);is_same=query['person']==anchor['person']
   (same if is_same else cross).append(score)
   pairs.append(dict(query=query['id'],anchor=anchor['id'],same_person=is_same,cosine=score))
 write_json(out/'test-pair-scores.json',dict(evaluation_only=True,rows=pairs))
 write_json(out/'test-scores.json',dict(evaluation_only=True,rows=test_ranked))
 measured=metrics(test_ranked,t,m)
 unknown_people=len({r['person'] for r in test if r['unknown']})
 # For zero FA: exact one-sided 95% binomial upper; correlated excerpts are
 # not independent, so also report the more cautious person-level count.
 n=measured['unknown'];fa=measured['unknown_false_accepts']
 evidence=dict(evaluation_only=True,synthetic_test_only=False,validation_status='evaluation_only',
   policy_installed=False,criteria_sha256=digest(out/'criteria.json'),corpus_sha256=digest(out/'corpus.json'),
   freeze_sha256=freeze_hash,candidate_sha256=candidate_hash,finished_at=now(),
   disjoint_enrollment_calibration_test=True,unknown_people_test=unknown_people,
   calibration=selected,test=measured,same_person_test_pair_cosine=distribution(same),cross_person_test_pair_cosine=distribution(cross),
   same_person_per_query_max_cosine=distribution([max(cosine(r['embedding'],e['embedding']) for e in enroll if e['person']==r['person']) for r in test if not r['unknown']]),
   unknown_per_query_max_cosine=distribution([r['best'] for r in test_ranked if r['unknown']]),
   zero_FA_one_sided_95_upper_per_excerpt=(1-.05**(1/n)) if fa==0 else None,
   zero_FA_one_sided_95_upper_per_person=(1-.05**(1/unknown_people)) if fa==0 else None,
   adequacy_gates_met=False,domain='English AMI same-day simulated ES2004a-d; mono Mix-Headset; oracle clean 4-second excerpts',
   exclusions=['no PT-BR acceptance','no Teams/microphone generalization','no diarization quality claim from oracle embeddings',
       'no population false-accept guarantee','no consent or policy changes'])
 frozen_verify(out,freeze);verify_file(out/'candidate.json',candidate_hash)
 write_json(out/'evidence.json',evidence)
 print(json.dumps(evidence,indent=2),flush=True)
if __name__=='__main__':main()
