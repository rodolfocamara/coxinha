//! Audio recorder.
//!
//! Captures mic + system loopback simultaneously and mixes them into
//! a 16kHz mono WAV (ideal format for Parakeet/Whisper).
//!
//! F1 TODO:
//! - [ ] Real `cpal` mic capture
//! - [ ] WASAPI loopback capture via the `wasapi` crate (Windows)
//! - [ ] Resampler to 16kHz when the native device runs at a different rate
//! - [ ] Stream mixer
//! - [ ] Chunked writes (crash resilience)

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use shared::*;
use uuid::Uuid;

use crate::db::Db;

pub struct Recorder {
    vault: PathBuf,
    db: Arc<Db>,
    current: Option<ActiveRecording>,
}

struct ActiveRecording {
    meeting_id: Uuid,
    #[allow(dead_code)]
    started_at: chrono::DateTime<Utc>,
    #[allow(dead_code)]
    output_path: PathBuf,
    // TODO: cpal + wasapi stream handles
}

impl Recorder {
    pub fn new(vault: PathBuf, db: Arc<Db>) -> Self {
        Self {
            vault,
            db,
            current: None,
        }
    }

    pub async fn start(&mut self, title: &str) -> Result<Uuid> {
        if self.current.is_some() {
            anyhow::bail!("already recording");
        }

        let id = Uuid::new_v4();
        let meeting_dir = self.vault.join("meetings").join(id.to_string());
        tokio::fs::create_dir_all(&meeting_dir).await?;
        let output_path = meeting_dir.join("recording.wav");

        // Persist the "in-progress" meeting
        let meeting = Meeting {
            id,
            title: title.to_string(),
            started_at: Utc::now(),
            ended_at: None,
            duration_seconds: None,
            participants: Vec::new(),
            recording_path: Some(output_path.display().to_string()),
            has_transcript: false,
            has_summary: false,
            source_app: None,
        };
        self.db.upsert_meeting(&meeting)?;

        // TODO: start cpal input stream + wasapi loopback
        // Write metadata.json alongside
        let metadata = serde_json::json!({
            "id": id,
            "title": title,
            "started_at": meeting.started_at,
        });
        tokio::fs::write(
            meeting_dir.join("metadata.json"),
            serde_json::to_string_pretty(&metadata)?,
        )
        .await?;

        self.current = Some(ActiveRecording {
            meeting_id: id,
            started_at: Utc::now(),
            output_path,
        });

        tracing::info!("started recording meeting {}", id);
        Ok(id)
    }

    pub async fn stop(&mut self) -> Result<Meeting> {
        let rec = self
            .current
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("not recording"))?;
        let ended = Utc::now();
        let meeting_id = rec.meeting_id;

        // TODO: drop cpal/wasapi streams, finalize WAV file

        let mut m = self
            .db
            .get_meeting(meeting_id)?
            .ok_or_else(|| anyhow::anyhow!("meeting vanished"))?;
        m.ended_at = Some(ended);
        m.duration_seconds = Some((ended - m.started_at).num_seconds().max(0) as u32);
        self.db.upsert_meeting(&m)?;
        self.current = None;

        tracing::info!("stopped recording meeting {}", meeting_id);
        Ok(m)
    }

    /// Used by the tray toggle (spec 0007) to decide whether
    /// `Ctrl+Alt+R` should start or stop a recording.
    #[allow(dead_code)]
    pub fn is_recording(&self) -> bool {
        self.current.is_some()
    }
}
