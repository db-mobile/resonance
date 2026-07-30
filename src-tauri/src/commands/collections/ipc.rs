//! Presenting a v2 collection over IPC in the shape the frontend expects.
//!
//! The renderer still walks a flat `endpoints` array plus one level of
//! `folders[].endpoints`, so a v2 tree is projected back into that shape on the
//! way out. The duplication is a property of this one response, not of the
//! files: on disk each request exists exactly once.
//!
//! Nested folders are flattened into their nearest top-level ancestor, because
//! the current renderer cannot draw nesting. `folderPath` carries the full
//! location so the tree UI can restore it without another format change.
#![allow(dead_code)]

use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use super::model::{Body, BodyKind, FolderDoc, RequestDoc, FORMAT_VERSION};
use super::read::{folder_display_name, FolderNode, LoadedCollection, RequestEntry};
use super::{Collection, EndpointData};

/// Inserts a key only when the value carries something.
fn insert_some(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if let Some(value) = value {
        map.insert(key.to_string(), value);
    }
}

/// Projects a request back into the v1 endpoint metadata shape.
///
/// @param doc - The request document
/// @param folder_id - Owning folder id, absent for a root-level request
/// @param folder_path - Full folder path, for a tree UI that can use it
/// @returns The endpoint as the frontend expects it
pub(crate) fn request_to_endpoint(
    doc: &RequestDoc,
    folder_id: Option<&str>,
    folder_path: &[String],
) -> Value {
    let mut endpoint = Map::new();
    endpoint.insert("id".into(), json!(doc.id));
    endpoint.insert("name".into(), json!(doc.name));

    insert_some(
        &mut endpoint,
        "protocol",
        doc.protocol.clone().map(Value::from),
    );
    insert_some(&mut endpoint, "method", doc.method.clone().map(Value::from));
    insert_some(
        &mut endpoint,
        "httpMethod",
        doc.http_method.clone().map(Value::from),
    );
    insert_some(&mut endpoint, "path", doc.path.clone().map(Value::from));
    insert_some(
        &mut endpoint,
        "description",
        doc.description.clone().map(Value::from),
    );

    insert_some(&mut endpoint, "parameters", doc.spec.parameters.clone());
    insert_some(&mut endpoint, "requestBody", doc.spec.request_body.clone());
    insert_some(&mut endpoint, "responses", doc.spec.responses.clone());

    if let Some(folder_id) = folder_id {
        endpoint.insert("folderId".into(), json!(folder_id));
    }
    if !folder_path.is_empty() {
        endpoint.insert("folderPath".into(), json!(folder_path));
    }

    Value::Object(endpoint)
}

/// Projects a request's live state back into the v1 endpoint data shape.
///
/// The three v1 body fields are mutually exclusive, so exactly one is set from
/// whichever mode the v2 body carries.
///
/// @param doc - The request document
/// @returns The endpoint data the frontend reads per request
pub(crate) fn request_to_endpoint_data(doc: &RequestDoc) -> EndpointData {
    let mut data = EndpointData {
        url: doc.url.clone(),
        auth_config: doc.auth.clone(),
        path_params: doc.params.path.clone(),
        query_params: doc.params.query.clone(),
        headers: doc.params.headers.clone(),
        response_schema: doc.response_schema.clone(),
        grpc_data: doc.grpc.clone(),
        mqtt_data: doc.mqtt.clone(),
        ..Default::default()
    };

    if !doc.scripts.is_empty() {
        data.scripts = Some(json!({
            "preRequestScript": doc.scripts.pre_request.clone().unwrap_or_default(),
            "testScript": doc.scripts.test.clone().unwrap_or_default(),
        }));
    }

    match &doc.body {
        Some(Body::Known(BodyKind::Json { content })) => {
            data.modified_body = Some(content.clone());
        }
        Some(Body::Known(BodyKind::Text { content })) => {
            data.form_body_data = Some(json!({"mode": "text", "content": content}));
        }
        Some(Body::Known(BodyKind::FormData { fields })) => {
            data.form_body_data = Some(json!({"mode": "formdata", "fields": fields}));
        }
        Some(Body::Known(BodyKind::UrlEncoded { fields })) => {
            data.form_body_data = Some(json!({"mode": "urlencoded", "fields": fields}));
        }
        Some(Body::Known(BodyKind::Binary {
            file_path,
            content_type,
        })) => {
            data.form_body_data = Some(json!({
                "mode": "binary",
                "filePath": file_path,
                "contentType": content_type,
            }));
        }
        Some(Body::Known(BodyKind::Graphql {
            query,
            variables,
            operation_name,
        })) => {
            data.graphql_data = Some(json!({
                "mode": "graphql",
                "query": query,
                "variables": variables,
                "operationName": operation_name,
            }));
        }
        Some(Body::Other(value)) => {
            data.form_body_data = Some(value.clone());
        }
        None => {}
    }

    data
}

