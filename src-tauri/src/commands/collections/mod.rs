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

mod git;
mod ipc;
mod layout;
mod legacy;
mod link;
mod model;
mod read;
mod secrets;
mod write;

use ipc::to_ipc_collection;
use read::{read_collection_dir, Layout};

pub(crate) use layout::{desired_endpoint_file_name, find_endpoint_data_file};
use layout::{find_available_dir, slugify};
use secrets::redact_auth_secrets;

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
    /// True for a collection opened in place from a directory the app does not
    /// own. Emitted for the renderer, ignored on the way in: linkage is store
    /// state, never something the frontend can assert.
    #[serde(default, skip_deserializing)]
    pub linked: bool,
    /// Branch of the Git working tree the collection directory sits in, when
    /// it sits in one. Derived on every read, like `linked`: never accepted
    /// from the frontend and never written to disk.
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub git_branch: Option<String>,
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

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<T, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))
}

fn is_collection_dir(path: &Path) -> bool {
    Layout::detect(path).is_some()
}

/// Reads a collection directory in whichever layout it uses.
///
/// A v2 tree is projected back into the shape the frontend expects, so reading
/// the new format is invisible to the renderer.
fn read_collection_from_dir(path: &Path) -> Result<Collection, String> {
    let mut collection = match Layout::detect(path) {
        Some(Layout::V2) => {
            let loaded = read_collection_dir(path)?;
            to_ipc_collection(&loaded, &path.to_string_lossy(), false)
        }
        Some(Layout::V1) => {
            let mut collection: Collection =
                read_json_file(&CollectionPaths::of(path).collection_json())?;
            collection.storage_path = Some(path.to_string_lossy().to_string());
            collection
        }
        None => return Err(format!("{} is not a collection directory", path.display())),
    };

    // Every read of a collection off disk funnels through here, and the branch
    // is as much a fn(&Path) as the rest of the read, so one call covers list,
    // get, and open alike.
    collection.git_branch = git::branch_for_dir(path);
    Ok(collection)
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

/// Applies endpoint data onto the matching request anywhere in a tree.
///
/// @param node - Folder to walk
/// @param request_id - Request to update
/// @param data - The data the frontend sent
/// @returns True when the request was found
fn apply_endpoint_data_in_tree(
    node: &mut read::FolderNode,
    request_id: &str,
    data: &EndpointData,
) -> bool {
    for entry in &mut node.requests {
        if entry.doc.id == request_id {
            ipc::apply_endpoint_data(&mut entry.doc, data);
            return true;
        }
    }
    node.folders
        .iter_mut()
        .any(|folder| apply_endpoint_data_in_tree(folder, request_id, data))
}

/// Removes a request from a tree, wherever it sits.
///
/// @param node - Folder to walk
/// @param request_id - Request to remove
/// @returns True when the request was found and removed
fn remove_request_from_tree(node: &mut read::FolderNode, request_id: &str) -> bool {
    let before = node.requests.len();
    node.requests.retain(|entry| entry.doc.id != request_id);
    if node.requests.len() != before {
        return true;
    }
    node.folders
        .iter_mut()
        .any(|folder| remove_request_from_tree(folder, request_id))
}

/// Loads whatever is already stored for a collection, in either layout.
///
/// A v1 directory is converted on the way in, so a save always merges onto the
/// v2 model regardless of what is on disk.
///
/// @param dir - The collection directory
/// @returns The stored collection, or None for a directory with nothing in it
fn load_existing(dir: &Path) -> Result<Option<read::LoadedCollection>, String> {
    match Layout::detect(dir) {
        Some(Layout::V2) => Ok(Some(read_collection_dir(dir)?)),
        Some(Layout::V1) => {
            let collection: Collection =
                read_json_file(&CollectionPaths::of(dir).collection_json())?;

            let requests_dir = CollectionPaths::of(dir).requests();
            let mut data = HashMap::new();
            for (endpoint_id, _) in list_collection_endpoints(&collection) {
                if let Some(file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? {
                    if let Ok(endpoint_data) = read_json_file::<EndpointData>(&file) {
                        data.insert(endpoint_id, endpoint_data);
                    }
                }
            }

            let mut loaded = legacy::v1_to_v2(&collection, &data);

            let variables_file = CollectionPaths::of(dir).variables_json();
            if variables_file.exists() {
                loaded.variables = read_json_file(&variables_file).unwrap_or_default();
            }

            Ok(Some(loaded))
        }
        None => Ok(None),
    }
}

/// Writes a collection as a v2 tree, converting it first when the directory
/// still holds v1 files.
///
/// The per-request state already on disk is carried over: `collection_save`
/// only ever carries structure, so a folder rename must not blank the bodies
/// and credentials of the requests inside it.
fn write_v2_collection(dir: &Path, incoming: &Collection) -> Result<(), String> {
    write_v2_collection_seeded(dir, incoming, None, &HashMap::new())
}

/// Writes a collection as v2, seeding variables and per-request state that are
/// not carried by the IPC collection.
///
/// Import needs this: it produces a whole collection plus its variables and
/// per-endpoint payloads in one go, and writing those as separate v1 files
/// beside a v2 tree would leave artifacts the next save deletes.
///
/// @param dir - The collection directory
/// @param incoming - The collection structure
/// @param variables - Variables to store, or None to keep what is on disk
/// @param seed_data - Per-request state keyed by request id
/// @returns Ok once every file is in place
fn write_v2_collection_seeded(
    dir: &Path,
    incoming: &Collection,
    variables: Option<Vec<Value>>,
    seed_data: &HashMap<String, EndpointData>,
) -> Result<(), String> {
    let existing = load_existing(dir)?;

    let mut root = ipc::tree_from_ipc(incoming, existing.as_ref());
    if !seed_data.is_empty() {
        seed_tree(&mut root, seed_data);
    }

    let mut loaded = read::LoadedCollection {
        meta: model::CollectionDoc {
            format: model::FORMAT_VERSION,
            id: incoming.id.clone(),
            name: incoming.name.clone(),
            base_url: incoming.base_url.clone(),
            description: None,
            default_headers: match &incoming.default_headers {
                Value::Null => None,
                Value::Object(map) if map.is_empty() => None,
                other => Some(other.clone()),
            },
            auth: incoming.auth_config.clone(),
            open_api_spec: existing.as_ref().and_then(|e| e.meta.open_api_spec.clone()),
            extra: existing
                .as_ref()
                .map(|e| e.meta.extra.clone())
                .unwrap_or_default(),
        },
        open_api_spec: incoming
            .open_api_spec
            .clone()
            .filter(|v| !v.is_null())
            .or_else(|| existing.as_ref().and_then(|e| e.open_api_spec.clone())),
        variables: variables.unwrap_or_else(|| existing.map(|e| e.variables).unwrap_or_default()),
        root,
        layout: Layout::V2,
    };

    write::write_collection_dir(dir, &mut loaded)
}

/// Applies seeded per-request state onto a freshly built tree.
fn seed_tree(node: &mut read::FolderNode, seed: &HashMap<String, EndpointData>) {
    for entry in &mut node.requests {
        if let Some(data) = seed.get(&entry.doc.id) {
            ipc::apply_endpoint_data(&mut entry.doc, data);
        }
    }
    for folder in &mut node.folders {
        seed_tree(folder, seed);
    }
}

pub(crate) fn persist_collection(
    app: &AppHandle,
    collection: Collection,
) -> Result<Collection, String> {
    let persisted = prepare_collection_dir(app, collection)?;
    let target_dir = PathBuf::from(
        persisted
            .storage_path
            .clone()
            .ok_or_else(|| "Collection storage path missing".to_string())?,
    );

    write_v2_collection(&target_dir, &persisted)?;
    register_collection_path(app, &persisted.id, &target_dir)?;

    if let Some(parent) = target_dir.parent() {
        save_last_collection_directory(app, parent);
    }

    Ok(persisted)
}

/// Resolves and prepares a collection's directory, renaming it when the
/// collection's name changed, and returns the collection with its secrets
/// redacted and its storage path filled in.
///
/// Split out of persist_collection so import can place a directory and then
/// write its own seeded tree into it.
fn prepare_collection_dir(app: &AppHandle, collection: Collection) -> Result<Collection, String> {
    ensure_default_collections_dir(app)?;

    let existing_dir = resolve_collection_dir(app, &collection.id)?;

    // A collection opened in place lives in a directory the app does not own,
    // usually a git checkout. It must be used exactly where it is: renaming it
    // to match the collection name would move the user's working copy out from
    // under their shell, their IDE and their CI, and tightening its
    // permissions would change a directory that is not ours.
    let linked = is_linked_collection(app, &collection.id)?;
    if let link::Placement::InPlace(dir) = link::placement(linked, existing_dir.as_deref()) {
        let mut persisted = collection.clone();
        persisted.storage_path = Some(dir.to_string_lossy().to_string());
        persisted.storage_parent_path = None;
        persisted.linked = true;
        redact_collection_secrets(&mut persisted);
        return Ok(persisted);
    }

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
    persisted.linked = false;
    redact_collection_secrets(&mut persisted);

    Ok(persisted)
}

/// Blanks literal credentials on a collection and its folders before write.
fn redact_collection_secrets(collection: &mut Collection) {
    if let Some(auth) = collection.auth_config.as_mut() {
        redact_auth_secrets(auth);
    }
    for folder in collection.folders.iter_mut() {
        if let Some(auth) = folder.get_mut("authConfig").filter(|v| v.is_object()) {
            redact_auth_secrets(auth);
        }
    }
}

/// Reads the linked map out of the store.
fn get_linked_collections(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let value = store
        .get(link::LINKED_COLLECTIONS_KEY)
        .unwrap_or(Value::Object(serde_json::Map::new()));

    serde_json::from_value(value).map_err(|e| format!("Failed to parse linked collections: {}", e))
}

/// Writes the linked map back to the store.
fn save_linked_collections(
    app: &AppHandle,
    linked: &HashMap<String, String>,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    store.set(
        link::LINKED_COLLECTIONS_KEY.to_string(),
        serde_json::to_value(linked).map_err(|e| e.to_string())?,
    );
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Reports whether a collection was opened in place.
fn is_linked_collection(app: &AppHandle, collection_id: &str) -> Result<bool, String> {
    Ok(link::is_linked(
        collection_id,
        &get_collection_index(app)?,
        &get_linked_collections(app)?,
    ))
}

/// Persists an imported collection, its variables and its per-request payloads
/// as one v2 tree.
///
/// @param app - Tauri app handle
/// @param collection - The imported collection
/// @param variables - Variables produced by the importer
/// @param endpoint_data - Per-request payloads keyed by request id
/// @returns The collection as persisted, with its storage path set
pub(crate) fn persist_imported_collection(
    app: &AppHandle,
    collection: Collection,
    variables: Vec<Value>,
    endpoint_data: HashMap<String, EndpointData>,
) -> Result<Collection, String> {
    let persisted = prepare_collection_dir(app, collection)?;
    let dir = PathBuf::from(
        persisted
            .storage_path
            .clone()
            .ok_or_else(|| "Collection storage path missing".to_string())?,
    );

    write_v2_collection_seeded(&dir, &persisted, Some(variables), &endpoint_data)?;
    register_collection_path(app, &persisted.id, &dir)?;

    if let Some(parent) = dir.parent() {
        save_last_collection_directory(app, parent);
    }

    Ok(persisted)
}

/// A collection as export needs it: the IPC shape, its variables, and the
/// per-request state keyed by request id.
pub(crate) type ExportBundle = (Collection, Vec<Value>, HashMap<String, EndpointData>);

/// Loads everything export needs, in whichever layout the collection uses.
///
/// @param app - Tauri app handle
/// @param collection_id - The collection to load
/// @returns The collection over IPC, its variables, and per-request state by id
pub(crate) fn load_for_export(
    app: &AppHandle,
    collection_id: &str,
) -> Result<ExportBundle, String> {
    let dir = resolve_collection_dir(app, collection_id)?
        .ok_or_else(|| format!("Collection {} not found", collection_id))?;

    let collection = read_collection_from_dir(&dir)?;

    match Layout::detect(&dir) {
        Some(Layout::V2) => {
            let loaded = read_collection_dir(&dir)?;
            let data = loaded
                .requests()
                .into_iter()
                .map(|entry| {
                    (
                        entry.doc.id.clone(),
                        ipc::request_to_endpoint_data(&entry.doc),
                    )
                })
                .collect();
            Ok((collection, loaded.variables, data))
        }
        _ => {
            let paths = CollectionPaths::of(&dir);

            let variables = if paths.variables_json().exists() {
                read_json_file(&paths.variables_json()).unwrap_or_default()
            } else {
                Vec::new()
            };

            let requests_dir = paths.requests();
            let mut data = HashMap::new();
            for (endpoint_id, _) in list_collection_endpoints(&collection) {
                if let Some(file) = find_endpoint_data_file(&requests_dir, &endpoint_id)? {
                    if let Ok(endpoint_data) = read_json_file::<EndpointData>(&file) {
                        data.insert(endpoint_id, endpoint_data);
                    }
                }
            }

            Ok((collection, variables, data))
        }
    }
}

/// One collection that could not be opened, and why.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFailure {
    pub path: String,
    pub reason: String,
}

/// The outcome of opening a directory.
///
/// Failures are reported rather than swallowed: a collection whose files do
/// not parse would otherwise be registered, listed, and then silently dropped
/// by `collections_get_all`, leaving the user with nothing in the sidebar and
/// no explanation.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExistingResult {
    pub opened: Vec<Collection>,
    pub already_open: Vec<String>,
    pub failed: Vec<OpenFailure>,
}

/// Opens a collection directory in place, or every collection one level below it.
///
/// Nothing is copied and nothing is moved: the directory is registered where
/// it already is. The app then treats it as linked, which keeps later saves
/// from renaming it and keeps `collection_delete` from removing it.
///
/// @param app - Tauri app handle
/// @param path - The directory the user picked
/// @returns What was opened, what was already open, and what failed
#[tauri::command]
pub async fn collections_open_existing(
    app: AppHandle,
    path: String,
) -> Result<OpenExistingResult, String> {
    let picked = PathBuf::from(&path);

    // Opening the app's own directory would mark every collection in it as
    // linked in one click, which the UI offers no way to undo.
    let default_dir = get_default_collections_dir(&app)?;
    if link::is_under(&default_dir, &picked) {
        return Err(format!(
            "{} is inside Resonance's own collections folder and is already managed",
            picked.display()
        ));
    }

    let dirs = link::discover_collection_dirs(&picked)?;
    if dirs.is_empty() {
        return Err(format!(
            "No collection found in {}. Pick the folder holding collection.yaml, or one directly above it.",
            picked.display()
        ));
    }

    let mut result = OpenExistingResult {
        opened: Vec::new(),
        already_open: Vec::new(),
        failed: Vec::new(),
    };

    let mut index = get_collection_index(&app)?;
    let mut linked = get_linked_collections(&app)?;

    for dir in dirs {
        // Read before registering, so a directory whose files do not parse is
        // reported now instead of vanishing from the sidebar later.
        let mut collection = match read_collection_from_dir(&dir) {
            Ok(collection) => collection,
            Err(reason) => {
                result.failed.push(OpenFailure {
                    path: dir.to_string_lossy().to_string(),
                    reason,
                });
                continue;
            }
        };

        match link::classify_open(&collection.id, &dir, &index) {
            link::Decision::AlreadyOpen => {
                result.already_open.push(collection.name.clone());
                continue;
            }
            link::Decision::Conflict {
                existing,
                same_path_different_id,
            } => {
                let reason = if same_path_different_id {
                    format!(
                        "{} is already open under a different collection id",
                        existing.display()
                    )
                } else {
                    format!(
                        "\"{}\" is already open from {}. Close it first.",
                        collection.name,
                        existing.display()
                    )
                };
                result.failed.push(OpenFailure {
                    path: dir.to_string_lossy().to_string(),
                    reason,
                });
                continue;
            }
            link::Decision::Open => {}
        }

        let dir_string = dir.to_string_lossy().to_string();
        index.insert(collection.id.clone(), dir_string.clone());
        linked.insert(collection.id.clone(), dir_string);

        collection.linked = true;
        result.opened.push(collection);
    }

    if !result.opened.is_empty() {
        save_collection_index(&app, &index)?;
        save_linked_collections(&app, &linked)?;
    }

    Ok(result)
}

/// Removes a collection from the list without touching a single file.
///
/// The counterpart to opening in place: the directory belongs to the user, so
/// closing must be reversible. Keychain credentials are deliberately kept —
/// they are the only part of a linked collection that does not live in the
/// directory, and re-opening the same checkout restores them under the same id.
///
/// @param app - Tauri app handle
/// @param collection_id - The collection to close
/// @returns Ok once it is no longer listed
#[tauri::command]
pub async fn collection_close(app: AppHandle, collection_id: String) -> Result<(), String> {
    let mut linked = get_linked_collections(&app)?;
    linked.remove(&collection_id);
    save_linked_collections(&app, &linked)?;

    unregister_collection_path(&app, &collection_id)?;

    Ok(())
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

    let mut collection = read_collection_from_dir(&paths.dir)?;
    register_collection_path(&app, &collection.id, &paths.dir)?;

    // Set here rather than in the reader: linkage is store state, and the
    // reader is a pure fn(&Path) with no access to it.
    collection.linked = is_linked_collection(&app, &collection.id)?;

    Ok(collection)
}

#[tauri::command]
pub async fn collection_save(app: AppHandle, collection: Collection) -> Result<(), String> {
    persist_collection(&app, collection)?;
    Ok(())
}

#[tauri::command]
pub async fn collection_delete(app: AppHandle, collection_id: String) -> Result<(), String> {
    // Guarded here rather than only in the menu: this removes a directory
    // tree, and for a collection opened in place that directory is the user's
    // own checkout. A frontend that omits the menu item is not a safeguard.
    if is_linked_collection(&app, &collection_id)? {
        return Err(format!(
            "Collection {} was opened in place; close it instead of deleting it",
            collection_id
        ));
    }

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
    let paths = CollectionPaths::resolve(&app, &collection_id)?;

    if Layout::detect(&paths.dir) == Some(Layout::V2) {
        let loaded = read_collection_dir(&paths.dir)?;
        return Ok(ipc::find_request(&loaded, &endpoint_id)
            .map(ipc::request_to_endpoint_data)
            .unwrap_or_default());
    }

    let requests_dir = paths.requests();

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
    if Layout::detect(&paths.dir) == Some(Layout::V2) {
        let mut loaded = read_collection_dir(&paths.dir)?;
        if !apply_endpoint_data_in_tree(&mut loaded.root, &endpoint_id, &data) {
            return Err(format!("Endpoint {} not found in collection", endpoint_id));
        }
        return write::write_collection_dir(&paths.dir, &mut loaded);
    }

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
    let paths = CollectionPaths::resolve(&app, &collection_id)?;

    if Layout::detect(&paths.dir) == Some(Layout::V2) {
        let mut loaded = read_collection_dir(&paths.dir)?;
        let request_file = loaded
            .requests()
            .into_iter()
            .find(|entry| entry.doc.id == endpoint_id)
            .and_then(|entry| entry.source.clone());

        if remove_request_from_tree(&mut loaded.root, &endpoint_id) {
            write::write_collection_dir(&paths.dir, &mut loaded)?;
            if let Some(file) = request_file {
                let _ = fs::remove_file(file);
            }
        }
        return Ok(());
    }

    let requests_dir = paths.requests();

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
    let paths = CollectionPaths::resolve(&app, &collection_id)?;

    if Layout::detect(&paths.dir) == Some(Layout::V2) {
        return Ok(read_collection_dir(&paths.dir)?.variables);
    }

    let variables_file = paths.variables_json();

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

    if Layout::detect(&paths.dir) == Some(Layout::V2) {
        let mut loaded = read_collection_dir(&paths.dir)?;
        loaded.variables = variables;
        return write::write_collection_dir(&paths.dir, &mut loaded);
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

        // Gathered before the write so everything lands as one v2 tree; the
        // old code wrote v1 files afterwards, which the next save deleted.
        let endpoint_data = collect_legacy_endpoint_data(&store, &collection_id);
        let variables = collect_legacy_variables(&store, &collection_id);

        persist_imported_collection(&app, collection, variables, endpoint_data)?;

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

/// Collects a collection's per-endpoint state out of the legacy global store.
///
/// Pure: the caller writes the result as part of one v2 tree. Writing these as
/// v1 files beside a v2 tree would leave artifacts the next save deletes.
///
/// @param store - The legacy store
/// @param collection_id - The collection being migrated
/// @returns Per-endpoint state keyed by endpoint id
fn collect_legacy_endpoint_data(
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> HashMap<String, EndpointData> {
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
                if let Some(endpoint_id) = key.strip_prefix(&prefix) {
                    endpoint_ids.insert(endpoint_id.to_string());
                }
            }
        }
    }

    let mut collected = HashMap::new();

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

        if !endpoint_data.has_migrated_content() {
            continue;
        }

        if let Some(auth) = endpoint_data.auth_config.as_mut() {
            redact_auth_secrets(auth);
        }
        collected.insert(endpoint_id, endpoint_data);
    }

    collected
}

