//! Current Git branch and uncommitted changes of the working tree a
//! collection lives in.
//!
//! Collections opened in place usually sit in a checkout, so the sidebar shows
//! which branch each one is on and which files differ from the index. All of
//! that comes from reading `.git` files directly, which is why there is no Git
//! library here: `git2` would pull in libgit2 and `openssl-sys`, and this app
//! is deliberately rustls-only. Reading the files directly also cannot be
//! talked into running hooks or config-declared filters from a repository the
//! user has only just opened.
//!
//! Staying out of the object database keeps three limits, all accepted:
//! only the working tree is compared with the index, so a file that is staged
//! but not committed reads as clean; `.gitignore` is not consulted, so only
//! untracked YAML files count as added; and line endings are compared as
//! stored, so a CRLF checkout of LF blobs over-reports. Blob ids are SHA-1,
//! which the tree already carries for request scripting.
//!
//! Everything is pure over the filesystem so it can be tested without an
//! `AppHandle`, matching how `link.rs` is written. Every failure resolves to
//! `None`: this is decoration, and it must never break opening a collection.

pub mod index;
pub mod status;

pub use status::{
    ChangeKind, CollectionGitStatus, DirStatus, StatusScanner, collection_git_status,
    status_for_dir,
};

use std::fs;
use std::path::{Path, PathBuf};

/// Length of the abbreviated object id shown for a detached HEAD.
const SHORT_ID_LEN: usize = 7;

/// A working tree and the Git directory that governs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worktree {
    /// The directory holding `HEAD` and `index`.
    pub git_dir: PathBuf,
    /// The directory the index paths are relative to.
    pub root: PathBuf,
}

/// Locates the working tree containing a path.
///
/// Walks up from `start` until a `.git` entry turns up. A `.git` file rather
/// than a directory means a linked worktree or a submodule, and points at the
/// real Git directory through a `gitdir:` line. Either way the directory the
/// entry was found in is the root the index describes.
///
/// @param start - Directory to start the search from
/// @returns The working tree, or None when the path is not in one
pub fn find_worktree(start: &Path) -> Option<Worktree> {
    let mut current = Some(start);

    while let Some(dir) = current {
        let candidate = dir.join(".git");
        if candidate.is_dir() {
            return Some(Worktree {
                git_dir: candidate,
                root: dir.to_path_buf(),
            });
        }
        if candidate.is_file() {
            return resolve_gitdir_file(&candidate, dir).map(|git_dir| Worktree {
                git_dir,
                root: dir.to_path_buf(),
            });
        }
        current = dir.parent();
    }

    None
}

/// Locates the Git directory governing a path.
///
/// @param start - Directory to start the search from
/// @returns The Git directory, or None when the path is not in a working tree
pub fn find_git_dir(start: &Path) -> Option<PathBuf> {
    find_worktree(start).map(|worktree| worktree.git_dir)
}

/// Reads the branch HEAD points at.
///
/// A detached HEAD has no branch, so its abbreviated object id stands in.
///
/// @param git_dir - The Git directory, as returned by `find_git_dir`
/// @returns The branch name or short object id, or None when HEAD is unreadable
pub fn read_head_branch(git_dir: &Path) -> Option<String> {
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let head = head.trim();

    if let Some(reference) = head.strip_prefix("ref:") {
        let reference = reference.trim();
        let branch = reference.strip_prefix("refs/heads/").unwrap_or(reference);
        return non_empty(branch);
    }

    let id: String = head.chars().take(SHORT_ID_LEN).collect();
    if id.len() == SHORT_ID_LEN && id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(id);
    }

    None
}

/// Current Git branch for a directory, when it lives in a working tree.
///
/// @param dir - Directory to inspect
/// @returns The branch name or short object id, or None when there is no repository
pub fn branch_for_dir(dir: &Path) -> Option<String> {
    find_git_dir(dir).as_deref().and_then(read_head_branch)
}

/// Follows the `gitdir:` pointer in a `.git` file.
///
/// The recorded path may be relative, in which case it resolves against the
/// directory holding the `.git` file rather than the process working directory.
///
/// @param file - The `.git` file
/// @param base - Directory containing that file
/// @returns The Git directory it points at, or None when the pointer is unusable
fn resolve_gitdir_file(file: &Path, base: &Path) -> Option<PathBuf> {
    let contents = fs::read_to_string(file).ok()?;
    let pointer = contents
        .lines()
        .find_map(|line| line.trim().strip_prefix("gitdir:"))?
        .trim();

    let target = PathBuf::from(non_empty(pointer)?);
    let target = if target.is_absolute() {
        target
    } else {
        base.join(target)
    };

    target.is_dir().then_some(target)
}

