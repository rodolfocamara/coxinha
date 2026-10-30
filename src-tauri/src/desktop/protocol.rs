//! UI receipt, durable completion and recovery choices are distinct messages.
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FlushFailure {
    AttachmentPending,
    SaveFailed,
}
impl FlushFailure {
    fn category(self) -> &'static str {
        match self {
            Self::AttachmentPending => "attachment_pending",
            Self::SaveFailed => "save_failed",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FlushReply {
    Saved,
    Failed(FlushFailure),
}
impl FlushReply {
    pub(super) fn from_ipc(success: bool, reason: Option<&str>) -> Self {
        if success {
            Self::Saved
        } else {
            Self::Failed(match reason {
                Some("attachment_pending") => FlushFailure::AttachmentPending,
                _ => FlushFailure::SaveFailed,
            })
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ExitDecision {
    Retry,
    PreserveRawAndExit,
    Cancel,
}
#[derive(Debug)]
pub(super) enum Message {
    Started,
    Flush(FlushReply),
    Presented,
    Choice(ExitDecision),
}
pub(super) struct Pending {
    pub id: String,
    send: UnboundedSender<Message>,
    started: bool,
    replied: bool,
    pub recovery: Option<(String, bool)>,
}
impl Pending {
    pub fn new(id: String, send: UnboundedSender<Message>) -> Self {
        Self {
            id,
            send,
            started: false,
            replied: false,
            recovery: None,
        }
    }
}
fn active<'a>(pending: &'a mut Option<Pending>, id: &str) -> Result<&'a mut Pending, String> {
    pending
        .as_mut()
        .filter(|p| p.id == id)
        .ok_or_else(|| "inactive desktop request".into())
}
pub(super) fn started(pending: &mut Option<Pending>, id: &str) -> Result<(), String> {
    let p = active(pending, id)?;
    if !p.started {
        p.started = true;
        p.send
            .send(Message::Started)
            .map_err(|_| "desktop receiver closed")?;
    }
    Ok(())
}
pub(super) fn reply(
    pending: &mut Option<Pending>,
    id: &str,
    reply: FlushReply,
) -> Result<(), String> {
    let p = active(pending, id)?;
    if !p.started || p.replied {
        return Err("unexpected desktop completion".into());
    }
    p.replied = true;
    p.send
        .send(Message::Flush(reply))
        .map_err(|_| "desktop receiver closed".into())
}
pub(super) fn respond(
    pending: &mut Option<Pending>,
    id: &str,
    recovery: &str,
    action: &str,
) -> Result<(), String> {
    let p = active(pending, id)?;
    let presented = &mut p
        .recovery
        .as_mut()
        .filter(|(r, _)| r == recovery)
        .ok_or("inactive desktop recovery")?
        .1;
    let message = match action {
        "presented" if !*presented => {
            *presented = true;
            Message::Presented
        }
        "retry" if *presented => Message::Choice(ExitDecision::Retry),
        "cancel" if *presented => Message::Choice(ExitDecision::Cancel),
        "discard" if *presented => Message::Choice(ExitDecision::PreserveRawAndExit),
        _ => return Err("invalid desktop recovery action".into()),
    };
    if action != "presented" {
        p.recovery = None;
    }
    p.send
        .send(message)
        .map_err(|_| "desktop receiver closed".into())
}
#[async_trait::async_trait]
pub(super) trait Host: Sync {
    fn begin(&self) -> (String, UnboundedReceiver<Message>);
    fn flush(&self, id: &str);
    fn recover(&self, id: &str, recovery_id: &str, reason: &str);
    fn finish(&self, id: &str);
    #[must_use = "Await the emergency fallback to obtain the explicit exit decision."]
    async fn fallback(&self, reason: &str) -> ExitDecision;
    #[must_use = "Await shutdown completion and handle failure before exiting."]
    async fn complete(&self, discard: bool) -> Result<(), String>;
}
pub(super) async fn run(host: &impl Host) {
    run_with_deadlines(host, Duration::from_secs(30), Duration::from_secs(3)).await
}
pub(super) async fn run_with_deadlines(host: &impl Host, delay: Duration, emergency: Duration) {
    'retry: loop {
        let (id, mut receive) = host.begin();
        host.flush(&id);
        let mut started = false;
        let mut reply = None;
        let deadline = tokio::time::sleep(delay);
        tokio::pin!(deadline);
        let mut resend = tokio::time::interval(Duration::from_millis(250));
        loop {
            tokio::select! {
                message = receive.recv() => match message {
                    Some(Message::Started) => started = true,
                    Some(Message::Flush(value)) => { reply = Some(value); break; },
                    None => break,
                    _ => {},
                },
                _ = resend.tick(), if !started => host.flush(&id),
                _ = &mut deadline => break,
            }
        }
        loop {
            let reason = match reply {
                Some(FlushReply::Saved) => match host.complete(false).await {
                    Ok(()) => return,
                    Err(_) => "shutdown_failed",
                },
                Some(FlushReply::Failed(failure)) => failure.category(),
                None => "flush_delayed",
            };
            let recovery = uuid::Uuid::new_v4().to_string();
            host.recover(&id, &recovery, reason);
            let ack_deadline = tokio::time::sleep(emergency);
            tokio::pin!(ack_deadline);
            let mut presented = false;
            let choice = loop {
                tokio::select! {
                    message = receive.recv() => match message {
                        Some(Message::Presented) => presented = true,
                        Some(Message::Choice(choice)) => break choice,
                        Some(Message::Flush(value)) => { reply = Some(value); },
                        Some(Message::Started) => started = true,
                        None => break host.fallback(reason).await,
                    },
                    _ = &mut ack_deadline, if !presented => break host.fallback(reason).await,
                }
            };
            // Native emergency dialogs may outlive the actual save. Retain its completion.
            while let Ok(message) = receive.try_recv() {
                if let Message::Flush(value) = message {
                    reply = Some(value);
                }
            }
            match choice {
                ExitDecision::Cancel => {
                    host.finish(&id);
                    return;
                }
                ExitDecision::Retry if reply.is_none() => {
                    // Same save still running. Never start a competing flush.
                    host.flush(&id);
                    let deadline = tokio::time::sleep(delay);
                    tokio::pin!(deadline);
                    let mut resend = tokio::time::interval(Duration::from_millis(250));
                    loop {
                        tokio::select! {
                            message = receive.recv() => match message {
                                Some(Message::Started) => started = true,
                                Some(Message::Flush(value)) => { reply = Some(value); break; },
                                None => break,
                                _ => {},
                            },
                            _ = resend.tick(), if !started => host.flush(&id),
                            _ = &mut deadline => break,
                        }
                    }
                    continue;
                }
                ExitDecision::Retry if reply == Some(FlushReply::Saved) => continue,
                ExitDecision::Retry => continue 'retry,
                ExitDecision::PreserveRawAndExit => {
                    if reply == Some(FlushReply::Saved) && host.complete(false).await.is_ok() {
                        return;
                    }
                    if host.complete(true).await.is_ok() {
                        return;
                    }
                    // Even an explicitly requested discard cannot strand a locked app on failure.
                    reply = Some(FlushReply::Failed(FlushFailure::SaveFailed));
                }
            }
        }
    }
}
