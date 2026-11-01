//! Turns a model answer into a plain one-line title (spec 0097 P4, Output).
//! The model sees meeting content, so its answer is untrusted text.

const MAX_CHARS: usize = 80;

/// `None` when nothing usable is left; the caller keeps the placeholder.
pub fn sanitize_title(raw: &str) -> Option<String> {
    let visible = strip_think(raw);
    let line = visible.lines().map(clean_line).find(|l| !l.is_empty())?;
    Some(truncate(&line, MAX_CHARS))
}

/// Drops `<think>` blocks. An unclosed block hides everything after it, and
/// a lone closing tag (the template opened it) hides everything before it.
fn strip_think(raw: &str) -> String {
    const OPEN: &str = "<think>";
    const CLOSE: &str = "</think>";
    // ASCII lowercasing keeps byte offsets, so indexes map back onto `raw`.
    let lower = raw.to_ascii_lowercase();
    let mut start = 0;
    if let Some(close) = lower.find(CLOSE) {
        if !lower[..close].contains(OPEN) {
            start = close + CLOSE.len();
        }
    }
    let mut out = String::new();
    while let Some(open) = lower[start..].find(OPEN).map(|i| start + i) {
        out.push_str(&raw[start..open]);
        match lower[open..].find(CLOSE) {
            Some(close) => start = open + close + CLOSE.len(),
            None => return out,
        }
    }
    out.push_str(&raw[start..]);
    out
}

fn clean_line(line: &str) -> String {
    let line = strip_links(line);
    let words: Vec<&str> = line.split_whitespace().filter(|w| !is_url(w)).collect();
    let mut text: String = words
        .join(" ")
        .replace("[[", "")
        .replace("]]", "")
        .replace("__", "")
        .chars()
        .filter(|&c| !is_dropped(c))
        .collect();
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = strip_block_marks(&text);
    let text = strip_label(text);
    text.trim_matches(|c: char| {
        c.is_whitespace() || matches!(c, '\'' | '.' | ':' | ';' | ',' | '-')
    })
    .to_string()
}

/// Markdown links keep their text: `[x](https://y)` becomes `x`.
fn strip_links(line: &str) -> String {
    let mut out = line.to_string();
    while let Some(mid) = out.find("](") {
        let Some(end) = out[mid..].find(')').map(|i| mid + i) else {
            break;
        };
        out.replace_range(mid + 1..=end, "");
    }
    out
}

fn is_url(word: &str) -> bool {
    let lower = word
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_ascii_lowercase();
    lower.contains("://") || lower.starts_with("www.") || lower.starts_with("mailto:")
}

/// Quotes, inline Markdown marks, brackets, control and invisible format
/// characters (zero-width, bidi overrides) never belong in a title.
fn is_dropped(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '"' | '`' | '*' | '~' | '[' | ']' | '\u{201c}' | '\u{201d}' | '\u{201e}' | '\u{2018}'
                | '\u{2019}' | '\u{00ab}' | '\u{00bb}' | '\u{200b}'..='\u{200f}'
                | '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{2069}' | '\u{feff}'
        )
}

/// Leading heading, quote and list markers.
fn strip_block_marks(text: &str) -> &str {
    let mut text = text.trim_start();
    loop {
        let next = text
            .strip_prefix('#')
            .or_else(|| text.strip_prefix('>'))
            .or_else(|| text.strip_prefix("- "))
            .or_else(|| text.strip_prefix("+ "))
            .or_else(|| numbered(text))
            .map(str::trim_start);
        match next {
            Some(rest) => text = rest,
            None => return text,
        }
    }
}

fn numbered(text: &str) -> Option<&str> {
    let digits = text.find(|c: char| !c.is_ascii_digit())?;
    (digits > 0)
        .then(|| {
            text[digits..]
                .strip_prefix(". ")
                .or_else(|| text[digits..].strip_prefix(") "))
        })
        .flatten()
}

/// Small models often answer `Title: X`; keep only `X`.
fn strip_label(text: &str) -> &str {
    let Some((label, rest)) = text.split_once(':') else {
        return text;
    };
    let label = label.trim().to_lowercase();
    if [
        "title",
        "titulo",
        "t\u{ed}tulo",
        "t\u{ed}tulo sugerido",
        "titulo sugerido",
    ]
    .contains(&label.as_str())
    {
        rest
    } else {
        text
    }
}

/// At most `max` characters, cut at a word when one ends in the second half.
fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    let cut = match cut.rfind(' ') {
        Some(space) if cut[..space].chars().count() >= max / 2 => &cut[..space],
        _ => &cut,
    };
    cut.trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '.' | ':' | ';' | ',' | '-'))
        .to_string()
}

#[cfg(test)]
#[path = "sanitize_tests.rs"]
mod tests;
