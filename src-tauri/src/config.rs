//! Global app state. Everything shared across threads lives here.
//!
//! Config is persisted in `~/coxinha/.coxinha/config.toml` and can be
//! edited by hand while the app is closed.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use shared::*;
use tauri::AppHandle;

use crate::db::Db;
use crate::diarizer::Diarizer;
use crate::recorder::Recorder;
use crate::storage::Storage;
use crate::summarizer::Summarizer;
use crate::transcriber::Transcriber;

pub struct AppState {
    /// Kept so future background tasks (call detector, sync workers)
    /// can emit events without threading the handle through every
    /// call path. Unused today — remove only if we're sure nothing
    /// spawned from state will need it.
    #[allow(dead_code)]
    pub app_handle: AppHandle,
    pub config: AppConfig,
    pub config_path: PathBuf,
    /// Held so the DB stays alive for Storage/Recorder clones and so
    /// the `rebuild_from_vault` command (spec 0004) can access it
    /// directly once wired.
    #[allow(dead_code)]
    pub db: Arc<Db>,
    pub storage: Arc<Storage>,
    pub recorder: Recorder,
    pub transcriber: Arc<dyn Transcriber>,
    pub diarizer: Arc<dyn Diarizer>,
    pub summarizer: Arc<Summarizer>,
    pub active_calls: Vec<ActiveCall>,
}

impl AppState {
    /// Async by design: future init paths (model download, network
    /// probes, FTS warm-up) will need `.await`. Body is sync today.
    pub async fn initialize(app_handle: &AppHandle) -> Result<Self> {
        let vault_root = default_vault_root()?;
        let config_path = vault_root.join(".coxinha").join("config.toml");

        // Load config or create the default
        let mut config: AppConfig = if config_path.exists() {
            let raw = std::fs::read_to_string(&config_path)
                .with_context(|| format!("reading {}", config_path.display()))?;
            toml::from_str(&raw).context("parsing config.toml")?
        } else {
            let cfg = default_config(&vault_root);
            ensure_parent_dir(&config_path)?;
            std::fs::write(&config_path, toml::to_string_pretty(&cfg)?)?;
            cfg
        };

        // Rewrite shortcuts that match a documented broken default
        // (spec 0042). Users who customized keep their choice — only
        // the exact stale default sets flip. One-shot per install.
        if migrate_stale_shortcut_defaults(&mut config.shortcuts) {
            std::fs::write(&config_path, toml::to_string_pretty(&config)?)?;
            tracing::info!(
                "migrated stale shortcut defaults to current ({:?})",
                config.shortcuts.new_note
            );
        }

        // Log the effective shortcut set every boot so when a user
        // reports "shortcut doesn't fire" we can read the truth
        // without guessing what their config.toml actually says.
        // One info line, five fields, easy to grep.
        tracing::info!(
            "effective shortcuts: new_note={} open_app={} agenda={} meetings={} toggle_recording={}",
            config.shortcuts.new_note,
            config.shortcuts.open_app,
            config.shortcuts.agenda,
            config.shortcuts.meetings,
            config.shortcuts.toggle_recording,
        );

        // Make sure the folder layout exists
        bootstrap_vault(&vault_root)?;

        // DB
        let db_path = vault_root.join(".coxinha").join("index.db");
        let db = Arc::new(Db::open(&db_path)?);

        // Storage
        let storage = Arc::new(Storage::new(vault_root.clone(), db.clone()));

        // Recorder
        let recorder = Recorder::new(vault_root.clone(), db.clone());

        // Pluggable engines driven by config
        let transcriber = crate::transcriber::build(&config.transcriber)?;
        let diarizer = crate::diarizer::build(&config.diarizer)?;
        let summarizer = Arc::new(Summarizer::new(config.llm.clone(), storage.clone()));

        Ok(Self {
            app_handle: app_handle.clone(),
            config,
            config_path,
            db,
            storage,
            recorder,
            transcriber,
            diarizer,
            summarizer,
            active_calls: Vec::new(),
        })
    }

