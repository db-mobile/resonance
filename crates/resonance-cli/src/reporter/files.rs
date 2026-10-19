//! JUnit and JSON report files, written after the run.
use resonance_core::report::{summarize, to_json, to_junit};
use resonance_core::results::RunResult;
use std::path::{Path, PathBuf};

use crate::error::CliError;

/// Writes the requested reports and returns what was written.
pub fn write_reports(
    result: &RunResult,
    junit: Option<&Path>,
    json: Option<&Path>,
) -> Result<Vec<(&'static str, PathBuf)>, CliError> {
    let summary = summarize(result);
    let mut written = Vec::new();
    for (kind, path, content) in [
        ("junit", junit, to_junit(&summary)),
        ("json", json, to_json(&summary)),
    ] {
        let Some(path) = path else { continue };
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent).map_err(|source| CliError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        std::fs::write(path, content).map_err(|source| CliError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        written.push((kind, path.to_path_buf()));
    }
    Ok(written)
}
