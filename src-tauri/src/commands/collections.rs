use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;
use tokio::sync::oneshot;

use super::fs_secure::{restrict_dir, restrict_file};

const STORE_FILE: &str = "resonance-store.json";
const COLLECTIONS_DIR: &str = "collections";
const COLLECTION_INDEX_KEY: &str = "collectionIndex";
const LAST_COLLECTION_DIR_KEY: &str = "lastCollectionDirectory";

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
    /// Collection-level auth config ({type, config}) inherited by endpoints
    /// whose auth type is "inherit". Secret fields are redacted before write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<Value>,
    #[serde(rename = "_openApiSpec")]
    #[serde(default)]
    pub open_api_spec: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_path: Option<String>,
    #[serde(skip_serializing, default)]
    pub storage_parent_path: Option<String>,
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
    pub form_body_data: Option<Value>,
    #[serde(default)]
    pub grpc_data: Option<Value>,
    #[serde(default)]
    pub mqtt_data: Option<Value>,
    #[serde(default)]
    pub response_schema: Option<Value>,
}

impl EndpointData {
    /// True when the legacy store held anything worth writing to an endpoint
    /// file. Only the fields the migration populates are considered; the rest
    /// are always `None` on this path.
    fn has_migrated_content(&self) -> bool {
        self.modified_body.is_some()
            || !self.path_params.is_empty()
            || !self.query_params.is_empty()
            || !self.headers.is_empty()
            || self.auth_config.is_some()
            || self.url.is_some()
            || self.scripts.is_some()
            || self.graphql_data.is_some()
            || self.grpc_data.is_some()
    }
}

fn get_default_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join(COLLECTIONS_DIR))
}

pub(crate) fn ensure_default_collections_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = get_default_collections_dir(app)?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create collections dir: {}", e))?;
    }
    restrict_dir(&dir);
    Ok(dir)
}

/// The on-disk layout of one collection, resolved once so the filenames live in
/// a single place rather than being re-joined at every call site.
pub(crate) struct CollectionPaths {
    pub dir: PathBuf,
}

impl CollectionPaths {
    /// Resolve a registered collection, reporting it missing if the index has
    /// no usable entry.
    fn resolve(app: &AppHandle, collection_id: &str) -> Result<Self, String> {
        let dir = resolve_collection_dir(app, collection_id)?
            .ok_or_else(|| format!("Collection {} not found", collection_id))?;
        Ok(Self { dir })
    }

