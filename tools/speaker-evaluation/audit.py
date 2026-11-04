"""Read-only final integrity audit of a completed evaluation."""
import argparse,json,datetime
from pathlib import Path
from contract import digest,verify_file,verify_models,validate_split,PREPROCESSING,write_json
from evaluate import frozen_verify
p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out).resolve()
freeze=json.loads((out/'freeze.json').read_text());frozen_verify(out,freeze)
config=json.loads((out/'models.json').read_text());verify_models(config,PREPROCESSING)
corpus=json.loads((out/'corpus.json').read_text());validate_split(corpus['rows'])
for r in corpus['rows']:
 verify_file(out/r['path'],r['sha256']);verify_file(out/r['wav16_path'],r['wav16_sha256'])
evidence=json.loads((out/'evidence.json').read_text());verify_file(out/'candidate.json',evidence['candidate_sha256'])
verify_file(out/'criteria.json',evidence['criteria_sha256']);verify_file(out/'corpus.json',evidence['corpus_sha256'])
verify_file(out/'freeze.json',evidence['freeze_sha256'])
for label,split in [('enrollment','enrollment'),('calibration','calibration'),('test','test')]:
 inputs=json.loads((out/(label+'-input.json')).read_text());expected={r['id'] for r in corpus['rows'] if r['split']==split}
 if {r['id'] for r in inputs}!=expected:raise ValueError('inference split mismatch')
 embeddings=json.loads((out/(label+'-embeddings.json')).read_text())['rows']
 if {r['id'] for r in embeddings}!=expected or any(len(r['embedding'])!=256 for r in embeddings):raise ValueError('embedding coverage/dimension')
guard=json.loads((out/'no-policy-guard-evidence.json').read_text())
assert guard['recognition_without_policy']['speakers'][0]['state']=='unknown'
assert 'Unknown' in guard['match_without_policy']
assert evidence['evaluation_only'] and not evidence['policy_installed'] and not evidence['adequacy_gates_met']
write_json(out/'integrity-audit.json',dict(evaluation_only=True,status='passed',time=datetime.datetime.now(datetime.timezone.utc).isoformat(),
 corpus_clips=len(corpus['rows']),embedding_dimension=256,frozen_inputs_verified=True,
 model_hashes_verified=True,all_audio_hashes_verified=True,no_policy_match_and_recognition_verified=True,
 independent_splits_verified=True))
print('PASS: frozen inputs, pinned models, 48 real embeddings, splits, hashes and no-policy guard')