/// Builds one folder entry, recursing into its subfolders.
///
/// Each folder carries its own `endpoints` and a nested `folders`, so the
/// renderer can walk the tree without a second lookup.
fn folder_to_ipc(node: &FolderNode, path: &mut Vec<String>, flat: &mut Vec<Value>) -> Value {
    let id = folder_id(node);
    let name = folder_display_name(node);

    let mut endpoints = Vec::new();
    for entry in &node.requests {
        let endpoint = request_to_endpoint(&entry.doc, Some(&id), path);
        flat.push(endpoint.clone());
        endpoints.push(endpoint);
    }

    let mut children = Vec::new();
    for child in &node.folders {
        path.push(folder_display_name(child));
        children.push(folder_to_ipc(child, path, flat));
        path.pop();
    }

    let mut entry = Map::new();
    entry.insert("id".into(), json!(id));
    entry.insert("name".into(), json!(name));
    entry.insert("endpoints".into(), Value::Array(endpoints));
    if !children.is_empty() {
        entry.insert("folders".into(), Value::Array(children));
    }
    if let Some(meta) = &node.meta {
        insert_some(&mut entry, "authConfig", meta.auth.clone());
    }

    Value::Object(entry)
}

/// A folder's id: its own metadata when present, else derived from its name so
/// expansion state and auth scopes stay stable for a hand-made directory.
fn folder_id(folder: &FolderNode) -> String {
    if let Some(meta) = &folder.meta {
        if !meta.id.is_empty() {
            return meta.id.clone();
        }
    }
    format!(
        "folder_{}",
        folder_display_name(folder)
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect::<String>()
    )
}

/// Projects a loaded v2 collection into the IPC shape.
///
/// @param loaded - The collection as read from disk
/// @param storage_path - Absolute directory, set for this response only
/// @param linked - True when this collection was opened in place
/// @returns The collection as the frontend expects it
pub(crate) fn to_ipc_collection(
    loaded: &LoadedCollection,
    storage_path: &str,
    linked: bool,
) -> Collection {
    let mut endpoints = Vec::new();
    let mut folders = Vec::new();

    for entry in &loaded.root.requests {
        endpoints.push(request_to_endpoint(&entry.doc, None, &[]));
    }

    for folder in &loaded.root.folders {
        let mut path = vec![folder_display_name(folder)];
        // The renderer reads folders[].endpoints; everything else walks the
        // flat list, so a foldered request is present in both.
        folders.push(folder_to_ipc(folder, &mut path, &mut endpoints));
    }

    Collection {
        id: loaded.meta.id.clone(),
        name: loaded.meta.name.clone(),
        base_url: loaded.meta.base_url.clone(),
        endpoints,
        folders,
        default_headers: loaded
            .meta
            .default_headers
            .clone()
            .unwrap_or(Value::Object(Map::new())),
        auth_config: loaded.meta.auth.clone(),
        open_api_spec: loaded.open_api_spec.clone(),
        storage_path: Some(storage_path.to_string()),
        storage_parent_path: None,
        linked,
    }
}

/// Reads a string off an IPC endpoint, treating blank as absent.
fn ipc_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Applies the metadata half of an IPC endpoint onto a request document.
///
/// Only the fields `collection_save` actually carries are touched. A request's
/// live state — body, params, auth, scripts — arrives through
/// `collection_save_endpoint_data` and must survive a structural save
/// untouched, or editing a folder name would wipe every request in it.
fn overlay_metadata(doc: &mut RequestDoc, endpoint: &Value) {
    if let Some(name) = ipc_string(endpoint, "name") {
        doc.name = name;
    }
    doc.protocol = ipc_string(endpoint, "protocol").or(doc.protocol.take());
    doc.method = ipc_string(endpoint, "method").or(doc.method.take());
    doc.http_method = ipc_string(endpoint, "httpMethod").or(doc.http_method.take());
    doc.path = ipc_string(endpoint, "path").or(doc.path.take());
    doc.description = ipc_string(endpoint, "description").or(doc.description.take());

    if let Some(parameters) = endpoint.get("parameters").filter(|v| !v.is_null()) {
        doc.spec.parameters = Some(parameters.clone());
    }
    if let Some(request_body) = endpoint.get("requestBody").filter(|v| !v.is_null()) {
        doc.spec.request_body = Some(request_body.clone());
    }
    if let Some(responses) = endpoint.get("responses").filter(|v| !v.is_null()) {
        doc.spec.responses = Some(responses.clone());
    }
}

/// Indexes an existing tree by request id, so a save can start from what is
/// already on disk rather than from an empty document.
fn index_requests(loaded: &LoadedCollection) -> HashMap<String, RequestEntry> {
    loaded
        .requests()
        .into_iter()
        .map(|entry| (entry.doc.id.clone(), entry.clone()))
        .collect()
}

/// Indexes an existing tree's folders by id, to keep their directories.
fn index_folders(node: &FolderNode, out: &mut HashMap<String, FolderNode>) {
    for folder in &node.folders {
        if let Some(meta) = &folder.meta {
            out.insert(meta.id.clone(), folder.clone());
        }
        index_folders(folder, out);
    }
}

/// Builds one request entry, preserving whatever is already on disk for it.
fn entry_for(endpoint: &Value, existing: &HashMap<String, RequestEntry>) -> Option<RequestEntry> {
    let id = ipc_string(endpoint, "id")?;

    let mut entry = existing.get(&id).cloned().unwrap_or_else(|| {
        RequestEntry::new(RequestDoc::new(
            id.clone(),
            ipc_string(endpoint, "name").unwrap_or_else(|| id.clone()),
        ))
    });

    overlay_metadata(&mut entry.doc, endpoint);
    Some(entry)
}

