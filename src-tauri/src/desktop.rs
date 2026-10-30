//! Durable save-and-close. Timers signal delay, never authorize discard.
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};
mod protocol;
mod recovery;
mod shutdown;
use protocol::{ExitDecision, FlushReply};
use recovery::fallback;
use shutdown::complete_exit;

pub struct Desktop {
    busy: AtomicBool,
    pending: Mutex<Option<protocol::Pending>>,
    log: Mutex<PathBuf>,
    session: String,
}
impl Desktop {
    pub fn new(path: PathBuf) -> anyhow::Result<Self> {
        fs::create_dir_all(&path)?;
        let state = Self {
            busy: AtomicBool::new(false),
            pending: Mutex::new(None),
            log: Mutex::new(path.join("desktop.log")),
            session: uuid::Uuid::new_v4().to_string(),
        };
        state
            .record("session_started")
            .map_err(anyhow::Error::msg)?;
        Ok(state)
    }
    fn try_begin(&self) -> bool {
        !self.busy.swap(true, Ordering::SeqCst)
    }
    fn pending_guard(&self) -> std::sync::MutexGuard<'_, Option<protocol::Pending>> {
        self.pending.lock().unwrap_or_else(|poisoned| {
            tracing::warn!("desktop pending lock recovered after panic");
            self.pending.clear_poison();
            poisoned.into_inner()
        })
    }
    fn record(&self, category: &str) -> Result<(), String> {
        let path = self.log.lock().map_err(|_| "diagnostic lock unavailable")?;
        if fs::metadata(&*path).is_ok_and(|m| m.len() >= 256 * 1024) {
            let previous = path.with_extension("previous.log");
            match fs::remove_file(&previous) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("diagnostic rotation failed".into()),
            }
            fs::rename(&*path, previous).map_err(|_| "diagnostic rotation failed")?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&*path)
            .map_err(|_| "diagnostic file unavailable")?;
        writeln!(
            file,
            "{} session={} build={} category={}",
            chrono::Utc::now().to_rfc3339(),
            self.session,
            concat!(env!("CARGO_PKG_VERSION"), "/", env!("COXINHA_BUILD_ID")),
            category
        )
        .map_err(|_| "diagnostic write failed".into())
    }
}
#[tauri::command]
#[specta::specta]
pub fn desktop_diagnostic(
    category: String,
    line: Option<u32>,
    column: Option<u32>,
    state: State<'_, Desktop>,
) -> Result<(), String> {
    let safe = match category.as_str() {
        "frontend_error" | "frontend_rejection" | "save_failed" | "attachment_pending"
        | "root_render_error" => category.as_str(),
        _ => "frontend_unknown",
    };
    let location = format!(
        "{safe} source=bundled_frontend line={} column={}",
        line.unwrap_or(0),
        column.unwrap_or(0)
    );
    state.record(&location)
}
#[tauri::command]
#[specta::specta]
pub fn desktop_diagnostic_info(state: State<'_, Desktop>) -> Result<String, String> {
    Ok(format!(
        "{}\nsession={} build={}",
        state
            .log
            .lock()
            .map_err(|_| "diagnostic lock unavailable")?
            .display(),
        state.session,
        concat!(env!("CARGO_PKG_VERSION"), "/", env!("COXINHA_BUILD_ID"))
    ))
}

#[tauri::command]
#[specta::specta]
pub fn desktop_flush_started(request_id: String, state: State<'_, Desktop>) -> Result<(), String> {
    protocol::started(&mut state.pending_guard(), &request_id)
}
#[tauri::command]
#[specta::specta]
pub fn desktop_flush_result(
    request_id: String,
    success: bool,
    reason: Option<String>,
    state: State<'_, Desktop>,
) -> Result<(), String> {
    protocol::reply(
        &mut state.pending_guard(),
        &request_id,
        FlushReply::from_ipc(success, reason.as_deref()),
    )
}
#[tauri::command]
#[specta::specta]
pub fn desktop_recovery_response(
    app: AppHandle,
    request_id: String,
    recovery_id: String,
    action: String,
    state: State<'_, Desktop>,
) -> Result<(), String> {
    protocol::respond(
        &mut state.pending_guard(),
        &request_id,
        &recovery_id,
        &action,
    )?;
    // A native emergency may have disabled the owner. The UI has now mounted
    // its inert background and focus trap, so modal controls can safely work.
    if action == "presented" {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_enabled(true);
        }
    }
    Ok(())
}
fn abort(app: &AppHandle, id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_enabled(true);
    }
    let _ = app.emit("desktop-exit-aborted", id);
}
struct BusyReset<'a> {
    state: &'a Desktop,
    app: &'a AppHandle,
}
impl Drop for BusyReset<'_> {
    fn drop(&mut self) {
        if let Some(pending) = self.state.pending_guard().take() {
            abort(self.app, &pending.id);
        }
        self.state.busy.store(false, Ordering::SeqCst);
    }
}
pub fn request_exit(app: &AppHandle) {
    if !app.state::<Desktop>().try_begin() {
        return;
    }
    crate::window::show_main(app);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = handle.state::<Desktop>();
        let _busy = BusyReset {
            state: &state,
            app: &handle,
        };
        protocol::run(&NativeHost(&handle)).await;
    });
}
struct NativeHost<'a>(&'a AppHandle);
#[async_trait::async_trait]
impl protocol::Host for NativeHost<'_> {
    fn begin(
        &self,
    ) -> (
        String,
        tokio::sync::mpsc::UnboundedReceiver<protocol::Message>,
    ) {
        let id = uuid::Uuid::new_v4().to_string();
        let (send, receive) = tokio::sync::mpsc::unbounded_channel();
        *self.0.state::<Desktop>().pending_guard() = Some(protocol::Pending::new(id.clone(), send));
        (id, receive)
    }
    fn flush(&self, id: &str) {
        let _ = self.0.emit("desktop-flush", id);
    }
    fn recover(&self, id: &str, recovery_id: &str, reason: &str) {
        let state = self.0.state::<Desktop>();
        if let Some(pending) = state.pending_guard().as_mut() {
            pending.recovery = Some((recovery_id.into(), false));
        }
        let _ = state.record(reason);
        let _ = self.0.emit(
            "desktop-recovery",
            serde_json::json!({"requestId":id,"recoveryId":recovery_id,"reason":reason}),
        );
    }
    fn finish(&self, id: &str) {
        self.0.state::<Desktop>().pending_guard().take();
        abort(self.0, id);
    }
    async fn fallback(&self, reason: &str) -> ExitDecision {
        if let Some(pending) = self.0.state::<Desktop>().pending_guard().as_mut() {
            pending.recovery = None;
        }
        fallback(self.0, reason).await
    }
    async fn complete(&self, discard: bool) -> Result<(), String> {
        complete_exit(self.0, discard).await?;
        self.0.state::<Desktop>().pending_guard().take();
        Ok(())
    }
}
#[cfg(test)]
mod tests;
