use super::*;
#[test]
fn pagination_never_leaks_tokens() {
    for url in [
        "http://graph.microsoft.com/v1.0/me/calendarView",
        "https://graph.microsoft.com.evil/v1.0/me/calendarView",
        "https://evil@graph.microsoft.com/v1.0/me/calendarView",
        "https://graph.microsoft.com/v1.0/users/x/calendarView",
    ] {
        assert!(graph_url(url).is_err());
    }
    assert!(graph_url("https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=abc").is_ok());
}
#[test]
fn callback_requires_host_path_unique_state() {
    let redirect = "http://localhost:1234/callback";
    assert_eq!(
        callback(
            "GET /callback?state=ok&code=secret HTTP/1.1\r\nHost: localhost:1234\r\n",
            redirect,
            "ok"
        )
        .unwrap(),
        "secret"
    );
    for target in [
        "/callback?state=bad&code=x",
        "/callback?state=ok&state=ok&code=x",
        "/other?state=ok&code=x",
    ] {
        assert!(callback(
            &format!("GET {target} HTTP/1.1\r\nHost: localhost:1234\r\n"),
            redirect,
            "ok"
        )
        .is_err());
    }
    assert!(callback(
        "GET /callback?state=ok&code=x HTTP/1.1\r\nHost: evil\r\n",
        redirect,
        "ok"
    )
    .is_err());
}
#[test]
fn occurrence_identity_and_utc_preserved() {
    let event=parse_event(&serde_json::json!({"id":"occurrence-2","subject":"Recurring","start":{"dateTime":"2026-10-23T12:00:00","timeZone":"UTC"},"end":{"dateTime":"2026-10-23T13:00:00","timeZone":"UTC"},"isCancelled":false,"isAllDay":false,"attendees":[{"emailAddress":{"name":"Candidate","address":"c@example.test"}}]})).unwrap();
    assert_eq!(event.id, "occurrence-2");
    assert_eq!(event.starts_at, "2026-10-23T12:00:00Z");
    assert_eq!(event.attendees.len(), 1);
}

#[test]
fn fragmented_callback_and_bounds() {
    struct Fragmented {
        bytes: std::io::Cursor<Vec<u8>>,
    }
    impl Read for Fragmented {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            self.bytes.read(&mut output[..1])
        }
    }
    let request = b"GET /callback?state=ok&code=x HTTP/1.1\r\nHost: localhost:1234\r\n\r\n";
    let headers = read_headers(&mut Fragmented {
        bytes: std::io::Cursor::new(request.to_vec()),
    })
    .unwrap();
    assert_eq!(
        callback(
            std::str::from_utf8(&headers).unwrap(),
            "http://localhost:1234/callback",
            "ok"
        )
        .unwrap(),
        "x"
    );
    assert!(read_headers(&mut std::io::Cursor::new(vec![b'x'; 9000])).is_err());
    assert!(read_headers(&mut std::io::Cursor::new(b"GET /callback".to_vec())).is_err());
}
#[test]
fn explicit_provider_cancel_is_terminal_and_sanitized() {
    let error=callback("GET /callback?state=ok&error=access_denied&error_description=PRIVATE HTTP/1.1\r\nHost: localhost:1234\r\n", "http://localhost:1234/callback","ok").unwrap_err();
    assert_eq!(error, "calendar.cancelled");
    assert!(!error.contains("PRIVATE"));
}
#[test]
fn installation_and_account_isolation() {
    assert_ne!(
        installation_key(std::path::Path::new("/demo/outlook-cache.json")),
        installation_key(std::path::Path::new("/real/outlook-cache.json"))
    );
    assert!(verify_account("subject-a", Some("subject-b")).is_err());
    assert!(verify_account("subject-a", None).is_err());
    assert!(verify_account("subject-a", Some("subject-a")).is_ok());
}
#[test]
fn cancel_old_attempt_does_not_cancel_new_attempt() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    *pending().lock().unwrap() = Some(Pending {
        id: "new".into(),
        client_id: String::new(),
        tenant: String::new(),
        verifier: String::new(),
        redirect: String::new(),
        listener,
    });
    calendar_cancel(Some("old".into())).unwrap();
    assert!(active("new"));
    calendar_cancel(Some("new".into())).unwrap();
    assert!(!active("new"));
}

#[test]
fn recurrence_context_distinguishes_occurrences() {
    let fixture = |id: &str, start: &str| serde_json::json!({"id":id,"subject":"Recurring","start":{"dateTime":start,"timeZone":"UTC"},"end":{"dateTime":"2026-10-25T13:00:00","timeZone":"UTC"},"isCancelled":false,"isAllDay":false,"attendees":[],"organizer":{"emailAddress":{"name":"Organizer","address":"o@example.test"}},"seriesMasterId":"series","type":"occurrence","originalStart":format!("{start}Z")});
    let first = parse_event(&fixture("one", "2026-10-23T12:00:00")).unwrap();
    let second = parse_event(&fixture("two", "2026-10-24T12:00:00")).unwrap();
    assert_ne!(first.id, second.id);
    assert_ne!(first.original_start, second.original_start);
    assert_eq!(first.series_master_id, second.series_master_id);
    assert_eq!(first.event_type.as_deref(), Some("occurrence"));
    assert_eq!(first.organizer.unwrap().name, "Organizer");
}

