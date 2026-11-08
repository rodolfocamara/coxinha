//! Linux media URLs backed by verified file capabilities, never HTTP paths.
use std::{
    collections::HashMap,
    net::TcpListener,
    sync::{Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio::{net::TcpListener as AsyncListener, sync::oneshot, task::JoinSet};

mod grant;
mod http;
#[cfg(test)]
mod tests;

const MAX_CONNECTIONS: usize = 8;
const MAX_GRANTS: usize = 256;
const GRANT_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);
const HEADER_TIMEOUT: Duration = Duration::from_secs(2);
const REVOCATION_POLL: Duration = Duration::from_millis(100);
// A full PCM RIFF track can exceed twelve hours; an actively draining player is valid.
const REQUEST_TIMEOUT: Duration = GRANT_LIFETIME;
const HEADER_LIMIT: usize = 8192;
const CHUNK: usize = 64 * 1024;

struct Server {
    authority: String,
    origins: Vec<String>,
    grants: Mutex<HashMap<String, Arc<grant::Grant>>>,
}

pub(crate) struct NativeAudio {
    server: Arc<Server>,
    lifetime: Mutex<Option<(oneshot::Sender<()>, JoinHandle<()>)>>,
}

impl NativeAudio {
    pub(crate) fn start(origins: Vec<String>) -> anyhow::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let authority = listener.local_addr()?.to_string();
        let server = Arc::new(Server {
            authority,
            origins,
            grants: Mutex::new(HashMap::new()),
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_io()
            .enable_time()
            .build()?;
        let (stop, mut stopped) = oneshot::channel();
        let serving = server.clone();
        let join = std::thread::Builder::new()
            .name("native-audio".into())
            .spawn(move || {
                runtime.block_on(async move {
                    let Ok(listener) = AsyncListener::from_std(listener) else {
                        return;
                    };
                    let mut clients = JoinSet::new();
                    loop {
                        tokio::select! {
                            biased;
                            _ = &mut stopped => break,
                            _ = clients.join_next(), if !clients.is_empty() => {},
                            accepted = listener.accept() => {
                                let Ok((socket, peer)) = accepted else { break };
                                if !peer.ip().is_loopback() || clients.len() >= MAX_CONNECTIONS {
                                    continue;
                                }
                                let server = serving.clone();
                                clients.spawn(async move {
                                    let _ = tokio::time::timeout(
                                        REQUEST_TIMEOUT, http::serve(socket, server)
                                    ).await;
                                });
                            }
                        }
                    }
                    clients.abort_all();
                    while clients.join_next().await.is_some() {}
                });
            })?;
        Ok(Self {
            server,
            lifetime: Mutex::new(Some((stop, join))),
        })
    }

    pub(crate) fn stop(&self) {
        // Serialize stop/grant, but never hold the registry while joining IO.
        let mut lifetime = self.lifetime.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((stop, join)) = lifetime.take() {
            {
                let mut grants = self.server.grants.lock().unwrap_or_else(|e| e.into_inner());
                for grant in grants.values() {
                    grant
                        .revoked
                        .store(true, std::sync::atomic::Ordering::Release);
                }
                grants.clear();
            }
            let _ = stop.send(());
            let _ = join.join();
        }
    }
}

impl Drop for NativeAudio {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The application origin is fixed by Tauri; development adds only its configured URL.
pub(crate) fn app_origins(config: &tauri::Config) -> Vec<String> {
    let mut origins = vec!["tauri://localhost".into()];
    if cfg!(debug_assertions) {
        if let Some(url) = &config.build.dev_url {
            origins.push(url.origin().ascii_serialization());
        }
    }
    origins
}
