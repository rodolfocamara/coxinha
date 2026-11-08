//! Library side effects of the follow policy: stopping with the call,
//! and the automatic start of spec 0097.
use super::{changed, lock, notify, plan, policy, policy::Command, AutoRecord, EndedWithCall};
use crate::library::Library;
use crate::storage::Storage;
use coxinha_core::store::session::NewSession;
use serde_json::{json, Value};
use shared::ActiveCall;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

struct Started {
    meeting: String,
    session: String,
    title: String,
    named_by_event: bool,
}

/// Spec 0118 P3: the same words for the native notice and the strip line.
pub(super) fn stop_notice(app: &str, locale: &str) -> (String, String) {
    (
        rust_i18n::t!("autoRecord.stopped", locale = locale).to_string(),
        rust_i18n::t!("autoRecord.stoppedBody", locale = locale, app = app).to_string(),
    )
}

pub(super) async fn execute(app: &AppHandle, command: Command) {
    let (stop, start) = match command {
        Command::Start(call) => (None, Some(call)),
        Command::Stop { meeting, app } => (Some((meeting, app)), None),
        Command::StopThenStart { meeting, app, call } => (Some((meeting, app)), Some(call)),
    };
    if let Some((meeting, label)) = stop {
        let library = app.state::<Library>();
        let still_ours = library
            .status_value()
            .await
            .is_ok_and(|s| s["active"]["meetingId"].as_str() == Some(meeting.as_str()));
        if still_ours && library.stop_capture().await.is_ok() {
            tracing::info!(app = %label, "recording stopped with its call");
            *lock(&app.state::<AutoRecord>().ended) = Some(EndedWithCall {
                meeting_id: meeting,
                app: label.clone(),
            });
            let (title, body) = stop_notice(&label, &rust_i18n::locale());
            if let Err(e) = crate::call_detector::notify_ended(app, title, body).await {
                tracing::warn!(error = %e, "recording stopped notification unavailable");
            }
        }
    }
    let Some(call) = start else {
        changed(app);
        return;
    };
    let state = app.state::<AutoRecord>();
    match begin(app, &call).await {
        Ok(started) => {
            if !started.named_by_event {
                crate::titles::watch::watch(
                    app.clone(),
                    started.session.clone(),
                    started.meeting.clone(),
                    started.title.clone(),
                );
            }
            lock(&state.policy).started(started.meeting, started.session, &call);
            notify(
                app,
                rust_i18n::t!("autoRecord.started", title = started.title).to_string(),
                rust_i18n::t!("autoRecord.startedBody", app = call.app_name).to_string(),
            );
        }
        Err(error) => {
            tracing::warn!("automatic recording did not start: {error}");
            lock(&state.policy).start_failed();
            notify(
                app,
                rust_i18n::t!("autoRecord.failed").to_string(),
                rust_i18n::t!("autoRecord.failedBody", app = call.app_name).to_string(),
            );
        }
    }
    changed(app);
}

async fn sources() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(any(target_os = "linux", windows))]
        {
            coxinha_core::capture::list_sources()
                .and_then(|s| Ok(serde_json::to_value(s)?))
                .map_err(|e| format!("{e:#}"))
        }
        #[cfg(not(any(target_os = "linux", windows)))]
        {
            Err::<Value, String>("capture adapter unavailable on this platform".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Devices, calendar title, session, start, invitees. Each step can fail
/// once; there is no retry loop and the strip prompt stays available.
async fn begin(app: &AppHandle, call: &ActiveCall) -> Result<Started, String> {
    let settings = lock(&app.state::<AutoRecord>().settings).clone();
    let devices = sources().await?;
    let mic = plan::pick_source(&devices, false, settings.mic_source.as_deref())
        .ok_or("no microphone")?;
    let output = plan::pick_source(&devices, true, settings.output_source.as_deref())
        .ok_or("no computer audio")?;
    let snapshot = crate::calendar::fresh(app).await;
    let event = plan::current_event(&snapshot.events, chrono::Utc::now()).cloned();
    let library = app.state::<Library>();
    let storage = app.state::<Arc<Storage>>().inner().clone();
    let reuse = match &event {
        Some(e) => plan::reusable_session(&library.session_list().await?, e),
        None => None,
    };
    let (session, title) = match (reuse, &event) {
        (Some(id), Some(e)) => (id, e.title.trim().to_owned()),
        _ => {
            let input = match &event {
                Some(e) => NewSession {
                    title: e.title.trim().to_owned(),
                    starts_at: plan::session_time(&e.starts_at),
                    ends_at: plan::session_time(&e.ends_at),
                    status: coxinha_core::store::session::SessionStatus::Planned,
                },
                None => NewSession::manual(
                    rust_i18n::t!("autoRecord.title", app = call.app_name).to_string(),
                ),
            };
            let title = input.title.clone();
            let created = library.create_session(&storage, input).await?;
            let id = created["id"].as_str().ok_or("session id missing")?;
            (id.to_owned(), title)
        }
    };
    let key = policy::call_key(call);
    let still = app
        .state::<crate::call_detector::Detector>()
        .active_calls()
        .iter()
        .any(|c| policy::call_key(c) == key);
    if !still {
        return Err("call ended before the capture started".into());
    }
    let started = library
        .start_session(&storage, &session, title.clone(), mic, output)
        .await?;
    let meeting = started["active"]["meetingId"]
        .as_str()
        .ok_or("capture was not acknowledged")?
        .to_owned();
    if let Some(e) = &event {
        let people = json!(plan::invitees(e));
        if let Err(error) = library.set_participants(&meeting, people).await {
            tracing::debug!("invitees not saved: {error}");
        }
    }
    Ok(Started {
        meeting,
        session,
        title,
        named_by_event: event.is_some(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_stop_notice_names_the_app_in_both_languages() {
        assert_eq!(
            super::stop_notice("Google Chrome", "pt-BR"),
            (
                "Gravação encerrada".to_string(),
                "O Coxinha parou junto com a chamada no Google Chrome.".to_string()
            )
        );
        assert_eq!(
            super::stop_notice("Google Chrome", "en").1,
            "Coxinha stopped together with the Google Chrome call."
        );
    }
}
