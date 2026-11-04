"""Evaluation-only contracts. Synthetic tests validate logic, never acoustics."""
import hashlib
import json
import math
from pathlib import Path

PREPROCESSING = 'pcm16-48k-fir97-7khz-decimate3-knf-fbank80-v1'
PINS = {
 'embedding': '7bb2f06e9df17cdf1ef14ee8a15ab08ed28e8d0ef5054ee135741560df2ec068',
 'segmentation': '057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25',
 'onnxruntime': '3da6146e14e7b8aaec625dde11d6114c7457c87a5f93d744897da8781e35c673',
}

def digest(path):
 h = hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda: f.read(1048576), b''): h.update(b)
 return h.hexdigest()

def write_json(path, data):
 Path(path).write_text(json.dumps(data, indent=2, sort_keys=True, allow_nan=False)+'\n')

def verify_file(path, expected):
 if digest(path) != expected: raise ValueError('checksum mismatch: '+str(path))

def verify_models(config, preprocessing):
 if preprocessing != PREPROCESSING: raise ValueError('wrong preprocessing')
 for key, expected in PINS.items():
  model = config['models'][key]
  if model['sha256'] != expected: raise ValueError('wrong model: '+key)
  verify_file(model['path'], expected)

def validate_split(rows):
 if not rows: raise ValueError('empty corpus')
 ids, hashes, sessions, source_intervals = set(), set(), {}, {}
 people = {s: set() for s in ['enrollment','calibration','test']}
 unknown = {s: set() for s in ['calibration','test']}
 for r in rows:
  if r['id'] in ids or r['pcm_sha256'] in hashes: raise ValueError('duplicate source content')
  ids.add(r['id']); hashes.add(r['pcm_sha256'])
  split = r['split']
  if split not in people: raise ValueError('invalid split')
  session = r['session']
  if session in sessions and sessions[session] != split: raise ValueError('session leakage')
  sessions[session] = split
  people[split].add(r['person'])
  if r['unknown']: unknown[split].add(r['person'])
  a,b = r['start_sample'],r['end_sample']
  if a < 0 or b-a < 64000: raise ValueError('invalid or short interval')
  key = r['source_url']
  for x,y in source_intervals.get(key,[]):
   if a < y and b > x: raise ValueError('source interval overlap')
  source_intervals.setdefault(key,[]).append((a,b))
 if people['enrollment'] & (unknown['calibration']|unknown['test']): raise ValueError('known unknown leakage')
 if unknown['calibration'] & unknown['test']: raise ValueError('unknown person leakage')
 for split in ['calibration','test']:
  if not people['enrollment'] <= people[split]: raise ValueError('missing recurrence')

def cosine(a,b):
 if len(a)!=len(b) or not a or not all(math.isfinite(x) for x in a+b): raise ValueError('invalid vectors')
 den=math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))
 if den<=1e-8: raise ValueError('zero vector')
 return max(-1.,min(1.,sum(x*y for x,y in zip(a,b))/den))

def rank(query, enrollment):
 scores={}
 for r in enrollment:
  s=cosine(query['embedding'],r['embedding'])
  scores[r['person']]=max(scores.get(r['person'],-1),s)
 order=sorted(scores.items(),key=lambda v:(-v[1],v[0]))
 return {'id':query['id'],'person':query['person'],'unknown':query['unknown'],
         'scores':dict(order),'best_person':order[0][0],'best':order[0][1],
         'margin':order[0][1]-order[1][1]}

def accepted(r, threshold, margin):
 return r['best']>=threshold and r['margin']>margin

def metrics(rows, threshold, margin):
 known=[r for r in rows if not r['unknown']]; unknown=[r for r in rows if r['unknown']]
 correct=sum(accepted(r,threshold,margin) and r['best_person']==r['person'] for r in known)
 wrong=sum(accepted(r,threshold,margin) and r['best_person']!=r['person'] for r in known)
 rejected=sum(not accepted(r,threshold,margin) for r in known)
 fa=sum(accepted(r,threshold,margin) for r in unknown)
 return dict(known=len(known),unknown=len(unknown),correct=correct,misidentifications=wrong,
             false_rejections=rejected,false_rejection_rate=rejected/len(known) if known else None,
             unknown_false_accepts=fa,unknown_false_accept_rate=fa/len(unknown) if unknown else None,
             unknown_rejected=len(unknown)-fa,known_coverage=(correct+wrong)/len(known) if known else None,
             total_coverage=(correct+wrong+fa)/len(rows) if rows else None)

def candidate(rows, criteria):
 if not rows or not any(r['unknown'] for r in rows): raise ValueError('calibration unknowns required')
 sweep=[]
 for t in criteria['threshold_grid']:
  for m in criteria['margin_grid']:
   out=metrics(rows,t,m);sweep.append(dict(threshold=t,margin=m,**out))
 # Zero FA and zero misidentification mandatory on calibration. Max recall,
 # then strictest threshold then strictest margin: stable, predeclared tie-break.
 valid=[r for r in sweep if r['unknown_false_accepts']==0 and r['misidentifications']==0]
 if not valid: raise ValueError('no admissible calibration point')
 best=sorted(valid,key=lambda r:(-r['correct'],-r['threshold'],-r['margin']))[0]
 return best,sweep
