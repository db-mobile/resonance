//! Opening a collection directory for a headless caller: read once, never
//! write, and turn every failure into a message a CLI can print as-is.

use std::path::{Path, PathBuf};

use crate::read::{LoadedCollection, is_collection_dir, read_collection_dir};

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("{0} is not a collection directory (no collection.yaml)")]
    NotACollection(PathBuf),
    #[error("{0}")]
    Read(String),
    #[error("no request matches {selector}")]
    RequestNotFound { selector: String },
    #[error("{selector} is ambiguous; candidates:\n{}", candidates.join("\n"))]
    AmbiguousRequest {
        selector: String,
        candidates: Vec<String>,
    },
    #[error("folder {0} not found in the collection")]
    FolderNotFound(String),
    #[error("runner {0} not found")]
    RunnerNotFound(String),
    #[error("data file {path}: {reason}")]
    DataFile { path: String, reason: String },
    #[error("environment file: {0}")]
    Environment(String),
}

/// Reads a collection directory.
///
/// @param dir - The collection directory
/// @returns The collection in memory
pub fn load_collection(dir: &Path) -> Result<LoadedCollection, LoadError> {
    if !is_collection_dir(dir) {
        return Err(LoadError::NotACollection(dir.to_path_buf()));
    }
    read_collection_dir(dir).map_err(LoadError::Read)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn load_collection_reads_v2() {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join("collection.yaml"),
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        )
        .unwrap();
        fs::write(
            temp.path().join("health.yaml"),
            "resonanceFormat: 2\nid: r1\nname: Health\nmethod: GET\npath: /health\n",
        )
        .unwrap();

        let loaded = load_collection(temp.path()).unwrap();
        assert_eq!(loaded.meta.id, "c1");
        assert_eq!(loaded.requests().len(), 1);
    }

    #[test]
    fn load_collection_rejects_a_dir_holding_only_a_collection_json() {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join("collection.json"),
            r#"{"id":"c1","name":"P"}"#,
        )
        .unwrap();

        let error = load_collection(temp.path()).unwrap_err();
        assert!(matches!(error, LoadError::NotACollection(_)));
    }

    #[test]
    fn load_collection_rejects_non_collection_dir() {
        let temp = TempDir::new().unwrap();
        let error = load_collection(temp.path()).unwrap_err();
        assert!(matches!(error, LoadError::NotACollection(_)));
        assert!(error.to_string().contains("collection.yaml"));
    }
}