/// Collects a collection's variables out of the legacy global store.
fn collect_legacy_variables(
    store: &tauri_plugin_store::Store<tauri::Wry>,
    collection_id: &str,
) -> Vec<Value> {
    match store.get(format!("{}Variables", collection_id)) {
        Some(Value::Array(vars)) => vars,
        _ => Vec::new(),
    }
}

#[tauri::command]
pub async fn collections_get_path(app: AppHandle) -> Result<String, String> {
    let path = get_default_collections_dir(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// Current Git branch of every registered collection, keyed by collection id.
///
/// Branches also ride along on each `Collection`, but a checkout switched in a
/// terminal has to be picked up without re-reading every request file, so this
/// answers from the index alone: a few directory probes and one small read.
/// Collections outside a working tree are left out rather than reported null.
///
/// @param app - Tauri app handle
/// @returns Branch name (or short object id when HEAD is detached) per collection
#[tauri::command]
pub async fn collections_git_branches(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let index = get_collection_index(&app)?;
    let mut branches = HashMap::new();

    for (collection_id, path) in index {
        if let Some(branch) = git::branch_for_dir(Path::new(&path)) {
            branches.insert(collection_id, branch);
        }
    }

    Ok(branches)
}

/// Picks a folder.
///
/// @param app - Tauri app handle
/// @param remember - Whether to keep the pick as the default for next time.
///   The open-in-place flow passes false: it picks a *collection*, and
///   remembering it would make the next new collection default to being
///   created inside someone's checkout.
/// @returns The picked path, or None when cancelled
#[tauri::command]
pub async fn collections_pick_directory(
    app: AppHandle,
    remember: Option<bool>,
) -> Result<Option<String>, String> {
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
    if remember.unwrap_or(true) {
        save_last_collection_directory(&app, folder);
    }

    Ok(Some(folder.to_string_lossy().to_string()))
}

#[cfg(test)]
mod convert_on_save {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn v1_on_disk(dir: &Path) {
        let collection = json!({
            "id": "c1",
            "name": "Petstore",
            "baseUrl": "https://api.example.com",
            "endpoints": [
                {"id": "custom_1", "name": "Health", "method": "GET", "path": "/health"},
                {"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets"}
            ],
            "folders": [{
                "id": "folder_pets",
                "name": "pets",
                "endpoints": [
                    {"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets"}
                ]
            }],
            "defaultHeaders": {"Accept": "application/json"}
        });

        fs::write(
            dir.join("collection.json"),
            serde_json::to_string_pretty(&collection).unwrap(),
        )
        .unwrap();

        fs::write(
            dir.join("variables.json"),
            r#"[{"key":"baseUrl","value":"x"}]"#,
        )
        .unwrap();

        fs::create_dir(dir.join("requests")).unwrap();
        fs::write(
            dir.join("requests/create-pet--custom_2.json"),
            r#"{"modifiedBody":"{\"name\":\"Rex\"}","headers":[{"key":"Accept","value":"*/*"}],"pathParams":[],"queryParams":[]}"#,
        )
        .unwrap();
    }

    fn ipc_from_disk(dir: &Path) -> Collection {
        read_collection_from_dir(dir).unwrap()
    }

    #[test]
    fn a_v1_directory_is_still_read_as_v1_before_any_save() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        assert_eq!(Layout::detect(temp.path()), Some(Layout::V1));
        assert_eq!(ipc_from_disk(temp.path()).endpoints.len(), 2);
    }

    #[test]
    fn saving_converts_the_directory_to_v2() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        assert_eq!(Layout::detect(temp.path()), Some(Layout::V2));
        assert!(temp.path().join("collection.yaml").exists());
        assert!(temp.path().join("health.yaml").exists());
        assert!(temp.path().join("pets/create-pet.yaml").exists());
    }

    #[test]
    fn the_v1_files_are_removed_once_the_v2_tree_is_complete() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        assert!(!temp.path().join("collection.json").exists());
        assert!(!temp.path().join("variables.json").exists());
        assert!(!temp.path().join("requests").exists());
    }

    #[test]
    fn conversion_carries_the_per_request_state_across() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        let loaded = read_collection_dir(temp.path()).unwrap();
        let created = ipc::find_request(&loaded, "custom_2").unwrap();
        let data = ipc::request_to_endpoint_data(created);

        assert_eq!(data.modified_body.as_deref(), Some("{\"name\":\"Rex\"}"));
        assert_eq!(data.headers.len(), 1);
    }

    #[test]
    fn conversion_carries_the_variables_across() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        let loaded = read_collection_dir(temp.path()).unwrap();
        assert_eq!(loaded.variables.len(), 1);
        assert_eq!(loaded.variables[0]["key"], "baseUrl");
    }

    #[test]
    fn conversion_preserves_endpoint_ids() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        let loaded = read_collection_dir(temp.path()).unwrap();
        let ids: HashSet<_> = loaded
            .requests()
            .iter()
            .map(|entry| entry.doc.id.clone())
            .collect();

        assert!(ids.contains("custom_1"));
        assert!(ids.contains("custom_2"));
    }

    #[test]
    fn the_collection_still_reads_the_same_over_ipc_after_converting() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let before = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &before).unwrap();
        let after = ipc_from_disk(temp.path());

        assert_eq!(before.id, after.id);
        assert_eq!(before.name, after.name);
        assert_eq!(before.endpoints.len(), after.endpoints.len());
        assert_eq!(before.folders.len(), after.folders.len());
        assert_eq!(
            before.folders[0]["endpoints"].as_array().unwrap().len(),
            after.folders[0]["endpoints"].as_array().unwrap().len()
        );
    }

    /// A name already taken by a directory must not fail the write: the
    /// writer suffixes past it rather than giving up or deleting anything.
    #[test]
    fn an_obstructed_file_name_is_routed_around() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());
        fs::create_dir(temp.path().join("health.yaml")).unwrap();

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        assert!(temp.path().join("health-2.yaml").is_file());
        assert!(temp.path().join("health.yaml").is_dir());
        assert_eq!(
            read_collection_dir(temp.path()).unwrap().requests().len(),
            2
        );
    }

    /// The guarantee behind convert-on-save: until `collection.yaml` exists,
    /// the directory still reads as a complete v1 collection. Stray v2 files
    /// from an interrupted write are inert, so a crash mid-conversion costs
    /// nothing.
    ///
    /// (A simulated write failure is not used here: the writer suffixes past
    /// an obstructed name, and `restrict_dir` resets a directory's mode on
    /// every write, so neither is a reachable failure.)
    #[test]
    fn a_partial_conversion_still_reads_as_a_complete_v1_collection() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        // Some v2 files landed, but the marker never did.
        fs::write(
            temp.path().join("health.yaml"),
            "resonanceFormat: 2\nid: custom_1\nname: Health\n",
        )
        .unwrap();
        fs::create_dir(temp.path().join("pets")).unwrap();
        fs::write(
            temp.path().join("pets/create-pet.yaml"),
            "resonanceFormat: 2\nid: custom_2\nname: Create Pet\n",
        )
        .unwrap();

        assert_eq!(Layout::detect(temp.path()), Some(Layout::V1));

        let collection = ipc_from_disk(temp.path());
        assert_eq!(collection.endpoints.len(), 2);
        assert_eq!(collection.folders.len(), 1);

        // And the v1 per-request state is still the source of truth.
        let requests_dir = CollectionPaths::of(temp.path()).requests();
        let file = find_endpoint_data_file(&requests_dir, "custom_2")
            .unwrap()
            .unwrap();
        let data: EndpointData = read_json_file(&file).unwrap();
        assert_eq!(data.modified_body.as_deref(), Some("{\"name\":\"Rex\"}"));
    }

    /// The leftovers of an interrupted conversion are cleared by the next
    /// successful save, rather than lingering in both formats forever.
    #[test]
    fn an_interrupted_conversion_heals_on_the_next_save() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        // Simulate a crash after some v2 files landed but before the marker.
        fs::write(
            temp.path().join("health.yaml"),
            "resonanceFormat: 2\nid: custom_1\nname: Health\n",
        )
        .unwrap();
        assert_eq!(Layout::detect(temp.path()), Some(Layout::V1));

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        assert_eq!(Layout::detect(temp.path()), Some(Layout::V2));
        assert!(!temp.path().join("collection.json").exists());
        assert!(!temp.path().join("requests").exists());
    }

    /// Import writes a v2 tree directly. Writing its variables and per-request
    /// payloads as v1 files beside it would leave artifacts the next save
    /// deletes, taking the imported scripts and GraphQL bodies with them.
    /// The legacy store migration (v0 -> v2) used to write its endpoint data
    /// and variables as v1 files *after* the collection had already been
    /// written as a v2 tree, so the next save's cleanup deleted them. This
    /// pins that everything lands in one tree.
    #[test]
    fn a_store_migration_lands_entirely_in_the_v2_tree() {
        let temp = TempDir::new().unwrap();

        let incoming = Collection {
            id: "c1".into(),
            name: "Legacy".into(),
            base_url: String::new(),
            endpoints: vec![json!({"id": "custom_1", "name": "Health", "method": "GET"})],
            folders: vec![],
            default_headers: Value::Null,
            auth_config: None,
            open_api_spec: None,
            storage_path: None,
            storage_parent_path: None,
            linked: false,
            git_branch: None,
        };

        let mut seed = HashMap::new();
        seed.insert(
            "custom_1".to_string(),
            EndpointData {
                modified_body: Some("{\"legacy\": true}".into()),
                headers: vec![json!({"key": "X-Legacy", "value": "1"})],
                url: Some("https://legacy.example.com".into()),
                ..Default::default()
            },
        );

        write_v2_collection_seeded(
            temp.path(),
            &incoming,
            Some(vec![json!({"key": "legacyVar", "value": "kept"})]),
            &seed,
        )
        .unwrap();

        // Nothing v1-shaped was left behind for a later save to delete.
        assert!(!temp.path().join("variables.json").exists());
        assert!(!temp.path().join("requests").exists());

        // A second save must not lose anything.
        let reread = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &reread).unwrap();

        let loaded = read_collection_dir(temp.path()).unwrap();
        assert_eq!(loaded.variables.len(), 1, "variables were lost");

        let data = ipc::request_to_endpoint_data(ipc::find_request(&loaded, "custom_1").unwrap());
        assert_eq!(data.modified_body.as_deref(), Some("{\"legacy\": true}"));
        assert_eq!(data.headers.len(), 1, "headers were lost");
        assert_eq!(data.url.as_deref(), Some("https://legacy.example.com"));
    }

    #[test]
    fn a_seeded_write_leaves_no_v1_artifacts() {
        let temp = TempDir::new().unwrap();

        let incoming = Collection {
            id: "c1".into(),
            name: "Imported".into(),
            base_url: "https://api.example.com".into(),
            endpoints: vec![json!({"id": "e1", "name": "Get User", "method": "GET"})],
            folders: vec![],
            default_headers: Value::Null,
            auth_config: None,
            open_api_spec: None,
            storage_path: None,
            storage_parent_path: None,
            linked: false,
            git_branch: None,
        };

        let mut seed = HashMap::new();
        seed.insert(
            "e1".to_string(),
            EndpointData {
                scripts: Some(json!({"preRequestScript": "", "testScript": "check();"})),
                graphql_data: Some(json!({"query": "{ me }", "variables": "{}"})),
                ..Default::default()
            },
        );

        write_v2_collection_seeded(
            temp.path(),
            &incoming,
            Some(vec![
                json!({"key": "baseUrl", "value": "https://api.example.com"}),
            ]),
            &seed,
        )
        .unwrap();

        assert!(!temp.path().join("variables.json").exists());
        assert!(!temp.path().join("requests").exists());
        assert!(temp.path().join("variables.yaml").exists());

        let loaded = read_collection_dir(temp.path()).unwrap();
        assert_eq!(loaded.variables.len(), 1);

        let request = ipc::find_request(&loaded, "e1").unwrap();
        assert_eq!(request.scripts.test.as_deref(), Some("check();"));

        let data = ipc::request_to_endpoint_data(request);
        assert_eq!(data.graphql_data.unwrap()["query"], "{ me }");
    }

    /// Export must read the same content whichever layout the collection uses.
    #[test]
    fn export_sees_the_same_content_before_and_after_conversion() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let requests_dir = CollectionPaths::of(temp.path()).requests();
        let before_file = find_endpoint_data_file(&requests_dir, "custom_2")
            .unwrap()
            .unwrap();
        let before: EndpointData = read_json_file(&before_file).unwrap();

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        let loaded = read_collection_dir(temp.path()).unwrap();
        let after = ipc::request_to_endpoint_data(ipc::find_request(&loaded, "custom_2").unwrap());

        assert_eq!(before.modified_body, after.modified_body);
        assert_eq!(before.headers, after.headers);
    }

    #[test]
    fn a_second_save_is_a_no_op_on_disk() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();
        let first = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        let reread = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &reread).unwrap();
        let second = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        assert_eq!(first, second);
    }

    #[test]
    fn renaming_a_request_after_conversion_moves_only_that_file() {
        let temp = TempDir::new().unwrap();
        v1_on_disk(temp.path());

        let incoming = ipc_from_disk(temp.path());
        write_v2_collection(temp.path(), &incoming).unwrap();

        let created_before = fs::read_to_string(temp.path().join("pets/create-pet.yaml")).unwrap();

        let mut renamed = ipc_from_disk(temp.path());
        for endpoint in renamed.endpoints.iter_mut() {
            if endpoint["id"] == "custom_1" {
                endpoint["name"] = json!("Ping");
            }
        }
        write_v2_collection(temp.path(), &renamed).unwrap();

        assert!(temp.path().join("ping.yaml").exists());
        assert!(!temp.path().join("health.yaml").exists());
        assert_eq!(
            created_before,
            fs::read_to_string(temp.path().join("pets/create-pet.yaml")).unwrap(),
            "an unrelated request was rewritten"
        );
    }
}