/// Rebuilds the on-disk tree from an IPC collection, carried over the state
/// already stored for each request.
///
/// The IPC shape duplicates a foldered request into the flat list, so an
/// endpoint claimed by a folder is skipped at the root.
///
/// @param incoming - The collection as the frontend sent it
/// @param existing - What is currently on disk, if anything
/// @returns The root folder of the tree to write
pub(crate) fn tree_from_ipc(
    incoming: &Collection,
    existing: Option<&LoadedCollection>,
) -> FolderNode {
    let existing_requests = existing.map(index_requests).unwrap_or_default();

    let mut existing_folders = HashMap::new();
    if let Some(loaded) = existing {
        index_folders(&loaded.root, &mut existing_folders);
    }

    let mut foldered_ids = HashSet::new();
    collect_foldered_ids(&incoming.folders, &mut foldered_ids);

    let mut root = FolderNode {
        source: existing.and_then(|l| l.root.source.clone()),
        ..Default::default()
    };

    for endpoint in &incoming.endpoints {
        let Some(id) = ipc_string(endpoint, "id") else {
            continue;
        };
        if foldered_ids.contains(&id) {
            continue;
        }
        if let Some(entry) = entry_for(endpoint, &existing_requests) {
            root.requests.push(entry);
        }
    }

    renumber_if_reordered(&mut root.requests, existing.map(|loaded| &loaded.root));

    for folder in &incoming.folders {
        if let Some(node) = folder_from_ipc(folder, &existing_requests, &existing_folders) {
            root.folders.push(node);
        }
    }

    root
}

/// Renumbers a folder's requests when the incoming order differs from the one
/// already on disk.
///
/// Reordering is the only thing that may rewrite `seq`. Renumbering on every
/// save would touch every sibling file each time, which is exactly the churn
/// this format exists to avoid; never renumbering would silently discard a
/// reorder, because the wire carries no `seq` and the reader sorts by it.
///
/// @param requests - The requests in their incoming order
/// @param existing - The folder as it currently sits on disk, if any
fn renumber_if_reordered(requests: &mut [RequestEntry], existing: Option<&FolderNode>) {
    let previous: Vec<&str> = existing
        .map(|folder| {
            folder
                .requests
                .iter()
                .map(|entry| entry.doc.id.as_str())
                .collect()
        })
        .unwrap_or_default();

    let incoming: Vec<&str> = requests.iter().map(|entry| entry.doc.id.as_str()).collect();

    // Only an actual reorder counts. An add or a delete leaves the surviving
    // requests in their relative order, and those keep their numbers.
    let previous_surviving: Vec<&str> = previous
        .iter()
        .filter(|id| incoming.contains(id))
        .copied()
        .collect();
    let incoming_known: Vec<&str> = incoming
        .iter()
        .filter(|id| previous.contains(id))
        .copied()
        .collect();

    if previous_surviving == incoming_known {
        return;
    }

    for (index, entry) in requests.iter_mut().enumerate() {
        entry.doc.seq = (index as i64 + 1) * 10;
    }
}

/// Gathers every request id any folder claims, at any depth.
fn collect_foldered_ids(folders: &[Value], out: &mut HashSet<String>) {
    for folder in folders {
        if let Some(endpoints) = folder.get("endpoints").and_then(|e| e.as_array()) {
            for endpoint in endpoints {
                if let Some(id) = ipc_string(endpoint, "id") {
                    out.insert(id);
                }
            }
        }
        if let Some(children) = folder.get("folders").and_then(|f| f.as_array()) {
            collect_foldered_ids(children, out);
        }
    }
}

/// Rebuilds one folder and everything under it, keeping the directory and
/// metadata it already had on disk.
fn folder_from_ipc(
    folder: &Value,
    existing_requests: &HashMap<String, RequestEntry>,
    existing_folders: &HashMap<String, FolderNode>,
) -> Option<FolderNode> {
    let folder_id = ipc_string(folder, "id")?;
    let previous = existing_folders.get(&folder_id);

    let mut node = FolderNode {
        meta: Some(FolderDoc {
            format: FORMAT_VERSION,
            id: folder_id.clone(),
            name: ipc_string(folder, "name").unwrap_or_else(|| folder_id.clone()),
            seq: previous.and_then(|f| f.meta.as_ref()).map_or(0, |m| m.seq),
            auth: folder
                .get("authConfig")
                .filter(|v| v.is_object())
                .cloned()
                .or_else(|| {
                    previous
                        .and_then(|f| f.meta.as_ref())
                        .and_then(|m| m.auth.clone())
                }),
            extra: Map::new(),
        }),
        source: previous.and_then(|f| f.source.clone()),
        requests: Vec::new(),
        folders: Vec::new(),
    };

    if let Some(endpoints) = folder.get("endpoints").and_then(|e| e.as_array()) {
        for endpoint in endpoints {
            if let Some(entry) = entry_for(endpoint, existing_requests) {
                node.requests.push(entry);
            }
        }
    }

    renumber_if_reordered(&mut node.requests, previous);

    if let Some(children) = folder.get("folders").and_then(|f| f.as_array()) {
        for child in children {
            if let Some(child_node) = folder_from_ipc(child, existing_requests, existing_folders) {
                node.folders.push(child_node);
            }
        }
    }

    Some(node)
}

