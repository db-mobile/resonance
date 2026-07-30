//! Collections opened in place from a directory the app does not own.
//!
//! A linked collection lives wherever the user keeps it — typically a git
//! checkout. Everything here is pure so it can be tested without an
//! `AppHandle`: the command layer supplies the store maps and writes the
//! results back.
//!
//! Linkage is recorded as `{id: path}` rather than a bare id list. The path is
//! what makes it self-correcting: `collections_list` re-registers every
//! collection it finds in the app's own directory, so an id whose path drifted
//! back under app ownership would otherwise stay marked linked forever.
//!
//! Nothing calls this yet: the commands that open and close a collection land
//! in a later step, so dead code is expected here until then.
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::read::Layout;

/// Store key holding `{collectionId: absolutePath}` for linked collections.
pub(crate) const LINKED_COLLECTIONS_KEY: &str = "linkedCollections";

/// What opening a directory should do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Decision {
    /// Not known, or known at a path that no longer holds a collection.
    Open,
    /// Already open from exactly this directory; nothing to do.
    AlreadyOpen,
    /// A different directory already claims this identity.
    Conflict {
        /// What is already open, reported so the user can act on it.
        existing: PathBuf,
        /// True when the clash is on the path rather than the id.
        same_path_different_id: bool,
    },
}

/// Reports whether a collection is currently linked.
///
/// Linkage requires the recorded path to still be the registered one, so an
/// entry left behind after a collection moved back under app ownership does
/// not keep suppressing its Delete action.
///
/// @param id - The collection id
/// @param index - The `{id: path}` collection index
/// @param linked - The `{id: path}` linked map
/// @returns True when this collection was opened in place
pub(crate) fn is_linked(
    id: &str,
    index: &HashMap<String, String>,
    linked: &HashMap<String, String>,
) -> bool {
    match (index.get(id), linked.get(id)) {
        (Some(registered), Some(recorded)) => paths_equal(registered, recorded),
        _ => false,
    }
}

/// Compares two path strings, tolerating trailing separators and `..`.
fn paths_equal(left: &str, right: &str) -> bool {
    normalize(Path::new(left)) == normalize(Path::new(right))
}

/// Resolves a path as far as the filesystem allows, falling back to a
/// lexical cleanup when it does not exist.
///
/// Canonicalizing matters for the default-directory check: a symlinked home
/// or a `..` in the picked path would otherwise slip past a string compare.
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| lexical_clean(path))
}

/// Removes `.` and resolves `..` textually, for a path that does not exist.
fn lexical_clean(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Reports whether `candidate` is the given directory or sits inside it.
///
/// Compares resolved paths component-wise, so `collections-old` is not treated
/// as being under `collections`.
///
/// @param parent - The enclosing directory
/// @param candidate - The path to test
/// @returns True when candidate is parent or below it
pub(crate) fn is_under(parent: &Path, candidate: &Path) -> bool {
    let parent = normalize(parent);
    let candidate = normalize(candidate);
    candidate == parent || candidate.starts_with(&parent)
}

/// Where a collection's directory should be for a save.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Placement {
    /// Use this directory exactly as it is: do not rename it to match the
    /// collection name, do not create it, do not change its permissions.
    InPlace(PathBuf),
    /// App-owned. May be created, renamed to match the collection name, and
    /// locked down to the owner.
    Managed,
}

/// Decides how a collection's directory should be treated on save.
///
/// A linked collection is the user's own directory — usually a git checkout —
/// so renaming it to match the collection name would move their working copy
/// out from under their shell, editor and CI. A collection is only ever
/// treated in place once it actually has a directory.
///
/// @param linked - Whether this collection was opened in place
/// @param existing_dir - The directory it currently occupies, if any
/// @returns How the directory should be treated
pub(crate) fn placement(linked: bool, existing_dir: Option<&Path>) -> Placement {
    match (linked, existing_dir) {
        (true, Some(dir)) => Placement::InPlace(dir.to_path_buf()),
        _ => Placement::Managed,
    }
}

