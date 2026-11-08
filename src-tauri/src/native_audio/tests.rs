use super::*;
use coxinha_core::{
    capture::{Recording, Track},
    store::Store,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::atomic::Ordering,
};

mod attacks;
mod lifecycle;

struct Fixture {
    _directory: tempfile::TempDir,
    audio: NativeAudio,
    detail: Value,
    url: String,
    path: PathBuf,
    bytes: Vec<u8>,
}

impl Fixture {
    fn new() -> Self {
        Self::with_frames(281040)
    }
    fn with_frames(frames: usize) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::open(directory.path()).unwrap();
        let id = store
            .create_meeting("synthetic audio transport fixture")
            .unwrap();
        let mut recording = Recording::start(&store, &id, "fixture-mic", "fixture-output").unwrap();
        let samples: Vec<i16> = (0..frames).map(|i| ((i * 73) % 30001) as i16).collect();
        for (index, chunk) in samples.chunks(960).enumerate() {
            recording
                .write_block(Track::Mic, chunk, index as u64)
                .unwrap();
            recording
                .write_block(Track::Output, chunk, index as u64)
                .unwrap();
        }
        let manifest = recording.finish(&store, false).unwrap();
        let paths = manifest.verified_tracks(directory.path()).unwrap();
        let path = paths[0].clone();
        let bytes = std::fs::read(&path).unwrap();
        let detail = json!({"meeting":{"id":id},"manifest":manifest,"audio":{"mic":paths[0],"output":paths[1]}});
        let audio = NativeAudio::start(vec![
            "tauri://localhost".into(),
            "http://localhost:1420".into(),
        ])
        .unwrap();
        let granted = audio.grant_detail(detail.clone()).unwrap();
        let url = granted["audio"]["mic"].as_str().unwrap().to_string();
        Self {
            _directory: directory,
            audio,
            detail,
            url,
            path,
            bytes,
        }
    }
    fn target(&self) -> &str {
        self.url
            .strip_prefix(&format!("http://{}", self.audio.server.authority))
            .unwrap()
    }
    fn socket(&self) -> TcpStream {
        let socket =
            TcpStream::connect(self.audio.server.authority.parse::<SocketAddr>().unwrap()).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        socket
    }
    fn request(&self, method: &str, extra: &str) -> Response {
        self.raw(&format!(
            "{method} {} HTTP/1.1\r\nHost: {}\r\n{extra}\r\n",
            self.target(),
            self.audio.server.authority
        ))
    }
    fn raw(&self, request: &str) -> Response {
        let mut socket = self.socket();
        socket.write_all(request.as_bytes()).unwrap();
        response(&mut socket)
    }
}

struct Response {
    status: u16,
    headers: String,
    body: Vec<u8>,
}
fn response(socket: &mut TcpStream) -> Response {
    let mut bytes = Vec::new();
    if let Err(error) = socket.read_to_end(&mut bytes) {
        // Rejecting an oversize request may reset unread incoming bytes after the response.
        assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
        assert!(!bytes.is_empty());
    }
    let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
    let headers = String::from_utf8(bytes[..end].to_vec()).unwrap();
    let status = headers.split(' ').nth(1).unwrap().parse().unwrap();
    Response {
        status,
        headers,
        body: bytes[end + 4..].to_vec(),
    }
}

#[test]
fn real_http_preserves_full_wav_and_seek_bytes_including_suffix_head_and_416() {
    let f = Fixture::new();
    let entire = f.request("GET", "Origin: tauri://localhost\r\n");
    assert_eq!(entire.status, 200);
    assert_eq!(entire.body, f.bytes);
    assert!(entire
        .headers
        .contains("Access-Control-Allow-Origin: tauri://localhost"));
    for header in [
        "Cache-Control: no-store",
        "Accept-Ranges: bytes",
        "Content-Type: audio/wav",
        "X-Content-Type-Options: nosniff",
        "Connection: close",
    ] {
        assert!(entire.headers.contains(header), "{header}");
    }
    let wav = hound::WavReader::new(std::io::Cursor::new(entire.body)).unwrap();
    assert_eq!(wav.spec().sample_rate, 48000);
    assert_eq!(wav.duration(), 281040);
    let cases = [
        ("0-43", 0, 44),
        ("96044-192043", 96044, 96000),
        ("281040-", 281040, f.bytes.len() - 281040),
        ("-123", f.bytes.len() - 123, 123),
        ("-999999999", 0, f.bytes.len()),
        ("14-999999999", 14, f.bytes.len() - 14),
    ];
    for (interval, offset, size) in cases {
        let part = f.request("GET", &format!("Range: bytes={interval}\r\n"));
        assert_eq!(part.status, 206, "{interval}");
        assert_eq!(part.body, f.bytes[offset..offset + size]);
        assert!(part.headers.contains(&format!(
            "Content-Range: bytes {offset}-{}/{}",
            offset + size - 1,
            f.bytes.len()
        )));
        assert!(part.headers.contains(&format!("Content-Length: {size}")));
    }
    // HEAD ignores Range per HTTP semantics, including malformed Range.
    let head = f.request("HEAD", "Range: bytes=nonsense\r\n");
    assert_eq!(head.status, 200);
    assert!(head.body.is_empty());
    assert!(head
        .headers
        .contains(&format!("Content-Length: {}", f.bytes.len())));
    let stale = f.request("GET", "Range: bytes=0-43\r\nIf-Range: \"stale\"\r\n");
    assert_eq!(stale.status, 200);
    assert_eq!(stale.body, f.bytes);
    for interval in [
        "-0",
        "1-0",
        "999999999-",
        "0-1,3-4",
        "a-b",
        "18446744073709551616-",
        "0-18446744073709551616",
        "+1-2",
        "-",
        "0 - 1",
    ] {
        let bad = f.request("GET", &format!("Range: bytes={interval}\r\n"));
        assert_eq!(bad.status, 416, "{interval}");
        assert!(bad.body.is_empty());
        assert!(bad
            .headers
            .contains(&format!("Content-Range: bytes */{}", f.bytes.len())));
    }
    assert_eq!(f.request("GET", "Range: items=0-2\r\n").status, 416);
}

