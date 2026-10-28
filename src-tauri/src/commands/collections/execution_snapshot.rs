//! Desktop adapter for the runner's compact, run-local collection capture.
use super::*;
use resonance_collections::snapshot::{self, CollectionSnapshot, TargetRef};

#[tauri::command]
pub async fn collections_capture_execution_snapshot(
    app: AppHandle,
    targets: Vec<TargetRef>,
) -> Result<Vec<CollectionSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scripts = super::super::scripts::read_legacy_store_scripts(&app);
        snapshot::capture_collections(&targets, |id, endpoints| {
            let capture = || -> Result<CollectionSnapshot, String> {
                let paths = CollectionPaths::resolve(&app, id)?;
                match Layout::detect(&paths.dir) {
                    Some(Layout::V2) => {
                        let loaded = read_collection_dir_cached(collection_cache(), &paths.dir)?;
                        Ok(snapshot::from_loaded(id, &loaded, endpoints, &scripts))
                    }
                    Some(Layout::V1) => snapshot::read_v1(id, &paths.dir, endpoints, &scripts),
                    None => Err(format!("Collection {id} not found")),
                }
            };
            // Match the repositories' existing read failures: a missing or
            // unreadable collection becomes a per-visit missingCollection error.
            capture().unwrap_or_else(|_| CollectionSnapshot::missing(id, endpoints))
        })
    })
    .await
    .map_err(|error| format!("Collection capture failed: {error}"))
}