    pub async fn update_config(&mut self, new_config: AppConfig) -> Result<()> {
        let transcriber_changed = self.config.transcriber != new_config.transcriber;
        let diarizer_changed = self.config.diarizer != new_config.diarizer;
        let llm_changed = self.config.llm != new_config.llm;

        self.config = new_config;

        if transcriber_changed {
            self.transcriber = crate::transcriber::build(&self.config.transcriber)?;
        }
        if diarizer_changed {
            self.diarizer = crate::diarizer::build(&self.config.diarizer)?;
        }
        if llm_changed {
            self.summarizer = Arc::new(Summarizer::new(
                self.config.llm.clone(),
                self.storage.clone(),
            ));
        }

        std::fs::write(&self.config_path, toml::to_string_pretty(&self.config)?)?;
        Ok(())
    }
}

/// Resolves the vault root. `COXINHA_VAULT` wins when set — used by
/// the boot smoke test to keep runs off the user's real home folder.
fn default_vault_root() -> Result<PathBuf> {
    if let Some(profile) = crate::app_paths::TestProfile::from_env()? {
        return Ok(profile.vault());
    }
    if let Some(custom) = std::env::var_os("COXINHA_VAULT") {
        return Ok(PathBuf::from(custom));
    }
    let dirs = directories::UserDirs::new().context("UserDirs unavailable")?;
    Ok(dirs.home_dir().join("coxinha"))
}

/// Detect shortcut sets that match earlier defaults we now know
/// were intercepted on Windows (Ctrl+Alt+N → OneNote in-app;
/// Ctrl+Alt+Shift+N → the transitional attempt that also failed).
/// If the whole set matches one of the stale defaults, reset to
/// the current `ShortcutsConfig::default()`. Users who customized
/// even one key keep their choice — only exact matches flip.
fn migrate_stale_shortcut_defaults(current: &mut ShortcutsConfig) -> bool {
    let stale_sets: [ShortcutsConfig; 4] = [
        ShortcutsConfig {
            new_note: "Ctrl+Alt+N".into(),
            open_app: "Ctrl+Alt+C".into(),
            agenda: "Ctrl+Alt+A".into(),
            meetings: "Ctrl+Alt+M".into(),
            toggle_recording: "Ctrl+Alt+R".into(),
        },
        ShortcutsConfig {
            new_note: "Ctrl+Alt+Shift+N".into(),
            open_app: "Ctrl+Alt+Shift+C".into(),
            agenda: "Ctrl+Alt+Shift+A".into(),
            meetings: "Ctrl+Alt+Shift+M".into(),
            toggle_recording: "Ctrl+Alt+Shift+R".into(),
        },
        ShortcutsConfig {
            new_note: "Super+Shift+N".into(),
            open_app: "Super+Shift+C".into(),
            agenda: "Super+Shift+A".into(),
            meetings: "Super+Shift+M".into(),
            toggle_recording: "Super+Shift+R".into(),
        },
        // Super+Y hero attempt — Super+Y registered cleanly on
        // most machines but the Super+Shift+* siblings collided
        // with Windows 11 bindings (Win+Shift+M restore minimized,
        // Win+Shift+R screen record, Win+Shift+A accessibility
        // tip focus). Plus the whole set leaked registrations on
        // force-kill, blocking fresh boots. Migration flips
        // forward to the Ctrl+Alt+<free-letter> set.
        ShortcutsConfig {
            new_note: "Super+Y".into(),
            open_app: "Super+Shift+C".into(),
            agenda: "Super+Shift+A".into(),
            meetings: "Super+Shift+M".into(),
            toggle_recording: "Super+Shift+R".into(),
        },
    ];
    if stale_sets.iter().any(|s| s == current) {
        *current = ShortcutsConfig::default();
        return true;
    }
    false
}

fn default_config(vault_root: &std::path::Path) -> AppConfig {
    AppConfig {
        vault_path: vault_root.display().to_string(),
        // Empty string = "use OS default at runtime".
        locale: String::new(),
        // None by default — a fresh install boots without needing a
        // model on disk. Users pick Whisper/Parakeet in Settings.
        transcriber: TranscriberConfig::None,
        diarizer: DiarizerConfig::None,
        llm: LlmProvider::Ollama {
            endpoint: "http://localhost:11434".into(),
            model: "llama3.2:3b".into(),
        },
        autostart: false,
        shortcuts: ShortcutsConfig::default(),
    }
}

