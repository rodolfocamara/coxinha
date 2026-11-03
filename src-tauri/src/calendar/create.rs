//! Creating an Outlook event for a meeting planned in Coxinha (spec 0104 P5).
//! Subject and times only: no body and no attendees, so nobody is invited.
use super::*;

const EVENTS_URL: &str = "https://graph.microsoft.com/v1.0/me/events";
const MAX_SUBJECT: usize = 255;

#[derive(Debug, PartialEq)]
pub(super) struct NewEvent {
    pub subject: String,
    pub start: chrono::DateTime<Utc>,
    pub end: chrono::DateTime<Utc>,
    pub transaction: String,
}

fn instant(raw: &str) -> Result<chrono::DateTime<Utc>, String> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| "calendar.createInvalid".to_string())
}

pub(super) fn validate(
    subject: &str,
    starts_at: &str,
    ends_at: &str,
    transaction: &str,
) -> Result<NewEvent, String> {
    let subject = subject.trim();
    let start = instant(starts_at)?;
    let end = instant(ends_at)?;
    let transaction_ok = !transaction.is_empty()
        && transaction.len() <= 64
        && transaction
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if subject.is_empty()
        || subject.chars().count() > MAX_SUBJECT
        || end <= start
        || end - start > Duration::days(14)
        || !transaction_ok
    {
        return Err("calendar.createInvalid".into());
    }
    Ok(NewEvent {
        subject: subject.to_string(),
        start,
        end,
        transaction: transaction.to_string(),
    })
}

/// The Graph `transactionId` makes a retry of the same meeting a no-op.
pub(super) fn create_body(event: &NewEvent) -> serde_json::Value {
    let at = |t: &chrono::DateTime<Utc>| {
        serde_json::json!({
            "dateTime": t.format("%Y-%m-%dT%H:%M:%S").to_string(),
            "timeZone": "UTC",
        })
    };
    serde_json::json!({
        "subject": event.subject,
        "start": at(&event.start),
        "end": at(&event.end),
        "showAs": "busy",
        "attendees": [],
        "transactionId": event.transaction,
    })
}

pub(super) fn create_url() -> reqwest::Url {
    reqwest::Url::parse(EVENTS_URL).expect("static Graph URL")
}

pub(super) enum Posted {
    Created(Option<Box<Event>>),
    Forbidden,
}

pub(super) fn posted(status: u16, body: Option<&serde_json::Value>) -> Result<Posted, String> {
    match status {
        200..=299 => Ok(Posted::Created(
            body.and_then(|b| parse_event(b).ok()).map(Box::new),
        )),
        403 => Ok(Posted::Forbidden),
        _ => Err(SAFE_ERROR.into()),
    }
}

/// Adds the created event when the refreshed list does not have it yet.
pub(super) fn insert_created(snapshot: &mut Snapshot, created: Option<Event>) {
    let Some(event) = created else { return };
    if snapshot.events.iter().any(|e| e.id == event.id) {
        return;
    }
    snapshot.events.push(event);
    snapshot
        .events
        .sort_by(|a, b| a.starts_at.cmp(&b.starts_at));
}

#[tauri::command]
#[specta::specta]
pub async fn calendar_create_event(
    app: tauri::AppHandle,
    subject: String,
    starts_at: String,
    ends_at: String,
    transaction_id: String,
) -> Result<Snapshot, String> {
    let event = validate(&subject, &starts_at, &ends_at, &transaction_id)?;
    let _operation = OPERATION.lock().await;
    let mut snapshot = calendar_status(app.clone())?;
    if snapshot.account.is_none() {
        return Err("calendar.createDisconnected".into());
    }
    let (credentials, tokens) = refresh(&app).await?;
    let account = credentials.account.clone();
    let storage_app = app.clone();
    blocking(move || write_credentials(&storage_app, &credentials)).await?;
    let outcome = if granted(tokens.scope.as_deref()).is_some_and(|a| !a.write) {
        Posted::Forbidden
    } else {
        let response = client()?
            .post(create_url())
            .bearer_auth(&tokens.access_token)
            .header("Prefer", "outlook.timezone=\"UTC\", IdType=\"ImmutableId\"")
            .json(&create_body(&event))
            .send()
            .await
            .map_err(|_| SAFE_ERROR)?;
        let status = response.status().as_u16();
        let body = response.json::<serde_json::Value>().await.ok();
        posted(status, body.as_ref())?
    };
    let created = match outcome {
        Posted::Forbidden => {
            snapshot.category_access.write = false;
            let app = app.clone();
            blocking(move || save(&app, &snapshot)).await?;
            return Err("calendar.createReconnect".into());
        }
        Posted::Created(created) => created.map(|event| *event),
    };
    // The event exists now: a failed refresh must not read as a failed create.
    let mut fresh = match fetch(&tokens.access_token, None).await {
        Ok(mut fresh) if verify_account(&account, fresh.account.as_deref()).is_ok() => {
            attach_categories(
                &mut fresh,
                &tokens.access_token,
                tokens.scope.as_deref(),
                Some(&snapshot),
            )
            .await;
            fresh
        }
        _ => snapshot,
    };
    insert_created(&mut fresh, created);
    fresh.category_access.write = true;
    let cached = fresh.clone();
    blocking(move || save(&app, &cached)).await?;
    Ok(fresh)
}

#[cfg(test)]
#[path = "create_tests.rs"]
mod tests;
