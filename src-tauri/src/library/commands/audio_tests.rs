use super::*;
use coxinha_core::capture::{Recording, Track};
use std::io::{Read, Write};

#[tokio::test]
async fn canonical_detail_recover_import_only_grant_verified_audio() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let closed = store
        .create_meeting("closed synthetic transport fixture")
        .unwrap();
    let mut recording = Recording::start(&store, &closed, "fixture-mic", "fixture-output").unwrap();
    recording.write_block(Track::Mic, &[73; 960], 1).unwrap();
    recording
        .write_block(Track::Output, &[-29; 960], 1)
        .unwrap();
    recording.finish(&store, false).unwrap();
    let raw = temp.path().join("raw").join(&closed).join("mic.wav");
    let expected = std::fs::read(&raw).unwrap();
    let recoverable = store
        .create_meeting("recoverable synthetic transport fixture")
        .unwrap();
    let mut recording =
        Recording::start(&store, &recoverable, "fixture-mic", "fixture-output").unwrap();
    recording.write_block(Track::Mic, &[19; 960], 1).unwrap();
    drop(recording);
    drop(store);
    let library = Library::open(temp.path().into()).unwrap();
    let transport =
        crate::native_audio::NativeAudio::start(vec!["tauri://localhost".into()]).unwrap();
    let unclosed = library
        .ask(Action::Detail(recoverable.clone()))
        .await
        .unwrap();
    assert!(transport.grant_detail(unclosed).unwrap()["audio"].is_null());
    let detail = library.ask(Action::Detail(closed.clone())).await.unwrap();
    let dto = transport.grant_detail(detail).unwrap();
    assert!(dto["audio"]["mic"]
        .as_str()
        .unwrap()
        .starts_with("http://127.0.0.1:"));
    assert!(!dto["audio"]
        .to_string()
        .contains(temp.path().to_str().unwrap()));
    let recovered = library.ask(Action::Recover(recoverable)).await.unwrap();
    assert!(transport.grant_detail(recovered).unwrap()["audio"]["mic"].is_string());
    let imported = library
        .ask(Action::ImportAudio(
            "imported fixture".into(),
            raw.to_string_lossy().into(),
        ))
        .await
        .unwrap();
    let imported = transport.grant_detail(imported).unwrap();
    let url = imported["audio"]["imported"]
        .as_str()
        .unwrap()
        .strip_prefix("http://")
        .unwrap();
    let (authority, path) = url.split_once('/').unwrap();
    let mut socket = std::net::TcpStream::connect(authority).unwrap();
    socket
        .set_read_timeout(Some(std::time::Duration::from_secs(3)))
        .unwrap();
    socket
        .write_all(format!("GET /{path} HTTP/1.1\r\nHost: {authority}\r\n\r\n").as_bytes())
        .unwrap();
    let mut bytes = Vec::new();
    socket.read_to_end(&mut bytes).unwrap();
    let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
    // Import normalizes the WAV, so compare decoded samples rather than container headers.
    let actual: Vec<i16> = hound::WavReader::new(std::io::Cursor::new(&bytes[end..]))
        .unwrap()
        .into_samples()
        .map(Result::unwrap)
        .collect();
    let expected: Vec<i16> = hound::WavReader::new(std::io::Cursor::new(expected))
        .unwrap()
        .into_samples()
        .map(Result::unwrap)
        .collect();
    assert_eq!(actual, expected);
    for id in [
        "../private/profiles.db".into(),
        uuid::Uuid::new_v4().to_string(),
    ] {
        assert!(library.ask(Action::Detail(id)).await.is_err());
    }
    let private = temp.path().join("private/profiles.db");
    assert!(library
        .ask(Action::ImportAudio(
            "invalid private fixture".into(),
            private.to_string_lossy().into()
        ))
        .await
        .is_err());
    library.shutdown().await.unwrap();
    // Canonical worker completion does not depend on network clients or transport shutdown.
    transport.stop();
}