pub(crate) fn bootstrap_vault(root: &std::path::Path) -> Result<()> {
    for sub in &[
        "notes",
        "meetings",
        "attachments",
        "daily",
        ".coxinha/models",
    ] {
        std::fs::create_dir_all(root.join(sub))?;
    }
    Ok(())
}

fn ensure_parent_dir(p: &std::path::Path) -> Result<()> {
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_builds_all_engines() {
        // Regression guard: default_config must produce a configuration
        // that the engine factories can build — otherwise a fresh
        // install panics during setup. This is the kind of failure
        // that bit us once and shouldn't again.
        let cfg = default_config(std::path::Path::new("C:/tmp/coxinha"));
        crate::transcriber::build(&cfg.transcriber).expect("transcriber builds");
        crate::diarizer::build(&cfg.diarizer).expect("diarizer builds");
    }

    #[test]
    fn migrate_flips_pre_spec_0042_ctrl_alt_defaults() {
        let mut stale = ShortcutsConfig {
            new_note: "Ctrl+Alt+N".into(),
            open_app: "Ctrl+Alt+C".into(),
            agenda: "Ctrl+Alt+A".into(),
            meetings: "Ctrl+Alt+M".into(),
            toggle_recording: "Ctrl+Alt+R".into(),
        };
        assert!(migrate_stale_shortcut_defaults(&mut stale));
        assert_eq!(stale, ShortcutsConfig::default());
    }

    #[test]
    fn migrate_flips_transitional_ctrl_alt_shift_defaults() {
        let mut stale = ShortcutsConfig {
            new_note: "Ctrl+Alt+Shift+N".into(),
            open_app: "Ctrl+Alt+Shift+C".into(),
            agenda: "Ctrl+Alt+Shift+A".into(),
            meetings: "Ctrl+Alt+Shift+M".into(),
            toggle_recording: "Ctrl+Alt+Shift+R".into(),
        };
        assert!(migrate_stale_shortcut_defaults(&mut stale));
        assert_eq!(stale, ShortcutsConfig::default());
    }

    #[test]
    fn migrate_flips_interim_super_shift_defaults() {
        let mut stale = ShortcutsConfig {
            new_note: "Super+Shift+N".into(),
            open_app: "Super+Shift+C".into(),
            agenda: "Super+Shift+A".into(),
            meetings: "Super+Shift+M".into(),
            toggle_recording: "Super+Shift+R".into(),
        };
        assert!(migrate_stale_shortcut_defaults(&mut stale));
        assert_eq!(stale, ShortcutsConfig::default());
    }

    #[test]
    fn migrate_flips_super_y_hero_defaults() {
        // The Super+Y + Super+Shift+{C,A,M,R} set shipped briefly
        // but collided with Windows 11 system bindings on several
        // letters. Make sure a config that landed on it migrates
        // forward to whatever the current default is.
        let mut stale = ShortcutsConfig {
            new_note: "Super+Y".into(),
            open_app: "Super+Shift+C".into(),
            agenda: "Super+Shift+A".into(),
            meetings: "Super+Shift+M".into(),
            toggle_recording: "Super+Shift+R".into(),
        };
        assert!(migrate_stale_shortcut_defaults(&mut stale));
        assert_eq!(stale, ShortcutsConfig::default());
    }

    #[test]
    fn migrate_keeps_customized_shortcuts() {
        // If the user customized any chord, migration leaves the
        // whole set alone — we don't want to silently erase a
        // deliberate rebind.
        let customized = ShortcutsConfig {
            new_note: "Ctrl+Alt+N".into(),
            open_app: "Ctrl+Alt+Shift+F12".into(), // user's pick
            agenda: "Ctrl+Alt+A".into(),
            meetings: "Ctrl+Alt+M".into(),
            toggle_recording: "Ctrl+Alt+R".into(),
        };
        let mut cfg = customized.clone();
        assert!(!migrate_stale_shortcut_defaults(&mut cfg));
        assert_eq!(cfg, customized);
    }

    #[test]
    fn migrate_is_noop_on_current_defaults() {
        let mut cfg = ShortcutsConfig::default();
        assert!(!migrate_stale_shortcut_defaults(&mut cfg));
        assert_eq!(cfg, ShortcutsConfig::default());
    }
}
