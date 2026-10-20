//! `resonance list`: what a collection offers to run.
use resonance_collections::address::list as list_requests;
use resonance_collections::load_collection;
use serde_json::json;
use std::io::Write;
use std::path::Path;

use crate::cli::ListArgs;
use crate::error::CliError;

pub fn list(args: ListArgs, out: &mut dyn Write) -> Result<(), CliError> {
    let loaded = load_collection(&args.collection)?;
    let requests = list_requests(&loaded);
    let runners: Vec<_> = loaded
        .runners
        .iter()
        .map(|entry| {
            (
                entry
                    .source
                    .as_deref()
                    .and_then(Path::file_stem)
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default(),
                entry,
            )
        })
        .collect();

    if args.json {
        let value = json!({
            "collection": {"id": loaded.meta.id, "name": loaded.meta.name},
            "requests": requests.iter().map(|r| json!({"path": r.path, "method": r.method, "name": r.name, "id": r.id, "tags": r.tags})).collect::<Vec<_>>(),
            "runners": runners.iter().map(|(stem, entry)| json!({"file": format!("runners/{stem}.yaml"), "name": entry.doc.name, "id": entry.doc.id, "requests": entry.doc.requests.len()})).collect::<Vec<_>>(),
        });
        let _ = writeln!(
            out,
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        );
        return Ok(());
    }

    let _ = writeln!(out, "{} ({})", loaded.meta.name, loaded.meta.id);
    let _ = writeln!(out, "\nRequests");
    if requests.is_empty() {
        let _ = writeln!(out, "  (none)");
    }
    let width = requests.iter().map(|r| r.method.len()).max().unwrap_or(0);
    for request in &requests {
        let tags = if request.tags.is_empty() {
            String::new()
        } else {
            format!("  [{}]", request.tags.join(", "))
        };
        let _ = writeln!(
            out,
            "  {:<width$}  {}  {}  ({}){}",
            request.method,
            request.path,
            request.name,
            request.id,
            tags,
            width = width
        );
    }
    let _ = writeln!(out, "\nRunners");
    if runners.is_empty() {
        let _ = writeln!(out, "  (none)");
    }
    for (stem, entry) in &runners {
        let _ = writeln!(
            out,
            "  {}  {}  ({})  {} request{}",
            stem,
            entry.doc.name,
            entry.doc.id,
            entry.doc.requests.len(),
            if entry.doc.requests.len() == 1 {
                ""
            } else {
                "s"
            }
        );
    }
    Ok(())
}
