//! Opening a collection directory for a headless caller: read once, never
//! write, and turn every failure into a message a CLI can print as-is.

use std::path::{Path, PathBuf};

use crate::read::{Layout, LoadedCollection, read_collection_dir};

#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error("{0} is not a collection directory (no collection.yaml)")]
    NotACollection(PathBuf),
    #[error("{0} uses the legacy collection.json layout; open it in Resonance once to convert it")]
    LegacyLayout(PathBuf),
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

/// Reads a v2 collection directory.
///
/// A v1 directory is refused rather than converted: conversion rewrites the
/// user's files, which is the desktop's job, not a CI run's.
///
/// @param dir - The collection directory
/// @returns The collection in memory
pub fn load_collection(dir: &Path) -> Result<LoadedCollection, LoadError> {
    match Layout::detect(dir) {
        Some(Layout::V2) => read_collection_dir(dir).map_err(LoadError::Read),
        Some(Layout::V1) => Err(LoadError::LegacyLayout(dir.to_path_buf())),
        None => Err(LoadError::NotACollection(dir.to_path_buf())),
    }
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
    fn load_collection_refuses_v1_with_conversion_hint() {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join("collection.json"),
            r#"{"id":"c1","name":"P"}"#,
        )
        .unwrap();

        let error = load_collection(temp.path()).unwrap_err();
        assert!(matches!(error, LoadError::LegacyLayout(_)));
        assert!(error.to_string().contains("open it in Resonance"));
    }

    #[test]
    fn load_collection_rejects_non_collection_dir() {
        let temp = TempDir::new().unwrap();
        let error = load_collection(temp.path()).unwrap_err();
        assert!(matches!(error, LoadError::NotACollection(_)));
        assert!(error.to_string().contains("collection.yaml"));
    }
}
