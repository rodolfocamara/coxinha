use super::*;
use protocol::*;
use recovery::decision;
use std::{collections::VecDeque, time::Duration};
use tauri_plugin_dialog::MessageDialogResult;
#[test]
fn diagnostics_are_bounded_and_rotate_repeatedly() {
    let dir = tempfile::tempdir().unwrap();
    let state = Desktop::new(dir.path().into()).unwrap();
    let path = dir.path().join("desktop.log");
    for _ in 0..3 {
        fs::write(&path, vec![b'x'; 256 * 1024]).unwrap();
        state
            .record("frontend_error source=bundled_frontend line=21 column=8")
            .unwrap();
        assert!(fs::metadata(&path).unwrap().len() < 1024);
        assert_eq!(
            fs::metadata(path.with_extension("previous.log"))
                .unwrap()
                .len(),
            256 * 1024
        );
    }
    let log = fs::read_to_string(path).unwrap();
    assert!(log.contains(&state.session));
    assert!(log.contains(env!("COXINHA_BUILD_ID")));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
}
#[test]
fn commands_require_active_ids_receipt_completion_and_explicit_warned_choice() {
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
    let mut pending = Some(Pending::new("active".into(), send));
    assert!(reply(&mut pending, "active", FlushReply::Saved).is_err());
    assert!(started(&mut pending, "stale").is_err());
    started(&mut pending, "active").unwrap();
    started(&mut pending, "active").unwrap();
    assert!(matches!(receive.try_recv(), Ok(Message::Started)));
    assert!(receive.try_recv().is_err());
    reply(&mut pending, "active", FlushReply::Saved).unwrap();
    assert!(reply(&mut pending, "active", FlushReply::Saved).is_err());
    assert!(matches!(
        receive.try_recv(),
        Ok(Message::Flush(FlushReply::Saved))
    ));
    pending.as_mut().unwrap().recovery = Some(("recovery".into(), false));
    assert!(respond(&mut pending, "active", "recovery", "discard").is_err());
    assert!(respond(&mut pending, "active", "stale", "presented").is_err());
    assert!(respond(&mut pending, "stale", "recovery", "presented").is_err());
    respond(&mut pending, "active", "recovery", "presented").unwrap();
    assert!(matches!(receive.try_recv(), Ok(Message::Presented)));
    assert!(respond(&mut pending, "active", "recovery", "unknown").is_err());
    respond(&mut pending, "active", "recovery", "cancel").unwrap();
    assert!(matches!(
        receive.try_recv(),
        Ok(Message::Choice(ExitDecision::Cancel))
    ));
    assert!(respond(&mut pending, "active", "recovery", "discard").is_err());
    assert_eq!(decision(MessageDialogResult::Cancel), ExitDecision::Cancel);
    assert_eq!(
        decision(MessageDialogResult::Custom("unexpected".into())),
        ExitDecision::Cancel
    );
    assert_eq!(
        decision(MessageDialogResult::No),
        ExitDecision::PreserveRawAndExit
    );
}
#[test]
fn repeated_close_admits_one_request_and_poisoned_lock_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let state = std::sync::Arc::new(Desktop::new(dir.path().into()).unwrap());
    assert!(state.try_begin());
    assert!(!state.try_begin());
    state.busy.store(false, Ordering::SeqCst);
    assert!(state.try_begin());
    let poisoned = state.clone();
    assert!(std::thread::spawn(move || {
        let _guard = poisoned.pending.lock().unwrap();
        panic!("synthetic failure");
    })
    .join()
    .is_err());
    assert!(state.pending.is_poisoned());
    assert!(state.pending_guard().is_none());
    assert!(!state.pending.is_poisoned());
}
#[test]
fn reasons_are_whitelisted_without_logging_contents() {
    assert_eq!(
        FlushReply::from_ipc(false, Some("attachment_pending")),
        FlushReply::Failed(FlushFailure::AttachmentPending)
    );
    for reason in [None, Some("save_failed"), Some("private note")] {
        assert_eq!(
            FlushReply::from_ipc(false, reason),
            FlushReply::Failed(FlushFailure::SaveFailed)
        );
    }
    assert_eq!(FlushReply::from_ipc(true, None), FlushReply::Saved);
}
struct Script {
    flushes: VecDeque<Vec<(u64, Message)>>,
    recoveries: VecDeque<Vec<(u64, Message)>>,
    fallback: VecDeque<ExitDecision>,
    completions: VecDeque<Result<(), String>>,
    send: Option<tokio::sync::mpsc::UnboundedSender<Message>>,
    events: Vec<String>,
    count: usize,
    emergency_late_save: bool,
}
struct FakeHost(Mutex<Script>);
impl FakeHost {
    fn new(
        flushes: Vec<Vec<(u64, Message)>>,
        recoveries: Vec<Vec<(u64, Message)>>,
        completions: Vec<Result<(), String>>,
    ) -> Self {
        Self(Mutex::new(Script {
            flushes: flushes.into(),
            recoveries: recoveries.into(),
            fallback: VecDeque::new(),
            completions: completions.into(),
            send: None,
            events: vec![],
            count: 0,
            emergency_late_save: false,
        }))
    }
    fn events(&self) -> Vec<String> {
        self.0.lock().unwrap().events.clone()
    }
}
fn deliver(send: tokio::sync::mpsc::UnboundedSender<Message>, messages: Vec<(u64, Message)>) {
    tokio::spawn(async move {
        for (delay, message) in messages {
            if delay > 0 {
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            let _ = send.send(message);
        }
    });
}
#[async_trait::async_trait]
impl Host for FakeHost {
    fn begin(&self) -> (String, tokio::sync::mpsc::UnboundedReceiver<Message>) {
        let mut s = self.0.lock().unwrap();
        s.count += 1;
        let id = s.count.to_string();
        s.events.push(format!("begin:{id}"));
        let (send, receive) = tokio::sync::mpsc::unbounded_channel();
        s.send = Some(send.clone());
        let messages = s
            .flushes
            .pop_front()
            .expect("unexpected concurrent/repeated flush");
        deliver(send, messages);
        (id, receive)
    }
    fn flush(&self, _: &str) {
        self.0.lock().unwrap().events.push("flush".into());
    }
    fn recover(&self, _: &str, _: &str, reason: &str) {
        let mut s = self.0.lock().unwrap();
        s.events.push(format!("recover:{reason}"));
        let messages = s.recoveries.pop_front().expect("unexpected recovery");
        deliver(s.send.clone().unwrap(), messages);
    }
    fn finish(&self, id: &str) {
        self.0.lock().unwrap().events.push(format!("cancel:{id}"));
    }
    async fn fallback(&self, _: &str) -> ExitDecision {
        let (choice, late_save, send) = {
            let mut s = self.0.lock().unwrap();
            s.events.push("native_emergency".into());
            (
                s.fallback
                    .pop_front()
                    .expect("healthy UI must not open native dialog"),
                s.emergency_late_save,
                s.send.clone().unwrap(),
            )
        };
        if late_save {
            send.send(Message::Flush(FlushReply::Saved)).unwrap();
            tokio::task::yield_now().await;
        }
        choice
    }
    async fn complete(&self, discard: bool) -> Result<(), String> {
        let mut s = self.0.lock().unwrap();
        s.events.push(format!("complete:{discard}"));
        s.completions.pop_front().expect("unexpected exit/discard")
    }
}
fn saved() -> Vec<(u64, Message)> {
    vec![
        (0, Message::Started),
        (0, Message::Flush(FlushReply::Saved)),
    ]
}
fn choice(choice: ExitDecision) -> Vec<(u64, Message)> {
    vec![(0, Message::Presented), (0, Message::Choice(choice))]
}
async fn run_test(host: &FakeHost) {
    tokio::time::timeout(
        Duration::from_secs(2),
        run_with_deadlines(host, Duration::from_millis(15), Duration::from_millis(15)),
    )
    .await
    .unwrap();
}
#[tokio::test]
async fn normal_close_flushes_and_exits_without_initial_confirmation() {
    let h = FakeHost::new(vec![saved()], vec![], vec![Ok(())]);
    run_test(&h).await;
    let e = h.events();
    assert_eq!(e.first().unwrap(), "begin:1");
    assert!(e.contains(&"complete:false".into()));
    assert!(!e
        .iter()
        .any(|e| e.starts_with("recover") || e == "native_emergency"));
}
#[tokio::test]
async fn receipt_is_not_completion_and_timeout_never_exits() {
    let h = FakeHost::new(
        vec![vec![(0, Message::Started)]],
        vec![choice(ExitDecision::Cancel)],
        vec![],
    );
    run_test(&h).await;
    assert!(h.events().contains(&"recover:flush_delayed".into()));
    assert!(h.events().contains(&"cancel:1".into()));
}
#[tokio::test]
async fn permanent_failure_retries_new_request_without_unlocking_then_can_cancel() {
    let failure = || {
        vec![
            (0, Message::Started),
            (
                0,
                Message::Flush(FlushReply::Failed(FlushFailure::SaveFailed)),
            ),
        ]
    };
    let h = FakeHost::new(
        vec![failure(), failure()],
        vec![choice(ExitDecision::Retry), choice(ExitDecision::Cancel)],
        vec![],
    );
    run_test(&h).await;
    let e = h.events();
    assert!(e.contains(&"begin:2".into()));
    assert!(!e.contains(&"cancel:1".into()));
    assert!(e.contains(&"cancel:2".into()));
}
#[tokio::test]
async fn late_completion_during_healthy_recovery_is_retained_without_competing_save() {
    let h = FakeHost::new(
        vec![vec![(0, Message::Started)]],
        vec![vec![
            (0, Message::Presented),
            (2, Message::Flush(FlushReply::Saved)),
            (2, Message::Choice(ExitDecision::Retry)),
        ]],
        vec![Ok(())],
    );
    run_test(&h).await;
    let e = h.events();
    assert!(!e.contains(&"begin:2".into()));
    assert!(e.contains(&"complete:false".into()));
}
#[tokio::test]
async fn pending_retry_waits_on_same_request_and_finalization_failure_stays_recoverable() {
    let h = FakeHost::new(
        vec![vec![(0, Message::Started)]],
        vec![
            choice(ExitDecision::Retry),
            vec![
                (0, Message::Presented),
                (0, Message::Flush(FlushReply::Saved)),
                (0, Message::Choice(ExitDecision::Retry)),
            ],
            choice(ExitDecision::Cancel),
        ],
        vec![
            Err("synthetic finalization".into()),
            Err("synthetic finalization".into()),
        ],
    );
    run_test(&h).await;
    assert!(!h.events().contains(&"begin:2".into()));
    assert!(h.events().contains(&"recover:shutdown_failed".into()));
}
#[tokio::test]
async fn frontend_missing_uses_emergency_and_cancel_without_discard() {
    let h = FakeHost::new(vec![vec![]], vec![vec![]], vec![]);
    h.0.lock().unwrap().fallback.push_back(ExitDecision::Cancel);
    run_test(&h).await;
    assert!(h.events().contains(&"native_emergency".into()));
    assert!(h.events().contains(&"cancel:1".into()));
}
#[tokio::test]
async fn explicit_warned_discard_only_and_failed_discard_does_not_strand_app() {
    let h = FakeHost::new(
        vec![vec![
            (0, Message::Started),
            (
                0,
                Message::Flush(FlushReply::Failed(FlushFailure::AttachmentPending)),
            ),
        ]],
        vec![
            choice(ExitDecision::PreserveRawAndExit),
            choice(ExitDecision::Cancel),
        ],
        vec![Err("synthetic failure".into())],
    );
    run_test(&h).await;
    assert!(h.events().contains(&"complete:true".into()));
    assert!(h.events().contains(&"cancel:1".into()));
}

#[tokio::test]
async fn late_completion_during_native_emergency_is_retained_on_retry() {
    let h = FakeHost::new(
        vec![vec![(0, Message::Started)]],
        vec![vec![]],
        vec![Ok(())],
    );
    {
        let mut script = h.0.lock().unwrap();
        script.fallback.push_back(ExitDecision::Retry);
        script.emergency_late_save = true;
    }
    run_test(&h).await;
    let events = h.events();
    assert!(events.contains(&"native_emergency".into()));
    assert!(events.contains(&"complete:false".into()));
    assert!(!events.contains(&"begin:2".into()));
    assert!(!events.contains(&"complete:true".into()));
}
