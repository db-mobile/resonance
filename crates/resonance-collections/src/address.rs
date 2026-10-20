//! Naming a request from the command line: by file path, id or display name.

use std::path::Path;

use crate::load::LoadError;
use crate::read::{FolderNode, LoadedCollection, RequestEntry, folder_display_name};

/// One request as a listing shows it.
#[derive(Debug, Clone)]
pub struct RequestListing<'a> {
    /// Collection-root-relative file path, e.g. `pets/create-pet.yaml`.
    pub path: String,
    pub method: String,
    pub name: &'a str,
    pub id: &'a str,
    pub tags: &'a [String],
    pub entry: &'a RequestEntry,
}

/// The file path of a request relative to the collection root, with `/`
/// separators; `None` for an entry that has never been written.
pub fn relative_path(loaded: &LoadedCollection, entry: &RequestEntry) -> Option<String> {
    let root = loaded.root.source.as_deref()?;
    let source = entry.source.as_deref()?;
    let relative = source.strip_prefix(root).ok()?;
    Some(
        relative
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

/// Every request, depth-first in the collection's own order.
pub fn list(loaded: &LoadedCollection) -> Vec<RequestListing<'_>> {
    loaded
        .requests()
        .into_iter()
        .map(|entry| RequestListing {
            path: relative_path(loaded, entry).unwrap_or_default(),
            method: entry.doc.method.clone().unwrap_or_default(),
            name: &entry.doc.name,
            id: &entry.doc.id,
            tags: &entry.doc.tags,
            entry,
        })
        .collect()
}

fn normalize_selector(selector: &str) -> String {
    let mut text = selector.trim().replace('\\', "/");
    while let Some(rest) = text.strip_prefix("./") {
        text = rest.to_string();
    }
    text.trim_end_matches('/').to_string()
}

fn without_yaml_extension(path: &str) -> &str {
    path.strip_suffix(".yaml")
        .or_else(|| path.strip_suffix(".yml"))
        .unwrap_or(path)
}

fn describe(listing: &RequestListing<'_>) -> String {
    format!(
        "  {}  {}  {}  ({})",
        listing.path, listing.method, listing.name, listing.id
    )
}

/// Resolves a selector to one request.
///
/// Tried in order: the file path relative to the collection root (with or
/// without its extension), the request id, the exact display name, then the
/// name ignoring case. Several name matches are an error that lists them.
///
/// @param loaded - The collection
/// @param selector - What the user typed
/// @returns The request
pub fn find_request<'a>(
    loaded: &'a LoadedCollection,
    selector: &str,
) -> Result<&'a RequestEntry, LoadError> {
    let wanted = normalize_selector(selector);
    let listings = list(loaded);

    if let Some(hit) = listings.iter().find(|l| {
        l.path == wanted || without_yaml_extension(&l.path) == without_yaml_extension(&wanted)
    }) {
        return Ok(hit.entry);
    }
    if let Some(hit) = listings.iter().find(|l| l.id == wanted) {
        return Ok(hit.entry);
    }
    for case_sensitive in [true, false] {
        let hits: Vec<_> = listings
            .iter()
            .filter(|l| {
                if case_sensitive {
                    l.name == wanted
                } else {
                    l.name.eq_ignore_ascii_case(&wanted)
                }
            })
            .collect();
        match hits.len() {
            0 => continue,
            1 => return Ok(hits[0].entry),
            _ => {
                return Err(LoadError::AmbiguousRequest {
                    selector: selector.to_string(),
                    candidates: hits.iter().map(|l| describe(l)).collect(),
                });
            }
        }
    }
    Err(LoadError::RequestNotFound {
        selector: selector.to_string(),
    })
}

fn folder_matches(folder: &FolderNode, component: &str) -> bool {
    let dir_name = folder
        .source
        .as_deref()
        .and_then(Path::file_name)
        .map(|n| n.to_string_lossy().to_string());
    dir_name.as_deref() == Some(component) || folder_display_name(folder) == component
}

fn collect<'a>(node: &'a FolderNode, out: &mut Vec<&'a RequestEntry>) {
    out.extend(node.requests.iter());
    for folder in &node.folders {
        collect(folder, out);
    }
}

/// Every request under a folder path (`pets/admin`), in tree order; an empty
/// path or `.` means the whole collection.
///
/// @param loaded - The collection
/// @param folder_path - Directory components separated by `/`
/// @returns The requests, folder's own first, then its subfolders
pub fn requests_under<'a>(
    loaded: &'a LoadedCollection,
    folder_path: &str,
) -> Result<Vec<&'a RequestEntry>, LoadError> {
    let wanted = normalize_selector(folder_path);
    let mut node = &loaded.root;
    if !wanted.is_empty() && wanted != "." {
        for component in wanted.split('/') {
            node = node
                .folders
                .iter()
                .find(|folder| folder_matches(folder, component))
                .ok_or_else(|| LoadError::FolderNotFound(folder_path.to_string()))?;
        }
    }
    let mut out = Vec::new();
    collect(node, &mut out);
    Ok(out)
}

/// True when a selector names a folder rather than a request.
pub fn is_folder(loaded: &LoadedCollection, selector: &str) -> bool {
    let wanted = normalize_selector(selector);
    if wanted.is_empty() || wanted == "." {
        return true;
    }
    let mut node = &loaded.root;
    for component in wanted.split('/') {
        match node.folders.iter().find(|f| folder_matches(f, component)) {
            Some(folder) => node = folder,
            None => return false,
        }
    }
    true
}

