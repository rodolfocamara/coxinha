use super::*;
use coxinha_core::curation::{CurationError, InventoryPager};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

type ShutdownReply = (
    tokio::sync::oneshot::Sender<Result<Value, String>>,
    Result<Value, String>,
);

#[derive(Default)]
pub(super) struct CurationState {
    pub(super) pager: InventoryPager,
    task: Option<ComparisonTask>,
    #[cfg(test)]
    gate: Option<TestGate>,
}
struct ComparisonTask {
    generation: i64,
    cancel: Arc<AtomicBool>,
    receive: mpsc::Receiver<Result<Value, String>>,
    join: Option<std::thread::JoinHandle<()>>,
    reply: Option<tokio::sync::oneshot::Sender<Result<Value, String>>>,
    #[cfg(test)]
    gate: Option<TestGate>,
}
impl ComparisonTask {
    fn cancel(&mut self) {
        self.cancel.store(true, Ordering::Release);
        #[cfg(test)]
        if let Some(gate) = &self.gate {
            gate.release();
        }
        if let Some(reply) = self.reply.take() {
            let _ = reply.send(Err(CurationError::Refresh.to_string()));
        }
    }
}
impl Drop for ComparisonTask {
    fn drop(&mut self) {
        self.cancel();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}
impl Worker {
    pub(super) fn dispatch(&mut self, request: Request) -> Option<ShutdownReply> {
        match request.action {
            Action::Curation(curation::CurationAction::Comparison(job)) => {
                self.start_comparison(job, request.reply);
                None
            }
            #[cfg(test)]
            Action::ComparisonGate(gate) => {
                self.curation.gate = Some(gate);
                let _ = request.reply.send(Ok(Value::Null));
                None
            }
            action => {
                let shutdown = matches!(action, Action::Shutdown { .. });
                if shutdown {
                    self.cancel_comparison();
                }
                let result = self.execute(action).map_err(|e| format!("{e:#}"));
                let finished = shutdown && result.is_ok();
                if finished {
                    Some((request.reply, result))
                } else {
                    let _ = request.reply.send(result);
                    None
                }
            }
        }
    }
    fn start_comparison(
        &mut self,
        job: String,
        reply: tokio::sync::oneshot::Sender<Result<Value, String>>,
    ) {
        if self.curation.task.is_some() {
            let _ = reply.send(Err(CurationError::Busy.to_string()));
            return;
        }
        let input = match self.store.prepare_voice_comparison(&job) {
            Ok(input) => input,
            Err(e) => {
                let _ = reply.send(Err(format!("{e:#}")));
                return;
            }
        };
        let generation = input.profile_generation();
        let cancel = Arc::new(AtomicBool::new(false));
        let owned_cancel = cancel.clone();
        let (send, receive) = mpsc::channel();
        #[cfg(test)]
        let gate = self.curation.gate.take();
        #[cfg(test)]
        let owned_gate = gate.clone();
        let join = std::thread::Builder::new()
            .name("voice-comparison".into())
            .spawn(move || {
                #[cfg(test)]
                if let Some(gate) = owned_gate {
                    gate.wait(&owned_cancel);
                }
                let result = std::panic::catch_unwind(|| input.score(&owned_cancel))
                    .map_err(|_| "voice comparison worker panicked".to_string())
                    .and_then(|r| r.map_err(|e| format!("{e:#}")));
                let _ = send.send(result);
            });
        match join {
            Ok(join) => {
                self.curation.task = Some(ComparisonTask {
                    generation,
                    cancel,
                    receive,
                    join: Some(join),
                    reply: Some(reply),
                    #[cfg(test)]
                    gate,
                })
            }
            Err(_) => {
                let _ = reply.send(Err("voice comparison worker unavailable".into()));
            }
        }
    }
    pub(super) fn pump_comparison(&mut self) {
        let Some(task) = self.curation.task.as_ref() else {
            return;
        };
        let result = match task.receive.try_recv() {
            Ok(r) => r,
            Err(mpsc::TryRecvError::Empty) => return,
            Err(mpsc::TryRecvError::Disconnected) => Err("voice comparison worker stopped".into()),
        };
        let mut task = self.curation.task.take().unwrap();
        let result = match self.store.curation_generation() {
            Ok(generation) if generation == task.generation => result,
            Ok(_) => Err(CurationError::Refresh.to_string()),
            Err(e) => Err(format!("{e:#}")),
        };
        if let Some(reply) = task.reply.take() {
            let _ = reply.send(result);
        }
    }
    pub(super) fn cancel_comparison(&mut self) {
        self.curation.task.take();
    }
}

#[cfg(test)]
#[derive(Clone)]
pub(super) struct TestGate {
    pub entered: mpsc::Sender<()>,
    pub state: Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}
#[cfg(test)]
impl TestGate {
    fn wait(&self, cancel: &AtomicBool) {
        let _ = self.entered.send(());
        let (mut open, wake) = (self.state.0.lock().unwrap(), &self.state.1);
        while !*open && !cancel.load(Ordering::Acquire) {
            open = wake.wait(open).unwrap();
        }
    }
    pub(super) fn release(&self) {
        *self.state.0.lock().unwrap() = true;
        self.state.1.notify_all();
    }
}
