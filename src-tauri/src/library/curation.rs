use super::*;
#[cfg(test)]
use coxinha_core::curation::CurationError;
use coxinha_core::curation::SelectedEnrollment;

pub(super) enum CurationAction {
    Candidates(String, String, String),
    Enroll(SelectedEnrollment),
    Profiles,
    ProfilesPage(Option<String>, Option<u32>),
    SamplesPage(String, Option<String>, Option<u32>),
    Samples(String),
    Revoke(String, String, String),
    Comparison(String),
}
impl Worker {
    pub(super) fn curation_action(&mut self, action: CurationAction) -> anyhow::Result<Value> {
        match action {
            CurationAction::Candidates(job, track, speaker) => {
                self.store.enrollment_candidates(&job, &track, &speaker)
            }
            CurationAction::Enroll(selection) => {
                anyhow::ensure!(
                    self.processing.is_none(),
                    "finish processing before voice enrollment"
                );
                #[cfg(target_os = "linux")]
                anyhow::ensure!(
                    self.active.is_none(),
                    "finish capture before voice enrollment"
                );
                self.store.enroll_selected_turns(&selection)
            }
            CurationAction::ProfilesPage(cursor, limit) => {
                self.curation
                    .pager
                    .profiles_page(&self.store, cursor.as_deref(), limit)
            }
            CurationAction::SamplesPage(person, cursor, limit) => {
                self.curation
                    .pager
                    .samples_page(&self.store, &person, cursor.as_deref(), limit)
            }
            CurationAction::Profiles => self.store.voice_profiles(),
            CurationAction::Samples(person) => self.store.person_samples(&person),
            CurationAction::Revoke(person, sample, origin) => {
                self.store.revoke_voice_sample(&person, &sample, &origin)?;
                Ok(Value::Null)
            }
            CurationAction::Comparison(job) => self.store.voice_comparison(&job),
        }
    }
}
#[tauri::command]
#[specta::specta]
pub async fn library_enrollment_candidates(
    state: State<'_, Library>,
    job: String,
    track: String,
    speaker: String,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::Candidates(
            job, track, speaker,
        )))
        .await
}
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn library_enroll_selected_turns(
    state: State<'_, Library>,
    job: String,
    track: String,
    speaker: String,
    assignment_id: String,
    person_id: String,
    expected_assignment_revision: i64,
    turn_ids: Vec<String>,
    human_origin: String,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::Enroll(
            SelectedEnrollment {
                job,
                track,
                speaker,
                assignment_id,
                person_id,
                expected_assignment_revision,
                turn_ids,
                human_origin,
            },
        )))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_voice_profiles(state: State<'_, Library>) -> Result<Value, String> {
    state.ask(Action::Curation(CurationAction::Profiles)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_person_samples(
    state: State<'_, Library>,
    person_id: String,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::Samples(person_id)))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_revoke_voice_sample(
    state: State<'_, Library>,
    person_id: String,
    sample_id: String,
    human_origin: String,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::Revoke(
            person_id,
            sample_id,
            human_origin,
        )))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_voice_comparison(
    state: State<'_, Library>,
    job: String,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::Comparison(job)))
        .await
}

#[cfg(test)]
mod tests;

#[tauri::command]
#[specta::specta]
pub async fn library_voice_profiles_page(
    state: State<'_, Library>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::ProfilesPage(
            cursor, limit,
        )))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_person_samples_page(
    state: State<'_, Library>,
    person_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    state
        .ask(Action::Curation(CurationAction::SamplesPage(
            person_id, cursor, limit,
        )))
        .await
}

#[cfg(test)]
#[path = "curation/concurrency_tests.rs"]
mod concurrency_tests;