    pub(crate) fn from_dir(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn of(dir: &Path) -> Self {
        Self::from_dir(dir.to_path_buf())
    }

    pub(crate) fn collection_json(&self) -> PathBuf {
        self.dir.join("collection.json")
    }

    pub(crate) fn requests(&self) -> PathBuf {
        self.dir.join("requests")
    }

    pub(crate) fn variables_json(&self) -> PathBuf {
        self.dir.join("variables.json")
    }

    /// Create the requests directory if it is missing, and restrict it either
    /// way. Restricting unconditionally is deliberate: a directory that already
    /// exists may predate the hardening, or have been created by an older
    /// version under a looser umask.
    pub(crate) fn ensure_requests(&self) -> Result<PathBuf, String> {
        let requests = self.requests();
        if !requests.exists() {
            fs::create_dir_all(&requests)
                .map_err(|e| format!("Failed to create requests dir: {}", e))?;
        }
        restrict_dir(&requests);
        Ok(requests)
    }
}

fn get_collection_index(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = store
        .get(COLLECTION_INDEX_KEY)
        .unwrap_or(Value::Object(serde_json::Map::new()));

    serde_json::from_value(value).map_err(|e| format!("Failed to parse collection index: {}", e))
}

fn save_collection_index(app: &AppHandle, index: &HashMap<String, String>) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        COLLECTION_INDEX_KEY.to_string(),
        serde_json::to_value(index).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn register_collection_path(
    app: &AppHandle,
    collection_id: &str,
    path: &Path,
) -> Result<(), String> {
    let mut index = get_collection_index(app)?;
    index.insert(
        collection_id.to_string(),
        path.to_string_lossy().to_string(),
    );
    save_collection_index(app, &index)
}

fn unregister_collection_path(app: &AppHandle, collection_id: &str) -> Result<(), String> {
    let mut index = get_collection_index(app)?;
    index.remove(collection_id);
    save_collection_index(app, &index)
}

fn get_last_collection_directory(app: &AppHandle) -> Option<PathBuf> {
    let store = app.store(STORE_FILE).ok()?;
    let dir_str = store.get(LAST_COLLECTION_DIR_KEY)?.as_str()?.to_string();
    if dir_str.is_empty() {
        return None;
    }

    let path = PathBuf::from(dir_str);
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

fn save_last_collection_directory(app: &AppHandle, dir: &Path) {
    if let Ok(store) = app.store(STORE_FILE) {
        store.set(
            LAST_COLLECTION_DIR_KEY.to_string(),
            Value::String(dir.to_string_lossy().to_string()),
        );
        let _ = store.save();
    }
}

pub(crate) fn write_json_file<T: Serialize>(path: &PathBuf, data: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize JSON: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write file: {}", e))?;
    restrict_file(path);
    Ok(())
}

/// Secret credential fields per auth type. Kept in sync with the frontend list in
/// `src/modules/auth/authSecrets.js`.
fn secret_auth_fields(auth_type: &str) -> &'static [&'static str] {
    match auth_type {
        "bearer" => &["token"],
        "basic" => &["password"],
        "api-key" => &["keyValue"],
        "oauth2" => &["clientSecret", "password", "token", "refreshToken"],
        "digest" => &["password"],
        "aws-v4" => &["secretAccessKey", "sessionToken"],
        _ => &[],
    }
}

/// A `{{ ... }}` reference resolves from a variable at request time and carries no
/// secret itself, so it is safe to leave on disk.
fn is_template_ref(value: &str) -> bool {
    match value.find("{{") {
        Some(start) => value[start..].contains("}}"),
        None => false,
    }
}

/// Defense in depth: blank literal credential fields so they never reach the
/// git-friendly collection files even if the frontend fails to redact them. Template
/// references and empty values are preserved. The real values are kept in the
/// frontend SecretStore and rehydrated on read.
fn redact_auth_secrets(auth_config: &mut Value) {
    let auth_type = match auth_config.get("type").and_then(|t| t.as_str()) {
        Some(t) => t.to_string(),
        None => return,
    };
    let fields = secret_auth_fields(&auth_type);
    if fields.is_empty() {
        return;
    }
    if let Some(config) = auth_config
        .get_mut("config")
        .and_then(|c| c.as_object_mut())
    {
        for field in fields {
            if let Some(Value::String(s)) = config.get(*field) {
                if !s.is_empty() && !is_template_ref(s) {
                    config.insert((*field).to_string(), Value::String(String::new()));
                }
            }
        }
    }
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<T, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))
}

fn is_collection_dir(path: &Path) -> bool {
    path.is_dir() && CollectionPaths::of(path).collection_json().exists()
}

fn read_collection_from_dir(path: &Path) -> Result<Collection, String> {
    let mut collection: Collection = read_json_file(&CollectionPaths::of(path).collection_json())?;
    collection.storage_path = Some(path.to_string_lossy().to_string());
    Ok(collection)
}

fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for c in input.chars() {
        let ch = c.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "collection".to_string()
    } else {
        slug
    }
}

fn sanitize_file_component(input: &str) -> String {
    let mut out = String::new();
    for c in input.chars() {
        let ch = c.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }

    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "item".to_string()
    } else {
        out
    }
}

fn find_available_dir(parent: &Path, base_name: &str, current_dir: Option<&Path>) -> PathBuf {
    let mut candidate = parent.join(base_name);
    if current_dir == Some(candidate.as_path()) || !candidate.exists() {
        return candidate;
    }

    let mut counter = 2;
    loop {
        candidate = parent.join(format!("{}-{}", base_name, counter));
        if current_dir == Some(candidate.as_path()) || !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

pub(crate) fn desired_endpoint_file_name(endpoint_name: &str, endpoint_id: &str) -> String {
    format!(
        "{}--{}.json",
        slugify(endpoint_name),
        sanitize_file_component(endpoint_id)
    )
}

pub(crate) fn find_endpoint_data_file(
    requests_dir: &Path,
    endpoint_id: &str,
) -> Result<Option<PathBuf>, String> {
    let legacy_file = requests_dir.join(format!("{}.json", endpoint_id));
    if legacy_file.exists() {
        return Ok(Some(legacy_file));
    }

    if !requests_dir.exists() {
        return Ok(None);
    }

    let suffix = format!("--{}.json", sanitize_file_component(endpoint_id));
    let entries =
        fs::read_dir(requests_dir).map_err(|e| format!("Failed to read requests dir: {}", e))?;

    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();

        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                if name.ends_with(&suffix) {
                    return Ok(Some(path));
                }
            }
        }
    }

    Ok(None)
}

