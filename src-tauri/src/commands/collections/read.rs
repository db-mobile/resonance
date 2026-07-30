//! Reading a v2 collection directory into memory.
//!
//! The directory tree *is* the request tree: every `.yaml` file that is not one
//! of the layout's own becomes a request, and every subdirectory becomes a
//! folder. Ordering comes from each document's `seq`, with the display name as
//! a stable tiebreak so a hand-edited or merge-duplicated `seq` degrades to
//! something deterministic rather than to filesystem order.
#![allow(dead_code)]

use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::layout::{COLLECTION_JSON, COLLECTION_YAML, FOLDER_YAML, OPENAPI_YAML, VARIABLES_YAML};
use super::model::{
    probe_format, CollectionDoc, FolderDoc, FormatProbe, RequestDoc, FORMAT_VERSION,
};

/// Which on-disk format a collection directory uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Layout {
    /// `collection.json` plus a flat `requests/` directory.
    V1,
    /// `collection.yaml` plus one file per request, folders as directories.
    V2,
}

impl Layout {
    /// Identifies a collection directory by its marker file.
    ///
    /// V2 wins when both markers are present, which is what an interrupted
    /// conversion leaves behind: the v2 tree is complete by then, and the v1
    /// files are stale leftovers the next save removes.
    ///
    /// @param dir - Directory to inspect
    /// @returns The layout, or None when this is not a collection directory
    pub(crate) fn detect(dir: &Path) -> Option<Self> {
        if !dir.is_dir() {
            return None;
        }
        if dir.join(COLLECTION_YAML).exists() {
            return Some(Layout::V2);
        }
        if dir.join(COLLECTION_JSON).exists() {
            return Some(Layout::V1);
        }
        None
    }
}

/// One request, paired with the file it came from so a later write can rename
/// that file rather than orphaning it.
#[derive(Debug, Clone)]
pub(crate) struct RequestEntry {
    /// Where this request was read from; `None` for one that has never been written.
    pub source: Option<PathBuf>,
    pub doc: RequestDoc,
}

impl RequestEntry {
    pub fn new(doc: RequestDoc) -> Self {
        Self { source: None, doc }
    }
}

/// A folder and everything under it.
#[derive(Debug, Clone, Default)]
pub(crate) struct FolderNode {
    /// `_folder.yaml`, absent for a directory that has none.
    pub meta: Option<FolderDoc>,
    /// Where this folder was read from; `None` for one not yet written.
    pub source: Option<PathBuf>,
    pub requests: Vec<RequestEntry>,
    pub folders: Vec<FolderNode>,
}

/// A whole collection, in memory.
#[derive(Debug, Clone)]
pub(crate) struct LoadedCollection {
    pub meta: CollectionDoc,
    /// Contents of the sibling spec file, inlined for the frontend.
    pub open_api_spec: Option<Value>,
    pub variables: Vec<Value>,
    pub root: FolderNode,
    pub layout: Layout,
}

impl LoadedCollection {
    /// Walks every request in the collection, depth-first.
    pub fn requests(&self) -> Vec<&RequestEntry> {
        let mut out = Vec::new();
        collect_requests(&self.root, &mut out);
        out
    }
}

fn collect_requests<'a>(node: &'a FolderNode, out: &mut Vec<&'a RequestEntry>) {
    for request in &node.requests {
        out.push(request);
    }
    for folder in &node.folders {
        collect_requests(folder, out);
    }
}

/// Rejects a document written by a build newer than this one.
///
/// Refusing to read is deliberate: parsing it would drop every field this
/// version does not know, and the next save would write that loss back to disk.
///
/// @param source - Raw document text
/// @param path - Path used in the error message
/// @returns Ok when the version is readable
fn check_version(source: &str, path: &Path) -> Result<(), String> {
    let format = probe_format(source).map_err(|e| format!("{}: {}", path.display(), e))?;

    if format > FORMAT_VERSION {
        return Err(format!(
            "{} was written by a newer version of Resonance (format {}, this build reads {})",
            path.display(),
            format,
            FORMAT_VERSION
        ));
    }
    Ok(())
}

/// Parses one YAML document, refusing anything from a newer build.
fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let source = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    check_version(&source, path)?;
    serde_yaml_ng::from_str(&source)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))
}

/// True for a file the layout owns rather than a request.
fn is_layout_file(name: &str) -> bool {
    name == COLLECTION_YAML
        || name == VARIABLES_YAML
        || name == OPENAPI_YAML
        || name == FOLDER_YAML
        || name.starts_with('_')
}

/// True for a file that could hold a request document.
fn is_yaml_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml")
    )
}