/// Applies the frontend's per-request data onto a request document.
///
/// The inverse of `request_to_endpoint_data`: this is what a
/// `collection_save_endpoint_data` call writes into the request's own file.
///
/// @param doc - The request document to update
/// @param data - The data the frontend sent
pub(crate) fn apply_endpoint_data(doc: &mut RequestDoc, data: &EndpointData) {
    doc.url = data.url.clone().filter(|u| !u.is_empty());
    doc.auth = data.auth_config.clone().filter(|a| !a.is_null());
    doc.params.path = data.path_params.clone();
    doc.params.query = data.query_params.clone();
    doc.params.headers = data.headers.clone();
    doc.grpc = data.grpc_data.clone().filter(|v| !v.is_null());
    doc.mqtt = data.mqtt_data.clone().filter(|v| !v.is_null());
    doc.response_schema = data.response_schema.clone().filter(|v| !v.is_null());
    doc.scripts = super::legacy::scripts_from_v1(data.scripts.as_ref());
    doc.body = super::legacy::body_from_v1(data);
}

/// Finds one request in a loaded collection.
pub(crate) fn find_request<'a>(
    loaded: &'a LoadedCollection,
    request_id: &str,
) -> Option<&'a RequestDoc> {
    loaded
        .requests()
        .into_iter()
        .find(|entry| entry.doc.id == request_id)
        .map(|entry| &entry.doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::collections::legacy::v1_to_v2;
    use crate::commands::collections::model::{FolderDoc, FORMAT_VERSION};
    use crate::commands::collections::read::{read_collection_dir, Layout, RequestEntry};
    use crate::commands::collections::write::write_collection_dir;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn request(id: &str, name: &str) -> RequestEntry {
        RequestEntry::new(RequestDoc::new(id.into(), name.into()))
    }

    fn folder(id: &str, name: &str, requests: Vec<RequestEntry>) -> FolderNode {
        FolderNode {
            meta: Some(FolderDoc {
                format: FORMAT_VERSION,
                id: id.into(),
                name: name.into(),
                seq: 0,
                auth: None,
                extra: Map::new(),
            }),
            source: None,
            requests,
            folders: Vec::new(),
        }
    }

    fn loaded(root: FolderNode) -> LoadedCollection {
        LoadedCollection {
            meta: crate::commands::collections::model::CollectionDoc {
                format: FORMAT_VERSION,
                id: "c1".into(),
                name: "Petstore".into(),
                base_url: "https://api.example.com".into(),
                description: None,
                default_headers: None,
                auth: None,
                open_api_spec: None,
                extra: Map::new(),
            },
            open_api_spec: None,
            variables: Vec::new(),
            root,
            layout: Layout::V2,
        }
    }

    #[test]
    fn root_requests_appear_in_the_flat_list() {
        let collection = loaded(FolderNode {
            requests: vec![request("r1", "Health")],
            ..Default::default()
        });

        let ipc = to_ipc_collection(&collection, "/tmp/x", false);

        assert_eq!(ipc.endpoints.len(), 1);
        assert_eq!(ipc.endpoints[0]["id"], "r1");
        assert!(ipc.folders.is_empty());
    }

    /// The renderer reads folders[].endpoints and everything else reads the
    /// flat list, so a foldered request must be visible in both, exactly as v1
    /// presented it.
    #[test]
    fn a_foldered_request_appears_in_both_views() {
        let collection = loaded(FolderNode {
            folders: vec![folder("f1", "pets", vec![request("r1", "List")])],
            ..Default::default()
        });

        let ipc = to_ipc_collection(&collection, "/tmp/x", false);

        assert_eq!(ipc.endpoints.len(), 1);
        assert_eq!(ipc.folders.len(), 1);
        assert_eq!(ipc.folders[0]["endpoints"].as_array().unwrap().len(), 1);
        assert_eq!(ipc.folders[0]["endpoints"][0]["id"], "r1");
    }

    /// Nesting reaches the frontend as nested folder entries, each holding
    /// only its own requests.
    #[test]
    fn a_nested_folder_is_carried_as_a_child_entry() {
        let mut outer = folder("outer", "outer", vec![request("r1", "Shallow")]);
        outer
            .folders
            .push(folder("inner", "inner", vec![request("r2", "Deep")]));

        let ipc = to_ipc_collection(
            &loaded(FolderNode {
                folders: vec![outer],
                ..Default::default()
            }),
            "/tmp/x",
            false,
        );

        let top = &ipc.folders[0];
        assert_eq!(top["endpoints"].as_array().unwrap().len(), 1);
        assert_eq!(top["endpoints"][0]["id"], "r1");

        let child = &top["folders"][0];
        assert_eq!(child["id"], "inner");
        assert_eq!(child["endpoints"].as_array().unwrap().len(), 1);
        assert_eq!(child["endpoints"][0]["id"], "r2");
    }

    /// Every request still appears once in the flat list, however deep it sits,
    /// because that is what the runner, docs and mock server walk.
    #[test]
    fn a_nested_request_still_reaches_the_flat_list() {
        let mut outer = folder("outer", "outer", vec![request("r1", "Shallow")]);
        outer
            .folders
            .push(folder("inner", "inner", vec![request("r2", "Deep")]));

        let ipc = to_ipc_collection(
            &loaded(FolderNode {
                folders: vec![outer],
                ..Default::default()
            }),
            "/tmp/x",
            false,
        );

        let ids: Vec<_> = ipc
            .endpoints
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect();

        assert_eq!(ids, vec!["r1".to_string(), "r2".to_string()]);
    }

    #[test]
    fn a_folder_with_no_children_omits_the_nested_key() {
        let ipc = to_ipc_collection(
            &loaded(FolderNode {
                folders: vec![folder("f1", "pets", vec![request("r1", "X")])],
                ..Default::default()
            }),
            "/tmp/x",
            false,
        );

        assert!(ipc.folders[0].get("folders").is_none());
    }

    #[test]
    fn a_nested_request_reports_its_full_folder_path() {
        let mut outer = folder("outer", "outer", vec![]);
        outer
            .folders
            .push(folder("inner", "inner", vec![request("r1", "Deep")]));

        let ipc = to_ipc_collection(
            &loaded(FolderNode {
                folders: vec![outer],
                ..Default::default()
            }),
            "/tmp/x",
            false,
        );

        let endpoint = &ipc.folders[0]["folders"][0]["endpoints"][0];
        assert_eq!(endpoint["folderPath"], json!(["outer", "inner"]));
        assert_eq!(endpoint["folderId"], "inner");
    }

    /// A nested tree must survive a trip out to the frontend and back.
    #[test]
    fn nesting_survives_a_round_trip_through_the_ipc_shape() {
        let mut outer = folder("outer", "outer", vec![request("r1", "Shallow")]);
        outer
            .folders
            .push(folder("inner", "inner", vec![request("r2", "Deep")]));

        let original = loaded(FolderNode {
            folders: vec![outer],
            ..Default::default()
        });

        let ipc = to_ipc_collection(&original, "/tmp/x", false);
        let rebuilt = tree_from_ipc(&ipc, Some(&original));

        assert_eq!(rebuilt.folders.len(), 1);
        assert_eq!(rebuilt.folders[0].requests.len(), 1);
        assert_eq!(rebuilt.folders[0].folders.len(), 1);
        assert_eq!(rebuilt.folders[0].folders[0].requests[0].doc.id, "r2");
        assert!(
            rebuilt.requests.is_empty(),
            "nothing should land at the root"
        );
    }

    #[test]
    fn a_folder_without_metadata_gets_a_stable_derived_id() {
        let node = FolderNode {
            meta: None,
            source: Some(std::path::PathBuf::from("/tmp/c/pets")),
            requests: vec![request("r1", "X")],
            folders: Vec::new(),
        };

        let ipc = to_ipc_collection(
            &loaded(FolderNode {
                folders: vec![node],
                ..Default::default()
            }),
            "/tmp/c",
            false,
        );

        assert_eq!(ipc.folders[0]["id"], "folder_pets");
        assert_eq!(ipc.folders[0]["name"], "pets");
    }

    #[test]
    fn collection_metadata_reaches_the_frontend() {
        let ipc = to_ipc_collection(&loaded(FolderNode::default()), "/tmp/petstore", false);

        assert_eq!(ipc.id, "c1");
        assert_eq!(ipc.name, "Petstore");
        assert_eq!(ipc.base_url, "https://api.example.com");
        assert_eq!(ipc.storage_path.as_deref(), Some("/tmp/petstore"));
    }

    #[test]
    fn a_request_with_nothing_set_carries_no_empty_keys() {
        let endpoint = request_to_endpoint(&RequestDoc::new("r1".into(), "X".into()), None, &[]);
        let map = endpoint.as_object().unwrap();

        assert_eq!(
            map.len(),
            2,
            "expected only id and name, got {:?}",
            map.keys().collect::<Vec<_>>()
        );
    }

    mod endpoint_data {
        use super::*;
        use crate::commands::collections::model::{Body, BodyKind};

        fn data_for(body: Body) -> EndpointData {
            let mut doc = RequestDoc::new("r1".into(), "X".into());
            doc.body = Some(body);
            request_to_endpoint_data(&doc)
        }

        #[test]
        fn a_json_body_becomes_the_modified_body_field() {
            let data = data_for(Body::Known(BodyKind::Json {
                content: "{}".into(),
            }));

            assert_eq!(data.modified_body.as_deref(), Some("{}"));
            assert!(data.form_body_data.is_none());
            assert!(data.graphql_data.is_none());
        }

        #[test]
        fn a_graphql_body_becomes_the_graphql_field() {
            let data = data_for(Body::Known(BodyKind::Graphql {
                query: "{ me }".into(),
                variables: "{}".into(),
                operation_name: Some("Me".into()),
            }));

            let graphql = data.graphql_data.unwrap();
            assert_eq!(graphql["query"], "{ me }");
            assert_eq!(graphql["mode"], "graphql");
            assert!(data.modified_body.is_none());
        }

        #[test]
        fn every_form_mode_becomes_the_form_body_field() {
            let cases = vec![
                (
                    BodyKind::Text {
                        content: "t".into(),
                    },
                    "text",
                ),
                (BodyKind::FormData { fields: vec![] }, "formdata"),
                (BodyKind::UrlEncoded { fields: vec![] }, "urlencoded"),
                (
                    BodyKind::Binary {
                        file_path: "/x".into(),
                        content_type: "application/octet-stream".into(),
                    },
                    "binary",
                ),
            ];

            for (kind, mode) in cases {
                let data = data_for(Body::Known(kind));
                assert_eq!(data.form_body_data.unwrap()["mode"], mode);
            }
        }

        #[test]
        fn scripts_are_named_as_the_frontend_expects() {
            let mut doc = RequestDoc::new("r1".into(), "X".into());
            doc.scripts.test = Some("expect(1).toBe(1);".into());

            let scripts = request_to_endpoint_data(&doc).scripts.unwrap();
            assert_eq!(scripts["testScript"], "expect(1).toBe(1);");
            assert_eq!(scripts["preRequestScript"], "");
        }

        #[test]
        fn a_request_without_scripts_reports_none() {
            let doc = RequestDoc::new("r1".into(), "X".into());
            assert!(request_to_endpoint_data(&doc).scripts.is_none());
        }
    }

    /// The step-9 promise: a v2 directory written by a teammate opens
    /// correctly in a build that still writes v1.
    #[test]
    fn a_v2_directory_on_disk_reads_back_through_the_ipc_shape() {
        let v1 = Collection {
            id: "c1".into(),
            name: "Petstore".into(),
            base_url: "https://api.example.com".into(),
            endpoints: vec![
                json!({"id": "custom_1", "name": "Health", "method": "GET", "path": "/health"}),
                json!({"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets"}),
            ],
            folders: vec![json!({
                "id": "folder_pets",
                "name": "pets",
                "endpoints": [{"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets"}]
            })],
            default_headers: json!({"Accept": "application/json"}),
            auth_config: None,
            open_api_spec: None,
            storage_path: None,
            storage_parent_path: None,
            linked: false,
        };

        let mut data = HashMap::new();
        data.insert(
            "custom_2".to_string(),
            EndpointData {
                modified_body: Some("{\"name\": \"Rex\"}".into()),
                headers: vec![json!({"key": "Accept", "value": "*/*"})],
                ..Default::default()
            },
        );

        let temp = TempDir::new().unwrap();
        let mut converted = v1_to_v2(&v1, &data);
        write_collection_dir(temp.path(), &mut converted).unwrap();

        let reread = read_collection_dir(temp.path()).unwrap();
        let ipc = to_ipc_collection(&reread, &temp.path().to_string_lossy(), false);

        assert_eq!(ipc.id, "c1");
        assert_eq!(ipc.default_headers["Accept"], "application/json");

        // Both requests are reachable, and the foldered one is in both views.
        assert_eq!(ipc.endpoints.len(), 2);
        assert_eq!(ipc.folders.len(), 1);
        assert_eq!(ipc.folders[0]["endpoints"].as_array().unwrap().len(), 1);
        assert_eq!(ipc.folders[0]["endpoints"][0]["id"], "custom_2");

        // The per-request data survives the trip through the files.
        let request = find_request(&reread, "custom_2").unwrap();
        let endpoint_data = request_to_endpoint_data(request);
        assert_eq!(
            endpoint_data.modified_body.as_deref(),
            Some("{\"name\": \"Rex\"}")
        );
        assert_eq!(endpoint_data.headers.len(), 1);
    }
}

