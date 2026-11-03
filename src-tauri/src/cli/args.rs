//! `Coxinha cli <command> [positional…] [--flag value…]`.
use std::collections::BTreeMap;

#[derive(Debug, Default, PartialEq)]
pub struct Args {
    pub command: String,
    pub positional: Vec<String>,
    pub flags: BTreeMap<String, String>,
}

/// Flags that take no value.
const SWITCHES: [&str; 2] = ["no-transcript", "help"];

pub fn parse(raw: &[String]) -> Result<Args, String> {
    let mut args = Args::default();
    let mut items = raw.iter();
    while let Some(item) = items.next() {
        if let Some(name) = item.strip_prefix("--") {
            if name.is_empty() {
                return Err("empty flag".into());
            }
            let (name, inline) = match name.split_once('=') {
                Some((n, v)) => (n, Some(v.to_string())),
                None => (name, None),
            };
            let value = if SWITCHES.contains(&name) {
                inline.unwrap_or_else(|| "true".into())
            } else {
                match inline {
                    Some(v) => v,
                    None => items
                        .next()
                        .cloned()
                        .ok_or_else(|| format!("--{name} needs a value"))?,
                }
            };
            args.flags.insert(name.to_string(), value);
        } else if args.command.is_empty() {
            args.command = item.clone();
        } else {
            args.positional.push(item.clone());
        }
    }
    if args.command.is_empty() {
        args.command = "help".into();
    }
    Ok(args)
}

impl Args {
    pub fn flag(&self, name: &str) -> Option<&str> {
        self.flags.get(name).map(String::as_str)
    }
    pub fn switch(&self, name: &str) -> bool {
        self.flag(name) == Some("true")
    }
    pub fn limit(&self, default: usize) -> Result<usize, String> {
        match self.flag("limit") {
            None => Ok(default),
            Some(v) => v
                .parse::<usize>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| "--limit must be a positive number".into()),
        }
    }
    pub fn date(&self, name: &str) -> Result<Option<chrono::NaiveDate>, String> {
        self.flag(name)
            .map(|v| {
                chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d")
                    .map_err(|_| format!("--{name} must be YYYY-MM-DD"))
            })
            .transpose()
    }
    pub fn arg(&self, index: usize, what: &str) -> Result<&str, String> {
        self.positional
            .get(index)
            .map(String::as_str)
            .ok_or_else(|| format!("missing {what}"))
    }
}