fn extract_endpoint_name(endpoint: &Value) -> Option<String> {
    endpoint
        .get("name")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            endpoint
                .get("path")
                .and_then(|value| value.as_str())
                .filter(|value| !value.trim().is_empty())
                .map(|value| value.to_string())
        })
}

fn list_collection_endpoints(collection: &Collection) -> Vec<(String, String)> {
    let mut seen = HashSet::new();
    let mut endpoints = Vec::new();

    let mut collect_endpoint = |endpoint: &Value| {
        if let Some(endpoint_id) = endpoint.get("id").and_then(|value| value.as_str()) {
            if seen.insert(endpoint_id.to_string()) {
                let endpoint_name =
                    extract_endpoint_name(endpoint).unwrap_or_else(|| endpoint_id.to_string());
                endpoints.push((endpoint_id.to_string(), endpoint_name));
            }
        }
    };

    for endpoint in &collection.endpoints {
        collect_endpoint(endpoint);
    }

    for folder in &collection.folders {
        if let Some(folder_endpoints) = folder.get("endpoints").and_then(|value| value.as_array()) {
            for endpoint in folder_endpoints {
                collect_endpoint(endpoint);
            }
        }
    }

    endpoints
}

fn find_endpoint_name_in_collection(collection: &Collection, endpoint_id: &str) -> Option<String> {
    list_collection_endpoints(collection)
        .into_iter()
        .find_map(|(id, name)| if id == endpoint_id { Some(name) } else { None })
}

