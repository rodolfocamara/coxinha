use super::*;
impl Worker {
    pub(super) fn detail(&self, id: &str) -> anyhow::Result<Value> {
        #[cfg(target_os = "linux")]
        anyhow::ensure!(
            self.active.as_ref().is_none_or(|a| a.id == id),
            "stop active capture before verifying another recording"
        );
        uuid::Uuid::parse_str(id)?;
        let meeting = self
            .store
            .meeting_summaries()?
            .into_iter()
            .find(|m| m["id"] == id)
            .ok_or_else(|| anyhow::anyhow!("meeting not found"))?;
        let directory = self.store.root.join("raw").join(id);
        let manifest: Option<CaptureManifest> =
            match std::fs::File::open(directory.join("manifest.json")) {
                Ok(file) => Some(serde_json::from_reader(file)?),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                Err(e) => return Err(e.into()),
            };
        let mut audio = Value::Null;
        if let Some(m) = &manifest {
            anyhow::ensure!(
                matches!(m.version, 1 | 2) && m.meeting == id,
                "invalid manifest"
            );
            if self.processing.is_none()
                && matches!(m.state.as_str(), "finished" | "interrupted")
                && m.tracks.iter().all(|t| t.sha256.is_some())
            {
                let paths = m.verified_tracks(&self.store.root)?;
                let mut per_track = serde_json::Map::new();
                for (i, path) in paths.iter().enumerate() {
                    per_track.insert(m.track_id(i)?.into(), json!(path));
                }
                audio = Value::Object(per_track);
            }
        }
        let storage = super::recording_storage::snapshot(&self.store.root, id, manifest.as_ref());
        Ok(
            json!({"meeting":meeting,"manifest":manifest,"audio":audio,"storage":storage,"inference":if cfg!(feature="local-processing") {"local"} else {"unavailable"}}),
        )
    }
}
