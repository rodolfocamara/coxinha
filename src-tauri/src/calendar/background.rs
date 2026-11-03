//! Keeps the Outlook cache fresh while connected (spec 0098). Connecting is
//! the user's opt-in to Graph; auto-record names calls from this cache.
use super::{cache_path, calendar_status, calendar_sync, Snapshot};
use chrono::{DateTime, Duration, Utc};

const EVERY: std::time::Duration = std::time::Duration::from_secs(15 * 60);
const FIRST: std::time::Duration = std::time::Duration::from_secs(30);
/// A call starting now needs today's agenda, not the one from this morning.
const STALE_MINUTES: i64 = 10;
const CALL_SYNC_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

fn connected(app: &tauri::AppHandle) -> bool {
    cache_path(app).is_ok_and(|path| path.exists())
}

pub(super) fn stale(synced_at: Option<&str>, now: DateTime<Utc>) -> bool {
    synced_at
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .is_none_or(|at| now - at.with_timezone(&Utc) > Duration::minutes(STALE_MINUTES))
}

/// Refreshes every 15 minutes; a failure waits for the next turn.
pub fn spawn(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST).await;
        loop {
            if connected(&app) {
                match calendar_sync(app.clone()).await {
                    Ok(_) => tracing::debug!("calendar refreshed"),
                    Err(code) => tracing::info!(code, "calendar refresh failed"),
                }
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// The cached agenda, refreshed first (bounded) when it is stale.
pub async fn fresh(app: &tauri::AppHandle) -> Snapshot {
    let cached = calendar_status(app.clone()).unwrap_or_default();
    if !connected(app) || !stale(cached.synced_at.as_deref(), Utc::now()) {
        return cached;
    }
    match tokio::time::timeout(CALL_SYNC_TIMEOUT, calendar_sync(app.clone())).await {
        Ok(Ok(snapshot)) => snapshot,
        _ => cached,
    }
}
