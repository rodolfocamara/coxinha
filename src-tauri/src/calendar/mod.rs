//! Explicit Outlook synchronization. The writes are an event's categories
//! (spec 0103) and creating a bare event (spec 0104 P5). Errors never include
//! provider bodies or tokens.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Mutex, OnceLock},
    time::Instant,
};
use tauri::Manager;
mod auth;
mod background;
pub(crate) mod categories;
pub(crate) mod create;
pub(crate) mod details;
mod graph;
mod photo_graph;
pub(crate) mod photos;
mod store;
use auth::*;
pub use background::{fresh, spawn as spawn_refresh};
use categories::*;
pub use categories::{Category, CategoryAccess};
pub use details::{AttendeeResponse, Response, ShowAs};
use graph::*;
use store::*;

/// Connecting asks for everything; refreshing asks only for what every
/// connection made before spec 0103 already granted, so those keep working.
const AUTHORIZE_SCOPE: &str = "https://graph.microsoft.com/Calendars.ReadBasic https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/MailboxSettings.Read openid offline_access";
const REFRESH_SCOPE: &str = "https://graph.microsoft.com/Calendars.ReadBasic openid offline_access";
const SAFE_ERROR: &str = "calendar.failed";
#[derive(Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub account: Option<String>,
    pub synced_at: Option<String>,
    pub events: Vec<Event>,
    /// Outlook's master category list (spec 0103).
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub category_access: CategoryAccess,
}
#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub cancelled: bool,
    pub all_day: bool,
    pub attendees: Vec<Candidate>,
    #[serde(default)]
    pub organizer: Option<Candidate>,
    #[serde(default)]
    pub series_master_id: Option<String>,
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub original_start: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    /// The owner's own answer (spec 0124 P1).
    #[serde(default)]
    pub response: Option<Response>,
    #[serde(default)]
    pub attendee_responses: Vec<AttendeeResponse>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub join_url: Option<String>,
    #[serde(default)]
    pub body_preview: Option<String>,
    #[serde(default)]
    pub show_as: Option<ShowAs>,
    #[serde(default)]
    pub is_organizer: bool,
    #[serde(default)]
    pub web_link: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, specta::Type)]
