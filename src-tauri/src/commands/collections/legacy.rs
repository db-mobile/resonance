//! Converting a v1 collection into the v2 model.
//!
//! v1 kept a request's metadata in the shared `collection.json` and its actual
//! values in `requests/<slug>--<id>.json`, with foldered requests duplicated
//! into a flat `endpoints` array. This module rejoins those halves into one
//! document per request and turns the folder array into a tree.
//!
//! The conversion is pure: it takes parsed v1 data and returns the v2 model,
//! touching no filesystem and needing no AppHandle, which is what keeps its
//! tests cheap.
#![allow(dead_code)]

use serde_json::{Map, Value};
use std::collections::HashMap;

use super::model::{
    Body, BodyKind, CollectionDoc, FolderDoc, Params, RequestDoc, Scripts, Spec, FORMAT_VERSION,
};
use super::read::{FolderNode, Layout, LoadedCollection, RequestEntry};
use super::{Collection, EndpointData};

/// Gap between generated `seq` values, matching the writer's step.
const SEQ_STEP: i64 = 10;

/// Reads a string field off a v1 JSON object, treating blank as absent.
fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Reads a nested object field, treating an empty object as absent.
fn object_field(value: &Value, key: &str) -> Option<Value> {
    value
        .get(key)
        .filter(|v| !v.is_null())
        .filter(|v| !matches!(v, Value::Object(map) if map.is_empty()))
        .cloned()
}

/// Keeps a value only when it carries something, so v1's ubiquitous nulls and
/// empty objects do not become keys in the v2 file.
fn non_empty_object(value: &Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Object(map) if map.is_empty() => None,
        other => Some(other.clone()),
    }
}

