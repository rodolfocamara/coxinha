use super::*;
pub(super) fn entry(app: &tauri::AppHandle) -> Result<keyring::Entry, String> {
    if !cfg!(any(target_os = "linux", target_os = "windows")) {
        return Err("calendar.storeUnavailable".into());
    }
    keyring::Entry::new("coxinha.outlook", &installation_key(&cache_path(app)?))
        .map_err(|_| "calendar.storeUnavailable".into())
}
pub(super) fn cache_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let profile = crate::app_paths::TestProfile::from_env().map_err(|_| SAFE_ERROR)?;
    resolve_cache_path(profile.as_ref(), || {
        app.path().app_data_dir().map_err(|_| SAFE_ERROR.into())
    })
}

// Explicit inputs keep path/namespace contracts independent of AppHandle and keyring.
fn resolve_cache_path(
    profile: Option<&crate::app_paths::TestProfile>,
    app_data_dir: impl FnOnce() -> Result<std::path::PathBuf, String>,
) -> Result<std::path::PathBuf, String> {
    if let Some(profile) = profile {
        return Ok(profile.root.join("app-data/outlook-cache.json"));
    }
    Ok(app_data_dir()?.join("outlook-cache.json"))
}
pub(super) fn save(app: &tauri::AppHandle, snapshot: &Snapshot) -> Result<(), String> {
    let path = cache_path(app)?;
    let parent = path.parent().ok_or(SAFE_ERROR)?;
    std::fs::create_dir_all(parent).map_err(|_| SAFE_ERROR)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| SAFE_ERROR)?;
    file.write_all(&serde_json::to_vec(snapshot).map_err(|_| SAFE_ERROR)?)
        .map_err(|_| SAFE_ERROR)?;
    file.as_file().sync_all().map_err(|_| SAFE_ERROR)?;
    file.persist(path).map_err(|_| SAFE_ERROR)?;
    Ok(())
}
pub(super) fn installation_key(path: &std::path::Path) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(path.to_string_lossy().as_bytes()))
}
pub(super) fn verify_account(expected: &str, actual: Option<&str>) -> Result<(), String> {
    if Some(expected) != actual {
        return Err("calendar.accountChanged".into());
    }
    Ok(())
}

// Windows Credential Manager limits the blob to 2,560 bytes. set_password
// encodes UTF-16; the versioned binary API preserves the full UTF-8 budget.
const SECRET_PREFIX: &[u8] = b"CXO1\n";
const WINDOWS_BLOB_LIMIT: usize = 2560;
pub(super) fn store_error(error: keyring::Error) -> String {
    match error {
        keyring::Error::NoStorageAccess(_) => "calendar.storeLocked",
        keyring::Error::NoEntry => "calendar.reconnect",
        keyring::Error::TooLong(_, _) => "calendar.secretTooLong",
        _ => "calendar.storeUnavailable",
    }
    .into()
}
pub(super) fn credential_bytes(
    credentials: &Credentials,
    limit: Option<usize>,
) -> Result<Vec<u8>, String> {
    let mut bytes = SECRET_PREFIX.to_vec();
    bytes.extend(serde_json::to_vec(credentials).map_err(|_| SAFE_ERROR)?);
    if limit.is_some_and(|limit| bytes.len() > limit) {
        return Err("calendar.secretTooLong".into());
    }
    Ok(bytes)
}
pub(super) fn write_credentials(
    app: &tauri::AppHandle,
    credentials: &Credentials,
) -> Result<(), String> {
    store_credentials_with(
        credentials,
        cfg!(target_os = "windows").then_some(WINDOWS_BLOB_LIMIT),
        |bytes| entry(app)?.set_secret(bytes).map_err(store_error),
    )
}
pub(super) fn store_credentials_with(
    credentials: &Credentials,
    limit: Option<usize>,
    write: impl FnOnce(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    let bytes = credential_bytes(credentials, limit)?;
    write(&bytes)
}
pub(super) fn decode_credentials(bytes: &[u8]) -> Result<Credentials, String> {
    let credentials: Credentials = if let Some(json) = bytes.strip_prefix(SECRET_PREFIX) {
        serde_json::from_slice(json).map_err(|_| SAFE_ERROR)?
    } else if let Ok(credentials) = serde_json::from_slice(bytes) {
        credentials
    } else {
        // Legacy Windows set_password used little-endian UTF-16.
        if !bytes.len().is_multiple_of(2) {
            return Err(SAFE_ERROR.into());
        }
        let words: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        let legacy = String::from_utf16(&words).map_err(|_| SAFE_ERROR)?;
        serde_json::from_str(&legacy).map_err(|_| SAFE_ERROR)?
    };
    if uuid::Uuid::parse_str(&credentials.client_id).is_err()
        || (!matches!(
            credentials.tenant.as_str(),
            "common" | "organizations" | "consumers"
        ) && uuid::Uuid::parse_str(&credentials.tenant).is_err())
        || credentials.account.is_empty()
        || credentials.refresh_token.is_empty()
    {
        return Err(SAFE_ERROR.into());
    }
    Ok(credentials)
}
pub(super) fn read_credentials(app: &tauri::AppHandle) -> Result<Credentials, String> {
    decode_credentials(&entry(app)?.get_secret().map_err(store_error)?)
}
pub(super) async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(operation)
        .await
        .map_err(|_| SAFE_ERROR)?
}

#[cfg(test)]
mod path_tests;
