"""Synthetic correctness tests. These are not acoustic evidence."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from contract import (validate_split,verify_file,verify_models,PREPROCESSING,PINS,candidate,cosine,metrics)

class ContractTests(unittest.TestCase):
 def rows(self):
  result=[]
  for i,(split,session,person,unknown) in enumerate([
   ('enrollment','known-a','p',False),('calibration','known-b','p',False),
   ('test','known-c','p',False),('calibration','unknown-a','u1',True),('test','unknown-b','u2',True)]):
   result.append(dict(id=str(i),pcm_sha256=str(i),split=split,session=session,person=person,unknown=unknown,
      start_sample=0,end_sample=64000,source_url='public/'+session))
  return result
 def test_valid_disjoint_recurring_people(self):validate_split(self.rows())
 def test_session_leakage(self):
  r=self.rows();r[2]['session']=r[0]['session']
  with self.assertRaisesRegex(ValueError,'session leakage'):validate_split(r)
 def test_same_source_overlap(self):
  r=self.rows();r[2]['source_url']=r[0]['source_url']
  with self.assertRaisesRegex(ValueError,'source interval overlap'):validate_split(r)
 def test_duplicate_content_under_new_name(self):
  r=self.rows();r[2]['pcm_sha256']=r[0]['pcm_sha256']
  with self.assertRaisesRegex(ValueError,'duplicate source content'):validate_split(r)
 def test_unknown_person_leakage(self):
  r=self.rows();r[-1]['person']='u1'
  with self.assertRaisesRegex(ValueError,'unknown person leakage'):validate_split(r)
 def test_known_claimed_unknown(self):
  r=self.rows();r[-1]['person']='p'
  with self.assertRaisesRegex(ValueError,'known unknown leakage'):validate_split(r)
 def test_corrupt_hash(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'public';p.write_bytes(b'changed public content')
   with self.assertRaisesRegex(ValueError,'checksum mismatch'):verify_file(p,'0'*64)
 def test_wrong_preprocessing(self):
  with self.assertRaisesRegex(ValueError,'wrong preprocessing'):verify_models({},'different-fbank')
 def test_wrong_model_hash(self):
  config={'models':{'embedding':{'sha256':'wrong','path':'not-opened'}}}
  with self.assertRaisesRegex(ValueError,'wrong model'):verify_models(config,PREPROCESSING)
 def test_missing_recurrence(self):
  r=self.rows();r[2]['person']='other'
  with self.assertRaisesRegex(ValueError,'missing recurrence'):validate_split(r)
 def test_nonfinite_or_wrong_dimension_rejected(self):
  for a,b in [([float('nan')],[1]),([1],[1,0]),([0],[0])]:
   with self.assertRaises(ValueError):cosine(a,b)
 def test_calibration_deterministic_and_order_independent(self):
  rows=[dict(id='k',unknown=False,person='p',best_person='p',best=.8,margin=.3),
        dict(id='u',unknown=True,person='u',best_person='p',best=.6,margin=.1)]
  criteria={'threshold_grid':[.5,.7,.8,.9],'margin_grid':[0,.1,.2]}
  first,sweep=candidate(rows,criteria)
  for _ in range(10):self.assertEqual(first,candidate(list(reversed(rows)),criteria)[0])
  self.assertEqual((first['threshold'],first['margin']),(.8,.2))
  self.assertEqual(len(sweep),12)
 def test_margin_boundary_strict(self):
  rows=[dict(unknown=False,person='p',best_person='p',best=.8,margin=.2)]
  self.assertEqual(metrics(rows,.8,.2)['false_rejections'],1)
 def test_no_calibration_without_unknowns(self):
  with self.assertRaisesRegex(ValueError,'unknowns'):candidate([{'unknown':False}],{})
if __name__=='__main__':unittest.main()
