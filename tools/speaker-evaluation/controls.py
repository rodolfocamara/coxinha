"""Separate real-audio/constructed controls for copied production segmentation."""
import argparse,json,math,struct,wave
from pathlib import Path
from collections import defaultdict
from contract import write_json,digest,verify_file,verify_models,PREPROCESSING
from evaluate import run_extract,distribution,frozen_verify

def wav_write(path,pcm):
 with wave.open(str(path),'wb') as w:w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(pcm)

def union(intervals):
 out=[]
 for a,b in sorted(intervals):
  if out and a<=out[-1][1]:out[-1][1]=max(out[-1][1],b)
  else:out.append([a,b])
 return sum(b-a for a,b in out)

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args();out=Path(a.out).resolve()
 config=json.loads((out/'models.json').read_text());verify_models(config,PREPROCESSING)
 freeze=json.loads((out/'freeze.json').read_text());frozen_verify(out,freeze)
 rows=json.loads((out/'corpus.json').read_text())['rows'];test=[r for r in rows if r['split']=='test' and not r['unknown']]
 for r in test:verify_file(out/r['path'],r['sha256'])
 controls=out/'controls';controls.mkdir(exist_ok=True)
 silent=controls/'silence.wav';wav_write(silent,bytes(4*48000*2))
 # 50/50 sum of two held-out people. This artificial overlap is a challenge
 # control, never an unknown-person test or an acoustic-quality estimate.
 first=test[0];second=next(r for r in test if r['person']!=first['person'])
 def read(r):
  with wave.open(str(out/r['path']),'rb') as w:return w.readframes(w.getnframes())
 p1=read(first);p2=read(second)
 mixed=b''.join(struct.pack('<h',round((x[0]+y[0])/2)) for x,y in zip(struct.iter_unpack('<h',p1),struct.iter_unpack('<h',p2)))
 mix=controls/'constructed-overlap.wav';wav_write(mix,mixed)
 control_rows=[dict(id='digital-silence',path=str(silent.relative_to(out))),dict(id='constructed-overlap',path=str(mix.relative_to(out)))]
 # Controlled recurrence within a session, real speech in artificial order.
 # Track-local clustering stays intact across clips, so fragmentation is visible.
 truths={}
 for session in sorted({r['session'] for r in test}):
  selected=[r for r in test if r['session']==session]
  selected=sorted(selected,key=lambda r:(r['id'][-1],r['person']))
  pcm=b'';truth=[]
  for r in selected:
   start=len(pcm)//96;pcm+=read(r);end=len(pcm)//96
   truth.append(dict(start_ms=start,end_ms=end,person=r['person'],source_id=r['id']))
   pcm+=bytes(48000*2)
  f=controls/(session+'-clean-assembly.wav');wav_write(f,pcm)
  label=session+'-clean-assembly';control_rows.append(dict(id=label,path=str(f.relative_to(out))));truths[label]=truth
 provenance=dict(evaluation_only=True,synthetic_test_only=False,constructed_structure=True,
   overlap_sources=[first['id'],second['id']],assembly_truth=truths,
   rows=[dict(r,sha256=digest(out/r['path'])) for r in control_rows])
 write_json(out/'controls-provenance.json',provenance)
 result=run_extract(out,config,control_rows,'segmentation-controls','segmentation')
 clean_result=run_extract(out,config,test,'segmentation-clean-test','segmentation')
 report=dict(evaluation_only=True,scope='copied production segmentation+greedy clustering; oracle-excerpt and constructed controls only; not unmodified meeting DER',
    clean_excerpts=len(clean_result),clean_total_ms=len(clean_result)*4000,
    clean_detected_union_ms=sum(union([(t['start_ms'],t['end_ms']) for t in r['turns']]) for r in clean_result),
    clean_embedded_union_ms=sum(union([(t['start_ms'],t['end_ms']) for t in r['turns'] if t['embedding']]) for r in clean_result),
    clean_turns=sum(len(r['turns']) for r in clean_result),clean_embedded_turns=sum(bool(t['embedding']) for r in clean_result for t in r['turns']),
    assemblies={})
 for r in result:
  if r['id'] not in truths:
   report[r['id']]=dict(turns=len(r['turns']),embedded_turns=sum(bool(t['embedding']) for t in r['turns']),
    speakers=sorted({t['speaker'] for t in r['turns']}));continue
  truth=truths[r['id']];overlap=defaultdict(lambda:defaultdict(int));unknown=0
  for t in r['turns']:
   for ref in truth:
    n=max(0,min(t['end_ms'],ref['end_ms'])-max(t['start_ms'],ref['start_ms']))
    if t['speaker']=='unknown':unknown+=n
    else:overlap[t['speaker']][ref['person']]+=n
  # Dominant identity per anonymous cluster by overlap; a cluster can be impure.
  dominant={c:max(by_person,key=by_person.get) for c,by_person in overlap.items()}
  fragments={person:sorted(c for c,p in dominant.items() if p==person) for person in {v['person'] for v in truth}}
  report['assemblies'][r['id']]=dict(truth_speech_ms=sum(t['end_ms']-t['start_ms'] for t in truth),
    cluster_overlap_ms=dict(overlap),dominant_cluster_identity=dominant,clusters_per_person={p:len(c) for p,c in fragments.items()},
    excess_fragments=sum(max(0,len(c)-1) for c in fragments.values()),unknown_overlap_ms_with_multiplicity=unknown,
    note='four known people, two 4s oracle-clean clips each, 1s gaps; different cluster counts are not different people')
 report['clean_detection_coverage']=report['clean_detected_union_ms']/report['clean_total_ms']
 report['clean_embedding_coverage']=report['clean_embedded_union_ms']/report['clean_total_ms']
 write_json(out/'segmentation-evidence.json',report)
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()
