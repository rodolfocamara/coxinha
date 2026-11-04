//! Microsoft 365 profile photos of invitees (spec 0117 P1). Runs only after the
//! opt-in, asks for the scope only in that explicit sign-in, and never retries
//! on its own a refusal only the owner can undo.
use super::photo_graph::{Directory, Graph, Reply};
use super::*;
use crate::library::{photos::PhotoAction, Library};
use coxinha_core::identity::photos::{DuePhoto, PhotoInvitee};
use std::future::Future;
use tauri::Emitter;

pub const PHOTO_SCOPE: &str = "https://graph.microsoft.com/User.ReadBasic.All";
pub const PHOTOS_CHANGED_EVENT: &str = "person-photos-changed";
const PER_PASS: usize = 20;
const MIN_PAUSE_SECONDS: i64 = 60 * 60;
static PASS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) fn authorize_scope(directory_photos: bool) -> String {
    if directory_photos {
        format!("{AUTHORIZE_SCOPE} {PHOTO_SCOPE}")
    } else {
        AUTHORIZE_SCOPE.to_string()
    }
}

/// `None` when the token response did not say which scopes it carries.
pub(super) fn scope_granted(scope: Option<&str>) -> Option<bool> {
    let wanted = PHOTO_SCOPE.rsplit('/').next()?;
    Some(scope?.split_whitespace().any(|s| {
        s.rsplit('/')
            .next()
            .unwrap_or(s)
            .eq_ignore_ascii_case(wanted)
    }))
}

pub(super) fn invitees(snapshot: &Snapshot) -> Vec<PhotoInvitee> {
    snapshot
        .events
        .iter()
        .filter(|event| !event.cancelled)
        .flat_map(|event| event.organizer.iter().chain(&event.attendees))
        .filter_map(|person| {
            let mail = person.email.as_deref()?.trim();
            let shaped =
                mail.contains('@') && mail.len() <= 320 && !mail.contains(char::is_control);
            (shaped && !person.name.trim().is_empty()).then(|| PhotoInvitee {
                name: person.name.clone(),
                mail: mail.to_string(),
            })
        })
        .collect()
}

pub(super) trait Ledger: Sync {
    /// False once the opt-out or the person's removal won the race.
    fn record(
        &self,
        person: &str,
        now: i64,
        photo: Option<Vec<u8>>,
    ) -> impl Future<Output = Result<bool, String>> + Send;
    fn block(&self, code: &str) -> impl Future<Output = Result<(), String>> + Send;
    fn pause(&self, until: i64) -> impl Future<Output = Result<(), String>> + Send;
}

/// One bounded walk over the people due. The first refusal or outage ends it.
pub(super) async fn run(
    ledger: &impl Ledger,
    directory: &impl Directory,
    due: Vec<DuePhoto>,
    now: i64,
) -> Result<usize, String> {
    let mut changed = 0;
    for person in due {
        let fetched = match directory.lookup(&person.mail).await {
            Reply::Found(Some(id)) => directory.photo(&id).await,
            Reply::Found(None) | Reply::NotFound => Reply::NotFound,
            Reply::Forbidden => Reply::Forbidden,
            Reply::Unauthorized => Reply::Unauthorized,
            Reply::Later(after) => Reply::Later(after),
        };
        let photo = match fetched {
            Reply::Found(bytes) => Some(bytes),
            Reply::NotFound => None,
            Reply::Forbidden => {
                ledger.block("calendar.photosForbidden").await?;
                break;
            }
            Reply::Unauthorized => {
                ledger.block("calendar.reconnect").await?;
                break;
            }
            Reply::Later(after) => {
                ledger
                    .pause(now + after.unwrap_or(0).max(MIN_PAUSE_SECONDS))
                    .await?;
                break;
            }
        };
        if !ledger.record(&person.person_id, now, photo).await? {
            break;
        }
        changed += 1;
    }
    Ok(changed)
}

struct AppLedger(Library);

impl Ledger for AppLedger {
    async fn record(&self, person: &str, now: i64, photo: Option<Vec<u8>>) -> Result<bool, String> {
        let done = self
            .0
            .photos(PhotoAction::Record {
                person: person.to_string(),
                now,
                photo,
            })
            .await?;
        Ok(done.as_bool().unwrap_or(false))
    }
    async fn block(&self, code: &str) -> Result<(), String> {
        self.0
            .photos(PhotoAction::Block(code.to_string()))
            .await
            .map(|_| ())
    }
    async fn pause(&self, until: i64) -> Result<(), String> {
        self.0.photos(PhotoAction::Pause(until)).await.map(|_| ())
    }
}