/// Finds the collections a picked directory offers.
///
/// The directory itself when it is a collection, otherwise every collection
/// directly inside it — a repository commonly holds several side by side. The
/// scan stops at one level: descending further would wander into unrelated
/// trees.
///
/// @param root - The directory the user picked
/// @returns Collection directories, sorted for a stable report
pub(crate) fn discover_collection_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Err(format!("{} is not a directory", root.display()));
    }

    if Layout::detect(root).is_some() {
        return Ok(vec![root.to_path_buf()]);
    }

    let entries =
        std::fs::read_dir(root).map_err(|e| format!("Failed to read {}: {}", root.display(), e))?;

    let mut found = Vec::new();
    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();

        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false);
        if hidden {
            continue;
        }

        if Layout::detect(&path).is_some() {
            found.push(path);
        }
    }

    found.sort();
    Ok(found)
}

/// Decides what opening one collection directory should do.
///
/// @param id - The id read from that directory
/// @param path - The directory being opened
/// @param index - The `{id: path}` collection index
/// @returns The decision, including what already claims the identity
pub(crate) fn classify_open(id: &str, path: &Path, index: &HashMap<String, String>) -> Decision {
    if let Some(registered) = index.get(id) {
        let registered_path = PathBuf::from(registered);

        if paths_equal(registered, &path.to_string_lossy()) {
            return Decision::AlreadyOpen;
        }

        // A stale entry is not a conflict: the collection was moved or
        // deleted, and re-registering is exactly what the user wants.
        if Layout::detect(&registered_path).is_some() {
            return Decision::Conflict {
                existing: registered_path,
                same_path_different_id: false,
            };
        }
    }

    // The same directory registered under a different id happens when a pull
    // changes the id in collection.yaml. Opening again would leave two entries
    // pointing at one directory.
    for (other_id, other_path) in index {
        if other_id != id && paths_equal(other_path, &path.to_string_lossy()) {
            return Decision::Conflict {
                existing: PathBuf::from(other_path),
                same_path_different_id: true,
            };
        }
    }

    Decision::Open
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn v2_collection(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("collection.yaml"),
            "resonanceFormat: 2\nid: c1\nname: X\n",
        )
        .unwrap();
    }

    fn v1_collection(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("collection.json"), "{}").unwrap();
    }

    fn index_of(pairs: &[(&str, &Path)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(id, path)| (id.to_string(), path.to_string_lossy().to_string()))
            .collect()
    }

    mod discovery {
        use super::*;

        #[test]
        fn a_v2_directory_is_returned_as_itself() {
            let temp = TempDir::new().unwrap();
            v2_collection(temp.path());

            assert_eq!(
                discover_collection_dirs(temp.path()).unwrap(),
                vec![temp.path().to_path_buf()]
            );
        }

        #[test]
        fn a_v1_directory_is_returned_as_itself() {
            let temp = TempDir::new().unwrap();
            v1_collection(temp.path());

            assert_eq!(discover_collection_dirs(temp.path()).unwrap().len(), 1);
        }

        #[test]
        fn a_parent_yields_only_its_collection_children() {
            let temp = TempDir::new().unwrap();
            v2_collection(&temp.path().join("petstore"));
            v2_collection(&temp.path().join("internal"));
            fs::create_dir(temp.path().join("docs")).unwrap();
            fs::create_dir(temp.path().join("scripts")).unwrap();
            fs::write(temp.path().join("README.md"), "hi").unwrap();

            let found = discover_collection_dirs(temp.path()).unwrap();

            assert_eq!(found.len(), 2);
            assert!(found.contains(&temp.path().join("petstore")));
            assert!(found.contains(&temp.path().join("internal")));
        }

        #[test]
        fn the_scan_does_not_descend_two_levels() {
            let temp = TempDir::new().unwrap();
            v2_collection(&temp.path().join("a/b"));

            assert!(discover_collection_dirs(temp.path()).unwrap().is_empty());
        }

        #[test]
        fn hidden_directories_are_not_scanned() {
            let temp = TempDir::new().unwrap();
            v2_collection(&temp.path().join(".hidden"));

            assert!(discover_collection_dirs(temp.path()).unwrap().is_empty());
        }

        #[test]
        fn a_directory_with_no_collections_yields_nothing() {
            let temp = TempDir::new().unwrap();
            fs::create_dir(temp.path().join("docs")).unwrap();

            assert!(discover_collection_dirs(temp.path()).unwrap().is_empty());
        }

        #[test]
        fn a_missing_path_is_an_error() {
            let temp = TempDir::new().unwrap();
            assert!(discover_collection_dirs(&temp.path().join("nope")).is_err());
        }

        #[test]
        fn a_file_is_an_error() {
            let temp = TempDir::new().unwrap();
            let file = temp.path().join("x.txt");
            fs::write(&file, "").unwrap();

            assert!(discover_collection_dirs(&file).is_err());
        }

        #[test]
        fn results_are_sorted_so_the_report_is_stable() {
            let temp = TempDir::new().unwrap();
            for name in ["zulu", "alpha", "mike"] {
                v2_collection(&temp.path().join(name));
            }

            let found = discover_collection_dirs(temp.path()).unwrap();
            let names: Vec<_> = found
                .iter()
                .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
                .collect();

            assert_eq!(names, vec!["alpha", "mike", "zulu"]);
        }
    }

    mod classification {
        use super::*;

        #[test]
        fn an_unknown_id_opens() {
            let temp = TempDir::new().unwrap();
            v2_collection(temp.path());

            assert_eq!(
                classify_open("c1", temp.path(), &HashMap::new()),
                Decision::Open
            );
        }

        #[test]
        fn the_same_path_is_already_open() {
            let temp = TempDir::new().unwrap();
            v2_collection(temp.path());
            let index = index_of(&[("c1", temp.path())]);

            assert_eq!(
                classify_open("c1", temp.path(), &index),
                Decision::AlreadyOpen
            );
        }

        #[test]
        fn a_different_live_path_conflicts() {
            let first = TempDir::new().unwrap();
            let second = TempDir::new().unwrap();
            v2_collection(first.path());
            v2_collection(second.path());
            let index = index_of(&[("c1", first.path())]);

            match classify_open("c1", second.path(), &index) {
                Decision::Conflict {
                    existing,
                    same_path_different_id,
                } => {
                    assert_eq!(normalize(&existing), normalize(first.path()));
                    assert!(!same_path_different_id);
                }
                other => panic!("expected a conflict, got {:?}", other),
            }
        }

        /// The collection was moved or deleted; re-registering is the point.
        #[test]
        fn a_stale_path_is_not_a_conflict() {
            let temp = TempDir::new().unwrap();
            v2_collection(temp.path());
            let index = index_of(&[("c1", Path::new("/nonexistent/gone"))]);

            assert_eq!(classify_open("c1", temp.path(), &index), Decision::Open);
        }

        /// A pull that changes the id in collection.yaml would otherwise leave
        /// two index entries pointing at one directory.
        #[test]
        fn the_same_path_under_another_id_conflicts() {
            let temp = TempDir::new().unwrap();
            v2_collection(temp.path());
            let index = index_of(&[("old_id", temp.path())]);

            match classify_open("new_id", temp.path(), &index) {
                Decision::Conflict {
                    same_path_different_id,
                    ..
                } => {
                    assert!(same_path_different_id);
                }
                other => panic!("expected a conflict, got {:?}", other),
            }
        }

        #[test]
        fn an_unrelated_entry_does_not_interfere() {
            let temp = TempDir::new().unwrap();
            let other = TempDir::new().unwrap();
            v2_collection(temp.path());
            let index = index_of(&[("other", other.path())]);

            assert_eq!(classify_open("c1", temp.path(), &index), Decision::Open);
        }
    }

    mod containment {
        use super::*;

        #[test]
        fn a_directory_contains_itself() {
            let temp = TempDir::new().unwrap();
            assert!(is_under(temp.path(), temp.path()));
        }

        #[test]
        fn a_child_is_under_its_parent() {
            let temp = TempDir::new().unwrap();
            let child = temp.path().join("collections/petstore");
            fs::create_dir_all(&child).unwrap();

            assert!(is_under(temp.path(), &child));
        }

        /// A shared name prefix must not read as containment.
        #[test]
        fn a_sibling_sharing_a_name_prefix_is_not_under() {
            let temp = TempDir::new().unwrap();
            let collections = temp.path().join("collections");
            let old = temp.path().join("collections-old");
            fs::create_dir_all(&collections).unwrap();
            fs::create_dir_all(&old).unwrap();

            assert!(!is_under(&collections, &old));
        }

        #[test]
        fn a_parent_is_not_under_its_child() {
            let temp = TempDir::new().unwrap();
            let child = temp.path().join("inner");
            fs::create_dir_all(&child).unwrap();

            assert!(!is_under(&child, temp.path()));
        }

        #[test]
        fn a_traversal_out_of_the_directory_is_not_under() {
            let temp = TempDir::new().unwrap();
            let collections = temp.path().join("collections");
            let escape = temp.path().join("collections/../elsewhere");
            fs::create_dir_all(&collections).unwrap();
            fs::create_dir_all(temp.path().join("elsewhere")).unwrap();

            assert!(!is_under(&collections, &escape));
        }

        #[test]
        fn a_traversal_back_into_the_directory_is_under() {
            let temp = TempDir::new().unwrap();
            let collections = temp.path().join("collections");
            fs::create_dir_all(collections.join("petstore")).unwrap();

            let roundabout = temp.path().join("collections/petstore/../petstore");
            assert!(is_under(&collections, &roundabout));
        }
    }

    mod placement_rules {
        use super::*;

        /// The B1 regression: a checkout at `acme-api-tests` holding a
        /// collection named "ACME API" must not be renamed to `acme-api`.
        #[test]
        fn a_linked_collection_keeps_the_directory_it_is_in() {
            let dir = Path::new("/home/someone/work/acme-api-tests");

            assert_eq!(
                placement(true, Some(dir)),
                Placement::InPlace(dir.to_path_buf())
            );
        }

        #[test]
        fn an_app_owned_collection_is_managed() {
            let dir = Path::new("/app/collections/acme-api");

            assert_eq!(placement(false, Some(dir)), Placement::Managed);
        }

        #[test]
        fn a_collection_with_no_directory_yet_is_managed() {
            assert_eq!(placement(true, None), Placement::Managed);
            assert_eq!(placement(false, None), Placement::Managed);
        }
    }

    mod linkage {
        use super::*;

        #[test]
        fn a_matching_entry_is_linked() {
            let index = index_of(&[("c1", Path::new("/work/api"))]);
            let linked = index_of(&[("c1", Path::new("/work/api"))]);

            assert!(is_linked("c1", &index, &linked));
        }

        #[test]
        fn an_unrecorded_collection_is_not_linked() {
            let index = index_of(&[("c1", Path::new("/work/api"))]);

            assert!(!is_linked("c1", &index, &HashMap::new()));
        }

        /// The registered path drifted back under app ownership, so the stale
        /// linked entry must stop suppressing Delete.
        #[test]
        fn a_drifted_path_is_no_longer_linked() {
            let index = index_of(&[("c1", Path::new("/app/collections/api"))]);
            let linked = index_of(&[("c1", Path::new("/work/api"))]);

            assert!(!is_linked("c1", &index, &linked));
        }

        #[test]
        fn a_trailing_separator_does_not_break_the_match() {
            let index = index_of(&[("c1", Path::new("/work/api/"))]);
            let linked = index_of(&[("c1", Path::new("/work/api"))]);

            assert!(is_linked("c1", &index, &linked));
        }
    }
}
