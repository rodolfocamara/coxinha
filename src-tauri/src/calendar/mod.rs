//! Explicit, read-only Outlook synchronization. Errors never include provider bodies or tokens.
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
mod graph;
mod store;
use graph::*;
use store::*;

const SCOPE: &str = "https://graph.microsoft.com/Calendars.ReadBasic openid offline_access";
const SAFE_ERROR: &str = "calendar.failed";
#[derive(Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub account: Option<String>,
    pub synced_at: Option<String>,
    pub events: Vec<Event>,
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
        ("scope", SCOPE),
        ("state", id.as_str()),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    *pending().lock().map_err(|_| SAFE_ERROR)? = Some(Pending {
        id: id.clone(),
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
fn callback(request: &str, redirect: &str, state: &str) -> Result<String, String> {
    let first = request.lines().next().ok_or(SAFE_ERROR)?;
    let target = first
        .strip_prefix("GET ")
        .and_then(|s| s.strip_suffix(" HTTP/1.1"))
        .ok_or(SAFE_ERROR)?;
    if !target.starts_with("/callback?") {
        return Err(SAFE_ERROR.into());
    }
    let base = reqwest::Url::parse(redirect).map_err(|_| SAFE_ERROR)?;
    let expected_host = format!("localhost:{}", base.port().ok_or(SAFE_ERROR)?);
    let hosts: Vec<_> = request
        .lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| key.eq_ignore_ascii_case("host"))
        .collect();
    if hosts.len() != 1 || hosts[0].1.trim() != expected_host {
        return Err(SAFE_ERROR.into());
    }
    let url = base.join(target).map_err(|_| SAFE_ERROR)?;
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.iter().filter(|(k, _)| k == "state").count() != 1
        || pairs
            .iter()
            .find(|(k, _)| k == "state")
            .map(|(_, v)| v.as_ref())
            != Some(state)
    {
        return Err(SAFE_ERROR.into());
    }
    if let Some((_, error)) = pairs.iter().find(|(key, _)| key == "error") {
        return Err(if error == "access_denied" {
            "calendar.cancelled"
        } else {
            "calendar.authorizationDenied"
        }
        .into());
    }
    if pairs.iter().filter(|(k, _)| k == "code").count() != 1 {
        return Err(SAFE_ERROR.into());
    }
    pairs
        .iter()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
        .ok_or(SAFE_ERROR.into())
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_complete(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    let _operation = OPERATION.lock().await;
    let (listener, client_id, tenant, verifier, redirect) = {
        let guard = pending().lock().map_err(|_| SAFE_ERROR)?;
        let p = guard
            .as_ref()
            .filter(|p| p.id == id)
            .ok_or("calendar.cancelled")?;
        (
            p.listener.try_clone().map_err(|_| SAFE_ERROR)?,
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
    let snapshot = fetch(&tokens.access_token, Some(&id)).await?;
    let credentials = Credentials {
        client_id,
        tenant,
        refresh_token: tokens.refresh_token.ok_or(SAFE_ERROR)?,
        account: snapshot.account.clone().ok_or(SAFE_ERROR)?,
    };
    let cached = snapshot.clone();
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
    Ok(snapshot)
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| SAFE_ERROR.into())
}
async fn token(tenant: &str, form: &[(&str, &str)]) -> Result<Tokens, String> {
    let response = client()?
        .post(format!(
            "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
        ))
        .form(form)
        .send()
        .await
        .map_err(|_| SAFE_ERROR)?;
    if !response.status().is_success() {
        if matches!(response.status().as_u16(), 400 | 401)
            && form
                .iter()
                .any(|(key, value)| *key == "grant_type" && *value == "refresh_token")
        {
            return Err("calendar.reconnect".into());
        }
        return Err("calendar.authorizationDenied".into());
    }
    response.json().await.map_err(|_| SAFE_ERROR.into())
}
#[tauri::command]
#[specta::specta]
pub async fn calendar_sync(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let _operation = OPERATION.lock().await;
    let storage_app = app.clone();
    let mut c = blocking(move || read_credentials(&storage_app)).await?;
    let tokens = token(
        &c.tenant,
        &[
            ("client_id", &c.client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", &c.refresh_token),
            ("scope", SCOPE),
        ],
    )
    .await?;
    let snapshot = fetch(&tokens.access_token, None).await?;
    verify_account(&c.account, snapshot.account.as_deref())?;
    if let Some(refresh) = tokens.refresh_token {
        c.refresh_token = refresh;
    }
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
    blocking(move || {
        match entry(&app)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(error) => return Err(store_error(error)),
        }
        let path = cache_path(&app)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|_| SAFE_ERROR)?;
        }
        Ok(())
    })
    .await
}
fn receive_callback(
    reader: &mut impl Read,
    redirect: &str,
    state: &str,
) -> Option<Result<String, String>> {
    let bytes = read_headers(reader).ok()?;
    let request = std::str::from_utf8(&bytes).ok()?;
    Some(callback(request, redirect, state))
}
fn read_headers(reader: &mut impl Read) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + std::time::Duration::from_secs(5);
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 512];
    while bytes.len() < 8192 && Instant::now() < deadline {
        let count = reader.read(&mut chunk).map_err(|_| SAFE_ERROR)?;
        if count == 0 {
            return Err(SAFE_ERROR.into());
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.windows(4).any(|s| s == b"\r\n\r\n") {
            return Ok(bytes);
        }
    }
    Err(SAFE_ERROR.into())
}

#[cfg(test)]
mod tests;