#[cfg(test)]
mod save_path {
    use super::*;
    use crate::commands::collections::model::{Body, BodyKind, FORMAT_VERSION};
    use crate::commands::collections::read::{Layout, RequestEntry};

    fn existing_with_state() -> LoadedCollection {
        let mut doc = RequestDoc::new("r1".into(), "Create Pet".into());
        doc.seq = 30;
        doc.body = Some(Body::Known(BodyKind::Json {
            content: "{\"name\": \"Rex\"}".into(),
        }));
        doc.params.headers = vec![json!({"key": "Accept", "value": "*/*"})];
        doc.auth = Some(json!({"type": "bearer", "config": {"token": ""}}));
        doc.scripts.test = Some("expect(1).toBe(1);".into());

        LoadedCollection {
            meta: crate::commands::collections::model::CollectionDoc {
                format: FORMAT_VERSION,
                id: "c1".into(),
                name: "P".into(),
                base_url: String::new(),
                description: None,
                default_headers: None,
                auth: None,
                open_api_spec: None,
                extra: Map::new(),
            },
            open_api_spec: None,
            variables: Vec::new(),
            root: FolderNode {
                requests: vec![RequestEntry::new(doc)],
                ..Default::default()
            },
            layout: Layout::V2,
        }
    }

    fn ipc_collection(endpoints: Vec<Value>, folders: Vec<Value>) -> Collection {
        Collection {
            id: "c1".into(),
            name: "P".into(),
            base_url: String::new(),
            endpoints,
            folders,
            default_headers: Value::Null,
            auth_config: None,
            open_api_spec: None,
            storage_path: None,
            storage_parent_path: None,
            linked: false,
        }
    }

