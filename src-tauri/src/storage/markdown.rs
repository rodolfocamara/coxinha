use std::path::Path;

pub(super) fn slug(s: &str) -> String {
    let lower = s.to_lowercase();
    let replaced: String = lower
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    // Collapse repeated '-'
    let mut out = String::new();
    let mut prev = '_';
    for c in replaced.chars() {
        if c == '-' && prev == '-' {
            continue;
        }
        out.push(c);
        prev = c;
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".into()
    } else {
        trimmed.chars().take(60).collect()
    }
}

pub(super) fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub(super) fn extract_tags(markdown: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for word in markdown.split_whitespace() {
        if let Some(rest) = word.strip_prefix('#') {
            if !rest.is_empty() && rest.chars().next().is_some_and(|c| c.is_alphabetic()) {
                let clean: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                    .collect();
                if !clean.is_empty() && !tags.contains(&clean) {
                    tags.push(clean);
                }
            }
        }
    }
    tags
}

/// Returns the filename without extension (e.g. `notes/foo-abc123.md`
/// → `foo-abc123`). Used as a secondary wiki-link key so
/// `[[foo-abc123]]` can link even when the user never set a title.
pub(super) fn path_stem(rel_path: &str) -> Option<String> {
    Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

/// Pulls `[[target]]` spans out of a markdown document. Supports
/// Obsidian's `[[target|alias]]` form — we keep the target, drop
/// the alias (backlinks index by target, aliases are display-only).
/// Byte-level scan to avoid pulling in a regex dep for one pattern.
pub(super) fn extract_wikilinks(markdown: &str) -> Vec<String> {
    let bytes = markdown.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            let mut j = start;
            while j + 1 < bytes.len() {
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    break;
                }
                // Linebreaks end a candidate wiki-link — Obsidian
                // won't render `[[foo\nbar]]` as a link either.
                if bytes[j] == b'\n' {
                    break;
                }
                j += 1;
            }
            if j + 1 < bytes.len() && bytes[j] == b']' && bytes[j + 1] == b']' {
                let raw = &markdown[start..j];
                let target = raw.split('|').next().unwrap_or("").trim();
                if !target.is_empty() {
                    out.push(target.to_string());
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

pub(super) fn first_heading(markdown: &str) -> Option<String> {
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() {
                return Some(plain_color_spans(title));
            }
        }
    }
    None
}

// Keep the ordinary Markdown title readable when a canvas heading contains color.
fn plain_color_spans(title: &str) -> String {
    let prefix = "<span style=\"color: #";
    let mut text = title.to_string();
    while let Some(start) = text.find(prefix) {
        let tail = &text[start + prefix.len()..];
        if tail.len() >= 8
            && tail.as_bytes()[..6].iter().all(u8::is_ascii_hexdigit)
            && tail.get(6..8) == Some("\">")
        {
            text.replace_range(start..start + prefix.len() + 8, "");
        } else {
            break;
        }
    }
    text.replace("</span>", "")
}
#[cfg(test)]
mod canvas_title_tests {
    #[test]
    fn color_is_not_part_of_the_index_title() {
        assert_eq!(
            super::first_heading("# <span style=\"color: #d95d57\">Plan</span> today"),
            Some("Plan today".into())
        );
    }
}
