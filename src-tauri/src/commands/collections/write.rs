//! Writing a v2 collection directory.
//!
//! Three rules make the format safe to keep in git:
//!
//! - Writes are atomic. A file is serialized in full, written to a sibling
//!   temp file, flushed, then renamed over the target, so a crash never leaves
//!   a half-written request.
//! - Unchanged files are not rewritten. The frontend saves whole collections,
//!   so without this every save would touch every request file and reintroduce
//!   exactly the churn this format removes.
//! - A name collision never deletes. The v1 writer removed the losing file;
//!   here the loser keeps a numeric suffix and its content.
#![allow(dead_code)]

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::super::fs_secure::{restrict_dir, restrict_file};
use super::layout::{
    find_available_path, request_stem, slugify, COLLECTION_JSON, COLLECTION_YAML, FOLDER_YAML,
    OPENAPI_YAML, VARIABLES_YAML,
};
use super::read::{folder_display_name, FolderNode, LoadedCollection};

/// Gap left between consecutive `seq` values, so a request can be inserted
/// between two others without renumbering either.
const SEQ_STEP: i64 = 10;

/// Serializes a value to YAML.
fn to_yaml<T: Serialize>(value: &T) -> Result<String, String> {
    serde_yaml_ng::to_string(value).map_err(|e| format!("Failed to serialize YAML: {}", e))
}

/// Writes bytes to a path atomically, leaving the target untouched on failure.
///
/// The temp file is created in the destination directory so the rename is
/// guaranteed to stay on one filesystem, and the data is flushed to disk
/// before the rename so a crash cannot expose an empty file under a real name.
///
/// @param path - Destination path
/// @param contents - Bytes to write
/// @returns Ok once the file is durably in place
pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("{} has no file name", path.display()))?;

    let temp = parent.join(format!(
        ".{}.tmp-{}",
        file_name,
        uuid::Uuid::new_v4().simple()
    ));

    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temp)
            .map_err(|e| format!("Failed to create {}: {}", temp.display(), e))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", temp.display(), e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush {}: {}", temp.display(), e))?;
        drop(file);

        restrict_file(&temp);

        fs::rename(&temp, path).map_err(|e| format!("Failed to place {}: {}", path.display(), e))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Writes a file only when its contents would actually change.
///
/// @param path - Destination path
/// @param contents - Bytes the file should hold
/// @returns True when the file was written
pub(crate) fn write_if_changed(path: &Path, contents: &str) -> Result<bool, String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == contents {
            return Ok(false);
        }
    }
    write_atomic(path, contents)?;
    Ok(true)
}

/// Creates a directory if missing and tightens its permissions either way.
fn ensure_dir(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    }
    restrict_dir(dir);
    Ok(())
}

/// Gives a `seq` to anything that has none, without touching existing values.
///
/// Renumbering wholesale would rewrite every sibling file on every save, so
/// only genuinely new entries are numbered, above whatever is already there.
fn assign_missing_seq(node: &mut FolderNode) {
    let mut next = node
        .requests
        .iter()
        .map(|entry| entry.doc.seq)
        .chain(
            node.folders
                .iter()
                .map(|f| f.meta.as_ref().map_or(0, |m| m.seq)),
        )
        .max()
        .unwrap_or(0);

    for entry in &mut node.requests {
        if entry.doc.seq == 0 {
            next += SEQ_STEP;
            entry.doc.seq = next;
        }
    }

    for folder in &mut node.folders {
        if let Some(meta) = &mut folder.meta {
            if meta.seq == 0 {
                next += SEQ_STEP;
                meta.seq = next;
            }
        }
        assign_missing_seq(folder);
    }
}

/// Moves a file to a new path, when the desired name differs from the current.
///
/// Renaming first and writing after is deliberate: writing the new file before
/// removing the old would leave two files claiming one request id.
fn relocate(current: &Path, desired: &Path) -> Result<(), String> {
    if current == desired || !current.exists() {
        return Ok(());
    }
    fs::rename(current, desired).map_err(|e| {
        format!(
            "Failed to move {} to {}: {}",
            current.display(),
            desired.display(),
            e
        )
    })
}