/// Returns the trimmed value, or None when nothing is left.
///
/// @param value - Candidate string
/// @returns The owned value when it holds something
fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn repo_with_head(temp: &TempDir, head: &str) -> PathBuf {
        let root = temp.path().join("repo");
        write(&root.join(".git").join("HEAD"), head);
        root
    }

    #[test]
    fn reads_the_checked_out_branch() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "ref: refs/heads/main\n");

        assert_eq!(branch_for_dir(&root), Some("main".to_string()));
    }

    #[test]
    fn keeps_slashes_in_a_branch_name() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "ref: refs/heads/feature/oauth-refresh\n");

        assert_eq!(
            branch_for_dir(&root),
            Some("feature/oauth-refresh".to_string())
        );
    }

    #[test]
    fn abbreviates_a_detached_head() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "9a30678f4b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e\n");

        assert_eq!(branch_for_dir(&root), Some("9a30678".to_string()));
    }

    #[test]
    fn finds_the_repository_from_a_nested_directory() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "ref: refs/heads/dev\n");
        let nested = root.join("collections").join("payments");
        fs::create_dir_all(&nested).unwrap();

        assert_eq!(branch_for_dir(&nested), Some("dev".to_string()));
    }

    #[test]
    fn reports_the_directory_holding_the_git_entry_as_the_root() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "ref: refs/heads/dev\n");
        let nested = root.join("collections").join("payments");
        fs::create_dir_all(&nested).unwrap();

        let worktree = find_worktree(&nested).unwrap();

        assert_eq!(worktree.root, root);
        assert_eq!(worktree.git_dir, root.join(".git"));
    }

    #[test]
    fn a_gitdir_pointer_keeps_the_checkout_as_the_root() {
        let temp = TempDir::new().unwrap();
        let git_dir = temp.path().join("worktrees").join("feature");
        write(&git_dir.join("HEAD"), "ref: refs/heads/feature\n");
        let root = temp.path().join("checkout");
        write(
            &root.join(".git"),
            &format!("gitdir: {}\n", git_dir.display()),
        );

        let worktree = find_worktree(&root).unwrap();

        assert_eq!(worktree.root, root);
        assert_eq!(worktree.git_dir, git_dir);
    }

    #[test]
    fn follows_an_absolute_gitdir_pointer() {
        let temp = TempDir::new().unwrap();
        let git_dir = temp.path().join("worktrees").join("feature");
        write(&git_dir.join("HEAD"), "ref: refs/heads/feature\n");

        let root = temp.path().join("checkout");
        write(
            &root.join(".git"),
            &format!("gitdir: {}\n", git_dir.display()),
        );

        assert_eq!(branch_for_dir(&root), Some("feature".to_string()));
    }

    #[test]
    fn follows_a_relative_gitdir_pointer() {
        let temp = TempDir::new().unwrap();
        write(
            &temp.path().join("modules").join("api").join("HEAD"),
            "ref: refs/heads/submodule-branch\n",
        );

        let root = temp.path().join("checkout");
        write(&root.join(".git"), "gitdir: ../modules/api\n");

        assert_eq!(branch_for_dir(&root), Some("submodule-branch".to_string()));
    }

    #[test]
    fn ignores_a_gitdir_pointer_that_leads_nowhere() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("checkout");
        write(&root.join(".git"), "gitdir: ../gone\n");

        assert_eq!(branch_for_dir(&root), None);
    }

    #[test]
    fn reports_nothing_outside_a_working_tree() {
        let temp = TempDir::new().unwrap();
        let plain = temp.path().join("plain");
        fs::create_dir_all(&plain).unwrap();

        assert_eq!(branch_for_dir(&plain), None);
    }

    #[test]
    fn reports_nothing_for_an_empty_head() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "\n");

        assert_eq!(branch_for_dir(&root), None);
    }

    #[test]
    fn reports_nothing_for_a_head_that_is_neither_ref_nor_object_id() {
        let temp = TempDir::new().unwrap();
        let root = repo_with_head(&temp, "not a head\n");

        assert_eq!(branch_for_dir(&root), None);
    }

    #[test]
    fn reports_nothing_when_head_is_missing() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("repo");
        fs::create_dir_all(root.join(".git")).unwrap();

        assert_eq!(branch_for_dir(&root), None);
    }
}
