use super::*;
use std::{io, os::unix::fs::FileExt};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

struct Request {
    head: bool,
    token: String,
    origin: Option<String>,
    range: Option<String>,
}

fn parse(bytes: &[u8], server: &Server) -> Result<Request, u16> {
    let text = std::str::from_utf8(bytes).map_err(|_| 400u16)?;
    let mut lines = text.strip_suffix("\r\n\r\n").ok_or(400u16)?.split("\r\n");
    let mut first = lines.next().ok_or(400u16)?.split(' ');
    let method = first.next().ok_or(400u16)?;
    let target = first.next().ok_or(400u16)?;
    if first.next() != Some("HTTP/1.1") || first.next().is_some() {
        return Err(400);
    }
    if !matches!(method, "GET" | "HEAD") {
        return Err(405);
    }
    let token = target
        .strip_prefix("/audio/")
        .and_then(|s| s.strip_suffix(".wav"))
        .ok_or(404u16)?;
    if token.len() != 64
        || !token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(404);
    }
    let mut headers = HashMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(400u16)?;
        if name.is_empty()
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || value.bytes().any(|b| b < 32 && b != b'\t' || b >= 127)
        {
            return Err(400);
        }
        if headers
            .insert(name.to_ascii_lowercase(), value.trim().to_string())
            .is_some()
        {
            return Err(400);
        }
    }
    if headers.get("host") != Some(&server.authority) {
        return Err(403);
    }
    if headers.contains_key("transfer-encoding")
        || headers.get("content-length").is_some_and(|v| v != "0")
    {
        return Err(400);
    }
    let origin = headers.remove("origin");
    if origin.as_ref().is_some_and(|o| !server.origins.contains(o)) {
        return Err(403);
    }
    // No preflights or credentialed access are needed for native media GET/HEAD.
    Ok(Request {
        head: method == "HEAD",
        token: token.into(),
        origin,
        // No validators are issued, so an If-Range condition can never match.
        range: if headers.contains_key("if-range") {
            None
        } else {
            headers.remove("range")
        },
    })
}

fn range(value: Option<&str>, length: u64) -> Result<(u64, u64, u16), ()> {
    let Some(value) = value else {
        return Ok((0, length, 200));
    };
    let (start, end) = value
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .ok_or(())?;
    let decimal = |text: &str| -> Result<u64, ()> {
        if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
            return Err(());
        }
        text.parse().map_err(|_| ())
    };
    if length == 0 {
        return Err(());
    }
    if start.is_empty() {
        let suffix = decimal(end)?;
        if suffix == 0 {
            return Err(());
        }
        let count = suffix.min(length);
        Ok((length - count, count, 206))
    } else {
        let start = decimal(start)?;
        let end = if end.is_empty() {
            length - 1
        } else {
            decimal(end)?.min(length - 1)
        };
        if start >= length || end < start {
            return Err(());
        }
        Ok((start, end - start + 1, 206))
    }
}

async fn write_header(socket: &mut TcpStream, bytes: &[u8]) -> io::Result<()> {
    tokio::time::timeout(HEADER_TIMEOUT, socket.write_all(bytes))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "media header write timeout"))?
}

async fn write_body(socket: &TcpStream, bytes: &[u8], grant: &grant::Grant) -> io::Result<()> {
    let mut written = 0;
    while written < bytes.len() {
        if !grant.active() {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "media capability expired or revoked",
            ));
        }
        // WebKit may stop draining media for minutes. Only readiness is timed out;
        // every successful partial write advances the offset exactly once.
        match tokio::time::timeout(REVOCATION_POLL, socket.writable()).await {
            Err(_) => continue,
            Ok(result) => result?,
        }
        if !grant.active() {
            continue;
        }
        match socket.try_write(&bytes[written..]) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "media socket closed",
                ))
            }
            Ok(count) => written += count,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

async fn headers(
    socket: &mut TcpStream,
    status: u16,
    length: u64,
    origin: Option<&str>,
    extra: &str,
) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        416 => "Range Not Satisfiable",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    };
    let cors = origin.map(|o| format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\nAccess-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range\r\n")).unwrap_or_default();
    write_header(socket, format!("HTTP/1.1 {status} {reason}\r\nContent-Length: {length}\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n{cors}{extra}\r\n").as_bytes()).await
}

pub(super) async fn serve(mut socket: TcpStream, server: Arc<Server>) -> io::Result<()> {
    let mut bytes = [0u8; HEADER_LIMIT];
    let read = tokio::time::timeout(HEADER_TIMEOUT, async {
        let mut used = 0;
        loop {
            if used == HEADER_LIMIT {
                return Err(431u16);
            }
            let count = socket.read(&mut bytes[used..]).await.map_err(|_| 400u16)?;
            if count == 0 {
                return Err(400);
            }
            used += count;
            if let Some(end) = bytes[..used].windows(4).position(|v| v == b"\r\n\r\n") {
                // A second request or a body in the same packet is rejected, never processed.
                if end + 4 != used {
                    return Err(400);
                }
                return parse(&bytes[..used], &server);
            }
        }
    })
    .await;
    let request = match read {
        Ok(Ok(request)) => request,
        Ok(Err(status)) => {
            return headers(
                &mut socket,
                status,
                0,
                None,
                if status == 405 {
                    "Allow: GET, HEAD\r\n"
                } else {
                    ""
                },
            )
            .await
        }
        Err(_) => return Ok(()),
    };
    let grant = server
        .grants
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&request.token)
        .filter(|g| g.active())
        .cloned();
    let Some(grant) = grant else {
        return headers(&mut socket, 404, 0, request.origin.as_deref(), "").await;
    };
    let interval = range(
        if request.head {
            None
        } else {
            request.range.as_deref()
        },
        grant.length,
    );
    let (mut offset, mut remaining, status) = match interval {
        Ok(interval) => interval,
        Err(()) => {
            return headers(
                &mut socket,
                416,
                0,
                request.origin.as_deref(),
                &format!("Content-Range: bytes */{}\r\n", grant.length),
            )
            .await
        }
    };
    let extra = if status == 206 {
        format!(
            "Content-Range: bytes {offset}-{}/{}\r\n",
            offset + remaining - 1,
            grant.length
        )
    } else {
        String::new()
    };
    headers(
        &mut socket,
        status,
        remaining,
        request.origin.as_deref(),
        &extra,
    )
    .await?;
    if request.head {
        return Ok(());
    }
    let mut buffer = [0u8; CHUNK];
    while remaining > 0 && grant.active() {
        let size = (remaining.min(CHUNK as u64)) as usize;
        let count = grant.file.read_at(&mut buffer[..size], offset)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "media file changed",
            ));
        }
        write_body(&socket, &buffer[..count], &grant).await?;
        remaining -= count as u64;
        offset += count as u64;
        // A cached file must not monopolize the single IO thread or delay cancellation.
        tokio::task::yield_now().await;
    }
    Ok(())
}
