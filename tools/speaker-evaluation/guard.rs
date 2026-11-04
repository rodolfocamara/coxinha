//! Real embeddings, isolated fresh public library, no policy API invocation.
use anyhow::{ensure,Result};
use coxinha_core::{identity::{EmbeddingSpace,MatchResult}, processing::{ProcessingConfig,ProcessingResult,SpeakerTurn},store::Store};
use serde_json::{json,Value};
use std::path::PathBuf;
fn main()->Result<()> {
 let out=PathBuf::from(std::env::args().nth(1).expect("evaluation output"));
 let config:ProcessingConfig=serde_json::from_slice(&std::fs::read(out.join("models.json"))?)?;
 let corpus:Value=serde_json::from_slice(&std::fs::read(out.join("corpus.json"))?)?;
 let enrollment:Value=serde_json::from_slice(&std::fs::read(out.join("enrollment-embeddings.json"))?)?;
 let heldout:Value=serde_json::from_slice(&std::fs::read(out.join("test-embeddings.json"))?)?;
 let person=corpus["rows"][0]["person"].as_str().unwrap();
 let train=corpus["rows"].as_array().unwrap().iter().find(|r|r["person"]==person && r["split"]=="enrollment").unwrap();
 let query=corpus["rows"].as_array().unwrap().iter().find(|r|r["person"]==person && r["split"]=="test").unwrap();
 let mut store=Store::open(out.join("guard-library"))?;
 let mut jobs=vec![];let mut vectors=vec![];
 let mut space=None;
 for (row,embeddings) in [(train,&enrollment),(query,&heldout)] {
  let vector:Vec<f32>=serde_json::from_value(embeddings["rows"].as_array().unwrap().iter().find(|r|r["id"]==row["id"]).unwrap()["embedding"].clone())?;
  let embedding_space=EmbeddingSpace {model:config.parameters["embedding_family"].as_str().unwrap().into(),
   revision:config.parameters["embedding_revision"].as_str().unwrap().into(),model_hash:config.models["embedding"].sha256.clone(),
   preprocessing:"pcm16-48k-fir97-7khz-decimate3-knf-fbank80-v1".into(),dimension:vector.len()};
  space=Some(embedding_space.clone());
  let meeting=store.import_audio("AMI isolated no-policy guard",&out.join(row["path"].as_str().unwrap()))?;
  let input=store.prepare_processing(&meeting,&config)?;ensure!(store.claim(&input.job)?,"job claim");
  store.commit_processing(&input,ProcessingResult {segments:vec![],warnings:vec!["Evaluation-only oracle embedding, not segmentation output".into()],
   turns:vec![SpeakerTurn {id:"evaluation-turn".into(),track:"imported".into(),start_ms:0,end_ms:4000,
       speaker:"oracle-person".into(),embedding:Some(vector.clone()),space:Some(embedding_space)}]})?;
  jobs.push(input.job);vectors.push(vector);
 }
 let identity=store.create_person(person,&[],"Public AMI annotation truth, isolated evaluation only")?;
 let assignment=store.confirm_processed_track_speaker(&jobs[0],"oracle-person",Some("imported"),&identity,"AMI annotation truth, evaluation only")?;
 let enrolled=store.enroll_processed_speaker(&assignment,&jobs[0],"oracle-person")?;
 ensure!(enrolled.len()==1,"one public sample enrolled");
 let space_id=store.register_space(&space.unwrap())?;
 let matched=store.match_voice(&space_id,&vectors[1],None)?;
 ensure!(matches!(&matched,MatchResult::Unknown{..}),"match must remain unknown");
 let recognized=store.recognition(&jobs[1])?;
 ensure!(recognized["calibrationStatus"]=="uncalibrated","uncalibrated");
 ensure!(recognized["speakers"].as_array().unwrap().len()==1,"non-vacuous recognition");
 ensure!(recognized["speakers"][0]["state"]=="unknown","recognition must remain unknown");
 let evidence=json!({"evaluation_only":true,"oracle_embedding_injection":true,"production_policy_api_called":false,
   "enrollment_clip":train["id"],"query_clip":query["id"],"enrolled_samples":enrolled.len(),
   "match_without_policy":matched,"recognition_without_policy":recognized});
 std::fs::write(out.join("no-policy-guard-evidence.json"),serde_json::to_vec_pretty(&evidence)?)?;
 println!("{evidence}");Ok(())
}