    /// collection_save carries structure only. If it overwrote per-request
    /// state, renaming a request would blank its body, headers and credentials.
    #[test]
    fn a_structural_save_preserves_every_request_body_and_credential() {
        let existing = existing_with_state();
        let incoming = ipc_collection(
            vec![json!({"id": "r1", "name": "Renamed", "method": "POST", "path": "/pets"})],
            vec![],
        );

        let root = tree_from_ipc(&incoming, Some(&existing));
        let doc = &root.requests[0].doc;

        assert_eq!(doc.name, "Renamed", "the rename should apply");
        assert_eq!(doc.method.as_deref(), Some("POST"));

        assert!(
            matches!(&doc.body, Some(Body::Known(BodyKind::Json { content })) if content == "{\"name\": \"Rex\"}")
        );
        assert_eq!(doc.params.headers.len(), 1);
        assert_eq!(doc.auth.as_ref().unwrap()["type"], "bearer");
        assert_eq!(doc.scripts.test.as_deref(), Some("expect(1).toBe(1);"));
    }

    #[test]
    fn a_structural_save_preserves_seq() {
        let existing = existing_with_state();
        let incoming = ipc_collection(vec![json!({"id": "r1", "name": "Create Pet"})], vec![]);

        let root = tree_from_ipc(&incoming, Some(&existing));
        assert_eq!(root.requests[0].doc.seq, 30);
    }

