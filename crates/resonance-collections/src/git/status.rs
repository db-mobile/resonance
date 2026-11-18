//! Working tree against index: which files under a collection directory
//! differ from what Git has recorded.
//!
//! A tracked file is compared by size first and by blob id second, so a file
//! of the same length is hashed the way Git would hash it. Every file is
//! hashed on every scan; collections are small and the scan only runs on
//! focus or after a save, so a stat shortcut is a later optimisation. Entries
//! Git itself does not compare are left alone: skip-worktree, assume-unchanged,
//! and submodules, whose directories are not walked either. Untracked
//! files count only when they are YAML, which keeps ignored build output and
//! editor leftovers from being reported without a `.gitignore` parser.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use sha1::{Digest, Sha1};

use super::find_worktree;
use super::index::{IndexEntry, read_index};
use crate::ipc::folder_id;
use crate::read::{FolderNode, LoadedCollection};

/// How a file differs from the index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
}

/// Changed paths under one directory, relative to it with forward slashes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DirStatus {
    pub changes: BTreeMap<String, ChangeKind>,
}

/// Parsed indexes keyed by Git directory, so several collections in one
/// checkout share a single parse.
#[derive(Default)]
pub struct StatusScanner {
    indexes: HashMap<PathBuf, Option<Vec<IndexEntry>>>,
}

impl StatusScanner {
    /// Compares a directory with the index of the working tree it sits in.
    ///
    /// @param dir - Collection directory
    /// @returns Its status, or None outside a working tree or when the index is unreadable
    pub fn status_for_dir(&mut self, dir: &Path) -> Option<DirStatus> {
        let worktree = find_worktree(dir)?;
        let prefix = relative_prefix(&worktree.root, dir)?;
        let entries = self
            .indexes
            .entry(worktree.git_dir.clone())
            .or_insert_with(|| read_index(&worktree.git_dir))
            .as_deref()?;
        Some(compare(dir, &prefix, entries))
    }

    #[cfg(test)]
    pub(crate) fn parsed_indexes(&self) -> usize {
        self.indexes.len()
    }
}

/// One-shot form of `StatusScanner::status_for_dir`.
///
/// @param dir - Collection directory
/// @returns Its status, or None outside a working tree or when the index is unreadable
pub fn status_for_dir(dir: &Path) -> Option<DirStatus> {
    StatusScanner::default().status_for_dir(dir)
}

/// Hashes file contents the way Git names a blob.
///
/// @param bytes - File contents
/// @returns The object id Git would give the file
pub fn blob_oid(bytes: &[u8]) -> [u8; 20] {
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
    hasher.update(bytes);
    hasher.finalize().into()
}

/// Uncommitted changes of one collection, shaped for the sidebar.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionGitStatus {
    /// Every changed file under the directory, request or not.
    pub changes: usize,
    /// Request id to change, for the files that are requests and still exist.
    pub requests: HashMap<String, ChangeKind>,
    /// Folder id to the number of changes anywhere below that folder.
    pub folders: HashMap<String, usize>,
}

/// Maps changed files onto request ids and rolls them up to folder ids.
///
/// @param dir - The collection directory the status was taken for
/// @param loaded - The collection read from that directory
/// @param status - Changes under the directory
/// @returns Per-request kinds, per-folder counts, every change counted
pub fn collection_git_status(
    dir: &Path,
    loaded: &LoadedCollection,
    status: &DirStatus,
) -> CollectionGitStatus {
    let ids: HashMap<&Path, &str> = loaded
        .requests()
        .into_iter()
        .filter_map(|entry| Some((entry.source.as_deref()?, entry.doc.id.as_str())))
        .collect();

    let requests = status
        .changes
        .iter()
        .filter(|(_, kind)| **kind != ChangeKind::Deleted)
        .filter_map(|(rel, kind)| {
            let id = ids.get(dir.join(rel).as_path())?;
            Some((id.to_string(), *kind))
        })
        .collect();

    let mut folder_dirs = Vec::new();
    for folder in &loaded.root.folders {
        collect_folders(folder, &mut folder_dirs);
    }
    let mut folders: HashMap<String, usize> = HashMap::new();
    for rel in status.changes.keys() {
        let changed = dir.join(rel);
        for (folder_dir, id) in &folder_dirs {
            if changed.starts_with(folder_dir) {
                *folders.entry(id.clone()).or_default() += 1;
            }
        }
    }

    CollectionGitStatus {
        changes: status.changes.len(),
        requests,
        folders,
    }
}