fn chain<'a>(node: &'a FolderNode, request_id: &str, path: &mut Vec<&'a FolderNode>) -> bool {
    if node.requests.iter().any(|entry| entry.doc.id == request_id) {
        return true;
    }
    for folder in &node.folders {
        path.push(folder);
        if chain(folder, request_id, path) {
            return true;
        }
        path.pop();
    }
    false
}

/// The folders enclosing a request, outermost first; empty for a root-level
/// request. The root node itself is never part of the chain.
pub fn folder_chain<'a>(loaded: &'a LoadedCollection, request_id: &str) -> Vec<&'a FolderNode> {
    let mut path = Vec::new();
    chain(&loaded.root, request_id, &mut path);
    path
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::load::load_collection;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn request(id: &str, name: &str, method: &str, seq: i64) -> String {
        format!(
            "resonanceFormat: 2\nid: {id}\nname: {name}\nseq: {seq}\nmethod: {method}\npath: /{id}\n"
        )
    }

    fn collection() -> TempDir {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "collection.yaml",
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        );
        write(
            temp.path(),
            "health.yaml",
            &request("r_health", "Health", "GET", 10),
        );
        write(
            temp.path(),
            "pets/list-pets.yaml",
            &request("r_list", "List pets", "GET", 20),
        );
        write(
            temp.path(),
            "pets/create-pet.yaml",
            &request("r_create", "Create pet", "POST", 10),
        );
        write(
            temp.path(),
            "pets/admin/purge.yaml",
            &request("r_purge", "Purge", "DELETE", 10),
        );
        write(
            temp.path(),
            "pets/admin/_folder.yaml",
            "resonanceFormat: 2\nid: folder_admin\nname: Admin\n",
        );
        write(
            temp.path(),
            "users/create-user.yaml",
            &request("r_user", "Create pet", "POST", 10),
        );
        temp
    }

    #[test]
    fn find_request_by_relative_path_with_and_without_extension() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        for selector in [
            "pets/create-pet.yaml",
            "pets/create-pet",
            "./pets/create-pet.yaml",
            "pets\\create-pet.yaml",
        ] {
            assert_eq!(
                find_request(&loaded, selector).unwrap().doc.id,
                "r_create",
                "{selector}"
            );
        }
    }

    #[test]
    fn find_request_by_id() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        assert_eq!(find_request(&loaded, "r_purge").unwrap().doc.name, "Purge");
    }

    #[test]
    fn find_request_by_name_exact_before_case_insensitive() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        assert_eq!(find_request(&loaded, "Health").unwrap().doc.id, "r_health");
        assert_eq!(find_request(&loaded, "health").unwrap().doc.id, "r_health");
    }

    #[test]
    fn find_request_ambiguous_name_lists_candidates() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let error = find_request(&loaded, "Create pet").unwrap_err();
        let LoadError::AmbiguousRequest { candidates, .. } = &error else {
            panic!("{error}");
        };
        assert_eq!(candidates.len(), 2);
        assert!(
            error
                .to_string()
                .contains("pets/create-pet.yaml  POST  Create pet  (r_create)")
        );
        assert!(error.to_string().contains("users/create-user.yaml"));
    }

    #[test]
    fn find_request_unknown_selector_errors() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        assert!(matches!(
            find_request(&loaded, "nope").unwrap_err(),
            LoadError::RequestNotFound { .. }
        ));
    }

    #[test]
    fn requests_under_folder_recurses_in_seq_order() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let ids: Vec<_> = requests_under(&loaded, "pets")
            .unwrap()
            .iter()
            .map(|e| e.doc.id.clone())
            .collect();
        assert_eq!(ids, vec!["r_create", "r_list", "r_purge"]);
        let nested: Vec<_> = requests_under(&loaded, "pets/admin")
            .unwrap()
            .iter()
            .map(|e| e.doc.id.clone())
            .collect();
        assert_eq!(nested, vec!["r_purge"]);
        assert_eq!(requests_under(&loaded, "").unwrap().len(), 5);
        assert!(is_folder(&loaded, "pets/admin"));
        assert!(!is_folder(&loaded, "pets/list-pets.yaml"));
    }

    #[test]
    fn requests_under_unknown_folder_errors() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        assert!(matches!(
            requests_under(&loaded, "pets/nope").unwrap_err(),
            LoadError::FolderNotFound(_)
        ));
    }

    #[test]
    fn list_reports_path_method_name_id_depth_first() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let rows: Vec<_> = list(&loaded)
            .iter()
            .map(|l| {
                (
                    l.path.clone(),
                    l.method.clone(),
                    l.name.to_string(),
                    l.id.to_string(),
                )
            })
            .collect();
        assert_eq!(
            rows[0],
            (
                "health.yaml".into(),
                "GET".into(),
                "Health".into(),
                "r_health".into()
            )
        );
        assert_eq!(rows[1].0, "pets/create-pet.yaml");
        assert_eq!(rows[3].0, "pets/admin/purge.yaml");
    }

    #[test]
    fn folder_chain_is_outermost_first_and_empty_at_the_root() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let names: Vec<_> = folder_chain(&loaded, "r_purge")
            .iter()
            .map(|f| folder_display_name(f))
            .collect();
        assert_eq!(names, vec!["pets", "Admin"]);
        assert!(folder_chain(&loaded, "r_health").is_empty());
    }
}
