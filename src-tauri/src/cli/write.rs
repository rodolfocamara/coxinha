//! Write commands: the item folder's name comes from the session or note,
//! never from the caller, and the same item rules as the app apply.
use super::{args::Args, data, is_plain_note, item_of, paths::Paths, Library};
use crate::items::{files, folder, links};
use serde_json::{json, Value};

pub fn run(paths: &Paths, args: &Args) -> Result<Value, String> {
    match args.command.as_str() {
        "add-file" => {
            let item = item(paths, args.arg(0, "item kind")?, args.arg(1, "item id")?)?;
            let sources = args.positional.get(2..).unwrap_or_default().to_vec();
            if sources.is_empty() {
                return Err("missing file path".into());
            }
            for source in &sources {
                if !std::path::Path::new(source).is_file() {
                    return Err(format!("{source} is not a file"));
                }
            }
            let sources: Vec<String> = sources
                .iter()
                .map(|s| {
                    std::fs::canonicalize(s)
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|_| s.clone())
                })
                .collect();
            Ok(
                serde_json::to_value(files::include(&paths.vault, &item, &sources)?)
                    .unwrap_or_default(),
            )
        }
        "add-ref" => {
            let item = item(paths, args.arg(0, "item kind")?, args.arg(1, "item id")?)?;
            let target = args.arg(2, "path or URL")?;
            let target = if files::is_url(target) {
                target.to_string()
            } else {
                std::path::absolute(target)
                    .map(|p| p.display().to_string())
                    .map_err(|_| "invalid path")?
            };
            let label = args.flag("label").map(str::to_string);
            Ok(
                serde_json::to_value(files::reference(&paths.vault, &item, &target, label)?)
                    .unwrap_or_default(),
            )
        }
        "link" | "unlink" => {
            let session = args.arg(0, "session id")?;
            let note = args.arg(1, "note id")?;
            Library::open(paths)?.session(session)?;
            if args.command == "link" {
                activity(paths, note)?;
                links::add(&paths.vault, session, note)?;
            } else {
                links::remove(&paths.vault, session, note)?;
            }
            let linked = links::list(&paths.vault, Some(session), None)?;
            Ok(json!({ "session": session, "links": linked }))
        }
        other => Err(format!("unknown command {other}")),
    }
}

fn activity(paths: &Paths, id: &str) -> Result<data::IndexedNote, String> {
    data::notes(paths)?
        .into_iter()
        .find(|n| n.id == id)
        .filter(|n| is_plain_note(&n.path))
        .ok_or_else(|| format!("no activity note {id}"))
}

fn item(paths: &Paths, kind: &str, id: &str) -> Result<folder::ItemRef, String> {
    match kind {
        "meeting" => Ok(item_of(Library::open(paths)?.session(id)?)),
        "activity" => {
            let note = activity(paths, id)?;
            Ok(folder::ItemRef {
                kind: folder::ItemKind::Activity,
                id: note.id,
                title: note.title,
                date: None,
            })
        }
        other => Err(format!(
            "item kind must be meeting or activity, not {other}"
        )),
    }
}