/// Collects every folder below a node, with the id the sidebar knows it by.
///
/// @param node - A folder node
/// @param out - Receives the folder directory and id of the node and its descendants
fn collect_folders<'a>(node: &'a FolderNode, out: &mut Vec<(&'a Path, String)>) {
    if let Some(source) = node.source.as_deref() {
        out.push((source, folder_id(node)));
    }
    for folder in &node.folders {
        collect_folders(folder, out);
    }
}

/// Builds the index path prefix of a directory inside a working tree.
///
/// @param root - The working tree root
/// @param dir - A directory at or below the root
/// @returns The prefix with a trailing slash, or empty for the root itself
fn relative_prefix(root: &Path, dir: &Path) -> Option<String> {
    let relative = dir.strip_prefix(root).ok()?;
    let mut prefix = join_components(relative)?;
    if !prefix.is_empty() {
        prefix.push('/');
    }
    Some(prefix)
}

/// Joins the normal components of a relative path with forward slashes.
///
/// @param path - A relative path
/// @returns The joined path, or None when a component is not UTF-8 or not a plain name
fn join_components(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(parts.join("/"))
}

/// Compares every tracked and untracked YAML path under a directory.
///
/// @param dir - The directory to compare
/// @param prefix - Its index path prefix
/// @param entries - The whole index
/// @returns The changes found
fn compare(dir: &Path, prefix: &str, entries: &[IndexEntry]) -> DirStatus {
    let mut changes = BTreeMap::new();
    let mut tracked = HashSet::new();
    let mut gitlinks = HashSet::new();

    for entry in entries.iter().filter(|e| e.path.starts_with(prefix)) {
        let rel = &entry.path[prefix.len()..];
        tracked.insert(rel.to_string());
        if entry.is_gitlink() {
            gitlinks.insert(dir.join(rel));
            continue;
        }
        if entry.skip_worktree || entry.assume_valid {
            continue;
        }
        if let Some(kind) = tracked_change(&dir.join(rel), entry) {
            changes.insert(rel.to_string(), kind);
        }
    }

    let mut present = Vec::new();
    collect_yaml(dir, dir, &gitlinks, &mut present);
    for rel in present {
        if !tracked.contains(&rel) {
            changes.insert(rel, ChangeKind::Added);
        }
    }

    DirStatus { changes }
}

/// Decides whether one tracked file differs from its index entry. A symbolic
/// link is compared by its target path, never by what it points at.
///
/// @param path - The file in the working tree
/// @param entry - Its index entry
/// @returns The change, or None when the file matches or cannot be judged
fn tracked_change(path: &Path, entry: &IndexEntry) -> Option<ChangeKind> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Some(ChangeKind::Deleted),
        Err(_) => return None,
    };
    if entry.intent_to_add {
        return Some(ChangeKind::Added);
    }
    if entry.stage > 0 {
        return Some(ChangeKind::Modified);
    }
    if meta.is_symlink() {
        if !entry.is_symlink() {
            return Some(ChangeKind::Modified);
        }
        let target = link_target_bytes(path)?;
        return (blob_oid(&target) != entry.oid).then_some(ChangeKind::Modified);
    }
    if meta.len() != u64::from(entry.size) {
        return Some(ChangeKind::Modified);
    }
    let bytes = fs::read(path).ok()?;
    (blob_oid(&bytes) != entry.oid).then_some(ChangeKind::Modified)
}

/// Reads the bytes Git stores as the blob of a symbolic link: its target path.
///
/// @param path - The link in the working tree
/// @returns The target as raw bytes, or None when it cannot be read
#[cfg(unix)]
fn link_target_bytes(path: &Path) -> Option<Vec<u8>> {
    use std::os::unix::ffi::OsStrExt;
    Some(fs::read_link(path).ok()?.as_os_str().as_bytes().to_vec())
}

