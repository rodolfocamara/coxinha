"""Fetch bounded AMI byte ranges; derive identity from official annotations."""
import argparse
import datetime
import io
import json
import struct
import subprocess
import urllib.request
import wave
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from contract import digest, write_json, validate_split, PREPROCESSING, verify_models

BASE='https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus'
NITE='{http://nite.sourceforge.net/}'
SESSIONS={'ES2004a':'enrollment','ES2004b':'calibration','ES2004c':'test','ES2004d':'test',
          'ES2005b':'calibration','ES2006a':'test'}
MAX_BYTES=1024**3

class Fetcher:
 def __init__(self,out):
  self.out=out;self.records=[];self.total=0;self.cache={}
  if (out/'downloads.json').exists():
   old=json.loads((out/'downloads.json').read_text());self.records=old['requests'];self.total=old['total_audio_bytes']
  import hashlib
  # Resume only previously verified public data; include abandoned-selection bytes.
  for f in (out/'audio').glob('*-16k.wav'):
   with wave.open(str(f),'rb') as w: raw=w.readframes(w.getnframes())
   self.cache[hashlib.sha256(raw).hexdigest()]=raw
  for f in (out/'provenance').glob('*.wav-header.bin'):
   raw=f.read_bytes();self.cache[hashlib.sha256(raw).hexdigest()]=raw
 def get(self,url,start,end):
  for record in self.records:
   if record['url']==url and record['start']==start and record['end']==end and record['sha256'] in self.cache:
    return self.cache[record['sha256']]
  request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}','Accept-Encoding':'identity'})
  with urllib.request.urlopen(request,timeout=45) as response:
   expected=f'bytes {start}-{end}/'
   if response.status!=206 or not response.headers.get('Content-Range','').startswith(expected):
    raise ValueError('server did not honor exact byte range')
   n=end-start+1
   if self.total+n>MAX_BYTES: raise ValueError('download cap')
   data=response.read(n+1)
   if len(data)!=n: raise ValueError('range length mismatch')
   self.total+=n
   import hashlib
   self.records.append(dict(url=url,start=start,end=end,bytes=n,sha256=hashlib.sha256(data).hexdigest(),
       content_range=response.headers['Content-Range'],last_modified=response.headers.get('Last-Modified'),
       etag=response.headers.get('ETag'),retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat()))
   write_json(self.out/'downloads.json',dict(evaluation_only=True,total_audio_bytes=self.total,requests=self.records))
   return data

def merge(intervals,gap=0):
 out=[]
 for a,b in sorted(intervals):
  if out and a<=out[-1][1]+gap: out[-1][1]=max(out[-1][1],b)
  else: out.append([a,b])
 return out

