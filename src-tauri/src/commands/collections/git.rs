//! Current Git branch of the working tree a collection lives in.
//!
//! Collections opened in place usually sit in a checkout, so the sidebar shows
//! which branch each one is on. Resolving that means reading two files, which
//! is why there is no Git library here: `git2` would pull in libgit2 and
//! `openssl-sys`, and this app is deliberately rustls-only. Reading the files
//! directly also cannot be talked into running hooks or config-declared
//! filters from a repository the user has only just opened.
//!
//! Everything is pure over the filesystem so it can be tested without an
//! `AppHandle`, matching how `link.rs` is written. Every failure resolves to
//! `None`: this is decoration, and it must never break opening a collection.

use std::fs;
use std::path::{Path, PathBuf};

/// Length of the abbreviated object id shown for a detached HEAD.
const SHORT_ID_LEN: usize = 7;

/// Locates the Git directory governing a path.
///
/// Walks up from `start` until a `.git` entry turns up. A `.git` file rather
/// than a directory means a linked worktree or a submodule, and points at the
/// real Git directory through a `gitdir:` line.
///
/// @param start - Directory to start the search from
/// @returns The Git directory, or None when the path is not in a working tree
pub(crate) fn find_git_dir(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);

    while let Some(dir) = current {
        let candidate = dir.join(".git");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if candidate.is_file() {
            return resolve_gitdir_file(&candidate, dir);
        }
        current = dir.parent();
    }

    None
}

/// Reads the branch HEAD points at.
///
/// A detached HEAD has no branch, so its abbreviated object id stands in.
///
/// @param git_dir - The Git directory, as returned by `find_git_dir`
/// @returns The branch name or short object id, or None when HEAD is unreadable
pub(crate) fn read_head_branch(git_dir: &Path) -> Option<String> {
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
pub(crate) fn branch_for_dir(dir: &Path) -> Option<String> {
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
