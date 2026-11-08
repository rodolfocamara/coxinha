use std::cell::RefCell;
use std::sync::Mutex;

use shared::ShortcutsConfig;
use tauri_plugin_global_shortcut::Shortcut;

use super::registry::{rebind, ChordBackend, Registry};
use super::{ShortcutAction, ShortcutFailure};

/// The plugin's bookkeeping, with chords another app already holds.
#[derive(Default)]
struct FakeBackend {
    held_elsewhere: Vec<Shortcut>,
    active: RefCell<Vec<Shortcut>>,
}

impl ChordBackend for FakeBackend {
    fn register(&self, shortcut: Shortcut) -> std::result::Result<(), String> {
        if self.held_elsewhere.contains(&shortcut) {
            return Err("HotKey already registered: taken".into());
        }
        self.active.borrow_mut().push(shortcut);
        Ok(())
    }
    fn unregister(&self, shortcut: Shortcut) -> std::result::Result<(), String> {
        self.active.borrow_mut().retain(|s| *s != shortcut);
        Ok(())
    }
}

fn chord(text: &str) -> Shortcut {
    text.parse().unwrap()
}

fn registered(backend: &FakeBackend, cfg: &ShortcutsConfig) -> Mutex<Registry> {
    let mut registry = Registry::default();
    registry.register_config(backend, cfg);
    Mutex::new(registry)
}

/// The names `captureChord` sends from Settings: the parser must take them all.
#[test]
fn every_captured_key_parses() {
    for key in [
        "Space",
        "Enter",
        "Tab",
        "Backspace",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Period",
        "Comma",
        "Slash",
        "Semicolon",
        "Quote",
        "Minus",
        "Equal",
        "Backquote",
        "Backslash",
        "BracketLeft",
        "BracketRight",
        "A",
        "1",
        "F5",
        "F12",
    ] {
        format!("Ctrl+Alt+Shift+Super+{key}")
            .parse::<Shortcut>()
            .unwrap_or_else(|e| panic!("{key}: {e:?}"));
    }
}

#[test]
fn startup_keeps_going_and_reports_each_failure() {
    let backend = FakeBackend {
        held_elsewhere: vec![chord("Ctrl+Alt+T")],
        ..Default::default()
    };
    let cfg = ShortcutsConfig {
        agenda: "Ctrl+Alt+NotAKey".into(),
        ..Default::default()
    };
    let mut registry = Registry::default();
    assert_eq!(registry.register_config(&backend, &cfg), (3, 2));
    let report = registry.report(&cfg, &|_| None, false);
    let status = |action| {
        report
            .statuses
            .iter()
            .find(|s| s.action == action)
            .unwrap()
            .clone()
    };
    assert_eq!(
        status(ShortcutAction::Meetings).failure,
        Some(ShortcutFailure::Taken)
    );
    assert_eq!(
        status(ShortcutAction::Agenda).failure,
        Some(ShortcutFailure::Invalid)
    );
    assert!(status(ShortcutAction::NewNote).registered);
    assert!(!status(ShortcutAction::Meetings).registered);
}

#[test]
fn rebind_moves_the_chord_and_releases_the_old_one() {
    let backend = FakeBackend::default();
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    rebind(
        &registry,
        &backend,
        &cfg,
        ShortcutAction::Meetings,
        "Ctrl+Alt+M",
    )
    .unwrap();
    let active = backend.active.borrow();
    assert!(active.contains(&chord("Ctrl+Alt+M")));
    assert!(!active.contains(&chord("Ctrl+Alt+T")));
    let inner = registry.lock().unwrap();
    assert_eq!(
        inner.routes.get(&chord("Ctrl+Alt+M")),
        Some(&ShortcutAction::Meetings)
    );
    assert!(!inner.routes.contains_key(&chord("Ctrl+Alt+T")));
}

#[test]
fn a_refused_chord_leaves_the_old_one_working() {
    let backend = FakeBackend {
        held_elsewhere: vec![chord("Ctrl+Alt+M")],
        ..Default::default()
    };
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    let (failure, _) = rebind(
        &registry,
        &backend,
        &cfg,
        ShortcutAction::Meetings,
        "Ctrl+Alt+M",
    )
    .unwrap_err();
    assert_eq!(failure, ShortcutFailure::Taken);
    assert!(backend.active.borrow().contains(&chord("Ctrl+Alt+T")));
    assert_eq!(
        registry
            .lock()
            .unwrap()
            .registered_chord(ShortcutAction::Meetings),
        Some(chord("Ctrl+Alt+T"))
    );
}

