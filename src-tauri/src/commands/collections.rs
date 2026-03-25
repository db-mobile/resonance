use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

const COLLECTIONS_DIR: &str = "collections";

/// Collection metadata stored in collection.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub endpoints: Vec<Value>,
    #[serde(default)]
    pub folders: Vec<Value>,
    #[serde(default)]
    pub default_headers: Value,
    #[serde(rename = "_openApiSpec")]
    #[serde(default)]
    pub open_api_spec: Option<Value>,
}

/// Request data stored per-endpoint
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EndpointData {
    #[serde(default)]
    pub modified_body: Option<String>,
    #[serde(default)]
    pub path_params: Vec<Value>,
    #[serde(default)]
    pub query_params: Vec<Value>,
    #[serde(default)]
    pub headers: Vec<Value>,
    #[serde(default)]
    pub auth_config: Option<Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub scripts: Option<Value>,
    #[serde(default)]
    pub graphql_data: Option<Value>,
    #[serde(default)]
    pub grpc_data: Option<Value>,
    #[serde(default)]
    pub response_schema: Option<Value>,
}

/// Get the collections directory path
fn get_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join(COLLECTIONS_DIR))
}

/// Get the path to a specific collection's directory
fn get_collection_dir(app: &AppHandle, collection_id: &str) -> Result<PathBuf, String> {
    Ok(get_collections_dir(app)?.join(collection_id))
}

/// Ensure the collections directory exists
fn ensure_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_collections_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create collections dir: {}", e))?;
    }
    Ok(dir)
}

/// Write JSON to file with pretty printing and sorted keys for git-friendly diffs
fn write_json_file<T: Serialize>(path: &PathBuf, data: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Read JSON from file
fn read_json_file<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<T, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))
}

/// List all collection IDs
#[tauri::command]
pub async fn collections_list(app: AppHandle) -> Result<Vec<String>, String> {
    let collections_dir = get_collections_dir(&app)?;

    if !collections_dir.exists() {
        return Ok(vec![]);
    }

    let mut collection_ids = Vec::new();

    let entries = fs::read_dir(&collections_dir)
        .map_err(|e| format!("Failed to read collections dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            if let Some(name) = path.file_name() {
                if let Some(name_str) = name.to_str() {
                    // Check if collection.json exists
                    if path.join("collection.json").exists() {
                        collection_ids.push(name_str.to_string());
                    }
                }
            }
        }
    }

    Ok(collection_ids)
}

/// Get all collections (metadata only, for listing)
#[tauri::command]
pub async fn collections_get_all(app: AppHandle) -> Result<Vec<Collection>, String> {
    let collection_ids = collections_list(app.clone()).await?;
    let mut collections = Vec::new();

    for id in collection_ids {
        match collection_get(app.clone(), id).await {
            Ok(collection) => collections.push(collection),
            Err(e) => {
                // Log error but continue with other collections
                eprintln!("Failed to load collection: {}", e);
            }
        }
    }

    Ok(collections)
}

/// Get a single collection by ID
#[tauri::command]
pub async fn collection_get(app: AppHandle, collection_id: String) -> Result<Collection, String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;
    let collection_file = collection_dir.join("collection.json");

    if !collection_file.exists() {
        return Err(format!("Collection {} not found", collection_id));
    }

    read_json_file(&collection_file)
}

/// Save a collection (creates or updates)
#[tauri::command]
pub async fn collection_save(app: AppHandle, collection: Collection) -> Result<(), String> {
    ensure_collections_dir(&app)?;

    let collection_dir = get_collection_dir(&app, &collection.id)?;

    if !collection_dir.exists() {
        fs::create_dir_all(&collection_dir)
            .map_err(|e| format!("Failed to create collection dir: {}", e))?;
    }

    let collection_file = collection_dir.join("collection.json");
    write_json_file(&collection_file, &collection)?;

    Ok(())
}

/// Delete a collection and all its data
#[tauri::command]
pub async fn collection_delete(app: AppHandle, collection_id: String) -> Result<(), String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;

    if collection_dir.exists() {
        fs::remove_dir_all(&collection_dir)
            .map_err(|e| format!("Failed to delete collection: {}", e))?;
    }

    Ok(())
}