def clean_intervals(own,others):
 out=[]
 for a,b in own:
  pieces=[[a,b]]
  for x,y in others:
   x-=0.1;y+=0.1;new=[]
   for p,q in pieces:
    if y<=p or x>=q: new.append([p,q])
    else:
     if x>p: new.append([p,x])
     if y<q: new.append([y,q])
   pieces=new
  out.extend(p for p in pieces if p[1]-p[0]>=4.2)
 return out

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',required=True);p.add_argument('--models',required=True);args=p.parse_args()
 out=Path(args.out).resolve();(out/'audio').mkdir(exist_ok=True)
 config=json.loads(Path(args.models).read_text());verify_models(config,PREPROCESSING)
 z=zipfile.ZipFile(out/'provenance/ami_public_manual_1.6.2.zip')
 meetings=ET.fromstring(z.read('corpusResources/meetings.xml'))
 fetch=Fetcher(out);rows=[];mappings=[]
 for session,split in SESSIONS.items():
  meeting=next(m for m in meetings if m.get('observation')==session)
  speakers=sorted(list(meeting),key=lambda s:s.get('nxt_agent'))
  segs={}; words={}
  for sp in speakers:
   agent=sp.get('nxt_agent')
   for kind in ['segments','words']:
    name=f'{kind}/{session}.{agent}.{kind}.xml';raw=z.read(name)
    target=out/'provenance'/name;target.parent.mkdir(exist_ok=True);target.write_bytes(raw)
    root=ET.fromstring(raw)
    if kind=='segments':
     values=[]
     for s in root:
      if s.tag=='segment':
       if s.get('channel')!=sp.get('channel'): raise ValueError('annotation/channel mismatch')
       values.append((float(s.get('transcriber_start')),float(s.get('transcriber_end'))))
     segs[agent]=values
    else:
     words[agent]=[(float(w.get('starttime')),float(w.get('endtime'))) for w in root
                    if w.tag=='w' and w.get('punc')!='true' and w.get('starttime') and float(w.get('endtime'))>float(w.get('starttime'))]
  url=f'{BASE}/{session}/audio/{session}.Mix-Headset.wav'
  header=fetch.get(url,0,4095);(out/'provenance'/f'{session}.wav-header.bin').write_bytes(header)
  if header[:4]!=b'RIFF' or header[8:12]!=b'WAVE': raise ValueError('not RIFF WAVE')
  pos=12;fmt=None;offset=None
  while pos+8<=len(header):
   name=header[pos:pos+4];size=struct.unpack_from('<I',header,pos+4)[0]
   if name==b'fmt ': fmt=struct.unpack_from('<HHIIHH',header,pos+8)
   if name==b'data': offset=pos+8;break
   pos+=8+size+(size%2)
  if fmt!=(1,1,16000,32000,2,16) or offset is None: raise ValueError(f'unsupported WAV {fmt}')
  for sp in speakers:
   agent=sp.get('nxt_agent');person=sp.get('global_name')
   mappings.append(dict(session=session,date=meeting.get('dateOnly'),start_time=meeting.get('startTime'),
       agent=agent,person=person,annotation_channel=sp.get('channel'),source_channel='Mix-Headset',
       evidence_nite_id=sp.get(NITE+'id'),evidence_file='provenance/meetings.xml'))
   others=merge([s for a,v in segs.items() if a!=agent for s in v])
   chosen=[]
   for a,b in clean_intervals(segs[agent],others):
    # Fixed 4 seconds, 100 ms inside clean annotation; >=65% lexical coverage.
    begin=round((a+0.1)*16000);end=begin+64000
    coverage=sum(max(0,min(y,end/16000)-max(x,begin/16000)) for x,y in merge(words[agent]))/4
    if coverage<0.65 or any(begin<y and end>x for x,y in chosen): continue
    chosen.append((begin,end))
    clip_id=f'{session}-{person}-{len(chosen)}';raw=fetch.get(url,offset+2*begin,offset+2*end-1)
    wav=out/'audio'/f'{clip_id}-16k.wav'
    with wave.open(str(wav),'wb') as w: w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(raw)
    target=out/'audio'/f'{clip_id}-48k.wav'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-i',str(wav),'-ar','48000','-ac','1','-c:a','pcm_s16le',str(target)],check=True,timeout=30)
    import hashlib
    rows.append(dict(id=clip_id,split=split,session=session,person=person,agent=agent,
       annotation_channel=sp.get('channel'),source_channel='Mix-Headset',unknown=not session.startswith('ES2004'),
       start_sample=begin,end_sample=end,source_sample_rate=16000,source_url=url,
       pcm_sha256=hashlib.sha256(raw).hexdigest(),wav16_path=str(wav.relative_to(out)),wav16_sha256=digest(wav),
       path=str(target.relative_to(out)),sha256=digest(target),lexical_coverage=coverage))
    if len(chosen)==2:break
   if len(chosen)!=2: raise ValueError(f'not enough clean excerpts: {session} {person}')
  print(session,'excerpts',len(rows),flush=True)
 validate_split(rows)
 write_json(out/'corpus.json',dict(evaluation_only=True,synthetic_test_only=False,corpus='AMI manual 1.6.2',
      license='CC-BY-4.0',source='https://groups.inf.ed.ac.uk/ami/corpus/',rows=rows))
 write_json(out/'participant-mappings.json',mappings)
 write_json(out/'models.json',config)
 write_json(out/'criteria.json',dict(evaluation_only=True,preprocessing=PREPROCESSING,
   threshold_grid=[round(.30+.02*i,2) for i in range(31)],margin_grid=[round(.02*i,2) for i in range(11)],
   selection='zero calibration FA and misidentification; max correct; highest threshold; highest margin',
   excerpt_selection='first 2 disjoint 4s clips per person/session; 100ms guard; >=65% lexical annotation coverage; subtract other-speaker segments expanded 100ms',
   scoring='max cosine over 2 enrollment samples per person; accept best>=threshold and best-runnerup>margin',
   production_adequacy_gates=dict(minimum_independent_unknown_people=100,minimum_independent_known_people=100,
      minimum_recording_days_per_person=3,required_domains=['PT-BR','Teams','multiple microphones'],
      maximum_unknown_FA_95_upper=.01,minimum_known_recall=.9),
   policy_installation=False))
if __name__=='__main__':main()
