//! Isolated evaluation executable. No application store or production policy API.
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf};
mod identity {
    #[derive(Clone)]
    pub struct EmbeddingSpace {
        pub model: String, pub revision: String, pub model_hash: String,
        pub preprocessing: String, pub dimension: usize,
    }
}
mod processing {
    use super::*;
    pub struct Model { pub path: PathBuf, pub sha256: String }
    pub struct ProcessingConfig { pub models: BTreeMap<String, Model>, pub parameters: Value }
    pub struct SpeakerTurn {
        pub id: String, pub track: String, pub start_ms: u64, pub end_ms: u64,
        pub speaker: String, pub embedding: Option<Vec<f32>>, pub space: Option<identity::EmbeddingSpace>,
    }
    pub struct ProcessingResult { pub turns: Vec<SpeakerTurn> }
}
mod speech {
    pub mod dsp { include!(concat!(env!("EVAL_SNAPSHOT"), "/dsp.rs")); }
    pub mod diarization { include!(concat!(env!("EVAL_SNAPSHOT"), "/diarization.rs")); }
    pub fn extract(path: &std::path::Path) -> anyhow::Result<Vec<f32>> { dsp::normalize(path, 120) }
    pub fn diagnose(config: &crate::processing::ProcessingConfig, samples: &[f32]) -> anyhow::Result<crate::processing::ProcessingResult> {
        let mut result = crate::processing::ProcessingResult { turns: vec![] };
        if !samples.iter().all(|s| *s == 0.) {
            diarization::Diarizer::new(config)?.process(samples, "evaluation", &mut result)?;
        }
        Ok(result)
    }
}
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    ensure!(args.len()==5, "extract <models.json> <input-list.json> <output.json> <oracle|segmentation>");
    let config_json: Value = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let mut models = BTreeMap::new();
    for key in ["embedding","segmentation","onnxruntime"] {
        models.insert(key.into(), processing::Model {
            path: config_json["models"][key]["path"].as_str().context("model path")?.into(),
            sha256: config_json["models"][key]["sha256"].as_str().context("model hash")?.into(),
        });
    }
    // Parent validates the pinned runtime hash before this process starts.
    let config=processing::ProcessingConfig { models, parameters:config_json["parameters"].clone() };
    let list: Value = serde_json::from_slice(&std::fs::read(&args[2])?)?;
    let mode=&args[4];
    let mut extractor = if mode=="oracle" {
        Some(pyannote_rs::EmbeddingExtractor::new(&config.models["embedding"].path)
             .map_err(|e| anyhow::anyhow!("{e}"))?)
    } else { ensure!(mode=="segmentation", "invalid mode"); None };
    let mut rows=vec![];
    for item in list.as_array().context("input list")? {
        let path=PathBuf::from(item["path"].as_str().context("audio path")?);
        let samples=speech::extract(&path)?;
        let rms=(samples.iter().map(|v|v*v).sum::<f32>()/samples.len() as f32).sqrt();
        let mut row=json!({"id":item["id"],"samples16k":samples.len(),"rms":rms});
        if let Some(extractor)=extractor.as_mut() {
            if samples.iter().all(|s| *s==0.) { row["embedding"]=Value::Null;row["reason"]=json!("digital_silence"); }
            else {
                let pcm: Vec<i16> = samples.iter().map(|v| (v.clamp(-1.0,32767.0/32768.0)*32768.0).round() as i16).collect();
                let mut vector: Vec<f32> = extractor.compute(&pcm).map_err(|e|anyhow::anyhow!("{e}"))?.collect();
                ensure!(!vector.is_empty() && vector.iter().all(|v|v.is_finite()), "invalid embedding");
                let norm=vector.iter().map(|v|v*v).sum::<f32>().sqrt();
                ensure!(norm.is_finite() && norm>1e-8, "zero norm");
                for v in &mut vector { *v/=norm; }
                row["embedding"]=json!(vector);
            }
        } else {
            let result=speech::diagnose(&config,&samples)?;
            row["turns"]=json!(result.turns.iter().map(|t|json!({"track":t.track,"speaker":t.speaker,
                "start_ms":t.start_ms,"end_ms":t.end_ms,"embedding":t.embedding,
                "space":t.space.as_ref().map(|s| json!({"model":s.model,"revision":s.revision,
                  "model_hash":s.model_hash,"preprocessing":s.preprocessing,"dimension":s.dimension}))})).collect::<Vec<_>>());
        }
        eprintln!("{} {}",mode,item["id"]);
        rows.push(row);
    }
    std::fs::write(&args[3],serde_json::to_vec_pretty(&json!({"evaluation_only":true,"mode":mode,"rows":rows}))?)?;
    Ok(())
}