fn library(app: &tauri::AppHandle) -> Option<Library> {
    app.try_state::<Library>().map(|state| (*state).clone())
}

fn photos_changed(app: &tauri::AppHandle) {
    let _ = app.emit(PHOTOS_CHANGED_EVENT, ());
}

/// Under the calendar's lock: refreshing rotates the stored refresh token.
async fn refreshed_tokens(app: &tauri::AppHandle) -> Result<Tokens, String> {
    let _operation = OPERATION.lock().await;
    let (credentials, tokens) = refresh(app).await?;
    let store_app = app.clone();
    blocking(move || write_credentials(&store_app, &credentials)).await?;
    Ok(tokens)
}

/// Nothing leaves the computer unless the worker says someone is due, which it
/// never does with the opt-in off: not even a token refresh.
pub(super) async fn pass(app: tauri::AppHandle) {
    let Some(library) = library(&app) else { return };
    let Ok(_pass) = PASS.try_lock() else { return };
    let Ok(snapshot) = calendar_status(app.clone()) else {
        return;
    };
    let now = Utc::now().timestamp();
    let due = match library.photos_due(invitees(&snapshot), now, PER_PASS).await {
        Ok(due) if !due.is_empty() => due,
        Ok(_) => return,
        Err(error) => {
            tracing::debug!(error, "directory photos not checked");
            return;
        }
    };
    let ledger = AppLedger(library);
    let tokens = refreshed_tokens(&app).await;
    let Ok(tokens) = tokens else {
        let _ = ledger.pause(now + MIN_PAUSE_SECONDS).await;
        return;
    };
    if scope_granted(tokens.scope.as_deref()) == Some(false) {
        let _ = ledger.block("calendar.photosConsent").await;
        photos_changed(&app);
        return;
    }
    let Ok(http) = client() else { return };
    let graph = Graph {
        http,
        access: tokens.access_token,
    };
    match run(&ledger, &graph, due, now).await {
        Ok(_) => photos_changed(&app),
        Err(error) => tracing::warn!(error, "directory photos pass stopped"),
    }
}

pub(super) async fn sweep(app: &tauri::AppHandle) {
    if let Some(library) = library(app) {
        let _ = library.photos(PhotoAction::Sweep).await;
    }
}

pub(super) async fn disable(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(library) = library(app) {
        library.photos(PhotoAction::Disable).await?;
        photos_changed(app);
    }
    Ok(())
}

/// Turning the switch off: stops requests and deletes every photo.
#[tauri::command]
#[specta::specta]
pub async fn directory_photos_disable(app: tauri::AppHandle) -> Result<(), String> {
    disable(&app).await
}

/// Decides the opt-in from what Entra really granted. A sign-in that did not
/// ask for photos only heals an opt-in already on: it never turns one on.
pub(super) fn sign_in_action(
    requested: bool,
    enabled: bool,
    scope: Option<&str>,
) -> Option<PhotoAction> {
    match (requested || enabled, scope_granted(scope) == Some(true)) {
        (false, _) => None,
        (true, true) => Some(PhotoAction::Enable),
        (true, false) => Some(PhotoAction::Block("calendar.photosConsent".into())),
    }
}

pub(super) async fn after_sign_in(
    app: &tauri::AppHandle,
    requested: bool,
    scope: Option<&str>,
    account_changed: bool,
) {
    let Some(library) = library(app) else { return };
    if account_changed {
        let _ = library.photos(PhotoAction::Disable).await;
    }
    let enabled = library
        .photos(PhotoAction::Status)
        .await
        .is_ok_and(|status| status["enabled"].as_bool() == Some(true));
    let action = sign_in_action(requested, enabled, scope);
    let granted = matches!(action, Some(PhotoAction::Enable));
    if let Some(action) = action {
        let _ = library.photos(action).await;
    }
    photos_changed(app);
    if granted {
        tauri::async_runtime::spawn(pass(app.clone()));
    }
}

#[cfg(test)]
#[path = "photos_tests.rs"]
mod tests;