#[test]
fn same_grant_concurrent_ranges_use_independent_positioned_reads() {
    let f = Fixture::new();
    // Repeat and interleave connections with different offsets on the identical descriptor.
    let simultaneous = std::sync::Barrier::new(2);
    std::thread::scope(|scope| {
        let left = scope.spawn(|| {
            for _ in 0..12 {
                simultaneous.wait();
                let response = f.request("GET", "Range: bytes=44044-264043\r\n");
                assert_eq!(response.status, 206);
                assert_eq!(response.body, f.bytes[44044..264044]);
            }
        });
        let right = scope.spawn(|| {
            for _ in 0..12 {
                simultaneous.wait();
                let response = f.request("GET", "Range: bytes=288044-508043\r\n");
                assert_eq!(response.status, 206);
                assert_eq!(response.body, f.bytes[288044..508044]);
            }
        });
        left.join().unwrap();
        right.join().unwrap();
    });
}

#[test]
fn descriptor_is_stable_after_path_is_renamed_and_replaced() {
    let f = Fixture::new();
    let renamed = f.path.with_extension("saved-wav");
    std::fs::rename(&f.path, &renamed).unwrap();
    std::fs::write(
        &f.path,
        b"synthetic private replacement must never be served",
    )
    .unwrap();
    assert_eq!(f.request("GET", "").body, f.bytes);
    let part = f.request("GET", "Range: bytes=96044-192043\r\n");
    assert_eq!(part.body, f.bytes[96044..192044]);
    assert!(f.audio.grant_detail(f.detail.clone()).is_err());
}

#[test]
fn invalid_symlink_directory_unknown_and_wrong_wav_are_never_granted() {
    let f = Fixture::new();
    let original = f.audio.server.grants.lock().unwrap().len();
    let mut altered = f.detail.clone();
    altered["audio"]["mic"] = json!(f._directory.path().join("private/profiles.db"));
    assert!(f.audio.grant_detail(altered).is_err());
    let invalid = f.path.with_file_name("invalid.wav");
    std::fs::write(&invalid, b"not a WAV").unwrap();
    let mut altered = f.detail.clone();
    altered["audio"]["mic"] = json!(invalid);
    altered["manifest"]["tracks"][0]["sha256"] =
        json!(format!("{:x}", Sha256::digest(b"not a WAV")));
    assert!(f.audio.grant_detail(altered).is_err());
    let link = f.path.with_file_name("symlink.wav");
    std::os::unix::fs::symlink(&f.path, &link).unwrap();
    let mut altered = f.detail.clone();
    altered["audio"]["mic"] = json!(link);
    assert!(f.audio.grant_detail(altered).is_err());
    let mut altered = f.detail.clone();
    altered["audio"]["mic"] = json!(f.path.parent().unwrap());
    assert!(f.audio.grant_detail(altered).is_err());
    let mut altered = f.detail.clone();
    altered["manifest"]["tracks"][0]["sha256"] = json!("00".repeat(32));
    assert!(f.audio.grant_detail(altered).is_err());
    let mut altered = f.detail.clone();
    altered["manifest"]["tracks"][0]["frames"] = json!(1);
    assert!(f.audio.grant_detail(altered).is_err());
    let mut altered = f.detail.clone();
    altered["manifest"]["state"] = json!("recording");
    assert!(f.audio.grant_detail(altered).is_err());
    assert_eq!(f.audio.server.grants.lock().unwrap().len(), original);
}
