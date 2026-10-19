//! Turning selectors into the ordered list of requests to run.
use resonance_collections::address::{find_request, is_folder, requests_under};
use resonance_collections::{LoadedCollection, RequestEntry};

use crate::error::CliError;

/// Resolves every selector in order: a folder expands to its requests, a
/// request selector to one request. No selectors means the whole collection.
pub fn resolve<'a>(
    loaded: &'a LoadedCollection,
    selectors: &[String],
) -> Result<Vec<&'a RequestEntry>, CliError> {
    if selectors.is_empty() {
        return Ok(requests_under(loaded, "")?);
    }
    let mut entries = Vec::new();
    for selector in selectors {
        if is_folder(loaded, selector) {
            entries.extend(requests_under(loaded, selector)?);
        } else {
            entries.push(find_request(loaded, selector)?);
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use resonance_collections::load_collection;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn collection() -> TempDir {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "collection.yaml",
            "resonanceFormat: 2\nid: c1\nname: P\n",
        );
        write(
            temp.path(),
            "health.yaml",
            "resonanceFormat: 2\nid: r_health\nname: Health\nseq: 10\nmethod: GET\npath: /health\n",
        );
        write(
            temp.path(),
            "pets/list.yaml",
            "resonanceFormat: 2\nid: r_list\nname: List\nseq: 20\nmethod: GET\npath: /pets\n",
        );
        write(
            temp.path(),
            "pets/create.yaml",
            "resonanceFormat: 2\nid: r_create\nname: Create\nseq: 10\nmethod: POST\npath: /pets\n",
        );
        temp
    }

    #[test]
    fn folders_expand_in_seq_order_and_requests_resolve_by_any_selector() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let ids = |selectors: &[&str]| {
            resolve(
                &loaded,
                &selectors.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            )
            .unwrap()
            .iter()
            .map(|e| e.doc.id.clone())
            .collect::<Vec<_>>()
        };
        assert_eq!(ids(&[]), vec!["r_health", "r_create", "r_list"]);
        assert_eq!(ids(&["pets"]), vec!["r_create", "r_list"]);
        assert_eq!(
            ids(&["pets\\list", "Health", "r_create"]),
            vec!["r_list", "r_health", "r_create"]
        );
    }

    #[test]
    fn unknown_selectors_are_errors() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        assert!(resolve(&loaded, &["nope".to_string()]).is_err());
    }
}