/// Writes one folder's requests and recurses into its subfolders.
///
/// Returns every path it wrote or kept, so the caller can tell which files in
/// the directory belong to the tree.
fn write_folder(dir: &Path, node: &mut FolderNode) -> Result<Vec<PathBuf>, String> {
    ensure_dir(dir)?;

    let mut claimed: Vec<PathBuf> = Vec::new();

    if let Some(meta) = &node.meta {
        let path = dir.join(FOLDER_YAML);
        write_if_changed(&path, &to_yaml(meta)?)?;
        claimed.push(path);
    }

    for index in 0..node.requests.len() {
        let stem = request_stem(&node.requests[index].doc.name);
        let current = node.requests[index].source.clone();

        let desired = find_available_path(dir, &stem, "yaml", current.as_deref());

        if let Some(current_path) = &current {
            relocate(current_path, &desired)?;
        }

        write_if_changed(&desired, &to_yaml(&node.requests[index].doc)?)?;
        node.requests[index].source = Some(desired.clone());
        claimed.push(desired);
    }

    for folder in &mut node.folders {
        let stem = slugify(&folder_display_name(folder));
        let current = folder.source.clone();

        let desired = if current.as_deref().map(|p| p.parent() == Some(dir)) == Some(true)
            && current.as_deref().and_then(|p| p.file_name()) == Some(std::ffi::OsStr::new(&stem))
        {
            current.clone().unwrap()
        } else {
            find_available_dir_for(dir, &stem, current.as_deref())
        };

        if let Some(current_path) = &current {
            if current_path != &desired && current_path.exists() {
                relocate(current_path, &desired)?;
            }
        }

        folder.source = Some(desired.clone());
        claimed.extend(write_folder(&desired, folder)?);
    }

    Ok(claimed)
}

