//! Token exchange and the loopback redirect. Errors never carry provider bodies.
use super::*;

pub(super) fn callback(request: &str, redirect: &str, state: &str) -> Result<String, String> {
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
#[derive(Deserialize)]
pub(super) struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Granted scopes; Entra lists every scope consented for Graph, not only the requested ones.
    #[serde(default)]
    pub scope: Option<String>,
}
pub(super) fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| SAFE_ERROR.into())
}
pub(super) async fn token(tenant: &str, form: &[(&str, &str)]) -> Result<Tokens, String> {
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
/// Refreshes with the base scope, which every connection has consented to;
/// the returned token still carries any scope granted later.
pub(super) async fn refresh(app: &tauri::AppHandle) -> Result<(Credentials, Tokens), String> {
    let storage_app = app.clone();
    let mut c = blocking(move || read_credentials(&storage_app)).await?;
    let tokens = token(
        &c.tenant,
        &[
            ("client_id", &c.client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", &c.refresh_token),
            ("scope", REFRESH_SCOPE),
        ],
    )
    .await?;
    if let Some(refresh) = &tokens.refresh_token {
        c.refresh_token = refresh.clone();
    }
    Ok((c, tokens))
}
pub(super) fn receive_callback(
    reader: &mut impl Read,
    redirect: &str,
    state: &str,
) -> Option<Result<String, String>> {
    let bytes = read_headers(reader).ok()?;
    let request = std::str::from_utf8(&bytes).ok()?;
    Some(callback(request, redirect, state))
}
pub(super) fn read_headers(reader: &mut impl Read) -> Result<Vec<u8>, String> {
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