    #[test]
    fn a_structural_save_keeps_the_file_a_request_already_owns() {
        let mut existing = existing_with_state();
        existing.root.requests[0].source = Some(std::path::PathBuf::from("/c/create-pet.yaml"));

        let incoming = ipc_collection(vec![json!({"id": "r1", "name": "Create Pet"})], vec![]);
        let root = tree_from_ipc(&incoming, Some(&existing));

        assert_eq!(
            root.requests[0].source.as_ref().unwrap(),
            &std::path::PathBuf::from("/c/create-pet.yaml")
        );
    }

    #[test]
    fn a_brand_new_request_is_created_from_the_payload_alone() {
        let incoming = ipc_collection(
            vec![json!({"id": "new1", "name": "Fresh", "method": "GET", "path": "/x"})],
            vec![],
        );

        let root = tree_from_ipc(&incoming, None);

        assert_eq!(root.requests[0].doc.name, "Fresh");
        assert_eq!(root.requests[0].doc.method.as_deref(), Some("GET"));
        assert!(root.requests[0].source.is_none());
    }

    /// The IPC shape duplicates a foldered request into the flat list; the
    /// tree must file it once, in its folder.
    #[test]
    fn a_request_duplicated_across_both_views_lands_once() {
        let endpoint = json!({"id": "r1", "name": "List"});
        let incoming = ipc_collection(
            vec![endpoint.clone()],
            vec![json!({"id": "f1", "name": "pets", "endpoints": [endpoint]})],
        );

        let root = tree_from_ipc(&incoming, None);

        assert!(
            root.requests.is_empty(),
            "it should not also sit at the root"
        );
        assert_eq!(root.folders[0].requests.len(), 1);
    }

    #[test]
    fn moving_a_request_out_of_a_folder_keeps_its_state() {
        let mut existing = existing_with_state();
        existing.root.folders.push(FolderNode {
            meta: Some(crate::commands::collections::model::FolderDoc {
                format: FORMAT_VERSION,
                id: "f1".into(),
                name: "pets".into(),
                seq: 10,
                auth: None,
                extra: Map::new(),
            }),
            source: None,
            requests: vec![existing.root.requests.remove(0)],
            folders: Vec::new(),
        });

        let incoming = ipc_collection(vec![json!({"id": "r1", "name": "Create Pet"})], vec![]);
        let root = tree_from_ipc(&incoming, Some(&existing));

        assert_eq!(root.requests.len(), 1);
        assert!(
            root.requests[0].doc.body.is_some(),
            "the body was lost in the move"
        );
    }

    #[test]
    fn folder_auth_and_directory_survive_a_rename() {
        let mut existing = existing_with_state();
        existing.root.folders.push(FolderNode {
            meta: Some(crate::commands::collections::model::FolderDoc {
                format: FORMAT_VERSION,
                id: "f1".into(),
                name: "pets".into(),
                seq: 40,
                auth: Some(json!({"type": "bearer", "config": {"token": ""}})),
                extra: Map::new(),
            }),
            source: Some(std::path::PathBuf::from("/c/pets")),
            requests: Vec::new(),
            folders: Vec::new(),
        });

        let incoming = ipc_collection(
            vec![],
            vec![json!({"id": "f1", "name": "animals", "endpoints": []})],
        );
        let root = tree_from_ipc(&incoming, Some(&existing));
        let meta = root.folders[0].meta.as_ref().unwrap();

        assert_eq!(meta.name, "animals");
        assert_eq!(meta.seq, 40);
        assert!(meta.auth.is_some(), "folder auth was dropped");
        assert_eq!(
            root.folders[0].source.as_ref().unwrap(),
            &std::path::PathBuf::from("/c/pets")
        );
    }

    mod reordering {
        use super::*;

