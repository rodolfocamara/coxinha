use super::*;
#[cfg(all(test, target_os = "linux"))]
mod audio_tests;
#[tauri::command]
#[specta::specta]
pub async fn library_list(state: State<'_, Library>) -> Result<Value, String> {
    state.ask(Action::List).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_sources() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "linux")]
        {
            coxinha_core::capture::list_sources()
                .and_then(|s| Ok(serde_json::to_value(s)?))
                .map_err(|e| format!("{e:#}"))
        }
        #[cfg(not(target_os = "linux"))]
        {
            Err("capture adapter unavailable on this platform".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
#[specta::specta]
pub async fn library_start(
    state: State<'_, Library>,
    title: String,
    mic_source: String,
    output_source: String,
) -> Result<Value, String> {
    state
        .ask(Action::Start {
            session: None,
            title,
            mic: mic_source,
            output: output_source,
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_status(state: State<'_, Library>) -> Result<Value, String> {
    state.ask(Action::Status).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_pause(state: State<'_, Library>, paused: bool) -> Result<Value, String> {
    state.ask(Action::Pause(paused)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_stop(state: State<'_, Library>) -> Result<Value, String> {
    state.ask(Action::Stop).await
}
async fn grant_audio(app: &tauri::AppHandle, detail: Value) -> Result<Value, String> {
    #[cfg(target_os = "linux")]
    {
        let transport = app
            .state::<std::sync::Arc<crate::native_audio::NativeAudio>>()
            .inner()
            .clone();
        tauri::async_runtime::spawn_blocking(move || transport.grant_detail(detail))
            .await
            .map_err(|_| "audio authorization task failed".to_string())?
            .map_err(|_| "audio authorization failed".to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        if let Some(audio) = detail["audio"].as_object() {
            for path in audio.values().filter_map(Value::as_str) {
                app.asset_protocol_scope()
                    .allow_file(path)
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(detail)
    }
}
#[tauri::command]
#[specta::specta]
pub async fn library_detail(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Value, String> {
    grant_audio(&app, state.ask(Action::Detail(meeting_id)).await?).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_recover(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Value, String> {
    grant_audio(&app, state.ask(Action::Recover(meeting_id)).await?).await
}

#[tauri::command]
#[specta::specta]
pub async fn library_process(
    state: State<'_, Library>,
    meeting_id: String,
    config: Value,
) -> Result<Value, String> {
    state.ask(Action::Process(meeting_id, config)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_processing(
    state: State<'_, Library>,
    meeting_id: String,
    job_id: Option<String>,
) -> Result<Value, String> {
    state.ask(Action::Processing(meeting_id, job_id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_create_person(
    state: State<'_, Library>,
    name: String,
    consent_origin: String,
) -> Result<Value, String> {
    state.ask(Action::CreatePerson(name, consent_origin)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_confirm_speaker(
    state: State<'_, Library>,
    job: String,
    speaker: String,
    person_id: String,
    human_origin: String,
    enroll: Option<bool>,
    track: Option<String>,
) -> Result<Value, String> {
    state
        .ask(Action::ConfirmSpeaker {
            job,
            speaker,
            person: person_id,
            origin: human_origin,
            enroll: enroll.unwrap_or(false),
            track,
        })
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_revoke_assignment(
    state: State<'_, Library>,
    assignment_id: String,
    human_origin: String,
) -> Result<Value, String> {
    state
        .ask(Action::RevokeAssignment(assignment_id, human_origin))
        .await
}
#[tauri::command]
#[specta::specta]
pub async fn library_edit_segment(
    state: State<'_, Library>,
    meeting_id: String,
    target: String,
    body: String,
) -> Result<Value, String> {
    state.ask(Action::Edit(meeting_id, target, body)).await
}

#[tauri::command]
#[specta::specta]
pub async fn library_import_audio(
    app: tauri::AppHandle,
    state: State<'_, Library>,
    title: String,
    path: String,
) -> Result<Value, String> {
    grant_audio(&app, state.ask(Action::ImportAudio(title, path)).await?).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_recognition(state: State<'_, Library>, job: String) -> Result<Value, String> {
    state.ask(Action::Recognition(job)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_participant_context(
    state: State<'_, Library>,
    meeting_id: String,
) -> Result<Value, String> {
    state.ask(Action::ParticipantContext(meeting_id)).await
}
#[tauri::command]
#[specta::specta]
pub async fn library_set_participant_context(
    state: State<'_, Library>,
    meeting_id: String,
    participants: Value,
) -> Result<Value, String> {
    state
        .ask(Action::SetParticipantContext(meeting_id, participants))
        .await
}