/// Get endpoint-specific data
#[tauri::command]
pub async fn collection_get_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<EndpointData, String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;
    let requests_dir = collection_dir.join("requests");
    let endpoint_file = requests_dir.join(format!("{}.json", endpoint_id));

    if !endpoint_file.exists() {
        return Ok(EndpointData::default());
    }

    read_json_file(&endpoint_file)
}

/// Save endpoint-specific data
#[tauri::command]
pub async fn collection_save_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
    data: EndpointData,
) -> Result<(), String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;
    let requests_dir = collection_dir.join("requests");

    if !requests_dir.exists() {
        fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests dir: {}", e))?;
    }

    let endpoint_file = requests_dir.join(format!("{}.json", endpoint_id));
    write_json_file(&endpoint_file, &data)?;

    Ok(())
}

/// Delete endpoint-specific data
#[tauri::command]
pub async fn collection_delete_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<(), String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;
    let endpoint_file = collection_dir
        .join("requests")
        .join(format!("{}.json", endpoint_id));

    if endpoint_file.exists() {
        fs::remove_file(&endpoint_file)
            .map_err(|e| format!("Failed to delete endpoint data: {}", e))?;
    }

    Ok(())
}

/// Get collection variables
#[tauri::command]
pub async fn collection_get_variables(
    app: AppHandle,
    collection_id: String,
) -> Result<Vec<Value>, String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;
    let variables_file = collection_dir.join("variables.json");

    if !variables_file.exists() {
        return Ok(vec![]);
    }

    read_json_file(&variables_file)
}

/// Save collection variables
#[tauri::command]
pub async fn collection_save_variables(
    app: AppHandle,
    collection_id: String,
    variables: Vec<Value>,
) -> Result<(), String> {
    let collection_dir = get_collection_dir(&app, &collection_id)?;

    if !collection_dir.exists() {
        return Err(format!("Collection {} not found", collection_id));
    }

    let variables_file = collection_dir.join("variables.json");
    write_json_file(&variables_file, &variables)?;

    Ok(())
}

/// Check if migration from old store is needed
#[tauri::command]
pub async fn collections_needs_migration(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_store::StoreExt;

    let collections_dir = get_collections_dir(&app)?;

    // If collections directory already has content, no migration needed
    if collections_dir.exists() {
        let entries = fs::read_dir(&collections_dir)
            .map_err(|e| format!("Failed to read collections dir: {}", e))?;
        if entries.count() > 0 {
            return Ok(false);
        }
    }

    // Check if old store has collections
    let store = app
        .store("resonance-store.json")
        .map_err(|e| e.to_string())?;

    let old_collections = store.get("collections").unwrap_or(Value::Null);

    match old_collections {
        Value::Array(arr) => Ok(!arr.is_empty()),
        _ => Ok(false),
    }
}

/// Migrate collections from old single-file store to per-collection files
#[tauri::command]
pub async fn collections_migrate(app: AppHandle) -> Result<u32, String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store("resonance-store.json")
        .map_err(|e| e.to_string())?;

    // Get old collections
    let old_collections = store.get("collections").unwrap_or(Value::Null);
    let collections: Vec<Value> = match old_collections {
        Value::Array(arr) => arr,
        _ => return Ok(0),
    };

    let mut migrated_count = 0;

    for collection_value in collections {
        // Parse collection
        let collection: Collection = serde_json::from_value(collection_value.clone())
            .map_err(|e| format!("Failed to parse collection: {}", e))?;

        let collection_id = collection.id.clone();

        // Save collection to new format
        collection_save(app.clone(), collection).await?;

        // Migrate endpoint-specific data
        migrate_endpoint_data(&app, &store, &collection_id)?;

        // Migrate variables
        migrate_variables(&app, &store, &collection_id)?;

        migrated_count += 1;
    }

    // After successful migration, clear old data from store
    // (keeping a backup key just in case)
    if migrated_count > 0 {
        let backup_collections = store.get("collections").unwrap_or(Value::Null);
        store.set("_backup_collections".to_string(), backup_collections);
        store.set("collections".to_string(), serde_json::json!([]));
        store.save().map_err(|e| e.to_string())?;
    }

    Ok(migrated_count)
}