/// Reads a request document, skipping a file that is not one.
///
/// A collection kept in a repository sits beside YAML that has nothing to do
/// with Resonance — `docker-compose.yaml`, CI config, a half-edited file. One
/// of those used to fail the entire read, and `collections_get_all` swallows
/// that error, so the collection disappeared from the sidebar with nothing
/// reported anywhere.
///
/// A version from a newer build stays fatal: that is a deliberate signal, not
/// a foreign file, and reading it would silently drop fields.
///
/// @param path - The candidate file
/// @returns The request, or None when the file is not one
fn read_request_file(path: &Path) -> Result<Option<RequestDoc>, String> {
    let source = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    // A file that is not even valid YAML cannot be a request, so it is
    // foreign rather than broken. Only a document that parses and declares a
    // newer format is fatal.
    if serde_yaml_ng::from_str::<FormatProbe>(&source).is_err() {
        eprintln!("Skipping {}: not a YAML document", path.display());
        return Ok(None);
    }
    check_version(&source, path)?;

    match serde_yaml_ng::from_str::<RequestDoc>(&source) {
        Ok(doc) => Ok(Some(doc)),
        Err(error) => {
            eprintln!(
                "Skipping {}: not a request file ({})",
                path.display(),
                error
            );
            Ok(None)
        }
    }
}

/// Orders a directory's children by `seq`, then name, then id.
///
/// Every fallback matters. A merge can leave two files with the same `seq`
/// (neither branch saw the other) and a hand-written file may have none. The
/// id breaks a remaining tie on name, without which the order would fall back
/// to `fs::read_dir` and differ between machines for the same commit.
fn sort_key(seq: i64, name: &str, id: &str) -> (i64, String, String) {
    (seq, name.to_ascii_lowercase(), id.to_string())
}

/// Reads one directory as a folder, recursing into subdirectories.
fn read_folder(dir: &Path) -> Result<FolderNode, String> {
    let mut node = FolderNode::default();

    let folder_yaml = dir.join(FOLDER_YAML);
    if folder_yaml.exists() {
        node.meta = Some(read_yaml::<FolderDoc>(&folder_yaml)?);
        node.source = Some(dir.to_path_buf());
    } else {
        node.source = Some(dir.to_path_buf());
    }

    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;

    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();

        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        // `.git`, `.github`, `.venv` and friends are not part of the
        // collection. Reading them would surface them in the sidebar, and the
        // writer would then rename `.git` to its slug — `git` — and destroy
        // the repository.
        if name.starts_with('.') {
            continue;
        }

        // A symlink is followed by `is_dir()`, so one pointing at an ancestor
        // is unbounded recursion.
        let is_symlink = fs::symlink_metadata(&path)
            .map(|meta| meta.is_symlink())
            .unwrap_or(false);
        if is_symlink {
            continue;
        }

        if path.is_dir() {
            if Layout::detect(&path).is_some() {
                return Err(format!(
                    "{} contains a nested collection at {}; open it on its own instead",
                    dir.display(),
                    path.display()
                ));
            }
            node.folders.push(read_folder(&path)?);
        } else if is_yaml_file(&path) && !is_layout_file(&name) {
            if let Some(doc) = read_request_file(&path)? {
                node.requests.push(RequestEntry {
                    source: Some(path),
                    doc,
                });
            }
        }
    }

    node.requests
        .sort_by_key(|entry| sort_key(entry.doc.seq, &entry.doc.name, &entry.doc.id));
    node.folders.sort_by_key(|folder| {
        let meta = folder.meta.as_ref();
        let seq = meta.map(|m| m.seq).unwrap_or(0);
        let name = folder_display_name(folder);
        let id = meta.map(|m| m.id.clone()).unwrap_or_default();
        sort_key(seq, &name, &id)
    });

    Ok(node)
}

/// A folder's display name: its own metadata when present, else its directory.
pub(crate) fn folder_display_name(folder: &FolderNode) -> String {
    if let Some(meta) = &folder.meta {
        return meta.name.clone();
    }
    folder
        .source
        .as_ref()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string()
}

