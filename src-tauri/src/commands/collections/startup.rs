//! Collection conversions run by the startup migration chain.
//!
//! Both work on one app-owned collection directory at a time and need no
//! AppHandle, so they can run in `setup` before the store plugin is touched.

use serde_json::{Map, Value};
use std::path::Path;

use super::legacy::scripts_from_v1;
use super::load_existing;
use super::read::{FolderNode, Layout, read_collection_dir};
use super::write::write_collection_dir;

/// Rewrites a v1 collection directory as a v2 tree.
///
/// @param dir - The collection directory
/// @returns True when the directory was converted, false when it was not v1
pub(crate) fn convert_v1_dir(dir: &Path) -> Result<bool, String> {
    if Layout::detect(dir) != Some(Layout::V1) {
        return Ok(false);
    }
    let Some(mut loaded) = load_existing(dir)? else {
        return Ok(false);
    };
    write_collection_dir(dir, &mut loaded)?;
    Ok(true)
}

/// Moves the global-store scripts of one v2 collection into its request files.
///
/// Only entries naming a request of this collection are consumed: a request
/// without scripts takes the stored ones, a request that already has scripts
/// keeps its own. Entries for unknown requests are left alone, since an id
/// such as `c_1` would otherwise claim the entries of a collection `c`'s
/// neighbour `c_1`.
///
/// @param dir - The collection directory
/// @param scripts - The `persistedScripts` map; consumed entries are removed
/// @returns How many requests received scripts
pub(crate) fn absorb_store_scripts(
    dir: &Path,
    scripts: &mut Map<String, Value>,
) -> Result<u32, String> {
    if Layout::detect(dir) != Some(Layout::V2) {
        return Ok(0);
    }
    let mut loaded = read_collection_dir(dir)?;
    let prefix = format!("{}_", loaded.meta.id);
    let keys: Vec<String> = scripts
        .keys()
        .filter(|key| key.starts_with(&prefix))
        .cloned()
        .collect();
    if keys.is_empty() {
        return Ok(0);
    }

    let mut absorbed = 0;
    for key in &keys {
        let Some(doc) = find_request_mut(&mut loaded.root, &key[prefix.len()..]) else {
            continue;
        };
        let stored = scripts.remove(key);
        if doc.scripts.is_empty() {
            doc.scripts = scripts_from_v1(stored.as_ref());
            if !doc.scripts.is_empty() {
                absorbed += 1;
            }
        }
    }

    if absorbed > 0 {
        write_collection_dir(dir, &mut loaded)?;
    }
    Ok(absorbed)
}

fn find_request_mut<'a>(
    node: &'a mut FolderNode,
    request_id: &str,
) -> Option<&'a mut super::model::RequestDoc> {
    if let Some(entry) = node
        .requests
        .iter_mut()
        .find(|entry| entry.doc.id == request_id)
    {
        return Some(&mut entry.doc);
    }
    node.folders
        .iter_mut()
        .find_map(|folder| find_request_mut(folder, request_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::collections::read::read_collection_dir;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    fn write_v1(dir: &Path) {
        fs::write(
            dir.join("collection.json"),
            json!({
                "id": "c_1",
                "name": "Pets",
                "baseUrl": "https://api.example.com",
                "endpoints": [
                    {"id": "r1", "name": "List", "method": "GET", "path": "/pets", "protocol": "http"},
                    {"id": "r2", "name": "Create", "method": "POST", "path": "/pets", "protocol": "http"}
                ],
                "folders": []
            })
            .to_string(),
        )
        .unwrap();
        fs::create_dir_all(dir.join("requests")).unwrap();
        fs::write(
            dir.join("requests/create--r2.json"),
            json!({"scripts": {"preRequestScript": "", "testScript": "kept();"}}).to_string(),
        )
        .unwrap();
    }

    fn script_test(dir: &Path, request_id: &str) -> Option<String> {
        read_collection_dir(dir)
            .unwrap()
            .requests()
            .into_iter()
            .find(|entry| entry.doc.id == request_id)
            .and_then(|entry| entry.doc.scripts.test.clone())
    }

    #[test]
    fn a_v1_dir_is_rewritten_as_v2_without_leftovers() {
        let temp = TempDir::new().unwrap();
        write_v1(temp.path());

        assert!(convert_v1_dir(temp.path()).unwrap());

        assert_eq!(Layout::detect(temp.path()), Some(Layout::V2));
        assert!(!temp.path().join("collection.json").exists());
        assert!(!temp.path().join("requests").exists());
        assert_eq!(script_test(temp.path(), "r2").as_deref(), Some("kept();"));
    }

    #[test]
    fn converting_is_a_no_op_for_v2_and_non_collection_dirs() {
        let temp = TempDir::new().unwrap();
        assert!(!convert_v1_dir(temp.path()).unwrap());

        write_v1(temp.path());
        convert_v1_dir(temp.path()).unwrap();
        assert!(!convert_v1_dir(temp.path()).unwrap());
    }

    #[test]
    fn store_scripts_fill_empty_requests_and_never_override_file_scripts() {
        let temp = TempDir::new().unwrap();
        write_v1(temp.path());
        convert_v1_dir(temp.path()).unwrap();

        let mut store = Map::new();
        store.insert(
            "c_1_r1".into(),
            json!({"preRequestScript": "pre();", "testScript": "stored();"}),
        );
        store.insert("c_1_r2".into(), json!({"testScript": "stale();"}));
        store.insert("c_1_gone".into(), json!({"testScript": "orphan();"}));
        store.insert("c_10_r1".into(), json!({"testScript": "other();"}));

        assert_eq!(absorb_store_scripts(temp.path(), &mut store).unwrap(), 1);

        assert_eq!(script_test(temp.path(), "r1").as_deref(), Some("stored();"));
        assert_eq!(script_test(temp.path(), "r2").as_deref(), Some("kept();"));
        let mut left: Vec<_> = store.keys().cloned().collect();
        left.sort();
        assert_eq!(left, vec!["c_10_r1", "c_1_gone"]);
    }

    #[test]
    fn a_shorter_collection_id_never_claims_a_longer_ids_entries() {
        let temp = TempDir::new().unwrap();
        write_v1(temp.path());
        convert_v1_dir(temp.path()).unwrap();

        let mut store = Map::new();
        store.insert("c_1_r1".into(), json!({"testScript": "mine();"}));
        store.insert("c_1_x_r9".into(), json!({"testScript": "neighbour();"}));

        absorb_store_scripts(temp.path(), &mut store).unwrap();

        assert_eq!(store.keys().collect::<Vec<_>>(), vec!["c_1_x_r9"]);
        assert_eq!(script_test(temp.path(), "r1").as_deref(), Some("mine();"));
    }
}