fn sync_endpoint_data_file_names(
    collection_dir: &Path,
    collection: &Collection,
) -> Result<(), String> {
    let requests_dir = CollectionPaths::of(collection_dir).requests();
    if !requests_dir.exists() {
        return Ok(());
    }

    for (endpoint_id, endpoint_name) in list_collection_endpoints(collection) {
        if let Some(current_file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? {
            let desired_file =
                requests_dir.join(desired_endpoint_file_name(&endpoint_name, &endpoint_id));
            if current_file != desired_file && !desired_file.exists() {
                fs::rename(&current_file, &desired_file)
                    .map_err(|e| format!("Failed to rename endpoint data file: {}", e))?;
            }
        }
    }

    Ok(())
}

pub(crate) fn resolve_collection_dir(
    app: &AppHandle,
    collection_id: &str,
) -> Result<Option<PathBuf>, String> {
    let index = get_collection_index(app)?;
    if let Some(path_str) = index.get(collection_id) {
        let path = PathBuf::from(path_str);
        if is_collection_dir(&path) {
            return Ok(Some(path));
        }
    }

    let default_dir = get_default_collections_dir(app)?;
    let legacy_dir = default_dir.join(collection_id);
    if is_collection_dir(&legacy_dir) {
        return Ok(Some(legacy_dir));
    }

    if !default_dir.exists() {
        return Ok(None);
    }

    let entries =
        fs::read_dir(&default_dir).map_err(|e| format!("Failed to read collections dir: {}", e))?;
    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();
        if !is_collection_dir(&path) {
            continue;
        }

        if let Ok(collection) = read_collection_from_dir(&path) {
            if collection.id == collection_id {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

pub(crate) fn persist_collection(
    app: &AppHandle,
    collection: Collection,
) -> Result<Collection, String> {
    ensure_default_collections_dir(app)?;

    let existing_dir = resolve_collection_dir(app, &collection.id)?;
    let target_parent = if let Some(parent) = collection
        .storage_parent_path
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        PathBuf::from(parent)
    } else if let Some(current_dir) = existing_dir.as_ref() {
        current_dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| {
                get_default_collections_dir(app).unwrap_or_else(|_| PathBuf::from("."))
            })
    } else {
        get_default_collections_dir(app)?
    };

    if !target_parent.exists() {
        fs::create_dir_all(&target_parent)
            .map_err(|e| format!("Failed to create collection parent dir: {}", e))?;
    }

    let base_name = slugify(&collection.name);
    let target_dir = find_available_dir(&target_parent, &base_name, existing_dir.as_deref());

    if let Some(current_dir) = existing_dir.as_ref() {
        if current_dir != &target_dir {
            fs::rename(current_dir, &target_dir)
                .map_err(|e| format!("Failed to rename collection dir: {}", e))?;
        }
    } else if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .map_err(|e| format!("Failed to create collection dir: {}", e))?;
    }
    restrict_dir(&target_dir);

    let mut persisted = collection.clone();
    persisted.storage_path = Some(target_dir.to_string_lossy().to_string());
    persisted.storage_parent_path = None;
    if let Some(auth) = persisted.auth_config.as_mut() {
        redact_auth_secrets(auth);
    }
    for folder in persisted.folders.iter_mut() {
        if let Some(auth) = folder.get_mut("authConfig").filter(|v| v.is_object()) {
            redact_auth_secrets(auth);
        }
    }

    write_json_file(
        &CollectionPaths::of(&target_dir).collection_json(),
        &persisted,
    )?;
    sync_endpoint_data_file_names(&target_dir, &persisted)?;
    register_collection_path(app, &persisted.id, &target_dir)?;

    if let Some(parent) = target_dir.parent() {
        save_last_collection_directory(app, parent);
    }

    Ok(persisted)
}

#[tauri::command]
pub async fn collections_list(app: AppHandle) -> Result<Vec<String>, String> {
    let mut collection_ids = Vec::new();
    let mut seen = HashSet::new();

    let default_dir = get_default_collections_dir(&app)?;
    if default_dir.exists() {
        let entries = fs::read_dir(&default_dir)
            .map_err(|e| format!("Failed to read collections dir: {}", e))?;

        for entry in entries {
            let path = entry
                .map_err(|e| format!("Failed to read dir entry: {}", e))?
                .path();

            if !is_collection_dir(&path) {
                continue;
            }

            if let Ok(collection) = read_collection_from_dir(&path) {
                if seen.insert(collection.id.clone()) {
                    register_collection_path(&app, &collection.id, &path)?;
                    collection_ids.push(collection.id);
                }
            }
        }
    }

    for (collection_id, path_str) in get_collection_index(&app)? {
        if seen.contains(&collection_id) {
            continue;
        }

        let path = PathBuf::from(path_str);
        if is_collection_dir(&path) && seen.insert(collection_id.clone()) {
            collection_ids.push(collection_id);
        }
    }

    Ok(collection_ids)
}

#[tauri::command]
pub async fn collections_get_all(app: AppHandle) -> Result<Vec<Collection>, String> {
    let collection_ids = collections_list(app.clone()).await?;
    let mut collections = Vec::new();

    for id in collection_ids {
        match collection_get(app.clone(), id).await {
            Ok(collection) => collections.push(collection),
            Err(e) => {
                eprintln!("Failed to load collection: {}", e);
            }
        }
    }

    Ok(collections)
}

#[tauri::command]
pub async fn collection_get(app: AppHandle, collection_id: String) -> Result<Collection, String> {
    let paths = CollectionPaths::resolve(&app, &collection_id)?;

    let collection = read_collection_from_dir(&paths.dir)?;
    register_collection_path(&app, &collection.id, &paths.dir)?;
    Ok(collection)
}

#[tauri::command]
pub async fn collection_save(app: AppHandle, collection: Collection) -> Result<(), String> {
    persist_collection(&app, collection)?;
    Ok(())
}

#[tauri::command]
pub async fn collection_delete(app: AppHandle, collection_id: String) -> Result<(), String> {
    if let Some(collection_dir) = resolve_collection_dir(&app, &collection_id)? {
        if collection_dir.exists() {
            fs::remove_dir_all(&collection_dir)
                .map_err(|e| format!("Failed to delete collection: {}", e))?;
        }
    }

    unregister_collection_path(&app, &collection_id)?;
    super::scripts::purge_store_scripts_for_collection(&app, &collection_id);
    Ok(())
}

#[tauri::command]
pub async fn collection_get_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<EndpointData, String> {
    let requests_dir = CollectionPaths::resolve(&app, &collection_id)?.requests();

    let Some(endpoint_file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? else {
        return Ok(EndpointData::default());
    };

    read_json_file(&endpoint_file)
}

#[tauri::command]
pub async fn collection_save_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
    mut data: EndpointData,
) -> Result<(), String> {
    // Defense in depth: ensure literal credentials never land in the on-disk file.
    if let Some(auth) = data.auth_config.as_mut() {
        redact_auth_secrets(auth);
    }

    let collection = collection_get(app.clone(), collection_id.clone()).await?;
    let paths = CollectionPaths::from_dir(PathBuf::from(
        collection
            .storage_path
            .clone()
            .ok_or_else(|| "Collection storage path missing".to_string())?,
    ));
    let requests_dir = paths.ensure_requests()?;

    let endpoint_name = find_endpoint_name_in_collection(&collection, &endpoint_id)
        .unwrap_or_else(|| endpoint_id.clone());
    let desired_file = requests_dir.join(desired_endpoint_file_name(&endpoint_name, &endpoint_id));

    if let Some(current_file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? {
        if current_file != desired_file && !desired_file.exists() {
            fs::rename(&current_file, &desired_file)
                .map_err(|e| format!("Failed to rename endpoint data file: {}", e))?;
        } else if current_file != desired_file && desired_file.exists() {
            fs::remove_file(&current_file)
                .map_err(|e| format!("Failed to remove old endpoint data file: {}", e))?;
        }
    }

    write_json_file(&desired_file, &data)?;
    Ok(())
}

#[tauri::command]
pub async fn collection_delete_endpoint_data(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<(), String> {
    let requests_dir = CollectionPaths::resolve(&app, &collection_id)?.requests();

    if let Some(endpoint_file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? {
        fs::remove_file(&endpoint_file)
            .map_err(|e| format!("Failed to delete endpoint data: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn collection_get_variables(
    app: AppHandle,
    collection_id: String,
) -> Result<Vec<Value>, String> {
    let variables_file = CollectionPaths::resolve(&app, &collection_id)?.variables_json();

    if !variables_file.exists() {
        return Ok(vec![]);
    }

    read_json_file(&variables_file)
}

#[tauri::command]
pub async fn collection_save_variables(
    app: AppHandle,
    collection_id: String,
    mut variables: Vec<Value>,
) -> Result<(), String> {
    let paths = CollectionPaths::resolve(&app, &collection_id)?;

    // Defense in depth: a variable flagged secret must never carry its value into the
    // git-friendly variables.json. The real value lives in the frontend SecretStore.
    for entry in variables.iter_mut() {
        if let Some(obj) = entry.as_object_mut() {
            if obj.get("secret").and_then(|s| s.as_bool()) == Some(true) {
                obj.insert("value".to_string(), Value::String(String::new()));
            }
        }
    }

    write_json_file(&paths.variables_json(), &variables)?;

    Ok(())
}

#[tauri::command]
pub async fn collections_needs_migration(app: AppHandle) -> Result<bool, String> {
    let collections_dir = get_default_collections_dir(&app)?;

    if collections_dir.exists() {
        let entries = fs::read_dir(&collections_dir)
            .map_err(|e| format!("Failed to read collections dir: {}", e))?;
        if entries.count() > 0 {
            return Ok(false);
        }
    }

    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let old_collections = store.get("collections").unwrap_or(Value::Null);

    match old_collections {
        Value::Array(arr) => Ok(!arr.is_empty()),
        _ => Ok(false),
    }
}

#[tauri::command]
pub async fn collections_migrate(app: AppHandle) -> Result<u32, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    let old_collections = store.get("collections").unwrap_or(Value::Null);
    let collections: Vec<Value> = match old_collections {
        Value::Array(arr) => arr,
        _ => return Ok(0),
    };

    let mut migrated_count = 0;

    for collection_value in collections {
        let collection: Collection = serde_json::from_value(collection_value.clone())
            .map_err(|e| format!("Failed to parse collection: {}", e))?;

        let collection_id = collection.id.clone();

        persist_collection(&app, collection)?;
        migrate_endpoint_data(&app, &store, &collection_id)?;
        migrate_variables(&app, &store, &collection_id)?;

        migrated_count += 1;
    }

    if migrated_count > 0 {
        let backup_collections = store.get("collections").unwrap_or(Value::Null);
        store.set("_backup_collections".to_string(), backup_collections);
        store.set("collections".to_string(), serde_json::json!([]));
        store.save().map_err(|e| e.to_string())?;
    }

    Ok(migrated_count)
}

/// Read one of the legacy global-store maps, defaulting to an empty object so a
/// key that was never written behaves like one holding nothing.
fn legacy_map(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Value {
    store
        .get(key)
        .unwrap_or(Value::Object(serde_json::Map::new()))
}

fn legacy_string(map: &Value, key: &str) -> Option<String> {
    map.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn legacy_array(map: &Value, key: &str) -> Vec<Value> {
    map.get(key)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

fn migrate_endpoint_data(
    app: &AppHandle,
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> Result<(), String> {
    let modified_bodies = legacy_map(store, "modifiedRequestBodies");
    let path_params = legacy_map(store, "persistedPathParams");
    let query_params = legacy_map(store, "persistedQueryParams");
    let headers = legacy_map(store, "persistedHeaders");
    let auth_configs = legacy_map(store, "persistedAuthConfigs");
    let urls = legacy_map(store, "persistedUrls");
    let scripts = legacy_map(store, "persistedScripts");
    let graphql_data = legacy_map(store, "graphqlData");
    let grpc_data = legacy_map(store, "grpcData");

    let prefix = format!("{}_", collection_id);
    let mut endpoint_ids: HashSet<String> = HashSet::new();

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

    let paths = CollectionPaths::resolve(app, collection_id)?;
    let requests_dir = if endpoint_ids.is_empty() {
        paths.requests()
    } else {
        paths.ensure_requests()?
    };

    for endpoint_id in endpoint_ids {
        let key = format!("{}_{}", collection_id, endpoint_id);

        let mut endpoint_data = EndpointData {
            modified_body: legacy_string(&modified_bodies, &key),
            path_params: legacy_array(&path_params, &key),
            query_params: legacy_array(&query_params, &key),
            headers: legacy_array(&headers, &key),
            auth_config: auth_configs.get(&key).cloned(),
            url: legacy_string(&urls, &key),
            scripts: scripts.get(&key).cloned(),
            graphql_data: graphql_data.get(&key).cloned(),
            form_body_data: None,
            grpc_data: grpc_data.get(&key).cloned(),
            mqtt_data: None,
            response_schema: None,
        };

        if endpoint_data.has_migrated_content() {
            if let Some(auth) = endpoint_data.auth_config.as_mut() {
                redact_auth_secrets(auth);
            }
            let endpoint_file = requests_dir.join(format!("{}.json", endpoint_id));
            write_json_file(&endpoint_file, &endpoint_data)?;
        }
    }

    if let Some(collection_dir) = resolve_collection_dir(app, collection_id)? {
        let collection = read_collection_from_dir(&collection_dir)?;
        sync_endpoint_data_file_names(&collection_dir, &collection)?;
    }

    Ok(())
}

fn migrate_variables(
    app: &AppHandle,
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> Result<(), String> {
    let key = format!("{}Variables", collection_id);
    let variables = store.get(&key).unwrap_or(Value::Array(vec![]));

    if let Value::Array(vars) = variables {
        if !vars.is_empty() {
            let paths = CollectionPaths::resolve(app, collection_id)?;
            write_json_file(&paths.variables_json(), &vars)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn collections_get_path(app: AppHandle) -> Result<String, String> {
    let path = get_default_collections_dir(&app)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn collections_pick_directory(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel::<Option<FilePath>>();

    let mut dialog = app.dialog().file();
    if let Some(last_dir) = get_last_collection_directory(&app) {
        dialog = dialog.set_directory(last_dir);
    } else if let Ok(default_dir) = get_default_collections_dir(&app) {
        dialog = dialog.set_directory(default_dir);
    }

    dialog.pick_folder(move |folder_path| {
        let _ = tx.send(folder_path);
    });

    let folder_path = rx.await.map_err(|e| format!("Dialog error: {}", e))?;

    let Some(path) = folder_path else {
        return Ok(None);
    };

    let folder = path.as_path().ok_or("Invalid folder path")?;
    save_last_collection_directory(&app, folder);

    Ok(Some(folder.to_string_lossy().to_string()))
}