/// Helper to migrate endpoint data for a collection
fn migrate_endpoint_data(
    app: &AppHandle,
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> Result<(), String> {
    // Get all the different endpoint data stores
    let modified_bodies = store
        .get("modifiedRequestBodies")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let path_params = store
        .get("persistedPathParams")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let query_params = store
        .get("persistedQueryParams")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let headers = store
        .get("persistedHeaders")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let auth_configs = store
        .get("persistedAuthConfigs")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let urls = store
        .get("persistedUrls")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let scripts = store
        .get("persistedScripts")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let graphql_data = store
        .get("graphqlData")
        .unwrap_or(Value::Object(serde_json::Map::new()));
    let grpc_data = store
        .get("grpcData")
        .unwrap_or(Value::Object(serde_json::Map::new()));

    // Find all endpoint IDs for this collection
    let prefix = format!("{}_", collection_id);
    let mut endpoint_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Collect endpoint IDs from all data stores
    for store_data in [
        &modified_bodies,
        &path_params,
        &query_params,
        &headers,
        &auth_configs,
        &urls,
        &scripts,
        &graphql_data,
        &grpc_data,
    ] {
        if let Value::Object(map) = store_data {
            for key in map.keys() {
                if key.starts_with(&prefix) {
                    let endpoint_id = key.strip_prefix(&prefix).unwrap().to_string();
                    endpoint_ids.insert(endpoint_id);
                }
            }
        }
    }

    // Create endpoint data files
    let collection_dir = get_collection_dir(app, collection_id)?;
    let requests_dir = collection_dir.join("requests");

    if !endpoint_ids.is_empty() && !requests_dir.exists() {
        fs::create_dir_all(&requests_dir)
            .map_err(|e| format!("Failed to create requests dir: {}", e))?;
    }

    for endpoint_id in endpoint_ids {
        let key = format!("{}_{}", collection_id, endpoint_id);

        let endpoint_data = EndpointData {
            modified_body: modified_bodies
                .get(&key)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            path_params: path_params
                .get(&key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default(),
            query_params: query_params
                .get(&key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default(),
            headers: headers
                .get(&key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default(),
            auth_config: auth_configs.get(&key).cloned(),
            url: urls
                .get(&key)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            scripts: scripts.get(&key).cloned(),
            graphql_data: graphql_data.get(&key).cloned(),
            grpc_data: grpc_data.get(&key).cloned(),
            response_schema: None,
        };

        // Only save if there's actual data
        if endpoint_data.modified_body.is_some()
            || !endpoint_data.path_params.is_empty()
            || !endpoint_data.query_params.is_empty()
            || !endpoint_data.headers.is_empty()
            || endpoint_data.auth_config.is_some()
            || endpoint_data.url.is_some()
            || endpoint_data.scripts.is_some()
            || endpoint_data.graphql_data.is_some()
            || endpoint_data.grpc_data.is_some()
        {
            let endpoint_file = requests_dir.join(format!("{}.json", endpoint_id));
            write_json_file(&endpoint_file, &endpoint_data)?;
        }
    }

    Ok(())
}

/// Helper to migrate variables for a collection
fn migrate_variables(
    app: &AppHandle,
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> Result<(), String> {
    let key = format!("{}Variables", collection_id);
    let variables = store.get(&key).unwrap_or(Value::Array(vec![]));

    if let Value::Array(vars) = variables {
        if !vars.is_empty() {
            let collection_dir = get_collection_dir(app, collection_id)?;
            let variables_file = collection_dir.join("variables.json");
            write_json_file(&variables_file, &vars)?;
        }
    }

    Ok(())
}

/// Get the collections directory path (for user reference)
#[tauri::command]
pub async fn collections_get_path(app: AppHandle) -> Result<String, String> {
    let path = get_collections_dir(&app)?;
    Ok(path.to_string_lossy().to_string())
}