/// Off Unix the stored target bytes cannot be rebuilt reliably, so a link is not judged.
///
/// @param _path - The link in the working tree
/// @returns Always None
#[cfg(not(unix))]
fn link_target_bytes(_path: &Path) -> Option<Vec<u8>> {
    None
}

/// Collects the YAML files under a directory, as paths relative to `root`.
///
/// @param root - The directory the paths are made relative to
/// @param dir - The directory being walked
/// @param gitlinks - Submodule directories, which are not entered
/// @param out - Receives the relative paths
fn collect_yaml(root: &Path, dir: &Path, gitlinks: &HashSet<PathBuf>, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if !gitlinks.contains(&path) {
                collect_yaml(root, &path, gitlinks, out);
            }
            continue;
        }
        if !is_yaml(&path) {
            continue;
        }
        if let Some(rel) = path.strip_prefix(root).ok().and_then(join_components) {
            out.push(rel);
        }
    }
}

/// @param path - A file path
/// @returns Whether it carries a YAML extension
fn is_yaml(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml")
    )
}

#[cfg(test)]
mod tests {
    use super::super::index::encode::{self, Spec, index, plain, raw};
    use super::*;
    use crate::read::read_collection_dir;
    use tempfile::TempDir;

    fn write(path: &Path, contents: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn repo(temp: &TempDir) -> (PathBuf, PathBuf) {
        let root = temp.path().join("repo");
        let git_dir = root.join(".git");
        write(&git_dir.join("HEAD"), b"ref: refs/heads/main\n");
        (root, git_dir)
    }

    fn tracked<'a>(path: &'a str, contents: &[u8]) -> Spec<'a> {
        plain(path, blob_oid(contents), contents.len() as u32)
    }

    fn write_index(git_dir: &Path, specs: &[Spec<'_>]) {
        let version = if specs.iter().any(|spec| spec.extended != 0) {
            3
        } else {
            2
        };
        write(&git_dir.join("index"), &index(version, specs));
    }

    fn link_entry<'a>(path: &'a str, target: &str) -> Spec<'a> {
        tracked(path, target.as_bytes()).with_mode(encode::MODE_SYMLINK)
    }

    fn changes(status: DirStatus) -> Vec<(String, ChangeKind)> {
        status.changes.into_iter().collect()
    }

    #[test]
    fn blob_oid_matches_git() {
        let hex: String = blob_oid(b"hello\n")
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect();

        assert_eq!(hex, "ce013625030ba8dba906f756967f9e9ca394464a");
    }

    #[test]
    fn a_file_matching_the_index_is_clean() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: A\n");
        write_index(&git_dir, &[tracked("a.yaml", b"name: A\n")]);

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[test]
    fn a_file_with_different_content_but_equal_size_is_modified() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: B\n");
        write_index(&git_dir, &[tracked("a.yaml", b"name: A\n")]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_file_with_a_different_size_is_modified() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: Longer\n");
        write_index(&git_dir, &[tracked("a.yaml", b"name: A\n")]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_tracked_file_that_is_gone_is_deleted() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write_index(&git_dir, &[tracked("gone.json", b"{}")]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("gone.json".to_string(), ChangeKind::Deleted)]
        );
    }

    #[test]
    fn an_untracked_yaml_file_is_added() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("new.yaml"), b"name: New\n");
        write(&root.join("sub").join("deep.yml"), b"name: Deep\n");
        write_index(&git_dir, &[]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![
                ("new.yaml".to_string(), ChangeKind::Added),
                ("sub/deep.yml".to_string(), ChangeKind::Added),
            ]
        );
    }

    #[test]
    fn an_untracked_non_yaml_file_is_ignored() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("response.json"), b"{}");
        write_index(&git_dir, &[]);

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[test]
    fn dot_entries_and_symlinks_are_not_reported_as_added() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join(".hidden.yaml"), b"x: 1\n");
        write(&root.join(".dir").join("a.yaml"), b"x: 1\n");
        write(&temp.path().join("outside.yaml"), b"x: 1\n");
        #[cfg(unix)]
        std::os::unix::fs::symlink(temp.path().join("outside.yaml"), root.join("link.yaml"))
            .unwrap();
        write_index(&git_dir, &[]);

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[test]
    fn only_entries_under_the_collection_prefix_are_considered() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let dir = root.join("collections").join("payments");
        write(&dir.join("pay.yaml"), b"name: Pay\n");
        write(
            &root.join("collections").join("payments-old").join("x.yaml"),
            b"x\n",
        );
        write_index(
            &git_dir,
            &[
                tracked("README.md", b"other"),
                tracked("collections/payments/pay.yaml", b"name: Old\n"),
                tracked("collections/payments-old/x.yaml", b"y\n"),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&dir).unwrap()),
            vec![("pay.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_conflicted_entry_is_modified() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: A\n");
        let mut spec = tracked("a.yaml", b"name: A\n");
        spec.flags |= 2 << 12;
        write_index(&git_dir, &[spec]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_tracked_symlink_with_its_recorded_target_is_clean() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("real.yaml"), b"name: A much longer body\n");
        std::os::unix::fs::symlink("real.yaml", root.join("link.yaml")).unwrap();
        std::os::unix::fs::symlink("missing.yaml", root.join("dangling.yaml")).unwrap();
        write_index(
            &git_dir,
            &[
                link_entry("dangling.yaml", "missing.yaml"),
                link_entry("link.yaml", "real.yaml"),
                tracked("real.yaml", b"name: A much longer body\n"),
            ],
        );

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[cfg(unix)]
    #[test]
    fn a_tracked_symlink_pointing_elsewhere_is_modified() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: A\n");
        write(&root.join("b.yaml"), b"name: A\n");
        std::os::unix::fs::symlink("b.yaml", root.join("link.yaml")).unwrap();
        write_index(
            &git_dir,
            &[
                tracked("a.yaml", b"name: A\n"),
                tracked("b.yaml", b"name: A\n"),
                link_entry("link.yaml", "a.yaml"),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("link.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_tracked_file_replaced_by_a_symlink_is_modified() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("real.yaml"), b"name: A\n");
        std::os::unix::fs::symlink("real.yaml", root.join("a.yaml")).unwrap();
        write_index(
            &git_dir,
            &[
                tracked("a.yaml", b"name: A\n"),
                tracked("real.yaml", b"name: A\n"),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_symlink_entry_checked_out_as_a_plain_file_is_compared_by_content() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("same.yaml"), b"real.yaml");
        write(&root.join("edited.yaml"), b"else.yaml");
        write_index(
            &git_dir,
            &[
                link_entry("edited.yaml", "real.yaml"),
                link_entry("same.yaml", "real.yaml"),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("edited.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn skip_worktree_entries_are_clean_whether_absent_or_different() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("local.yaml"), b"name: Local override\n");
        write_index(
            &git_dir,
            &[
                tracked("local.yaml", b"name: A\n").with_extended(encode::SKIP_WORKTREE),
                tracked("sparse.yaml", b"name: S\n").with_extended(encode::SKIP_WORKTREE),
            ],
        );

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[test]
    fn an_assume_valid_entry_is_clean_when_the_file_differs() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: Changed\n");
        let mut spec = tracked("a.yaml", b"name: A\n");
        spec.flags |= encode::ASSUME_VALID;
        write_index(&git_dir, &[spec]);

        assert_eq!(changes(status_for_dir(&root).unwrap()), vec![]);
    }

    #[test]
    fn an_intent_to_add_entry_is_added() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("new.yaml"), b"name: New\n");
        write_index(
            &git_dir,
            &[tracked("new.yaml", b"").with_extended(encode::INTENT_TO_ADD)],
        );

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("new.yaml".to_string(), ChangeKind::Added)]
        );
    }

    #[test]
    fn a_submodule_is_not_reported_and_its_files_are_not_added() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let dir = root.join("api");
        write(&dir.join("a.yaml"), b"name: A\n");
        write(&dir.join("vendor").join("inner.yaml"), b"name: Inner\n");
        write(
            &dir.join("vendor").join("deep").join("x.yaml"),
            b"name: X\n",
        );
        write(&dir.join("vendored").join("mine.yaml"), b"name: Mine\n");
        write_index(
            &git_dir,
            &[
                tracked("api/a.yaml", b"name: A\n"),
                plain("api/absent", [7; 20], 0).with_mode(encode::MODE_GITLINK),
                plain("api/vendor", [7; 20], 0).with_mode(encode::MODE_GITLINK),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&dir).unwrap()),
            vec![("vendored/mine.yaml".to_string(), ChangeKind::Added)]
        );
    }

    #[test]
    fn a_non_utf8_index_path_does_not_hide_other_changes() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: B\n");
        write_index(
            &git_dir,
            &[
                tracked("a.yaml", b"name: A\n"),
                raw(b"caf\xe9.yaml", [1; 20], 3),
            ],
        );

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn a_fresh_repository_without_an_index_reports_every_yaml_as_added() {
        let temp = TempDir::new().unwrap();
        let (root, _git_dir) = repo(&temp);
        write(&root.join("a.yaml"), b"name: A\n");

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Added)]
        );
    }

    #[test]
    fn a_corrupt_index_yields_no_status() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        write(&git_dir.join("index"), b"garbage");

        assert_eq!(status_for_dir(&root), None);
    }

    #[test]
    fn a_linked_worktree_reads_its_own_index() {
        let temp = TempDir::new().unwrap();
        let git_dir = temp
            .path()
            .join("main")
            .join(".git")
            .join("worktrees")
            .join("feature");
        write(&git_dir.join("HEAD"), b"ref: refs/heads/feature\n");
        let root = temp.path().join("checkout");
        write(
            &root.join(".git"),
            format!("gitdir: {}\n", git_dir.display()).as_bytes(),
        );
        write(&root.join("a.yaml"), b"name: B\n");
        write_index(&git_dir, &[tracked("a.yaml", b"name: A\n")]);

        assert_eq!(
            changes(status_for_dir(&root).unwrap()),
            vec![("a.yaml".to_string(), ChangeKind::Modified)]
        );
    }

    #[test]
    fn outside_a_working_tree_there_is_no_status() {
        let temp = TempDir::new().unwrap();
        let plain_dir = temp.path().join("plain");
        write(&plain_dir.join("a.yaml"), b"name: A\n");

        assert_eq!(status_for_dir(&plain_dir), None);
    }

    #[test]
    fn a_scanner_parses_one_index_for_two_collections() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let first = root.join("first");
        let second = root.join("second");
        write(&first.join("a.yaml"), b"name: A\n");
        write(&second.join("b.yaml"), b"name: B\n");
        write_index(
            &git_dir,
            &[
                tracked("first/a.yaml", b"name: A\n"),
                tracked("second/b.yaml", b"name: X\n"),
            ],
        );

        let mut scanner = StatusScanner::default();
        let first_status = scanner.status_for_dir(&first).unwrap();
        let second_status = scanner.status_for_dir(&second).unwrap();

        assert_eq!(changes(first_status), vec![]);
        assert_eq!(
            changes(second_status),
            vec![("b.yaml".to_string(), ChangeKind::Modified)]
        );
        assert_eq!(scanner.parsed_indexes(), 1);
    }

    #[test]
    fn collection_git_status_maps_request_files_to_ids_and_counts_the_rest() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let dir = root.join("api");
        write(
            &dir.join("collection.yaml"),
            b"resonanceFormat: 2\nid: c1\nname: API\n",
        );
        write(
            &dir.join("health.yaml"),
            b"resonanceFormat: 2\nid: r1\nname: Health\n",
        );
        write(
            &dir.join("pets").join("list.yaml"),
            b"resonanceFormat: 2\nid: r2\nname: List\n",
        );
        write_index(
            &git_dir,
            &[
                tracked(
                    "api/collection.yaml",
                    b"resonanceFormat: 2\nid: c1\nname: Old\n",
                ),
                tracked(
                    "api/health.yaml",
                    b"resonanceFormat: 2\nid: r1\nname: Old\n",
                ),
                tracked("api/gone.yaml", b"resonanceFormat: 2\nid: r9\nname: Gone\n"),
            ],
        );
        let loaded = read_collection_dir(&dir).unwrap();
        let status = status_for_dir(&dir).unwrap();

        let result = collection_git_status(&dir, &loaded, &status);

        assert_eq!(result.changes, 4);
        assert_eq!(
            result.requests,
            HashMap::from([
                ("r1".to_string(), ChangeKind::Modified),
                ("r2".to_string(), ChangeKind::Added),
            ])
        );
    }

    #[test]
    fn collection_git_status_rolls_changes_up_to_folders() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let dir = root.join("api");
        write(
            &dir.join("collection.yaml"),
            b"resonanceFormat: 2\nid: c1\nname: API\n",
        );
        write(
            &dir.join("health.yaml"),
            b"resonanceFormat: 2\nid: r1\nname: Health\n",
        );
        write(
            &dir.join("pets").join("_folder.yaml"),
            b"resonanceFormat: 2\nid: f_pets\nname: Pets\n",
        );
        write(
            &dir.join("pets").join("list.yaml"),
            b"resonanceFormat: 2\nid: r2\nname: List\n",
        );
        write(
            &dir.join("pets").join("admin").join("x.yaml"),
            b"resonanceFormat: 2\nid: r3\nname: X\n",
        );
        write_index(
            &git_dir,
            &[
                tracked(
                    "api/collection.yaml",
                    b"resonanceFormat: 2\nid: c1\nname: API\n",
                ),
                tracked(
                    "api/health.yaml",
                    b"resonanceFormat: 2\nid: r1\nname: Old\n",
                ),
                tracked(
                    "api/pets/_folder.yaml",
                    b"resonanceFormat: 2\nid: f_pets\nname: Pets\n",
                ),
                tracked(
                    "api/pets/list.yaml",
                    b"resonanceFormat: 2\nid: r2\nname: Old\n",
                ),
                tracked(
                    "api/pets/gone.yaml",
                    b"resonanceFormat: 2\nid: r9\nname: Gone\n",
                ),
            ],
        );
        let loaded = read_collection_dir(&dir).unwrap();
        let status = status_for_dir(&dir).unwrap();

        let result = collection_git_status(&dir, &loaded, &status);

        assert_eq!(result.changes, 4);
        assert_eq!(
            result.folders,
            HashMap::from([("f_pets".to_string(), 3), ("folder_admin".to_string(), 1)])
        );
    }

    #[test]
    fn a_deleted_file_in_a_missing_directory_counts_only_at_collection_level() {
        let temp = TempDir::new().unwrap();
        let (root, git_dir) = repo(&temp);
        let dir = root.join("api");
        write(
            &dir.join("collection.yaml"),
            b"resonanceFormat: 2\nid: c1\nname: API\n",
        );
        write_index(
            &git_dir,
            &[
                tracked(
                    "api/collection.yaml",
                    b"resonanceFormat: 2\nid: c1\nname: API\n",
                ),
                tracked(
                    "api/old/x.yaml",
                    b"resonanceFormat: 2\nid: r9\nname: Gone\n",
                ),
            ],
        );
        let loaded = read_collection_dir(&dir).unwrap();
        let status = status_for_dir(&dir).unwrap();

        let result = collection_git_status(&dir, &loaded, &status);

        assert_eq!(result.changes, 1);
        assert_eq!(result.folders, HashMap::new());
    }

    #[test]
    fn collection_git_status_serializes_for_the_sidebar() {
        let status = CollectionGitStatus {
            changes: 2,
            requests: HashMap::from([("r1".to_string(), ChangeKind::Added)]),
            folders: HashMap::from([("f1".to_string(), 2)]),
        };

        let json = serde_json::to_value(&status).unwrap();

        assert_eq!(
            json,
            serde_json::json!({ "changes": 2, "requests": { "r1": "added" }, "folders": { "f1": 2 } })
        );
    }
}
