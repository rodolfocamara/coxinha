//! The chords in force, what failed and what fired, apart from the plugin.

use std::collections::HashMap;
use std::sync::Mutex;

use shared::ShortcutsConfig;
use tauri_plugin_global_shortcut::Shortcut;

use super::{ShortcutAction, ShortcutFailure, ShortcutReport, ShortcutStatus, ACTIONS};

/// The plugin, behind what the rebinding logic needs from it.
pub(crate) trait ChordBackend {
    fn register(&self, shortcut: Shortcut) -> std::result::Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> std::result::Result<(), String>;
}

#[derive(Default)]
pub(crate) struct Registry {
    pub(super) routes: HashMap<Shortcut, ShortcutAction>,
    failures: HashMap<ShortcutAction, (ShortcutFailure, String)>,
    pub(super) fired: HashMap<ShortcutAction, f64>,
}

fn classify(error: &str) -> ShortcutFailure {
    if error.to_lowercase().contains("already registered") {
        ShortcutFailure::Taken
    } else {
        ShortcutFailure::Failed
    }
}

impl Registry {
    pub(super) fn registered_chord(&self, action: ShortcutAction) -> Option<Shortcut> {
        self.routes
            .iter()
            .find(|(_, registered)| **registered == action)
            .map(|(shortcut, _)| *shortcut)
    }

    /// Registers every chord; a failure is kept for Settings and stops nothing.
    pub(crate) fn register_config(
        &mut self,
        backend: &dyn ChordBackend,
        cfg: &ShortcutsConfig,
    ) -> (u8, u8) {
        self.routes.clear();
        self.failures.clear();
        let (mut ok, mut fail) = (0u8, 0u8);
        for action in ACTIONS {
            let raw = action.chord(cfg);
            let outcome = raw
                .parse::<Shortcut>()
                .map_err(|e| (ShortcutFailure::Invalid, format!("{e:?}")))
                .and_then(|shortcut| {
                    backend
                        .register(shortcut)
                        .map(|()| shortcut)
                        .map_err(|e| (classify(&e), e))
                });
            match outcome {
                Ok(shortcut) => {
                    tracing::info!("registered shortcut {} -> {:?}", raw, action.route());
                    self.routes.insert(shortcut, action);
                    ok += 1;
                }
                Err((failure, detail)) => {
                    tracing::warn!("failed to register {}: {}", raw, detail);
                    self.failures.insert(action, (failure, detail));
                    fail += 1;
                }
            }
        }
        (ok, fail)
    }

    pub(super) fn report(
        &self,
        cfg: &ShortcutsConfig,
        owner: &dyn Fn(&str) -> Option<String>,
        wayland: bool,
    ) -> ShortcutReport {
        let statuses = ACTIONS
            .iter()
            .map(|&action| {
                let failure = self.failures.get(&action);
                let chord = action.chord(cfg).to_string();
                ShortcutStatus {
                    action,
                    registered: self.registered_chord(action).is_some(),
                    failure: failure.map(|(kind, _)| *kind),
                    detail: failure.map(|(_, detail)| detail.clone()),
                    conflict: owner(&chord),
                    last_fired_ms: self.fired.get(&action).copied(),
                    chord,
                }
            })
            .collect();
        ShortcutReport { statuses, wayland }
    }
}

/// Moves `action` to `chord`. The old chord stays until the new one is accepted,
/// so a refused chord changes nothing. The plugin runs on the main thread, which
/// also takes the registry on a press: the lock is never held across its calls.
pub(crate) fn rebind(
    registry: &Mutex<Registry>,
    backend: &dyn ChordBackend,
    cfg: &ShortcutsConfig,
    action: ShortcutAction,
    chord: &str,
) -> std::result::Result<(), (ShortcutFailure, String)> {
    let next = chord
        .parse::<Shortcut>()
        .map_err(|e| (ShortcutFailure::Invalid, format!("{e:?}")))?;
    for other in ACTIONS.iter().filter(|other| **other != action) {
        if other.chord(cfg).parse::<Shortcut>().ok() == Some(next) {
            let name = serde_json::to_value(other)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_default();
            return Err((ShortcutFailure::Duplicate, name));
        }
    }
    let previous = registry.lock().unwrap().registered_chord(action);
    if previous == Some(next) {
        return Ok(());
    }
    backend
        .register(next)
        .map_err(|error| (classify(&error), error))?;
    {
        let mut registry = registry.lock().unwrap();
        if let Some(old) = previous {
            registry.routes.remove(&old);
        }
        registry.routes.insert(next, action);
        registry.failures.remove(&action);
    }
    if let Some(old) = previous {
        if let Err(error) = backend.unregister(old) {
            tracing::warn!("failed to unregister the old shortcut: {}", error);
        }
    }
    Ok(())
}
