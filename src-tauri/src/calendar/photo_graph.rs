//! The Graph side of directory photos (spec 0117 P1): the two requests and what
//! their answers mean. Errors never include provider bodies.
use super::*;
use coxinha_core::identity::photos::MAX_PHOTO_BYTES;
use std::future::Future;

const GRAPH_USERS: &str = "https://graph.microsoft.com/v1.0/users";

/// Graph addresses a user by id or UPN, not by mail, which can differ. Only the
/// owner's own directory answers, so this is also the "in the tenant" check.
pub(super) fn directory_url(mail: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(GRAPH_USERS).map_err(|_| SAFE_ERROR)?;
    url.query_pairs_mut().extend_pairs([
        ("$filter", format!("mail eq '{}'", mail.replace('\'', "''"))),
        ("$select", "id,userPrincipalName".to_string()),
        ("$top", "2".to_string()),
    ]);
    Ok(url)
}

pub(super) fn photo_url(id: &str) -> Result<reqwest::Url, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| SAFE_ERROR)?;
    reqwest::Url::parse(&format!("{GRAPH_USERS}/{id}/photos/240x240/$value"))
        .map_err(|_| SAFE_ERROR.into())
}

/// The one member with that mail; guests are not of the owner's tenant.
pub(super) fn member_id(page: &serde_json::Value) -> Option<String> {
    let [user] = page["value"].as_array()?.as_slice() else {
        return None;
    };
    let principal = user["userPrincipalName"].as_str()?;
    if principal.to_ascii_uppercase().contains("#EXT#") {
        return None;
    }
    user["id"].as_str().map(str::to_string)
}

#[derive(Debug, PartialEq)]
pub(super) enum Reply<T> {
    Found(T),
    NotFound,
    Forbidden,
    Unauthorized,
    Later(Option<i64>),
}

pub(super) fn classify<T>(status: u16, retry_after: Option<i64>) -> Option<Reply<T>> {
    match status {
        200..=299 => None,
        404 => Some(Reply::NotFound),
        401 => Some(Reply::Unauthorized),
        403 => Some(Reply::Forbidden),
        _ => Some(Reply::Later(retry_after)),
    }
}

pub(super) trait Directory: Sync {
    fn lookup(&self, mail: &str) -> impl Future<Output = Reply<Option<String>>> + Send;
    fn photo(&self, id: &str) -> impl Future<Output = Reply<Vec<u8>>> + Send;
}

pub(super) struct Graph {
    pub(super) http: reqwest::Client,
    pub(super) access: String,
}

impl Graph {
    async fn get(&self, url: reqwest::Url) -> Result<reqwest::Response, Reply<()>> {
        let response = self
            .http
            .get(url)
            .bearer_auth(&self.access)
            .send()
            .await
            .map_err(|_| Reply::Later(None))?;
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()?.parse().ok());
        match classify(response.status().as_u16(), retry_after) {
            Some(reply) => Err(reply),
            None => Ok(response),
        }
    }
}

fn refusal<T>(reply: Reply<()>) -> Reply<T> {
    match reply {
        Reply::NotFound => Reply::NotFound,
        Reply::Forbidden => Reply::Forbidden,
        Reply::Unauthorized => Reply::Unauthorized,
        Reply::Later(after) => Reply::Later(after),
        Reply::Found(()) => Reply::Later(None),
    }
}

impl Directory for Graph {
    async fn lookup(&self, mail: &str) -> Reply<Option<String>> {
        let Ok(url) = directory_url(mail) else {
            return Reply::Found(None);
        };
        match self.get(url).await {
            Err(reply) => refusal(reply),
            Ok(response) => match response.json::<serde_json::Value>().await {
                Ok(page) => Reply::Found(member_id(&page)),
                Err(_) => Reply::Later(None),
            },
        }
    }
    async fn photo(&self, id: &str) -> Reply<Vec<u8>> {
        let Ok(url) = photo_url(id) else {
            return Reply::NotFound;
        };
        let mut response = match self.get(url).await {
            Err(reply) => return refusal(reply),
            Ok(response) => response,
        };
        let mut bytes = Vec::new();
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    bytes.extend_from_slice(&chunk);
                    if bytes.len() > MAX_PHOTO_BYTES {
                        return Reply::NotFound;
                    }
                }
                Ok(None) => return Reply::Found(bytes),
                Err(_) => return Reply::Later(None),
            }
        }
    }
}