/// Normalizes v1 form rows into the canonical array shape.
///
/// Mirrors `normalizeFormRows` in `src/modules/utils/formDataRows.js`: older
/// data stored a flat `{key: value}` object where the current shape is an
/// ordered array of rows, and both must keep loading.
///
/// @param fields - The persisted `fields` value, in either shape
/// @returns Rows as an array, empty when there is nothing to convert
fn normalize_form_rows(fields: Option<&Value>) -> Vec<Value> {
    match fields {
        Some(Value::Array(rows)) => rows.clone(),
        Some(Value::Object(map)) => map
            .iter()
            .map(|(key, value)| {
                let text = match value {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                let mut row = Map::new();
                row.insert("key".into(), Value::String(key.clone()));
                row.insert("value".into(), Value::String(text));
                row.insert("type".into(), Value::String("text".into()));
                row.insert("filePath".into(), Value::String(String::new()));
                row.insert("contentType".into(), Value::String(String::new()));
                row.insert("enabled".into(), Value::Bool(true));
                Value::Object(row)
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Drops the empty `{query: {}, header: {}, path: {}}` skeleton the frontend
/// attached to every request it created, so it does not become noise in every
/// v2 file. Buckets that hold something are kept.
///
/// @param parameters - The v1 `parameters` object, if any
/// @returns The parameters with empty buckets removed, or None when nothing is left
fn prune_parameter_buckets(parameters: Option<Value>) -> Option<Value> {
    let map = match parameters {
        Some(Value::Object(map)) => map,
        other => return other,
    };

    let pruned: Map<String, Value> = map
        .into_iter()
        .filter(|(_, value)| !matches!(value, Value::Object(inner) if inner.is_empty()))
        .filter(|(_, value)| !value.is_null())
        .collect();

    if pruned.is_empty() {
        None
    } else {
        Some(Value::Object(pruned))
    }
}

/// Chooses the one body a v1 endpoint actually had.
///
/// v1 spread the body across three fields and wrote exactly one of them per
/// save, so precedence follows what the frontend could have produced:
/// `formBodyData` carries its own mode and wins, then `graphqlData`, then a
/// plain `modifiedBody` which was always JSON mode.
///
/// @param data - The endpoint's v1 data file
/// @returns The v2 body, or None when the request had none
pub(crate) fn body_from_v1(data: &EndpointData) -> Option<Body> {
    if let Some(form) = &data.form_body_data {
        let mode = form.get("mode").and_then(|m| m.as_str()).unwrap_or("");
        match mode {
            "formdata" => {
                return Some(Body::Known(BodyKind::FormData {
                    fields: normalize_form_rows(form.get("fields")),
                }))
            }
            "urlencoded" => {
                return Some(Body::Known(BodyKind::UrlEncoded {
                    fields: normalize_form_rows(form.get("fields")),
                }))
            }
            "binary" => {
                return Some(Body::Known(BodyKind::Binary {
                    file_path: string_field(form, "filePath").unwrap_or_default(),
                    content_type: string_field(form, "contentType").unwrap_or_default(),
                }))
            }
            "text" => {
                return Some(Body::Known(BodyKind::Text {
                    content: form
                        .get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string(),
                }))
            }
            _ => {}
        }
    }

    if let Some(graphql) = &data.graphql_data {
        let query = graphql
            .get("query")
            .and_then(|q| q.as_str())
            .unwrap_or("")
            .to_string();
        let variables = graphql
            .get("variables")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if !query.is_empty() || !variables.is_empty() {
            return Some(Body::Known(BodyKind::Graphql {
                query,
                variables,
                operation_name: string_field(graphql, "operationName"),
            }));
        }
    }

    if let Some(body) = &data.modified_body {
        if !body.is_empty() {
            return Some(Body::Known(BodyKind::Json {
                content: body.clone(),
            }));
        }
    }

    None
}

/// Converts v1 scripts, which used longer field names.
pub(crate) fn scripts_from_v1(value: Option<&Value>) -> Scripts {
    let scripts = match value {
        Some(scripts) => scripts,
        None => return Scripts::default(),
    };

    Scripts {
        pre_request: string_field(scripts, "preRequestScript"),
        test: string_field(scripts, "testScript"),
    }
}

/// Rejoins one endpoint's metadata and its data file into a request document.
///
/// @param endpoint - The endpoint entry from collection.json
/// @param data - The endpoint's data file, if it had one
/// @param seq - Position in its folder, derived from the v1 array order
/// @returns The v2 request document
pub(crate) fn endpoint_to_request(
    endpoint: &Value,
    data: Option<&EndpointData>,
    seq: i64,
) -> RequestDoc {
    let id = string_field(endpoint, "id").unwrap_or_default();
    let name = string_field(endpoint, "name")
        .or_else(|| string_field(endpoint, "path"))
        .unwrap_or_else(|| id.clone());

    let mut doc = RequestDoc::new(id, name);
    doc.format = FORMAT_VERSION;
    doc.seq = seq;
    doc.protocol = string_field(endpoint, "protocol");
    doc.method = string_field(endpoint, "method");
    doc.http_method = string_field(endpoint, "httpMethod");
    doc.path = string_field(endpoint, "path");
    doc.description = string_field(endpoint, "description");

    doc.spec = Spec {
        parameters: prune_parameter_buckets(object_field(endpoint, "parameters")),
        request_body: object_field(endpoint, "requestBody"),
        responses: object_field(endpoint, "responses"),
    };

    if let Some(data) = data {
        doc.url = data.url.clone().filter(|u| !u.is_empty());
        doc.auth = data.auth_config.clone().filter(|a| !a.is_null());
        doc.params = Params {
            path: data.path_params.clone(),
            query: data.query_params.clone(),
            headers: data.headers.clone(),
        };
        doc.body = body_from_v1(data);
        doc.grpc = data.grpc_data.clone().filter(|v| !v.is_null());
        doc.mqtt = data.mqtt_data.clone().filter(|v| !v.is_null());
        doc.scripts = scripts_from_v1(data.scripts.as_ref());
        doc.response_schema = data.response_schema.clone().filter(|v| !v.is_null());
    }

    doc
}

/// Lists the endpoint ids a v1 collection files inside folders.
fn foldered_ids(collection: &Collection) -> Vec<String> {
    let mut ids = Vec::new();
    for folder in &collection.folders {
        if let Some(endpoints) = folder.get("endpoints").and_then(|e| e.as_array()) {
            for endpoint in endpoints {
                if let Some(id) = string_field(endpoint, "id") {
                    ids.push(id);
                }
            }
        }
    }
    ids
}

/// Converts a v1 collection and its endpoint data files into the v2 model.
///
/// Endpoints duplicated across the flat list and a folder become one request,
/// filed in the folder. Ids are preserved exactly: they key the keychain auth
/// scopes, pinned requests, scripts, mock overrides and workspace tabs that
/// live outside the collection file, so changing one detaches all of it.
///
/// @param collection - The parsed collection.json
/// @param data - Endpoint data files, keyed by endpoint id
/// @returns The collection in the v2 model, ready to be written
pub(crate) fn v1_to_v2(
    collection: &Collection,
    data: &HashMap<String, EndpointData>,
) -> LoadedCollection {
    let meta = CollectionDoc {
        format: FORMAT_VERSION,
        id: collection.id.clone(),
        name: collection.name.clone(),
        base_url: collection.base_url.clone(),
        description: None,
        default_headers: non_empty_object(&collection.default_headers),
        auth: collection.auth_config.clone().filter(|a| !a.is_null()),
        // Set by the writer once the spec file is placed beside this document.
        open_api_spec: None,
        extra: Map::new(),
    };

    let foldered = foldered_ids(collection);
    let mut root = FolderNode::default();

    let mut seq = 0;
    for endpoint in &collection.endpoints {
        let id = match string_field(endpoint, "id") {
            Some(id) => id,
            None => continue,
        };
        if foldered.contains(&id) {
            continue;
        }
        seq += SEQ_STEP;
        root.requests.push(RequestEntry::new(endpoint_to_request(
            endpoint,
            data.get(&id),
            seq,
        )));
    }

    let mut folder_seq = 0;
    for folder in &collection.folders {
        let folder_id = match string_field(folder, "id") {
            Some(id) => id,
            None => continue,
        };
        folder_seq += SEQ_STEP;

        let mut node = FolderNode {
            meta: Some(FolderDoc {
                format: FORMAT_VERSION,
                id: folder_id,
                name: string_field(folder, "name").unwrap_or_else(|| "folder".to_string()),
                seq: folder_seq,
                auth: object_field(folder, "authConfig"),
                extra: Map::new(),
            }),
            source: None,
            requests: Vec::new(),
            folders: Vec::new(),
        };

        let mut inner_seq = 0;
        if let Some(endpoints) = folder.get("endpoints").and_then(|e| e.as_array()) {
            for endpoint in endpoints {
                let id = match string_field(endpoint, "id") {
                    Some(id) => id,
                    None => continue,
                };
                inner_seq += SEQ_STEP;
                node.requests.push(RequestEntry::new(endpoint_to_request(
                    endpoint,
                    data.get(&id),
                    inner_seq,
                )));
            }
        }

        root.folders.push(node);
    }

    LoadedCollection {
        meta,
        open_api_spec: collection.open_api_spec.clone().filter(|v| !v.is_null()),
        variables: Vec::new(),
        root,
        layout: Layout::V1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn v1_collection(endpoints: Vec<Value>, folders: Vec<Value>) -> Collection {
        Collection {
            id: "c1".into(),
            name: "Petstore".into(),
            base_url: "https://api.example.com".into(),
            endpoints,
            folders,
            default_headers: Value::Null,
            auth_config: None,
            open_api_spec: None,
            storage_path: Some("/home/someone/.local/share/resonance/collections/petstore".into()),
            storage_parent_path: None,
            linked: false,
            git_branch: None,
        }
    }

    fn endpoint(id: &str, name: &str) -> Value {
        json!({"id": id, "name": name, "method": "GET", "path": "/x", "protocol": "http"})
    }

    fn convert(collection: &Collection, data: HashMap<String, EndpointData>) -> LoadedCollection {
        v1_to_v2(collection, &data)
    }

    #[test]
    fn collection_metadata_carries_over() {
        let converted = convert(&v1_collection(vec![], vec![]), HashMap::new());

        assert_eq!(converted.meta.id, "c1");
        assert_eq!(converted.meta.name, "Petstore");
        assert_eq!(converted.meta.base_url, "https://api.example.com");
        assert_eq!(converted.meta.format, FORMAT_VERSION);
    }

    /// The absolute path was machine-specific noise in a committed file.
    #[test]
    fn the_storage_path_is_not_carried_over() {
        let converted = convert(&v1_collection(vec![], vec![]), HashMap::new());
        let yaml = serde_yaml_ng::to_string(&converted.meta).unwrap();

        assert!(!yaml.contains("storagePath"), "{}", yaml);
        assert!(!yaml.contains("/home/someone"), "{}", yaml);
    }

    #[test]
    fn the_openapi_spec_moves_off_the_collection_document() {
        let mut collection = v1_collection(vec![], vec![]);
        collection.open_api_spec = Some(json!({"openapi": "3.0.0"}));

        let converted = convert(&collection, HashMap::new());

        assert_eq!(converted.open_api_spec.unwrap()["openapi"], "3.0.0");
        assert!(
            converted.meta.open_api_spec.is_none(),
            "the file name is set by the writer, not the conversion"
        );
    }

    /// v1 stored a foldered request twice: once flat, once in the folder. The
    /// conversion must produce one file, in the folder.
    #[test]
    fn a_request_duplicated_into_a_folder_becomes_one_request() {
        let collection = v1_collection(
            vec![endpoint("r1", "Health"), endpoint("r2", "List Pets")],
            vec![json!({"id": "f1", "name": "pets", "endpoints": [endpoint("r2", "List Pets")]})],
        );

        let converted = convert(&collection, HashMap::new());

        assert_eq!(converted.requests().len(), 2);
        assert_eq!(converted.root.requests.len(), 1);
        assert_eq!(converted.root.requests[0].doc.id, "r1");
        assert_eq!(converted.root.folders[0].requests.len(), 1);
        assert_eq!(converted.root.folders[0].requests[0].doc.id, "r2");
    }

    #[test]
    fn a_folderless_collection_puts_every_request_at_the_root() {
        let collection = v1_collection(vec![endpoint("r1", "A"), endpoint("r2", "B")], vec![]);
        let converted = convert(&collection, HashMap::new());

        assert_eq!(converted.root.requests.len(), 2);
        assert!(converted.root.folders.is_empty());
    }

    /// Ids key the keychain scopes, pinned requests, scripts and mock
    /// overrides that live outside the collection file. Changing one on
    /// migration would detach all of it.
    #[test]
    fn endpoint_ids_are_preserved_exactly() {
        let collection = v1_collection(vec![endpoint("custom_3", "Legacy")], vec![]);
        let converted = convert(&collection, HashMap::new());

        assert_eq!(converted.root.requests[0].doc.id, "custom_3");
    }

    #[test]
    fn seq_follows_the_v1_array_order() {
        let collection = v1_collection(
            vec![
                endpoint("r1", "First"),
                endpoint("r2", "Second"),
                endpoint("r3", "Third"),
            ],
            vec![],
        );
        let converted = convert(&collection, HashMap::new());

        let seqs: Vec<_> = converted.root.requests.iter().map(|e| e.doc.seq).collect();
        assert_eq!(seqs, vec![10, 20, 30]);
    }

    #[test]
    fn folder_auth_carries_over() {
        let collection = v1_collection(
            vec![],
            vec![json!({
                "id": "f1",
                "name": "pets",
                "endpoints": [],
                "authConfig": {"type": "bearer", "config": {"token": ""}}
            })],
        );

        let converted = convert(&collection, HashMap::new());
        let auth = converted.root.folders[0]
            .meta
            .as_ref()
            .unwrap()
            .auth
            .as_ref()
            .unwrap();

        assert_eq!(auth["type"], "bearer");
    }

    #[test]
    fn an_endpoint_without_a_data_file_still_becomes_a_request() {
        let collection = v1_collection(vec![endpoint("r1", "Bare")], vec![]);
        let converted = convert(&collection, HashMap::new());

        assert_eq!(converted.root.requests[0].doc.name, "Bare");
        assert!(converted.root.requests[0].doc.body.is_none());
    }

    #[test]
    fn endpoint_data_is_rejoined_onto_the_request() {
        let mut data = HashMap::new();
        data.insert(
            "r1".to_string(),
            EndpointData {
                url: Some("https://api.example.com/x".into()),
                headers: vec![json!({"key": "Accept", "value": "*/*"})],
                query_params: vec![json!({"key": "page", "value": "1"})],
                auth_config: Some(json!({"type": "bearer", "config": {"token": ""}})),
                response_schema: Some(json!({"type": "object"})),
                ..Default::default()
            },
        );

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        let doc = &converted.root.requests[0].doc;

        assert_eq!(doc.url.as_deref(), Some("https://api.example.com/x"));
        assert_eq!(doc.params.headers.len(), 1);
        assert_eq!(doc.params.query.len(), 1);
        assert_eq!(doc.auth.as_ref().unwrap()["type"], "bearer");
        assert!(doc.response_schema.is_some());
    }

    #[test]
    fn spec_material_moves_under_the_spec_key() {
        let endpoint = json!({
            "id": "r1",
            "name": "X",
            "parameters": {"query": {"limit": {"example": "20"}}},
            "requestBody": {"required": true},
            "responses": {"200": {"description": "ok"}}
        });

        let converted = convert(&v1_collection(vec![endpoint], vec![]), HashMap::new());
        let spec = &converted.root.requests[0].doc.spec;

        assert!(spec.parameters.is_some());
        assert!(spec.request_body.is_some());
        assert!(spec.responses.is_some());
    }

    #[test]
    fn an_empty_parameters_skeleton_is_dropped() {
        let endpoint = json!({"id": "r1", "name": "X", "parameters": {}, "requestBody": null});
        let converted = convert(&v1_collection(vec![endpoint], vec![]), HashMap::new());

        assert!(converted.root.requests[0].doc.spec.is_empty());
    }

    /// The frontend attached this skeleton to every request it created, so
    /// keeping it would put three empty maps in every migrated file.
    #[test]
    fn the_default_parameter_skeleton_is_dropped() {
        let endpoint = json!({
            "id": "r1",
            "name": "X",
            "parameters": {"query": {}, "header": {}, "path": {}}
        });
        let converted = convert(&v1_collection(vec![endpoint], vec![]), HashMap::new());

        assert!(converted.root.requests[0].doc.spec.is_empty());

        let yaml = serde_yaml_ng::to_string(&converted.root.requests[0].doc).unwrap();
        assert!(!yaml.contains("spec"), "{}", yaml);
    }

    #[test]
    fn a_populated_parameter_bucket_is_kept_and_empty_siblings_dropped() {
        let endpoint = json!({
            "id": "r1",
            "name": "X",
            "parameters": {"query": {"limit": {"example": "20"}}, "header": {}, "path": {}}
        });
        let converted = convert(&v1_collection(vec![endpoint], vec![]), HashMap::new());

        let parameters = converted.root.requests[0]
            .doc
            .spec
            .parameters
            .as_ref()
            .unwrap();
        assert!(parameters.get("query").is_some());
        assert!(parameters.get("header").is_none());
        assert!(parameters.get("path").is_none());
    }

    mod bodies {
        use super::*;

        fn body_of(data: EndpointData) -> Option<Body> {
            let mut map = HashMap::new();
            map.insert("r1".to_string(), data);
            let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), map);
            converted.root.requests[0].doc.body.clone()
        }

        #[test]
        fn a_modified_body_becomes_a_json_body() {
            let body = body_of(EndpointData {
                modified_body: Some("{\"a\": 1}".into()),
                ..Default::default()
            });

            assert!(
                matches!(body, Some(Body::Known(BodyKind::Json { content })) if content == "{\"a\": 1}")
            );
        }

        #[test]
        fn form_data_becomes_a_formdata_body() {
            let body = body_of(EndpointData {
                form_body_data: Some(json!({
                    "mode": "formdata",
                    "fields": [{"key": "a", "value": "b", "enabled": true}]
                })),
                ..Default::default()
            });

            assert!(
                matches!(body, Some(Body::Known(BodyKind::FormData { fields })) if fields.len() == 1)
            );
        }

        #[test]
        fn urlencoded_becomes_an_urlencoded_body() {
            let body = body_of(EndpointData {
                form_body_data: Some(json!({"mode": "urlencoded", "fields": []})),
                ..Default::default()
            });

            assert!(matches!(
                body,
                Some(Body::Known(BodyKind::UrlEncoded { .. }))
            ));
        }

        #[test]
        fn a_binary_body_keeps_its_path_and_type() {
            let body = body_of(EndpointData {
                form_body_data: Some(json!({
                    "mode": "binary",
                    "filePath": "/tmp/x.bin",
                    "contentType": "application/octet-stream"
                })),
                ..Default::default()
            });

            match body {
                Some(Body::Known(BodyKind::Binary {
                    file_path,
                    content_type,
                })) => {
                    assert_eq!(file_path, "/tmp/x.bin");
                    assert_eq!(content_type, "application/octet-stream");
                }
                other => panic!("expected a binary body, got {:?}", other),
            }
        }

        #[test]
        fn a_text_body_keeps_its_content() {
            let body = body_of(EndpointData {
                form_body_data: Some(json!({"mode": "text", "content": "hello"})),
                ..Default::default()
            });

            assert!(
                matches!(body, Some(Body::Known(BodyKind::Text { content })) if content == "hello")
            );
        }

        /// Older data stored form fields as a flat object rather than rows.
        #[test]
        fn legacy_flat_form_fields_normalize_to_rows() {
            let body = body_of(EndpointData {
                form_body_data: Some(json!({
                    "mode": "formdata",
                    "fields": {"alpha": "one", "beta": "two"}
                })),
                ..Default::default()
            });

            match body {
                Some(Body::Known(BodyKind::FormData { fields })) => {
                    assert_eq!(fields.len(), 2);
                    for row in &fields {
                        assert!(row.get("key").is_some());
                        assert!(row.get("value").unwrap().is_string());
                        assert_eq!(row["enabled"], true);
                        assert_eq!(row["type"], "text");
                    }
                }
                other => panic!("expected form data rows, got {:?}", other),
            }
        }

        /// Three writers produced three key sets for graphqlData; all convert.
        #[test]
        fn every_graphql_key_set_converts() {
            let shapes = vec![
                json!({"query": "{ me }", "variables": "{}", "operationName": "Me"}),
                json!({"query": "{ me }", "variables": "{}", "operationName": null}),
                json!({"mode": "graphql", "query": "{ me }", "variables": "{}"}),
            ];

            for shape in shapes {
                let body = body_of(EndpointData {
                    graphql_data: Some(shape.clone()),
                    ..Default::default()
                });

                assert!(
                    matches!(body, Some(Body::Known(BodyKind::Graphql { ref query, .. })) if query == "{ me }"),
                    "failed for {}",
                    shape
                );
            }
        }

        #[test]
        fn form_body_data_wins_over_a_stale_modified_body() {
            let body = body_of(EndpointData {
                modified_body: Some("stale".into()),
                form_body_data: Some(json!({"mode": "text", "content": "current"})),
                ..Default::default()
            });

            assert!(
                matches!(body, Some(Body::Known(BodyKind::Text { content })) if content == "current")
            );
        }

        #[test]
        fn an_endpoint_with_no_body_fields_gets_no_body() {
            assert!(body_of(EndpointData::default()).is_none());
        }

        #[test]
        fn an_empty_graphql_payload_is_not_a_body() {
            let body = body_of(EndpointData {
                graphql_data: Some(json!({"query": "", "variables": ""})),
                ..Default::default()
            });

            assert!(body.is_none());
        }
    }

    #[test]
    fn grpc_and_mqtt_data_carry_over_verbatim() {
        let mut data = HashMap::new();
        data.insert(
            "r1".to_string(),
            EndpointData {
                grpc_data: Some(json!({
                    "target": "localhost:50051",
                    "service": "UserService",
                    "fullMethod": "/UserService/Get",
                    "requestJson": "{}",
                    "metadata": {"x-key": "v"},
                    "useTls": false,
                    "protoPath": null,
                    "clientStreaming": false,
                    "serverStreaming": true
                })),
                mqtt_data: Some(json!({"clientId": "c", "qos": 2})),
                ..Default::default()
            },
        );

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        let doc = &converted.root.requests[0].doc;

        assert_eq!(doc.grpc.as_ref().unwrap()["serverStreaming"], true);
        assert_eq!(doc.grpc.as_ref().unwrap()["metadata"]["x-key"], "v");
        assert_eq!(doc.mqtt.as_ref().unwrap()["qos"], 2);
    }

    /// The four-key gRPC writer produced a subset of the nine-key one.
    #[test]
    fn the_short_grpc_writer_also_converts() {
        let mut data = HashMap::new();
        data.insert(
            "r1".to_string(),
            EndpointData {
                grpc_data: Some(json!({
                    "target": "localhost:50051",
                    "service": "S",
                    "fullMethod": "/S/M",
                    "requestJson": "{}"
                })),
                ..Default::default()
            },
        );

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        assert_eq!(
            converted.root.requests[0].doc.grpc.as_ref().unwrap()["service"],
            "S"
        );
    }

    #[test]
    fn scripts_are_renamed_to_their_v2_keys() {
        let mut data = HashMap::new();
        data.insert(
            "r1".to_string(),
            EndpointData {
                scripts: Some(json!({
                    "preRequestScript": "pre();",
                    "testScript": "expect(1).toBe(1);"
                })),
                ..Default::default()
            },
        );

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        let scripts = &converted.root.requests[0].doc.scripts;

        assert_eq!(scripts.pre_request.as_deref(), Some("pre();"));
        assert_eq!(scripts.test.as_deref(), Some("expect(1).toBe(1);"));
    }

    #[test]
    fn empty_scripts_are_dropped() {
        let mut data = HashMap::new();
        data.insert(
            "r1".to_string(),
            EndpointData {
                scripts: Some(json!({"preRequestScript": "", "testScript": ""})),
                ..Default::default()
            },
        );

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        assert!(converted.root.requests[0].doc.scripts.is_empty());
    }

    #[test]
    fn a_request_falls_back_to_its_path_then_its_id_for_a_name() {
        let unnamed = json!({"id": "r1", "path": "/pets"});
        let bare = json!({"id": "r2"});

        let converted = convert(&v1_collection(vec![unnamed, bare], vec![]), HashMap::new());

        assert_eq!(converted.root.requests[0].doc.name, "/pets");
        assert_eq!(converted.root.requests[1].doc.name, "r2");
    }

    /// v1 emitted a null for every unset field; none may reach the v2 file.
    #[test]
    fn a_converted_request_writes_no_nulls() {
        let mut data = HashMap::new();
        data.insert("r1".to_string(), EndpointData::default());

        let converted = convert(&v1_collection(vec![endpoint("r1", "X")], vec![]), data);
        let yaml = serde_yaml_ng::to_string(&converted.root.requests[0].doc).unwrap();

        assert!(!yaml.contains("null"), "{}", yaml);
    }
}

#[cfg(test)]
mod end_to_end {
    use super::*;
    use crate::commands::collections::read::read_collection_dir;
    use crate::commands::collections::write::write_collection_dir;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    /// The whole migration path: a v1 collection converts, writes as a v2
    /// tree, and reads back with everything intact.
    #[test]
    fn a_v1_collection_survives_the_full_round_trip() {
        let collection = Collection {
            id: "c1".into(),
            name: "Petstore".into(),
            base_url: "https://api.example.com".into(),
            endpoints: vec![
                json!({"id": "custom_1", "name": "Health", "method": "GET", "path": "/health", "protocol": "http"}),
                json!({"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets", "protocol": "http"}),
            ],
            folders: vec![json!({
                "id": "folder_pets",
                "name": "pets",
                "authConfig": {"type": "bearer", "config": {"token": ""}},
                "endpoints": [
                    {"id": "custom_2", "name": "Create Pet", "method": "POST", "path": "/pets", "protocol": "http"}
                ]
            })],
            default_headers: json!({"Accept": "application/json"}),
            auth_config: Some(
                json!({"type": "api-key", "config": {"keyName": "X-Key", "keyValue": ""}}),
            ),
            open_api_spec: Some(json!({"openapi": "3.0.0"})),
            storage_path: Some("/machine/specific/path".into()),
            storage_parent_path: None,
            linked: false,
            git_branch: None,
        };

        let mut data = HashMap::new();
        data.insert(
            "custom_2".to_string(),
            EndpointData {
                modified_body: Some("{\n  \"name\": \"Rex\"\n}\n".into()),
                headers: vec![json!({"key": "Content-Type", "value": "application/json"})],
                scripts: Some(
                    json!({"preRequestScript": "", "testScript": "expect(1).toBe(1);\n"}),
                ),
                ..Default::default()
            },
        );

        let temp = TempDir::new().unwrap();
        let mut converted = v1_to_v2(&collection, &data);
        converted.variables = vec![json!({"key": "baseUrl", "value": "https://api.example.com"})];

        write_collection_dir(temp.path(), &mut converted).unwrap();

        // The layout is what the format promised.
        assert!(temp.path().join("collection.yaml").exists());
        assert!(temp.path().join("variables.yaml").exists());
        assert!(temp.path().join("openapi.yaml").exists());
        assert!(temp.path().join("health.yaml").exists());
        assert!(temp.path().join("pets/_folder.yaml").exists());
        assert!(temp.path().join("pets/create-pet.yaml").exists());

        // The duplicated endpoint became exactly one file.
        assert!(!temp.path().join("create-pet.yaml").exists());

        // The body reads as literal text, not an escaped string.
        let request = fs::read_to_string(temp.path().join("pets/create-pet.yaml")).unwrap();
        assert!(request.contains("content: |"), "{}", request);
        assert!(!request.contains("\\n"), "{}", request);
        assert!(request.contains("test: |"), "{}", request);

        // Nothing machine-specific reached the committed files.
        let meta = fs::read_to_string(temp.path().join("collection.yaml")).unwrap();
        assert!(!meta.contains("/machine/specific"), "{}", meta);
        assert!(
            !meta.contains("3.0.0"),
            "the spec must not be inlined: {}",
            meta
        );

        // And it all reads back.
        let read = read_collection_dir(temp.path()).unwrap();
        assert_eq!(read.requests().len(), 2);
        assert_eq!(read.meta.name, "Petstore");
        assert_eq!(read.variables.len(), 1);
        assert_eq!(read.open_api_spec.as_ref().unwrap()["openapi"], "3.0.0");

        let ids: Vec<_> = read.requests().iter().map(|e| e.doc.id.clone()).collect();
        assert!(ids.contains(&"custom_1".to_string()));
        assert!(ids.contains(&"custom_2".to_string()));

        assert_eq!(read.root.folders[0].requests[0].doc.name, "Create Pet");
    }

    /// Converting the same v1 collection twice must produce identical bytes,
    /// or a migration would show up as a diff on every save.
    #[test]
    fn converting_twice_produces_identical_bytes() {
        let collection = Collection {
            id: "c1".into(),
            name: "P".into(),
            base_url: String::new(),
            endpoints: vec![json!({"id": "r1", "name": "Health"})],
            folders: vec![],
            default_headers: Value::Null,
            auth_config: None,
            open_api_spec: None,
            storage_path: None,
            storage_parent_path: None,
            linked: false,
            git_branch: None,
        };

        let temp = TempDir::new().unwrap();
        let mut first = v1_to_v2(&collection, &HashMap::new());
        write_collection_dir(temp.path(), &mut first).unwrap();
        let before = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        let mut second = v1_to_v2(&collection, &HashMap::new());
        write_collection_dir(temp.path(), &mut second).unwrap();
        let after = fs::read_to_string(temp.path().join("health.yaml")).unwrap();

        assert_eq!(before, after);
    }
}
