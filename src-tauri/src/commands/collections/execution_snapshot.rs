//! Desktop adapter for the runner's compact, run-local collection capture.
use super::*;
use resonance_collections::snapshot::{self, CollectionSnapshot, TargetRef};

#[tauri::command]
pub async fn collections_capture_execution_snapshot(
    app: AppHandle,
    targets: Vec<TargetRef>,
) -> Result<Vec<CollectionSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        snapshot::capture_collections(&targets, |id, endpoints| {
            let capture = || -> Result<CollectionSnapshot, String> {
                let paths = CollectionPaths::resolve(&app, id)?;
                let loaded = read_collection_dir_cached(collection_cache(), &paths.dir)?;
                Ok(snapshot::from_loaded(id, &loaded, endpoints))
            };
            capture().unwrap_or_else(|_| CollectionSnapshot::missing(id, endpoints))
        })
    })
    .await
    .map_err(|error| format!("Collection capture failed: {error}"))
}
