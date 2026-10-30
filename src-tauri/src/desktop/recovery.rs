//! Emergency only: parent is best effort; the OS/compositor controls final placement.
use super::*;
use rust_i18n::t;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};
pub(super) fn decision(answer: MessageDialogResult) -> ExitDecision {
    if answer == MessageDialogResult::Yes
        || answer == MessageDialogResult::Custom(t!("desktop.retry").into_owned())
    {
        ExitDecision::Retry
    } else if answer == MessageDialogResult::No
        || answer == MessageDialogResult::Custom(t!("desktop.discardExit").into_owned())
    {
        ExitDecision::PreserveRawAndExit
    } else {
        ExitDecision::Cancel
    }
}
fn native_exit_dialog(
    app: &AppHandle,
    message: String,
) -> tauri_plugin_dialog::MessageDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().message(message).title("Coxinha");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_enabled(false);
        dialog.parent(&window)
    } else {
        dialog
    }
}
pub(super) async fn fallback(app: &AppHandle, reason: &str) -> ExitDecision {
    let _ = app.state::<Desktop>().record(reason);
    let details = desktop_diagnostic_info(app.state::<Desktop>()).unwrap_or_default();
    let message = format!(
        "{}\n\n{}\n\n{}",
        t!(match reason {
            "flush_delayed" => "desktop.delayed",
            "attachment_pending" => "desktop.attachmentPending",
            "save_failed" => "desktop.saveFailed",
            _ => "desktop.failed",
        }),
        t!("desktop.discardWarning"),
        details
    );
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    native_exit_dialog(app, message)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            t!("desktop.retry").into_owned(),
            t!("desktop.discardExit").into_owned(),
            t!("desktop.cancel").into_owned(),
        ))
        .show_with_result(move |answer| {
            // Some native dialog backends restore their owner on close; keep it locked until cancel/abort.
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.set_enabled(false);
            }
            let _ = send.send(decision(answer));
        });
    receive.await.unwrap_or(ExitDecision::Cancel)
}
