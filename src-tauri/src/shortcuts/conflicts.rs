//! Who else claims a chord, where the desktop lets us read it (spec 0128 P6).
//!
//! KDE keeps global shortcuts in `kglobalshortcutsrc`, and an app declares its
//! defaults with `X-KDE-Shortcuts` in its `.desktop` file. Other desktops give
//! us nothing to read, so an empty answer means "not known", not "free".

use std::collections::HashSet;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopChord {
    pub chord: String,
    pub owner: String,
}

/// One order and spelling for a chord, whichever tool wrote it.
fn normalize(chord: &str) -> String {
    let mut parts: Vec<String> = chord
        .split('+')
        .map(|part| part.trim().to_lowercase())
        .map(|part| match part.as_str() {
            "control" => "ctrl".to_string(),
            "meta" | "cmd" | "command" | "win" => "super".to_string(),
            _ => part
                .strip_prefix("key")
                .or_else(|| part.strip_prefix("digit"))
                .filter(|rest| rest.len() == 1)
                .map(str::to_string)
                .unwrap_or(part),
        })
        .collect();
    let key = parts.pop().unwrap_or_default();
    parts.sort();
    parts.push(key);
    parts.join("+")
}

/// `org.kde.konsole.desktop` is called `konsole` by anyone who would read this.
fn app_name(desktop_id: &str) -> String {
    let stem = desktop_id.strip_suffix(".desktop").unwrap_or(desktop_id);
    stem.rsplit('.').next().unwrap_or(stem).to_string()
}

fn real_chords(value: &str) -> impl Iterator<Item = &str> {
    value
        .split("\\t")
        .map(str::trim)
        .filter(|chord| !chord.is_empty() && *chord != "none")
}

/// Parses `kglobalshortcutsrc`: `name=current,default,description`, and under
/// `[services][app.desktop]` the current chords alone. Also returns the apps
/// with a `services` section, whose `.desktop` defaults no longer apply.
pub fn parse_kglobalshortcuts(text: &str) -> (Vec<DesktopChord>, HashSet<String>) {
    let mut found = Vec::new();
    let mut overridden = HashSet::new();
    let mut section: Option<(String, bool)> = None;
    for line in text.lines().map(str::trim) {
        if let Some(header) = line.strip_prefix('[') {
            let names: Vec<&str> = header.trim_end_matches(']').split("][").collect();
            section = match names.as_slice() {
                ["services", service] => {
                    overridden.insert((*service).to_string());
                    Some(((*service).to_string(), true))
                }
                [component, ..] => Some(((*component).to_string(), false)),
                [] => None,
            };
            continue;
        }
        let (Some((component, service)), Some((name, value))) = (&section, line.split_once('='))
        else {
            continue;
        };
        if name.starts_with("_k_friendly_name") {
            continue;
        }
        let mut fields = value.split(',');
        let current = fields.next().unwrap_or_default();
        let description = fields.nth(1).unwrap_or(name).trim();
        let owner = if *service {
            app_name(component)
        } else {
            format!("{component}: {description}")
        };
        for chord in real_chords(current) {
            found.push(DesktopChord {
                chord: normalize(chord),
                owner: owner.clone(),
            });
        }
    }
    (found, overridden)
}

/// Chords a `.desktop` file declares in `X-KDE-Shortcuts`.
pub fn parse_desktop_entry(file_name: &str, text: &str) -> Vec<DesktopChord> {
    let value = |key: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
    };
    let Some(chords) = value("X-KDE-Shortcuts") else {
        return Vec::new();
    };
    let owner = value("Name")
        .map(str::to_string)
        .unwrap_or_else(|| app_name(file_name));
    chords
        .split(',')
        .map(str::trim)
        .filter(|chord| !chord.is_empty())
        .map(|chord| DesktopChord {
            chord: normalize(chord),
            owner: owner.clone(),
        })
        .collect()
}

pub fn chord_owner(chord: &str, chords: &[DesktopChord]) -> Option<String> {
    let wanted = normalize(chord);
    chords
        .iter()
        .find(|known| known.chord == wanted)
        .map(|known| known.owner.clone())
}

fn home_dir(variable: &str, fallback: &str) -> Option<PathBuf> {
    std::env::var_os(variable)
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(fallback)))
}

fn application_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from("/usr/share/applications")];
    if let Some(home) = home_dir("XDG_DATA_HOME", ".local/share") {
        dirs.push(home.join("applications"));
    }
    dirs
}

/// What KDE says about the chords of this session; empty on other desktops.
pub fn desktop_chords() -> Vec<DesktopChord> {
    let on_kde = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|desktop| {
        desktop
            .split(':')
            .any(|name| name.eq_ignore_ascii_case("kde"))
    });
    if !on_kde {
        return Vec::new();
    }
    let configured = home_dir("XDG_CONFIG_HOME", ".config")
        .and_then(|home| std::fs::read_to_string(home.join("kglobalshortcutsrc")).ok())
        .unwrap_or_default();
    let (mut chords, overridden) = parse_kglobalshortcuts(&configured);
    for dir in application_dirs() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".desktop") || overridden.contains(&name) {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                chords.extend(parse_desktop_entry(&name, &text));
            }
        }
    }
    chords
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILE: &str = "\
[kwin]
_k_friendly_name=KWin
Window Close=Alt+F4,Alt+F4,Close Window
Unused=none,none,Unused
[services][kitty.desktop]
_launch=Ctrl+Alt+T\\tMeta+Return
[services][org.kde.konsole.desktop]
_launch=none
[services][brave-browser.desktop]
_launch=Meta+Y, Meta+Y
";

    #[test]
    fn reads_the_current_chords_and_ignores_none() {
        let (chords, overridden) = parse_kglobalshortcuts(FILE);
        assert_eq!(chord_owner("Ctrl+Alt+T", &chords).as_deref(), Some("kitty"));
        assert_eq!(
            chord_owner("Super+Return", &chords).as_deref(),
            Some("kitty")
        );
        assert_eq!(
            chord_owner("Alt+F4", &chords).as_deref(),
            Some("kwin: Close Window")
        );
        assert_eq!(
            chord_owner("Meta+Y", &chords).as_deref(),
            Some("brave-browser")
        );
        assert!(!chords.iter().any(|c| c.chord == "none"));
        assert!(overridden.contains("org.kde.konsole.desktop"));
    }

    #[test]
    fn chords_compare_whatever_their_order_and_spelling() {
        let (chords, _) = parse_kglobalshortcuts(FILE);
        assert!(chord_owner("Alt+Ctrl+T", &chords).is_some());
        assert!(chord_owner("Control+Alt+KeyT", &chords).is_some());
        assert_eq!(chord_owner("Ctrl+Alt+Y", &chords), None);
    }

    #[test]
    fn a_desktop_entry_declares_its_defaults() {
        let chords = parse_desktop_entry(
            "org.kde.konsole.desktop",
            "[Desktop Entry]\nName=Konsole\nX-KDE-Shortcuts=Ctrl+Alt+T,Meta+T\n",
        );
        assert_eq!(
            chord_owner("Ctrl+Alt+T", &chords).as_deref(),
            Some("Konsole")
        );
        assert_eq!(chord_owner("Super+T", &chords).as_deref(), Some("Konsole"));
        assert!(parse_desktop_entry("a.desktop", "[Desktop Entry]\nName=A\n").is_empty());
    }

    #[test]
    fn an_unreadable_file_means_nothing_is_known() {
        let (chords, overridden) = parse_kglobalshortcuts("");
        assert!(chords.is_empty() && overridden.is_empty());
    }
}
