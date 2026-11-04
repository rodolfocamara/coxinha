use super::*;

#[test]
fn real_http_rejects_origin_host_token_traversal_encoded_paths_and_smuggling() {
    let f = Fixture::new();
    assert_eq!(
        f.audio.server.authority.parse::<SocketAddr>().unwrap().ip(),
        std::net::Ipv4Addr::LOCALHOST
    );
    for origin in [
        "null",
        "https://attacker.example",
        "tauri://localhost.attacker",
        "http://localhost:1420.attacker",
        "http://127.0.0.1:1420",
        "http://localhost:1421",
        "tauri://localhost/",
    ] {
        let result = f.request("GET", &format!("Origin: {origin}\r\n"));
        assert_eq!(result.status, 403, "{origin}");
        assert!(result.body.is_empty());
        assert!(!result.headers.contains("Access-Control-Allow-Origin"));
    }
    assert_eq!(
        f.request("GET", "Origin: http://localhost:1420\r\n").status,
        200
    );
    assert!(!f
        .request("GET", "")
        .headers
        .contains("Access-Control-Allow-Origin"));
    for host in [
        "localhost:1234",
        "attacker.example",
        "127.0.0.1",
        "[::1]:1234",
        "127.0.0.1:0",
    ] {
        let result = f.raw(&format!(
            "GET {} HTTP/1.1\r\nHost: {host}\r\n\r\n",
            f.target()
        ));
        assert_eq!(result.status, 403);
        assert!(result.body.is_empty());
    }
    let unknown = format!("/audio/{}.wav", "0".repeat(64));
    for target in [
        unknown.as_str(),
        "/",
        "/private/profiles.db",
        "/audio/../private/profiles.db",
        "/audio/%2e%2e/private/profiles.db",
        "/audio/%2Fprivate.wav",
        "/audio/abc.wav",
        "/audio/ABC.wav",
        &format!("{}?path=/private/profiles.db", f.target()),
        &format!("{}#fragment", f.target()),
        &f.url,
    ] {
        let result = f.raw(&format!(
            "GET {target} HTTP/1.1\r\nHost: {}\r\n\r\n",
            f.audio.server.authority
        ));
        assert_eq!(result.status, 404, "{target}");
        assert!(result.body.is_empty());
    }
    for extra in [
        format!("Host: {}\r\n", f.audio.server.authority),
        "Origin: tauri://localhost\r\nOrigin: https://attacker.example\r\n".into(),
        "Range: bytes=0-1\r\nrange: bytes=2-3\r\n".into(),
        "Content-Length: 1\r\n".into(),
        "Transfer-Encoding: chunked\r\n".into(),
        " Host: attacker\r\n".into(),
        "X-Test: a\0b\r\n".into(),
    ] {
        assert_eq!(f.request("GET", &extra).status, 400);
    }
    assert_eq!(
        f.raw(&format!("GET {} HTTP/1.1\r\n\r\n", f.target()))
            .status,
        403
    );
    for method in ["POST", "PUT", "DELETE", "OPTIONS", "CONNECT"] {
        assert_eq!(f.request(method, "").status, 405);
    }
    let smuggle = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\n\r\nGET / HTTP/1.1\r\n\r\n",
        f.target(),
        f.audio.server.authority
    );
    assert_eq!(f.raw(&smuggle).status, 400);
}

#[test]
fn oversized_headers_and_slow_header_clients_are_bounded() {
    let f = Fixture::new();
    let big = format!("X-Padding: {}\r\n", "a".repeat(HEADER_LIMIT));
    assert_eq!(f.request("GET", &big).status, 431);
    let mut slow = f.socket();
    slow.write_all(format!("GET {} HTTP/1.1\r\n", f.target()).as_bytes())
        .unwrap();
    let start = Instant::now();
    let mut byte = [0];
    assert_eq!(slow.read(&mut byte).unwrap(), 0);
    assert!(start.elapsed() >= HEADER_TIMEOUT / 2);
    assert!(start.elapsed() < Duration::from_secs(4));
    assert_eq!(f.request("HEAD", "").status, 200);
}

#[test]
fn eight_stalled_clients_limit_connections_and_release_slots() {
    let f = Fixture::new();
    let mut sockets = Vec::new();
    for _ in 0..MAX_CONNECTIONS {
        let mut socket = f.socket();
        socket.write_all(b"GET ").unwrap();
        sockets.push(socket);
    }
    // The IO thread can accept queued peers before this ninth peer arrives.
    let mut rejected = f.socket();
    let mut byte = [0];
    let result = rejected.read(&mut byte);
    assert!(
        matches!(result, Ok(0))
            || result.is_err_and(|e| matches!(
                e.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::UnexpectedEof
            ))
    );
    for mut socket in sockets {
        socket.shutdown(std::net::Shutdown::Write).unwrap();
        let mut rejected = Vec::new();
        let _ = socket.read_to_end(&mut rejected);
    }
    // Accepted clients are promptly canceled by EOF, making a normal request available.
    assert_eq!(f.request("HEAD", "").status, 200);
}