        fn existing_three() -> LoadedCollection {
            let mut c = existing_with_state();
            c.root.requests.clear();
            for (index, id) in ["a", "b", "c"].iter().enumerate() {
                let mut doc = RequestDoc::new((*id).into(), id.to_uppercase());
                doc.seq = (index as i64 + 1) * 10;
                c.root.requests.push(RequestEntry::new(doc));
            }
            c
        }

        fn endpoint(id: &str) -> Value {
            json!({"id": id, "name": id.to_uppercase()})
        }

        fn seqs(root: &FolderNode) -> Vec<(String, i64)> {
            root.requests
                .iter()
                .map(|e| (e.doc.id.clone(), e.doc.seq))
                .collect()
        }

        #[test]
        fn an_unchanged_order_keeps_every_seq() {
            let existing = existing_three();
            let incoming =
                ipc_collection(vec![endpoint("a"), endpoint("b"), endpoint("c")], vec![]);

            let root = tree_from_ipc(&incoming, Some(&existing));

            assert_eq!(
                seqs(&root),
                vec![("a".into(), 10), ("b".into(), 20), ("c".into(), 30)]
            );
        }

        /// Without this, a reorder would be silently discarded: the wire has
        /// no seq, and the reader sorts by it.
        #[test]
        fn a_reorder_renumbers_the_folder() {
            let existing = existing_three();
            let incoming =
                ipc_collection(vec![endpoint("c"), endpoint("a"), endpoint("b")], vec![]);

            let root = tree_from_ipc(&incoming, Some(&existing));

            assert_eq!(
                seqs(&root),
                vec![("c".into(), 10), ("a".into(), 20), ("b".into(), 30)]
            );
        }

        #[test]
        fn adding_a_request_does_not_renumber_the_existing_ones() {
            let existing = existing_three();
            let incoming = ipc_collection(
                vec![endpoint("a"), endpoint("b"), endpoint("c"), endpoint("d")],
                vec![],
            );

            let root = tree_from_ipc(&incoming, Some(&existing));
            let result = seqs(&root);

            assert_eq!(result[0], ("a".to_string(), 10));
            assert_eq!(result[1], ("b".to_string(), 20));
            assert_eq!(result[2], ("c".to_string(), 30));
            assert_eq!(result[3].0, "d");
        }

        #[test]
        fn deleting_a_request_does_not_renumber_the_survivors() {
            let existing = existing_three();
            let incoming = ipc_collection(vec![endpoint("a"), endpoint("c")], vec![]);

            let root = tree_from_ipc(&incoming, Some(&existing));

            assert_eq!(seqs(&root), vec![("a".into(), 10), ("c".into(), 30)]);
        }

        #[test]
        fn a_reorder_inside_a_folder_renumbers_only_that_folder() {
            let mut existing = existing_three();
            let moved = existing.root.requests.split_off(1);
            existing.root.folders.push(FolderNode {
                meta: Some(crate::commands::collections::model::FolderDoc {
                    format: FORMAT_VERSION,
                    id: "f1".into(),
                    name: "pets".into(),
                    seq: 10,
                    auth: None,
                    extra: Map::new(),
                }),
                source: None,
                requests: moved,
                folders: Vec::new(),
            });

            let incoming = ipc_collection(
                vec![endpoint("a"), endpoint("c"), endpoint("b")],
                vec![json!({
                    "id": "f1",
                    "name": "pets",
                    "endpoints": [endpoint("c"), endpoint("b")]
                })],
            );

            let root = tree_from_ipc(&incoming, Some(&existing));

            assert_eq!(
                seqs(&root),
                vec![("a".into(), 10)],
                "the root was renumbered"
            );
            assert_eq!(
                seqs(&root.folders[0]),
                vec![("c".into(), 10), ("b".into(), 20)]
            );
        }
    }

    #[test]
    fn endpoint_data_round_trips_through_apply_and_project() {
        let mut doc = RequestDoc::new("r1".into(), "X".into());

        let data = EndpointData {
            url: Some("https://api.example.com/x".into()),
            headers: vec![json!({"key": "Accept", "value": "*/*"})],
            query_params: vec![json!({"key": "page", "value": "1"})],
            modified_body: Some("{\"a\": 1}".into()),
            auth_config: Some(json!({"type": "bearer", "config": {"token": ""}})),
            scripts: Some(json!({"preRequestScript": "pre();", "testScript": "test();"})),
            ..Default::default()
        };

        apply_endpoint_data(&mut doc, &data);
        let projected = request_to_endpoint_data(&doc);

        assert_eq!(projected.url, data.url);
        assert_eq!(projected.headers, data.headers);
        assert_eq!(projected.query_params, data.query_params);
        assert_eq!(projected.modified_body, data.modified_body);
        assert_eq!(projected.auth_config, data.auth_config);
        assert_eq!(projected.scripts.unwrap()["testScript"], "test();");
    }

    #[test]
    fn applying_endpoint_data_leaves_the_metadata_alone() {
        let mut doc = RequestDoc::new("r1".into(), "Named".into());
        doc.seq = 70;
        doc.method = Some("POST".into());

        apply_endpoint_data(&mut doc, &EndpointData::default());

        assert_eq!(doc.name, "Named");
        assert_eq!(doc.seq, 70);
        assert_eq!(doc.method.as_deref(), Some("POST"));
    }
}
