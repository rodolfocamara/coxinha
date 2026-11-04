//! Outlook categories (spec 0103): the master list with its colours, each
//! event's categories, and changing them on one event.
use super::*;

const MASTER_URL: &str = "https://graph.microsoft.com/v1.0/me/outlook/masterCategories";
const EVENTS_URL: &str = "https://graph.microsoft.com/v1.0/me/events";
const MAX_CATEGORIES: usize = 25;
const MAX_MASTER: usize = 500;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct Category {
    pub name: String,
    /// Outlook colour preset 0–24; `None` when the category has no colour.
    pub preset: Option<u8>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
pub struct CategoryAccess {
    /// `MailboxSettings.Read`: the master list and its colours.
    pub read: bool,
    /// `Calendars.ReadWrite`: changing an event's categories.
    pub write: bool,
}

pub(super) fn preset(raw: &str) -> Option<u8> {
    let digits = raw.to_ascii_lowercase();
    let digits = digits.strip_prefix("preset")?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse::<u8>().ok().filter(|n| *n <= 24)
}

/// `None` when the token response did not say which scopes it carries.
pub(super) fn granted(scope: Option<&str>) -> Option<CategoryAccess> {
    let names: Vec<String> = scope?
        .split_whitespace()
        .map(|s| s.rsplit('/').next().unwrap_or(s).to_ascii_lowercase())
        .collect();
    let has = |wanted: &[&str]| names.iter().any(|n| wanted.contains(&n.as_str()));
    Some(CategoryAccess {
        read: has(&["mailboxsettings.read", "mailboxsettings.readwrite"]),
        write: has(&["calendars.readwrite"]),
    })
}

pub(super) fn event_categories(item: &serde_json::Value) -> Vec<String> {
    let mut names = Vec::new();
    for name in item["categories"].as_array().into_iter().flatten() {
        if let Some(name) = name.as_str().map(str::trim).filter(|n| !n.is_empty()) {
            names.push(name.to_string());
        }
    }
    names
}

pub(super) fn parse_master(page: &serde_json::Value) -> Result<Vec<Category>, String> {
    let mut categories = Vec::new();
    for item in page["value"]
        .as_array()
        .ok_or(SAFE_ERROR)?
        .iter()
        .take(MAX_MASTER)
    {
        let Some(name) = item["displayName"].as_str().map(str::trim) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        categories.push(Category {
            name: name.to_string(),
            preset: item["color"].as_str().and_then(preset),
        });
    }
    Ok(categories)
}

pub(super) enum Master {
    Listed(Vec<Category>),
    Forbidden,
    Failed,
}

async fn master_categories(access: &str) -> Master {
    let Ok(http) = client() else {
        return Master::Failed;
    };
    let Ok(response) = http.get(MASTER_URL).bearer_auth(access).send().await else {
        return Master::Failed;
    };
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Master::Forbidden;
    }
    if !response.status().is_success() {
        return Master::Failed;
    }
    match response.json::<serde_json::Value>().await {
        Ok(page) => parse_master(&page).map_or(Master::Failed, Master::Listed),
        Err(_) => Master::Failed,
    }
}

/// Never fails the sync: without the scope the agenda still works, uncoloured.
pub(super) async fn attach_categories(
    snapshot: &mut Snapshot,
    access: &str,
    scope: Option<&str>,
    previous: Option<&Snapshot>,
) {
    let declared = granted(scope);
    let master = if declared.is_none_or(|a| a.read) {
        master_categories(access).await
    } else {
        Master::Forbidden
    };
    apply_master(snapshot, declared, master, previous);
}

pub(super) fn apply_master(
    snapshot: &mut Snapshot,
    declared: Option<CategoryAccess>,
    master: Master,
    previous: Option<&Snapshot>,
) {
    let mut access = declared.unwrap_or_default();
    match master {
        Master::Listed(list) => {
            access.read = true;
            snapshot.categories = list;
        }
        Master::Forbidden => access.read = false,
        Master::Failed => {
            access.read = previous.is_some_and(|p| p.category_access.read);
            snapshot.categories = previous.map(|p| p.categories.clone()).unwrap_or_default();
        }
    }
    if declared.is_none() {
        // A write that turns out to be forbidden clears this (403 below).
        access.write = access.read;
    }
    snapshot.category_access = access;
}

/// Trimmed, de-duplicated (case-insensitively, as Outlook does) and bounded.
pub(super) fn clean(categories: Vec<String>) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for name in categories {
        let name = name.trim();
        if name.is_empty() || out.iter().any(|n| n.eq_ignore_ascii_case(name)) {
            continue;
        }
        if name.chars().count() > 255 {
            return Err("calendar.categoriesInvalid".into());
        }
        out.push(name.to_string());
    }
    if out.len() > MAX_CATEGORIES {
        return Err("calendar.categoriesInvalid".into());
    }
    Ok(out)
}

pub(super) fn event_url(id: &str) -> Result<reqwest::Url, String> {
    if id.is_empty() || id == "." || id == ".." || id.len() > 1024 {
        return Err("calendar.eventMissing".into());
    }
    let mut url = reqwest::Url::parse(EVENTS_URL).map_err(|_| SAFE_ERROR)?;
    url.path_segments_mut().map_err(|_| SAFE_ERROR)?.push(id);
    Ok(url)
}

pub(super) fn patch_body(categories: &[String]) -> serde_json::Value {
    serde_json::json!({ "categories": categories })
}

/// Replaces the categories of one cached event; false when it is not cached.
pub(super) fn apply_categories(snapshot: &mut Snapshot, id: &str, categories: &[String]) -> bool {
    let Some(event) = snapshot.events.iter_mut().find(|e| e.id == id) else {
        return false;
    };
    event.categories = categories.to_vec();
    true
}

async fn save_blocking(app: &tauri::AppHandle, snapshot: Snapshot) -> Result<(), String> {
    let app = app.clone();
    blocking(move || save(&app, &snapshot)).await
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_set_categories(
    app: tauri::AppHandle,
    event_id: String,
    categories: Vec<String>,
) -> Result<Snapshot, String> {
    let categories = clean(categories)?;
    let url = event_url(&event_id)?;
    let _operation = OPERATION.lock().await;
    let mut snapshot = calendar_status(app.clone())?;
    if !snapshot.events.iter().any(|e| e.id == event_id) {
        return Err("calendar.eventMissing".into());
    }
    let (credentials, tokens) = refresh(&app).await?;
    let storage_app = app.clone();
    blocking(move || write_credentials(&storage_app, &credentials)).await?;
    let mut forbidden = granted(tokens.scope.as_deref()).is_some_and(|a| !a.write);
    if !forbidden {
        let response = client()?
            .patch(url)
            .bearer_auth(&tokens.access_token)
            // Cached IDs are immutable IDs (see `fetch`).
            .header("Prefer", "IdType=\"ImmutableId\"")
            .json(&patch_body(&categories))
            .send()
            .await
            .map_err(|_| SAFE_ERROR)?;
        match response.status().as_u16() {
            200..=299 => (),
            403 => forbidden = true,
            404 => return Err("calendar.eventMissing".into()),
            _ => return Err(SAFE_ERROR.into()),
        }
    }
    if forbidden {
        snapshot.category_access.write = false;
        save_blocking(&app, snapshot).await?;
        return Err("calendar.categoriesReconnect".into());
    }
    apply_categories(&mut snapshot, &event_id, &categories);
    snapshot.category_access.write = true;
    save_blocking(&app, snapshot.clone()).await?;
    Ok(snapshot)
}

#[cfg(test)]
mod tests;