pub struct Candidate {
    pub name: String,
    pub email: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Credentials {
    client_id: String,
    tenant: String,
    refresh_token: String,
    account: String,
}
struct Pending {
    id: String,
    /// The explicit opt-in (spec 0117 P1): the only sign-in that asks for photos.
    directory_photos: bool,
    client_id: String,
    tenant: String,
    verifier: String,
    redirect: String,
    listener: TcpListener,
}
static PENDING: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
fn pending() -> &'static Mutex<Option<Pending>> {
    PENDING.get_or_init(|| Mutex::new(None))
}
#[tauri::command]
#[specta::specta]
pub fn calendar_status(app: tauri::AppHandle) -> Result<Snapshot, String> {
    match std::fs::read(cache_path(&app)?) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| "calendar.cacheInvalid".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Snapshot::default()),
        Err(_) => Err("calendar.cacheRead".into()),
    }
}
#[derive(Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Authorization {
    id: String,
    url: String,
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_begin(
    app: tauri::AppHandle,
    client_id: String,
    tenant: String,
    directory_photos: bool,
) -> Result<Authorization, String> {
    uuid::Uuid::parse_str(&client_id).map_err(|_| "calendar.clientInvalid".to_string())?;
    if !matches!(tenant.as_str(), "common" | "organizations" | "consumers")
        && uuid::Uuid::parse_str(&tenant).is_err()
    {
        return Err("calendar.tenantInvalid".into());
    }
    // Probe the OS store before sending the user to a consent screen.
    let store = entry(&app)?;
    match tokio::task::spawn_blocking(move || store.get_secret())
        .await
        .map_err(|_| SAFE_ERROR)?
    {
        Ok(_) | Err(keyring::Error::NoEntry) => (),
        Err(error) => return Err(store_error(error)),
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| SAFE_ERROR)?;
    listener.set_nonblocking(true).map_err(|_| SAFE_ERROR)?;
    let redirect = format!(
        "http://localhost:{}/callback",
        listener.local_addr().map_err(|_| SAFE_ERROR)?.port()
    );
    let id = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = reqwest::Url::parse(&format!(
        "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize"
    ))
    .map_err(|_| SAFE_ERROR)?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id.as_str()),
        ("response_type", "code"),
        ("redirect_uri", redirect.as_str()),
        ("scope", photos::authorize_scope(directory_photos).as_str()),
        ("state", id.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    *pending().lock().map_err(|_| SAFE_ERROR)? = Some(Pending {
        id: id.clone(),
        directory_photos,
        client_id,
        tenant,
        verifier,
        redirect,
        listener,
    });
    Ok(Authorization {
        id,
        url: url.to_string(),
    })
}
#[tauri::command]
#[specta::specta]
pub fn calendar_cancel(id: Option<String>) -> Result<(), String> {
    let mut guard = pending().lock().map_err(|_| SAFE_ERROR)?;
    if id
        .as_ref()
        .is_none_or(|id| guard.as_ref().is_some_and(|p| &p.id == id))
    {
        *guard = None;
    }
    Ok(())
}
fn active(id: &str) -> bool {
    pending()
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|p| p.id == id))
        .unwrap_or(false)
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_complete(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    let _operation = OPERATION.lock().await;
    let (listener, directory_photos, client_id, tenant, verifier, redirect) = {
        let guard = pending().lock().map_err(|_| SAFE_ERROR)?;
        let p = guard
            .as_ref()
            .filter(|p| p.id == id)
            .ok_or("calendar.cancelled")?;
        (
            p.listener.try_clone().map_err(|_| SAFE_ERROR)?,
            p.directory_photos,
            p.client_id.clone(),
            p.tenant.clone(),
            p.verifier.clone(),
            p.redirect.clone(),
        )
    };
    let state = id.clone();
    let target = redirect.clone();
    let code = tokio::task::spawn_blocking(move || {
        let deadline=Instant::now()+std::time::Duration::from_secs(180);
        while Instant::now()<deadline && active(&state) {
            if let Ok((mut stream,_))=listener.accept() {
                stream.set_nonblocking(false).map_err(|_|SAFE_ERROR)?;
                stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).map_err(|_|SAFE_ERROR)?;
                let result=match receive_callback(&mut stream,&target,&state) { Some(result)=>result, None=>continue };
                let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nReturn to Coxinha. You can close this window.");
                if result.is_ok() || result.as_ref().is_err_and(|e| e == "calendar.cancelled" || e == "calendar.authorizationDenied") { return result; }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        Err("calendar.expired".into())
    }).await.map_err(|_|SAFE_ERROR)??;
    let tokens = token(
        &tenant,
        &[
            ("client_id", &client_id),
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    if !active(&id) {
        return Err("calendar.cancelled".into());
    }
    let mut snapshot = fetch(&tokens.access_token, Some(&id)).await?;
    attach_categories(
        &mut snapshot,
        &tokens.access_token,
        tokens.scope.as_deref(),
        None,
    )
    .await;
    let granted_scope = tokens.scope.clone();
    let previous_account = calendar_status(app.clone()).ok().and_then(|s| s.account);
    let account_changed = previous_account.is_some() && previous_account != snapshot.account;
    let credentials = Credentials {
        client_id,
        tenant,
        refresh_token: tokens.refresh_token.ok_or(SAFE_ERROR)?,
        account: snapshot.account.clone().ok_or(SAFE_ERROR)?,
    };
    let cached = snapshot.clone();
    let photos_app = app.clone();
    blocking(move || {
        if !active(&id) {
            return Err("calendar.cancelled".into());
        }
        write_credentials(&app, &credentials)?;
        let mut guard = pending().lock().map_err(|_| SAFE_ERROR)?;
        if guard.as_ref().map(|p| p.id.as_str()) != Some(id.as_str()) {
            drop(guard);
            let _ = entry(&app)?.delete_credential();
            return Err("calendar.cancelled".into());
        }
        save(&app, &cached)?;
        *guard = None;
        Ok(())
    })
    .await?;
    photos::after_sign_in(
        &photos_app,
        directory_photos,
        granted_scope.as_deref(),
        account_changed,
    )
    .await;
    Ok(snapshot)
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_sync(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let _operation = OPERATION.lock().await;
    let (c, tokens) = refresh(&app).await?;
    let mut snapshot = fetch(&tokens.access_token, None).await?;
    verify_account(&c.account, snapshot.account.as_deref())?;
    let previous = calendar_status(app.clone()).ok();
    attach_categories(
        &mut snapshot,
        &tokens.access_token,
        tokens.scope.as_deref(),
        previous.as_ref(),
    )
    .await;
    let cached = snapshot.clone();
    blocking(move || {
        write_credentials(&app, &c)?;
        save(&app, &cached)
    })
    .await?;
    Ok(snapshot)
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    calendar_cancel(None)?;
    let _operation = OPERATION.lock().await;
    photos::disable(&app).await?;
    blocking(move || {
        match entry(&app)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(error) => return Err(store_error(error)),
        }
        let path = cache_path(&app)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| SAFE_ERROR)?;
        }
        changed(&app);
        Ok(())
    })
    .await
}
#[cfg(test)]
mod tests;