/// Re-ids any request whose id another request already claimed.
///
/// Two files can claim one id after a merge, because both branches added a
/// request independently. Dropping one would silently delete a colleague's
/// work, so the loser keeps its content and gets a fresh id; a request that
/// arrived by merge has no local keychain scope or pinned state to preserve.
///
/// @param node - Folder to walk
/// @param seen - Ids already claimed
/// @returns Ids that were reassigned, for logging
fn dedupe_ids(node: &mut FolderNode, seen: &mut HashSet<String>) -> Vec<(String, String)> {
    let mut reassigned = Vec::new();

    for entry in &mut node.requests {
        if entry.doc.id.is_empty() || !seen.insert(entry.doc.id.clone()) {
            let old = entry.doc.id.clone();
            let fresh = new_request_id();
            seen.insert(fresh.clone());
            entry.doc.id = fresh.clone();
            reassigned.push((old, fresh));
        }
    }

    for folder in &mut node.folders {
        reassigned.extend(dedupe_ids(folder, seen));
    }

    reassigned
}

/// Mints a request id that no counter could reproduce on another branch.
pub(crate) fn new_request_id() -> String {
    format!("req_{}", uuid::Uuid::new_v4().simple())
}

/// Reads a v2 collection directory.
///
/// @param dir - The collection directory
/// @returns The collection in memory
pub(crate) fn read_collection_dir(dir: &Path) -> Result<LoadedCollection, String> {
    let collection_yaml = dir.join(COLLECTION_YAML);
    if !collection_yaml.exists() {
        return Err(format!("{} has no {}", dir.display(), COLLECTION_YAML));
    }

    let meta: CollectionDoc = read_yaml(&collection_yaml)?;

    let variables_yaml = dir.join(VARIABLES_YAML);
    let variables: Vec<Value> = if variables_yaml.exists() {
        let source = fs::read_to_string(&variables_yaml)
            .map_err(|e| format!("Failed to read {}: {}", variables_yaml.display(), e))?;
        serde_yaml_ng::from_str(&source)
            .map_err(|e| format!("Failed to parse {}: {}", variables_yaml.display(), e))?
    } else {
        Vec::new()
    };

    let open_api_spec = match &meta.open_api_spec {
        Some(name) => {
            let spec_path = dir.join(name);
            if spec_path.exists() {
                let source = fs::read_to_string(&spec_path)
                    .map_err(|e| format!("Failed to read {}: {}", spec_path.display(), e))?;
                Some(
                    serde_yaml_ng::from_str(&source)
                        .map_err(|e| format!("Failed to parse {}: {}", spec_path.display(), e))?,
                )
            } else {
                None
            }
        }
        None => None,
    };

    let mut root = read_folder(dir)?;

    let mut seen = HashSet::new();
    let reassigned = dedupe_ids(&mut root, &mut seen);
    for (old, fresh) in &reassigned {
        eprintln!(
            "collection {}: duplicate request id {} reassigned to {}",
            meta.id, old, fresh
        );
    }

    Ok(LoadedCollection {
        meta,
        open_api_spec,
        variables,
        root,
        layout: Layout::V2,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn minimal_collection(dir: &Path) {
        write(
            dir,
            COLLECTION_YAML,
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        );
    }

    fn request_yaml(id: &str, name: &str) -> String {
        format!("resonanceFormat: 2\nid: {}\nname: {}\n", id, name)
    }

    #[test]
    fn detects_a_v2_directory_by_its_marker() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        assert_eq!(Layout::detect(temp.path()), Some(Layout::V2));
    }

    #[test]
    fn detects_a_v1_directory_by_its_marker() {
        let temp = TempDir::new().unwrap();
        write(temp.path(), COLLECTION_JSON, "{}");
        assert_eq!(Layout::detect(temp.path()), Some(Layout::V1));
    }

    /// An interrupted conversion leaves both markers. The v2 tree is complete
    /// by that point, so it wins and the next save clears the v1 leftovers.
    #[test]
    fn v2_wins_when_both_markers_are_present() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), COLLECTION_JSON, "{}");
        assert_eq!(Layout::detect(temp.path()), Some(Layout::V2));
    }

    #[test]
    fn an_ordinary_directory_is_not_a_collection() {
        let temp = TempDir::new().unwrap();
        write(temp.path(), "notes.txt", "hello");
        assert_eq!(Layout::detect(temp.path()), None);
    }

    #[test]
    fn reads_requests_and_folders_from_the_directory_tree() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));
        write(
            temp.path(),
            "pets/_folder.yaml",
            "resonanceFormat: 2\nid: f1\nname: pets\n",
        );
        write(temp.path(), "pets/list.yaml", &request_yaml("r2", "List"));

        let read = read_collection_dir(temp.path()).unwrap();

        assert_eq!(read.root.requests.len(), 1);
        assert_eq!(read.root.folders.len(), 1);
        assert_eq!(read.root.folders[0].requests.len(), 1);
        assert_eq!(read.requests().len(), 2);
    }

    #[test]
    fn a_folder_without_metadata_is_named_after_its_directory() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "admin/x.yaml", &request_yaml("r1", "X"));

        let read = read_collection_dir(temp.path()).unwrap();

        assert!(read.root.folders[0].meta.is_none());
        assert_eq!(folder_display_name(&read.root.folders[0]), "admin");
    }

    #[test]
    fn layout_files_are_not_read_as_requests() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), VARIABLES_YAML, "- key: a\n  value: b\n");
        write(temp.path(), OPENAPI_YAML, "openapi: 3.0.0\n");
        write(temp.path(), "_notes.yaml", "anything: goes\n");

        let read = read_collection_dir(temp.path()).unwrap();
        assert!(read.root.requests.is_empty());
    }

    #[test]
    fn non_yaml_files_are_ignored() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "README.md", "# notes");
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));

        assert_eq!(
            read_collection_dir(temp.path()).unwrap().requests().len(),
            1
        );
    }

    #[test]
    fn requests_are_ordered_by_seq_then_name() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "c.yaml",
            "resonanceFormat: 2\nid: r3\nname: Charlie\nseq: 5\n",
        );
        write(
            temp.path(),
            "a.yaml",
            "resonanceFormat: 2\nid: r1\nname: Alpha\nseq: 20\n",
        );
        write(
            temp.path(),
            "b.yaml",
            "resonanceFormat: 2\nid: r2\nname: Bravo\nseq: 20\n",
        );

        let read = read_collection_dir(temp.path()).unwrap();
        let names: Vec<_> = read
            .root
            .requests
            .iter()
            .map(|e| e.doc.name.clone())
            .collect();

        assert_eq!(names, vec!["Charlie", "Alpha", "Bravo"]);
    }

    #[test]
    fn a_request_without_a_seq_sorts_first_by_name() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "z.yaml", &request_yaml("r1", "Zulu"));
        write(temp.path(), "a.yaml", &request_yaml("r2", "Alpha"));

        let read = read_collection_dir(temp.path()).unwrap();
        let names: Vec<_> = read
            .root
            .requests
            .iter()
            .map(|e| e.doc.name.clone())
            .collect();

        assert_eq!(names, vec!["Alpha", "Zulu"]);
    }

    /// After a merge two files can claim one id, because both branches added a
    /// request without seeing the other. Both must survive.
    #[test]
    fn a_duplicate_id_is_reassigned_and_both_requests_survive() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "mine.yaml", &request_yaml("req_same", "Mine"));
        write(
            temp.path(),
            "theirs.yaml",
            &request_yaml("req_same", "Theirs"),
        );

        let read = read_collection_dir(temp.path()).unwrap();
        let requests = read.requests();

        assert_eq!(requests.len(), 2, "a request was dropped");

        let ids: HashSet<_> = requests.iter().map(|e| e.doc.id.clone()).collect();
        assert_eq!(ids.len(), 2, "the ids were not made distinct");

        let names: HashSet<_> = requests.iter().map(|e| e.doc.name.clone()).collect();
        assert!(names.contains("Mine") && names.contains("Theirs"));
    }

    #[test]
    fn a_request_with_no_id_is_given_one() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "x.yaml",
            "resonanceFormat: 2\nid: ''\nname: Handwritten\n",
        );

        let read = read_collection_dir(temp.path()).unwrap();
        assert!(!read.root.requests[0].doc.id.is_empty());
    }

    #[test]
    fn a_newer_format_version_is_refused() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "x.yaml",
            "resonanceFormat: 99\nid: r1\nname: Future\n",
        );

        let error = read_collection_dir(temp.path()).unwrap_err();
        assert!(error.contains("newer version"), "{}", error);
    }

    #[test]
    fn a_newer_collection_document_is_refused() {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            COLLECTION_YAML,
            "resonanceFormat: 99\nid: c1\nname: Future\n",
        );

        assert!(read_collection_dir(temp.path())
            .unwrap_err()
            .contains("newer version"));
    }

    #[test]
    fn a_document_without_a_version_is_accepted() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "x.yaml", "id: r1\nname: Handwritten\n");

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.root.requests[0].doc.name, "Handwritten");
    }

    #[test]
    fn a_missing_variables_file_yields_no_variables() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());

        assert!(read_collection_dir(temp.path())
            .unwrap()
            .variables
            .is_empty());
    }

    #[test]
    fn a_directory_without_the_marker_cannot_be_read() {
        let temp = TempDir::new().unwrap();
        assert!(read_collection_dir(temp.path()).is_err());
    }

    #[test]
    fn each_request_remembers_the_file_it_came_from() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(
            read.root.requests[0].source.as_ref().unwrap(),
            &temp.path().join("health.yaml")
        );
    }

    /// A collection kept in a git repository has a `.git` directory beside it.
    /// `slugify(".git")` is `"git"`, so a writer that renames a directory to
    /// match its slug would rename `.git` and destroy the repository. The
    /// reader must never surface it as a folder in the first place.
    #[test]
    fn dot_directories_are_not_read_as_folders() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), ".git/config", "[core]\n");
        write(temp.path(), ".github/workflows/ci.yaml", "name: CI\n");
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));

        let read = read_collection_dir(temp.path()).unwrap();

        assert!(
            read.root.folders.is_empty(),
            "a dot-directory was read as a folder"
        );
        assert_eq!(read.requests().len(), 1);
    }

    #[test]
    fn a_symlinked_directory_is_skipped() {
        #[cfg(unix)]
        {
            let temp = TempDir::new().unwrap();
            minimal_collection(temp.path());
            fs::create_dir(temp.path().join("real")).unwrap();
            write(temp.path(), "real/x.yaml", &request_yaml("r1", "X"));
            std::os::unix::fs::symlink(temp.path().join("real"), temp.path().join("link")).unwrap();

            let read = read_collection_dir(temp.path()).unwrap();

            assert_eq!(read.root.folders.len(), 1, "the symlink was followed");
            assert_eq!(read.requests().len(), 1);
        }
    }

    /// A symlink pointing at an ancestor is unbounded recursion without a skip.
    #[test]
    fn a_symlink_cycle_does_not_recurse_forever() {
        #[cfg(unix)]
        {
            let temp = TempDir::new().unwrap();
            minimal_collection(temp.path());
            fs::create_dir(temp.path().join("inner")).unwrap();
            std::os::unix::fs::symlink(temp.path(), temp.path().join("inner/loop")).unwrap();

            let read = read_collection_dir(temp.path()).unwrap();
            assert!(read.requests().is_empty());
        }
    }

    /// A repository holds YAML that has nothing to do with Resonance. One such
    /// file used to fail the whole read, and `collections_get_all` swallows
    /// that error, so the collection vanished from the sidebar silently.
    #[test]
    fn a_foreign_yaml_file_is_skipped_rather_than_failing_the_read() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "docker-compose.yaml",
            "services:\n  api:\n    image: nginx\n",
        );
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));

        let read = read_collection_dir(temp.path()).unwrap();

        assert_eq!(read.requests().len(), 1);
        assert_eq!(read.root.requests[0].doc.id, "r1");
    }

    #[test]
    fn a_yml_file_is_treated_the_same_as_yaml() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "ping.yml", &request_yaml("r1", "Ping"));

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.requests().len(), 1);
    }

    #[test]
    fn a_malformed_yaml_file_is_skipped() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "broken.yaml", "this: [is not: valid\n");
        write(temp.path(), "health.yaml", &request_yaml("r1", "Health"));

        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.requests().len(), 1);
    }

    /// The outer read would otherwise absorb the inner collection's requests,
    /// re-id the duplicates, and write the mutations back into the inner
    /// collection's own files.
    #[test]
    fn a_nested_collection_is_refused() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "inner/collection.yaml",
            "resonanceFormat: 2\nid: c2\nname: Inner\n",
        );
        write(temp.path(), "inner/x.yaml", &request_yaml("r1", "X"));

        let error = read_collection_dir(temp.path()).unwrap_err();
        assert!(error.contains("nested collection"), "{}", error);
    }

    #[test]
    fn a_nested_v1_collection_is_also_refused() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "inner/collection.json", "{}");

        assert!(read_collection_dir(temp.path())
            .unwrap_err()
            .contains("nested collection"));
    }

    /// Same seq and same name used to fall back to fs::read_dir order, which
    /// differs by filesystem, so two people saw different orders for one commit.
    #[test]
    fn identical_seq_and_name_are_ordered_by_id() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "b.yaml",
            "resonanceFormat: 2\nid: zzz\nname: Same\nseq: 10\n",
        );
        write(
            temp.path(),
            "a.yaml",
            "resonanceFormat: 2\nid: aaa\nname: Same\nseq: 10\n",
        );

        let read = read_collection_dir(temp.path()).unwrap();
        let ids: Vec<_> = read
            .root
            .requests
            .iter()
            .map(|e| e.doc.id.clone())
            .collect();

        assert_eq!(ids, vec!["aaa", "zzz"]);
    }

    #[test]
    fn minted_ids_are_distinct() {
        let ids: HashSet<_> = (0..100).map(|_| new_request_id()).collect();
        assert_eq!(ids.len(), 100);
    }
}