#[test]
fn malformed_socket_input_is_ignored_before_valid_callback() {
    let redirect = "http://localhost:1234/callback";
    assert!(receive_callback(
        &mut std::io::Cursor::new(b"\xff\r\n\r\n".to_vec()),
        redirect,
        "ok"
    )
    .is_none());
    struct Timeout;
    impl Read for Timeout {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout"))
        }
    }
    assert!(receive_callback(&mut Timeout, redirect, "ok").is_none());
    let valid = b"GET /callback?state=ok&code=code HTTP/1.1\r\nHost: localhost:1234\r\n\r\n";
    assert_eq!(
        receive_callback(&mut std::io::Cursor::new(valid), redirect, "ok")
            .unwrap()
            .unwrap(),
        "code"
    );
}
#[test]
fn authorization_errors_are_distinct_and_sanitized() {
    for error in ["invalid_client", "temporarily_unavailable", "server_error"] {
        let request=format!("GET /callback?state=ok&error={error}&error_description=PRIVATE HTTP/1.1\r\nHost: localhost:1234\r\n");
        assert_eq!(
            callback(&request, "http://localhost:1234/callback", "ok").unwrap_err(),
            "calendar.authorizationDenied"
        );
    }
}
#[test]
fn utf8_secret_budget_is_exact_and_rejects_without_truncation() {
    let mut credentials = Credentials {
        client_id: "client".into(),
        tenant: "tenant".into(),
        account: "subject".into(),
        refresh_token: String::new(),
    };
    let overhead = credential_bytes(&credentials, None).unwrap().len();
    credentials.refresh_token = "x".repeat(2560 - overhead);
    let bytes = credential_bytes(&credentials, Some(2560)).unwrap();
    assert_eq!(bytes.len(), 2560);
    let decoded: Credentials =
        serde_json::from_slice(bytes.strip_prefix(b"CXO1\n").unwrap()).unwrap();
    assert_eq!(decoded.refresh_token, credentials.refresh_token);
    // The same JSON exceeds the previous Windows UTF-16 password budget.
    assert!(
        serde_json::to_string(&credentials)
            .unwrap()
            .encode_utf16()
            .count()
            * 2
            > 2560
    );
    credentials.refresh_token.push('x');
    assert_eq!(
        credential_bytes(&credentials, Some(2560)).unwrap_err(),
        "calendar.secretTooLong"
    );
}
#[test]
fn credential_errors_distinguish_locked_and_unavailable_without_details() {
    let locked = keyring::Error::NoStorageAccess(Box::new(std::io::Error::other("PRIVATE")));
    let unavailable = keyring::Error::PlatformFailure(Box::new(std::io::Error::other("PRIVATE")));
    assert_eq!(store_error(locked), "calendar.storeLocked");
    assert_eq!(store_error(unavailable), "calendar.storeUnavailable");
}
#[test]
fn fractional_graph_dates_are_canonical_for_chronological_sort() {
    let mut fixture = serde_json::json!({"id":"one","subject":"Meeting","start":{"dateTime":"2026-10-23T12:00:00.0000000","timeZone":"UTC"},"end":{"dateTime":"2026-10-23T13:00:00.125","timeZone":"UTC"},"isCancelled":false,"isAllDay":false,"attendees":[]});
    let first = parse_event(&fixture).unwrap();
    assert_eq!(first.starts_at, "2026-10-23T12:00:00Z");
    assert_eq!(first.ends_at, "2026-10-23T13:00:00Z");
    fixture["start"]["dateTime"] = serde_json::json!("2026-10-23T12:00:00");
    assert_eq!(first.starts_at, parse_event(&fixture).unwrap().starts_at);
}

#[test]
fn oversized_secret_never_invokes_store_or_replaces_previous_entry() {
    let credentials = Credentials {
        client_id: "client".into(),
        tenant: "tenant".into(),
        account: "subject".into(),
        refresh_token: "x".repeat(2560),
    };
    let mut previous = b"previous-protected-secret".to_vec();
    assert_eq!(
        store_credentials_with(&credentials, Some(2560), |bytes| {
            previous = bytes.to_vec();
            Ok(())
        })
        .unwrap_err(),
        "calendar.secretTooLong"
    );
    assert_eq!(previous, b"previous-protected-secret");
}
#[test]
fn legacy_utf16_migration_validates_metadata_and_rejects_garbage() {
    let credentials = Credentials {
        client_id: "00000000-0000-4000-8000-000000000001".into(),
        tenant: "organizations".into(),
        account: "subject".into(),
        refresh_token: "token".into(),
    };
    let json = serde_json::to_string(&credentials).unwrap();
    let legacy: Vec<u8> = json.encode_utf16().flat_map(u16::to_le_bytes).collect();
    assert_eq!(decode_credentials(&legacy).unwrap().account, "subject");
    assert_eq!(
        decode_credentials(&credential_bytes(&credentials, None).unwrap())
            .unwrap()
            .account,
        "subject"
    );
    for garbage in [
        vec![0xff, 0xff],
        vec![0],
        b"not JSON".to_vec(),
        b"CXO1\n{}".to_vec(),
    ] {
        assert!(decode_credentials(&garbage).is_err());
    }
    let mut invalid: serde_json::Value = serde_json::from_str(&json).unwrap();
    invalid["tenant"] = serde_json::json!("evil.example/token");
    let legacy: Vec<u8> = invalid
        .to_string()
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    assert!(decode_credentials(&legacy).is_err());
}