/// Picks a free directory name, suffixing past anything taken.
fn find_available_dir_for(parent: &Path, stem: &str, current: Option<&Path>) -> PathBuf {
    let candidate = parent.join(stem);
    if current == Some(candidate.as_path()) || !candidate.exists() {
        return candidate;
    }

    let mut counter = 2;
    loop {
        let candidate = parent.join(format!("{}-{}", stem, counter));
        if current == Some(candidate.as_path()) || !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

/// Removes the v1 files once a v2 tree is fully on disk.
///
/// Unconditional and idempotent, so a conversion interrupted before this point
/// heals itself on the next save rather than leaving both formats forever.
pub(crate) fn remove_v1_files(dir: &Path) -> Result<(), String> {
    let collection_json = dir.join(COLLECTION_JSON);
    if collection_json.exists() {
        fs::remove_file(&collection_json)
            .map_err(|e| format!("Failed to remove {}: {}", collection_json.display(), e))?;
    }

    let variables_json = dir.join("variables.json");
    if variables_json.exists() {
        fs::remove_file(&variables_json)
            .map_err(|e| format!("Failed to remove {}: {}", variables_json.display(), e))?;
    }

    let requests = dir.join("requests");
    if requests.is_dir() {
        fs::remove_dir_all(&requests)
            .map_err(|e| format!("Failed to remove {}: {}", requests.display(), e))?;
    }

    Ok(())
}

/// Writes a whole collection to a directory.
///
/// `collection.yaml` is written last on purpose: it is the marker that makes a
/// directory read as v2, so it must not appear until the tree beneath it is
/// complete. A crash midway leaves the v1 files intact and the directory still
/// reading as v1.
///
/// @param dir - The collection directory
/// @param collection - The collection to persist
/// @returns Ok once every file is in place
pub(crate) fn write_collection_dir(
    dir: &Path,
    collection: &mut LoadedCollection,
) -> Result<(), String> {
    ensure_dir(dir)?;

    assign_missing_seq(&mut collection.root);
    write_folder(dir, &mut collection.root)?;

    if !collection.variables.is_empty() {
        write_if_changed(&dir.join(VARIABLES_YAML), &to_yaml(&collection.variables)?)?;
    }

    if let Some(spec) = &collection.open_api_spec {
        write_if_changed(&dir.join(OPENAPI_YAML), &to_yaml(spec)?)?;
        collection.meta.open_api_spec = Some(OPENAPI_YAML.to_string());
    }

    write_if_changed(&dir.join(COLLECTION_YAML), &to_yaml(&collection.meta)?)?;

    remove_v1_files(dir)?;

    Ok(())
}

/// Serializes variables for a standalone write.
pub(crate) fn variables_yaml(variables: &[Value]) -> Result<String, String> {
    to_yaml(&variables)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::collections::model::{
        CollectionDoc, FolderDoc, RequestDoc, FORMAT_VERSION,
    };
    use crate::commands::collections::read::{read_collection_dir, Layout, RequestEntry};
    use serde_json::Map;
    use tempfile::TempDir;

    fn collection_meta() -> CollectionDoc {
        CollectionDoc {
            format: FORMAT_VERSION,
            id: "collection_1".into(),
            name: "Petstore".into(),
            base_url: String::new(),
            description: None,
            default_headers: None,
            auth: None,
            open_api_spec: None,
            extra: Map::new(),
        }
    }

    fn folder_meta(id: &str, name: &str) -> FolderDoc {
        FolderDoc {
            format: FORMAT_VERSION,
            id: id.into(),
            name: name.into(),
            seq: 0,
            auth: None,
            extra: Map::new(),
        }
    }

    fn request(id: &str, name: &str) -> RequestEntry {
        RequestEntry::new(RequestDoc::new(id.into(), name.into()))
    }

    fn collection(requests: Vec<RequestEntry>) -> LoadedCollection {
        LoadedCollection {
            meta: collection_meta(),
            open_api_spec: None,
            variables: Vec::new(),
            root: FolderNode {
                meta: None,
                source: None,
                requests,
                folders: Vec::new(),
            },
            layout: Layout::V2,
        }
    }

    #[test]
    fn a_written_collection_reads_back_with_the_same_requests() {
        let temp = TempDir::new().unwrap();
        let mut written = collection(vec![request("r1", "Health"), request("r2", "List Pets")]);

        write_collection_dir(temp.path(), &mut written).unwrap();
        let read = read_collection_dir(temp.path()).unwrap();

        let names: Vec<_> = read.requests().iter().map(|e| e.doc.name.clone()).collect();
        assert_eq!(names, vec!["Health", "List Pets"]);
        assert_eq!(read.meta.id, "collection_1");
    }

    #[test]
    fn each_request_becomes_its_own_file_named_after_it() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "List Users")]);

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join("list-users.yaml").exists());
        assert!(temp.path().join(COLLECTION_YAML).exists());
    }

    #[test]
    fn folders_become_directories() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![]);
        c.root.folders.push(FolderNode {
            meta: Some(folder_meta("f1", "pets")),
            source: None,
            requests: vec![request("r1", "List Pets")],
            folders: Vec::new(),
        });

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join("pets").is_dir());
        assert!(temp.path().join("pets").join(FOLDER_YAML).exists());
        assert!(temp.path().join("pets").join("list-pets.yaml").exists());
    }

    #[test]
    fn nested_folders_mirror_the_directory_tree() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![]);
        c.root.folders.push(FolderNode {
            meta: Some(folder_meta("outer", "outer")),
            source: None,
            requests: Vec::new(),
            folders: vec![FolderNode {
                meta: Some(folder_meta("inner", "inner")),
                source: None,
                requests: vec![request("r1", "Deep")],
                folders: Vec::new(),
            }],
        });

        write_collection_dir(temp.path(), &mut c).unwrap();
        assert!(temp.path().join("outer/inner/deep.yaml").exists());

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.requests().len(), 1);
        assert_eq!(read.root.folders[0].folders[0].requests[0].doc.name, "Deep");
    }

    /// The anti-churn guarantee: the same tree must produce the same bytes, or
    /// every save would show up as a diff.
    #[test]
    fn writing_twice_produces_identical_bytes() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Health")]);

        write_collection_dir(temp.path(), &mut c).unwrap();
        let first = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        write_collection_dir(temp.path(), &mut c).unwrap();
        let second = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        assert_eq!(first, second);
    }

    /// The promise this format makes to a git user: changing one request
    /// touches one file. If siblings were rewritten, every save would show up
    /// as a diff across the whole collection.
    #[test]
    fn editing_one_request_leaves_its_siblings_byte_identical() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![
            request("r1", "Alpha"),
            request("r2", "Bravo"),
            request("r3", "Charlie"),
        ]);
        write_collection_dir(temp.path(), &mut c).unwrap();

        let before: Vec<_> = ["alpha.yaml", "bravo.yaml", "charlie.yaml"]
            .iter()
            .map(|n| fs::read_to_string(temp.path().join(n)).unwrap())
            .collect();

        c.root.requests[1].doc.description = Some("now documented".into());
        write_collection_dir(temp.path(), &mut c).unwrap();

        let after: Vec<_> = ["alpha.yaml", "bravo.yaml", "charlie.yaml"]
            .iter()
            .map(|n| fs::read_to_string(temp.path().join(n)).unwrap())
            .collect();

        assert_eq!(before[0], after[0], "alpha was rewritten");
        assert_eq!(before[2], after[2], "charlie was rewritten");
        assert_ne!(before[1], after[1], "bravo should have changed");
        assert!(after[1].contains("now documented"));
    }

    /// Adding a request must not renumber or rewrite the existing ones.
    #[test]
    fn adding_a_request_leaves_the_existing_files_alone() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Alpha"), request("r2", "Bravo")]);
        write_collection_dir(temp.path(), &mut c).unwrap();

        let before = fs::read_to_string(temp.path().join("alpha.yaml")).unwrap();

        c.root.requests.push(request("r3", "Charlie"));
        write_collection_dir(temp.path(), &mut c).unwrap();

        assert_eq!(
            before,
            fs::read_to_string(temp.path().join("alpha.yaml")).unwrap()
        );
        assert!(temp.path().join("charlie.yaml").exists());
    }

    /// The end-to-end proof for the worst failure this format could cause:
    /// a collection kept in a git repository, read and written back, must
    /// leave `.git` exactly where it was. `slugify(".git")` is `"git"`, so a
    /// writer that renames directories to match their slug would rename it.
    #[test]
    fn a_git_directory_survives_a_read_and_write_cycle() {
        let temp = TempDir::new().unwrap();

        fs::write(
            temp.path().join(COLLECTION_YAML),
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        )
        .unwrap();
        fs::write(
            temp.path().join("health.yaml"),
            "resonanceFormat: 2\nid: r1\nname: Health\n",
        )
        .unwrap();

        fs::create_dir(temp.path().join(".git")).unwrap();
        fs::write(temp.path().join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(temp.path().join(".github/workflows")).unwrap();
        fs::write(temp.path().join(".github/workflows/ci.yaml"), "name: CI\n").unwrap();
        fs::write(temp.path().join("docker-compose.yaml"), "services: {}\n").unwrap();

        let mut loaded = read_collection_dir(temp.path()).unwrap();
        write_collection_dir(temp.path(), &mut loaded).unwrap();

        assert!(
            temp.path().join(".git").is_dir(),
            ".git was moved or removed"
        );
        assert!(!temp.path().join("git").exists(), ".git was renamed to git");
        assert_eq!(
            fs::read_to_string(temp.path().join(".git/HEAD")).unwrap(),
            "ref: refs/heads/main\n"
        );
        assert!(temp.path().join(".github/workflows/ci.yaml").exists());
        assert!(!temp.path().join(".git").join(FOLDER_YAML).exists());
    }

    #[test]
    fn a_foreign_yaml_file_is_left_untouched_by_a_write() {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join(COLLECTION_YAML),
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        )
        .unwrap();

        let compose = "services:\n  api:\n    image: nginx\n";
        fs::write(temp.path().join("docker-compose.yaml"), compose).unwrap();

        let mut loaded = read_collection_dir(temp.path()).unwrap();
        assert!(loaded.requests().is_empty());

        write_collection_dir(temp.path(), &mut loaded).unwrap();

        assert_eq!(
            fs::read_to_string(temp.path().join("docker-compose.yaml")).unwrap(),
            compose
        );
    }

    #[test]
    fn an_unchanged_file_is_not_rewritten() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("x.yaml");

        assert!(write_if_changed(&path, "a: 1\n").unwrap());
        assert!(!write_if_changed(&path, "a: 1\n").unwrap());
        assert!(write_if_changed(&path, "a: 2\n").unwrap());
    }

    #[test]
    fn renaming_a_request_moves_its_file_and_leaves_no_orphan() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Old Name")]);
        write_collection_dir(temp.path(), &mut c).unwrap();
        assert!(temp.path().join("old-name.yaml").exists());

        c.root.requests[0].doc.name = "New Name".into();
        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join("new-name.yaml").exists());
        assert!(!temp.path().join("old-name.yaml").exists());
    }

    #[test]
    fn two_requests_with_the_same_name_get_distinct_files() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Fetch"), request("r2", "Fetch")]);

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join("fetch.yaml").exists());
        assert!(temp.path().join("fetch-2.yaml").exists());
        assert_eq!(
            read_collection_dir(temp.path()).unwrap().requests().len(),
            2
        );
    }

    /// The v1 writer deleted the losing file when a desired name was taken,
    /// destroying that request's saved body, params and auth. Nothing here may
    /// remove a request file.
    #[test]
    fn a_name_collision_never_deletes_the_other_request() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Alpha"), request("r2", "Beta")]);
        write_collection_dir(temp.path(), &mut c).unwrap();

        c.root.requests[1].doc.name = "Alpha".into();
        write_collection_dir(temp.path(), &mut c).unwrap();

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.requests().len(), 2, "a request file was destroyed");

        let ids: Vec<_> = read.requests().iter().map(|e| e.doc.id.clone()).collect();
        assert!(ids.contains(&"r1".to_string()));
        assert!(ids.contains(&"r2".to_string()));
    }

    #[test]
    fn a_request_named_like_a_layout_file_is_suffixed() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![
            request("r1", "Collection"),
            request("r2", "Variables"),
        ]);

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join("collection-2.yaml").exists());
        assert!(temp.path().join("variables-2.yaml").exists());
        assert_eq!(
            read_collection_dir(temp.path()).unwrap().requests().len(),
            2
        );
    }

    #[test]
    fn requests_sort_by_seq_then_name() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![
            request("r1", "Zebra"),
            request("r2", "Alpha"),
            request("r3", "Beta"),
        ]);
        c.root.requests[0].doc.seq = 5;
        c.root.requests[1].doc.seq = 20;
        c.root.requests[2].doc.seq = 20;

        write_collection_dir(temp.path(), &mut c).unwrap();
        let read = read_collection_dir(temp.path()).unwrap();

        let names: Vec<_> = read.requests().iter().map(|e| e.doc.name.clone()).collect();
        assert_eq!(names, vec!["Zebra", "Alpha", "Beta"]);
    }

    #[test]
    fn a_new_request_is_numbered_above_the_existing_ones() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "First")]);
        c.root.requests[0].doc.seq = 40;
        c.root.requests.push(request("r2", "Second"));

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert_eq!(c.root.requests[0].doc.seq, 40);
        assert_eq!(c.root.requests[1].doc.seq, 50);
    }

    #[test]
    fn existing_seq_values_are_never_rewritten() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "A"), request("r2", "B")]);
        c.root.requests[0].doc.seq = 7;
        c.root.requests[1].doc.seq = 3;

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert_eq!(c.root.requests[0].doc.seq, 7);
        assert_eq!(c.root.requests[1].doc.seq, 3);
    }

    #[test]
    fn collection_yaml_is_written_after_the_requests() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Health")]);

        write_collection_dir(temp.path(), &mut c).unwrap();

        let marker = fs::metadata(temp.path().join(COLLECTION_YAML))
            .unwrap()
            .modified()
            .unwrap();
        let req = fs::metadata(temp.path().join("health.yaml"))
            .unwrap()
            .modified()
            .unwrap();

        assert!(marker >= req, "the layout marker must not precede the tree");
    }

    #[test]
    fn an_atomic_write_leaves_no_temp_files_behind() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Health")]);

        write_collection_dir(temp.path(), &mut c).unwrap();

        let leftovers: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();

        assert!(leftovers.is_empty(), "temp files were left behind");
    }

    /// The target must never be truncated by a write that fails, which is the
    /// whole reason the content goes to a temp file before the rename.
    #[cfg(unix)]
    #[test]
    fn a_failed_write_leaves_the_target_untouched() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let dir = temp.path().join("locked");
        fs::create_dir(&dir).unwrap();

        let target = dir.join("x.yaml");
        write_atomic(&target, "original\n").unwrap();

        // Read-only directory: the temp file cannot be created, so the write fails.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
        let outcome = write_atomic(&target, "replacement\n");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();

        assert!(outcome.is_err(), "the write should have failed");
        assert_eq!(fs::read_to_string(&target).unwrap(), "original\n");
    }

    #[test]
    fn a_failed_write_leaves_no_temp_file_behind() {
        let temp = TempDir::new().unwrap();
        let target = temp.path().join("blocked.yaml");
        fs::create_dir(&target).unwrap();

        assert!(write_atomic(&target, "x\n").is_err());

        let leftovers: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "a temp file survived a failed write");
    }

    #[test]
    fn variables_round_trip_through_their_own_file() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![]);
        c.variables = vec![
            serde_json::json!({"key": "baseUrl", "value": "https://api.example.com"}),
            serde_json::json!({"key": "token", "value": "", "secret": true}),
        ];

        write_collection_dir(temp.path(), &mut c).unwrap();
        let read = read_collection_dir(temp.path()).unwrap();

        assert_eq!(read.variables.len(), 2);
        assert_eq!(read.variables[0]["key"], "baseUrl");
        assert_eq!(read.variables[1]["secret"], true);
    }

    #[test]
    fn the_openapi_spec_lives_in_its_own_file() {
        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![]);
        c.open_api_spec = Some(serde_json::json!({"openapi": "3.0.0"}));

        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(temp.path().join(OPENAPI_YAML).exists());
        let collection_text = fs::read_to_string(temp.path().join(COLLECTION_YAML)).unwrap();
        assert!(
            !collection_text.contains("3.0.0"),
            "the spec must not be inlined"
        );

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.open_api_spec.unwrap()["openapi"], "3.0.0");
    }

    #[test]
    fn a_v2_write_removes_leftover_v1_files() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join(COLLECTION_JSON), "{}").unwrap();
        fs::write(temp.path().join("variables.json"), "[]").unwrap();
        fs::create_dir(temp.path().join("requests")).unwrap();
        fs::write(temp.path().join("requests/a--b.json"), "{}").unwrap();

        let mut c = collection(vec![request("r1", "Health")]);
        write_collection_dir(temp.path(), &mut c).unwrap();

        assert!(!temp.path().join(COLLECTION_JSON).exists());
        assert!(!temp.path().join("variables.json").exists());
        assert!(!temp.path().join("requests").exists());
    }

    #[test]
    fn removing_v1_files_is_safe_to_repeat() {
        let temp = TempDir::new().unwrap();
        remove_v1_files(temp.path()).unwrap();
        remove_v1_files(temp.path()).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn every_written_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let mut c = collection(vec![request("r1", "Health")]);
        write_collection_dir(temp.path(), &mut c).unwrap();

        for name in [COLLECTION_YAML, "health.yaml"] {
            let mode = fs::metadata(temp.path().join(name))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0, "{} is readable by others", name);
        }
    }
}
