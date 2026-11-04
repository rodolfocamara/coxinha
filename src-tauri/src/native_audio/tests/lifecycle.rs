use super::*;

#[test]
fn authorized_body_survives_backpressure_longer_than_header_deadline() {
    let f = Fixture::with_frames(4_194_304);
    let mut paused = f.socket();
    paused
        .write_all(
            format!(
                "GET {} HTTP/1.1\r\nHost: {}\r\n\r\n",
                f.target(),
                f.audio.server.authority
            )
            .as_bytes(),
        )
        .unwrap();
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        assert_eq!(paused.read(&mut byte).unwrap(), 1);
        header.push(byte[0]);
    }
    assert!(header.starts_with(b"HTTP/1.1 200 OK\r\n"));
    // Stop consuming beyond the former write deadline, then resume this exact connection.
    std::thread::sleep(HEADER_TIMEOUT + Duration::from_millis(500));
    let mut body = Vec::new();
    paused.read_to_end(&mut body).unwrap();
    assert_eq!(
        body.len(),
        f.bytes.len(),
        "authorized body was truncated after backpressure"
    );
    assert!(
        body == f.bytes,
        "resumed body must match byte for byte without duplicates"
    );
}

#[test]
fn request_lifetime_can_stream_the_longest_supported_pcm_track() {
    let longest_pcm = Duration::from_secs(u32::MAX as u64 / (48000 * 2));
    assert!(REQUEST_TIMEOUT > longest_pcm);
    assert!(HEADER_TIMEOUT < Duration::from_secs(3));
}

#[test]
fn revoked_expired_and_stopped_capabilities_fail_closed() {
    let f = Fixture::new();
    let token = f
        .target()
        .strip_prefix("/audio/")
        .unwrap()
        .strip_suffix(".wav")
        .unwrap()
        .to_string();
    let grant = f
        .audio
        .server
        .grants
        .lock()
        .unwrap()
        .get(&token)
        .unwrap()
        .clone();
    grant.revoked.store(true, Ordering::Release);
    assert_eq!(f.request("GET", "").status, 404);
    drop(grant);
    // Regrant removes revoked entries and issues a new capability.
    let next = f.audio.grant_detail(f.detail.clone()).unwrap();
    assert_ne!(next["audio"]["mic"], f.url);
    let next_token = next["audio"]["mic"]
        .as_str()
        .unwrap()
        .split('/')
        .next_back()
        .unwrap()
        .trim_end_matches(".wav")
        .to_string();
    {
        let mut registry = f.audio.server.grants.lock().unwrap();
        let grant = Arc::get_mut(registry.get_mut(&next_token).unwrap()).unwrap();
        grant.expires = Instant::now() - Duration::from_secs(1);
    }
    let expired_target = format!("/audio/{next_token}.wav");
    assert_eq!(
        f.raw(&format!(
            "GET {expired_target} HTTP/1.1\r\nHost: {}\r\n\r\n",
            f.audio.server.authority
        ))
        .status,
        404
    );
    let address = f.audio.server.authority.clone();
    f.audio.stop();
    assert!(TcpStream::connect(address).is_err());
    assert!(f.audio.grant_detail(f.detail.clone()).is_err());
    f.audio.stop();
}

#[test]
fn grant_registry_deduplicates_and_caps_open_file_descriptors() {
    let f = Fixture::new();
    for _ in 0..4 {
        let result = f.audio.grant_detail(f.detail.clone()).unwrap();
        assert_eq!(result["audio"]["mic"], f.url);
    }
    let mut registry = f.audio.server.grants.lock().unwrap();
    let grant = registry.values().next().unwrap().clone();
    // The bound is exercised without creating hundreds of canonical meetings.
    registry.clear();
    for i in 0..MAX_GRANTS {
        registry.insert(format!("{i:064x}"), grant.clone());
    }
    drop(registry);
    assert!(f
        .audio
        .grant_detail(f.detail.clone())
        .unwrap_err()
        .to_string()
        .contains("limit"));
}

#[test]
fn drop_cancels_stalled_clients_and_joins_its_io_thread() {
    let f = Fixture::new();
    let mut client = f.socket();
    client.write_all(b"GET ").unwrap();
    let address = f.audio.server.authority.clone();
    let start = Instant::now();
    drop(f);
    assert!(start.elapsed() < Duration::from_secs(1));
    let mut byte = [0];
    let ended = client.read(&mut byte);
    assert!(
        matches!(ended, Ok(0))
            || ended.is_err_and(|e| e.kind() == std::io::ErrorKind::ConnectionReset)
    );
    assert!(TcpStream::connect(address).is_err());
}

#[test]
fn slow_body_client_cannot_hold_shutdown_or_keep_streaming_after_revoke() {
    let f = Fixture::new();
    // An artificial large regular descriptor tests backpressure with bounded buffers.
    // It is inserted only inside this private test; production must pass WAV verification.
    let big = f.path.with_file_name("synthetic-sparse.wav");
    let file = std::fs::File::create(&big).unwrap();
    file.set_len(128 * 1024 * 1024).unwrap();
    drop(file);
    let token = "f".repeat(64);
    let grant = Arc::new(grant::Grant {
        file: std::fs::File::open(big).unwrap(),
        length: 128 * 1024 * 1024,
        expires: Instant::now() + GRANT_LIFETIME,
        revoked: Default::default(),
        identity: (0, 0, "test-only".into()),
    });
    f.audio
        .server
        .grants
        .lock()
        .unwrap()
        .insert(token.clone(), grant.clone());
    let mut client = f.socket();
    client
        .write_all(
            format!(
                "GET /audio/{token}.wav HTTP/1.1\r\nHost: {}\r\n\r\n",
                f.audio.server.authority
            )
            .as_bytes(),
        )
        .unwrap();
    let mut initial = [0; 1024];
    assert!(client.read(&mut initial).unwrap() > 0);
    // Fill the receive window, then revoke while the writer is waiting for readiness.
    std::thread::sleep(Duration::from_millis(250));
    let revoked_at = Instant::now();
    grant.revoked.store(true, Ordering::Release);
    let mut tail = Vec::new();
    client.read_to_end(&mut tail).unwrap();
    assert!(revoked_at.elapsed() < REVOCATION_POLL + Duration::from_secs(1));
    assert!(tail.len() < 128 * 1024 * 1024 - 1024);
    grant.revoked.store(false, Ordering::Release);
    assert_eq!(f.request("HEAD", "").status, 200);
    let mut stalled = f.socket();
    stalled
        .write_all(
            format!(
                "GET /audio/{token}.wav HTTP/1.1\r\nHost: {}\r\n\r\n",
                f.audio.server.authority
            )
            .as_bytes(),
        )
        .unwrap();
    assert!(stalled.read(&mut initial).unwrap() > 0);
    let start = Instant::now();
    f.audio.stop();
    assert!(start.elapsed() < Duration::from_secs(1));
    assert!(!grant.active());
    // stop is a completed join; reading drains only finite kernel-buffered bytes.
    let mut tail = Vec::new();
    stalled.read_to_end(&mut tail).unwrap();
    assert!(tail.len() < 128 * 1024 * 1024 - 1024);
}
