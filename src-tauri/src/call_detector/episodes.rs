use super::Candidate;
use shared::ActiveCall;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct Episodes {
    pending: BTreeSet<(u32, String)>,
    active: BTreeMap<(u32, String), (ActiveCall, u8)>,
}
impl Episodes {
    pub fn failed(&mut self) {
        self.pending.clear();
    }
    pub fn observe(&mut self, candidates: Vec<Candidate>) -> (Vec<ActiveCall>, Vec<ActiveCall>) {
        let keys: BTreeSet<_> = candidates
            .iter()
            .map(|c| (c.pid, c.process_name.clone()))
            .collect();
        let mut new = Vec::new();
        for candidate in candidates {
            let key = (candidate.pid, candidate.process_name.clone());
            if let Some((_, absent)) = self.active.get_mut(&key) {
                *absent = 0;
            } else if self.pending.contains(&key) {
                let call = ActiveCall {
                    app_name: candidate.app_name,
                    process_name: candidate.process_name,
                    pid: candidate.pid,
                    is_browser: candidate.is_browser,
                    detected_at: chrono::Utc::now(),
                };
                new.push(call.clone());
                self.active.insert(key, (call, 0));
            }
        }
        self.active.retain(|key, (_, absent)| {
            if !keys.contains(key) {
                *absent += 1;
            }
            *absent < 4
        });
        self.pending = keys;
        (
            self.active.values().map(|(call, _)| call.clone()).collect(),
            new,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn call() -> Candidate {
        Candidate {
            pid: 42,
            process_name: "teams".into(),
            app_name: "Microsoft Teams".into(),
            is_browser: false,
        }
    }
    #[test]
    fn debounce_dedup_grace_and_same_process_reentry() {
        let mut e = Episodes::default();
        assert!(e.observe(vec![call()]).0.is_empty());
        let (first, new) = e.observe(vec![call()]);
        assert_eq!(new.len(), 1);
        for _ in 0..5 {
            let (active, new) = e.observe(vec![call()]);
            assert_eq!(active, first);
            assert!(new.is_empty());
        }
        for _ in 0..3 {
            assert_eq!(e.observe(vec![]).0, first);
        }
        assert!(e.observe(vec![call()]).1.is_empty());
        for _ in 0..4 {
            e.observe(vec![]);
        }
        assert!(e.observe(vec![call()]).1.is_empty());
        assert_eq!(e.observe(vec![call()]).1.len(), 1);
    }
    #[test]
    fn failed_poll_breaks_pending_debounce_but_preserves_active_episode() {
        let mut e = Episodes::default();
        e.observe(vec![call()]);
        e.failed();
        assert!(e.observe(vec![call()]).0.is_empty());
        let (active, _) = e.observe(vec![call()]);
        e.failed();
        let (after, new) = e.observe(vec![call()]);
        assert_eq!(active, after);
        assert!(new.is_empty());
    }
    #[test]
    fn isolated_spikes_never_publish() {
        let mut e = Episodes::default();
        for _ in 0..4 {
            assert!(e.observe(vec![call()]).0.is_empty());
            assert!(e.observe(vec![]).0.is_empty());
        }
    }
}
