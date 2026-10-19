//! Best-effort filesystem permission hardening for app-owned data.
//!
//! On Unix, restricts sensitive files to `0600` and app-owned directories to
//! `0700` so other local users cannot read stored credentials/cookies or tamper
//! with collection files. No-ops on non-Unix targets, where per-user profile
//! directories are already access-controlled by the OS. All functions are
//! best-effort: a failed permission change never fails the write it follows.

use std::path::Path;

/// Restricts a file to owner read/write only (`0600`) on Unix.
#[cfg(unix)]
pub fn restrict_file(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

/// Restricts a directory to owner access only (`0700`) on Unix.
#[cfg(unix)]
pub fn restrict_dir(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
}

/// No-op on non-Unix targets.
#[cfg(not(unix))]
pub fn restrict_file(_path: &Path) {}

/// No-op on non-Unix targets.
#[cfg(not(unix))]
pub fn restrict_dir(_path: &Path) {}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use uuid::Uuid;

    fn mode(path: &Path) -> u32 {
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn restrict_file_sets_owner_only() {
        let path =
            std::env::temp_dir().join(format!("resonance-fs-secure-{}.json", Uuid::new_v4()));
        std::fs::write(&path, b"{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        restrict_file(&path);

        assert_eq!(mode(&path), 0o600);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn restrict_dir_sets_owner_only() {
        let path = std::env::temp_dir().join(format!("resonance-fs-secure-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();

        restrict_dir(&path);

        assert_eq!(mode(&path), 0o700);
        let _ = std::fs::remove_dir_all(&path);
    }

    #[test]
    fn restrict_file_on_missing_path_is_noop() {
        let path =
            std::env::temp_dir().join(format!("resonance-fs-secure-missing-{}", Uuid::new_v4()));
        restrict_file(&path);
        assert!(!path.exists());
    }
}