#[test]
fn rebinding_clears_a_startup_failure() {
    let backend = FakeBackend {
        held_elsewhere: vec![chord("Ctrl+Alt+T")],
        ..Default::default()
    };
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    rebind(
        &registry,
        &backend,
        &cfg,
        ShortcutAction::Meetings,
        "Ctrl+Alt+M",
    )
    .unwrap();
    let next = ShortcutsConfig {
        meetings: "Ctrl+Alt+M".into(),
        ..cfg
    };
    let report = registry.lock().unwrap().report(&next, &|_| None, false);
    let meetings = report
        .statuses
        .iter()
        .find(|s| s.action == ShortcutAction::Meetings)
        .unwrap();
    assert!(meetings.registered);
    assert_eq!(meetings.failure, None);
}

#[test]
fn rejects_a_chord_another_action_uses_or_that_does_not_parse() {
    let backend = FakeBackend::default();
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    assert_eq!(
        rebind(
            &registry,
            &backend,
            &cfg,
            ShortcutAction::Meetings,
            "Ctrl+Alt+W"
        )
        .unwrap_err(),
        (ShortcutFailure::Duplicate, "toggle_recording".to_string())
    );
    assert_eq!(
        rebind(
            &registry,
            &backend,
            &cfg,
            ShortcutAction::Meetings,
            "Ctrl+Alt+NotAKey"
        )
        .unwrap_err()
        .0,
        ShortcutFailure::Invalid
    );
}

#[test]
fn rebinding_to_the_same_chord_changes_nothing() {
    let backend = FakeBackend::default();
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    let before = backend.active.borrow().len();
    rebind(
        &registry,
        &backend,
        &cfg,
        ShortcutAction::Meetings,
        "Ctrl+Alt+T",
    )
    .unwrap();
    assert_eq!(backend.active.borrow().len(), before);
}

#[test]
fn report_names_the_owner_the_desktop_declares() {
    let backend = FakeBackend::default();
    let cfg = ShortcutsConfig::default();
    let registry = registered(&backend, &cfg);
    let report = registry.lock().unwrap().report(
        &cfg,
        &|chord| (chord == "Ctrl+Alt+T").then(|| "kitty".to_string()),
        true,
    );
    assert!(report.wayland);
    let meetings = report
        .statuses
        .iter()
        .find(|s| s.action == ShortcutAction::Meetings)
        .unwrap();
    assert_eq!(meetings.conflict.as_deref(), Some("kitty"));
    assert!(meetings.registered);
}

#[test]
fn default_shortcuts_parse() {
    // Guards spec 0042: the Ctrl+Alt+Shift+* defaults must
    // parse into valid Shortcut values so the app doesn't
    // boot with a broken global-shortcut registration.
    let cfg = ShortcutsConfig::default();
    for raw in [
        &cfg.new_note,
        &cfg.open_app,
        &cfg.agenda,
        &cfg.meetings,
        &cfg.toggle_recording,
    ] {
        raw.parse::<Shortcut>()
            .unwrap_or_else(|e| panic!("failed to parse default shortcut {raw:?}: {e:?}"));
    }
}

#[test]
fn default_shortcuts_avoid_known_conflicts() {
    // Regression guard for spec 0042. Every chord documented as
    // intercepted on Windows at the OS or Office level goes
    // here. See docs/research/shortcut-map.md for sources.
    let cfg = ShortcutsConfig::default();
    let forbidden = [
        "Ctrl+Alt+N",       // OneNote in-app, caused the original bug
        "Ctrl+Alt+Shift+N", // intermediate attempt that also failed in dev
        "Super+Shift+N",    // interim PR #22 default, never field-validated
        "Super+Y",          // registered on most machines, but siblings (Super+Shift+*) collided
        "Win+N",
        "Super+N", // Windows 11 notification center
        "Win+Alt+N",
        "Super+Alt+N", // OneNote Quick Note (global)
    ];
    for chord in forbidden {
        assert_ne!(
            cfg.new_note, chord,
            "default new_note chord {chord:?} is known to collide on Windows"
        );
    }
}
