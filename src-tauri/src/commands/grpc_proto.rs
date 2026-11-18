use prost_reflect::DescriptorPool;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

use super::grpc_reflection::{
    GrpcUnaryRequest, GrpcUnaryState, generate_message_skeleton, invoke_unary_with_pool,
    resolve_method, run_cancellable_unary,
};

/// State to hold loaded proto file descriptors
pub struct ProtoState {
    /// Map from proto file path to its descriptor pool
    pub(crate) pools: Mutex<HashMap<String, DescriptorPool>>,
}

impl Default for ProtoState {
    fn default() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }
}

impl ProtoState {
    /// The descriptor pool of a proto file loaded earlier.
    pub(crate) fn pool(&self, proto_path: &str) -> Result<DescriptorPool, String> {
        let pools = self.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(proto_path)
            .cloned()
            .ok_or_else(|| format!("Proto file not loaded: {}", proto_path))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoServiceInfo {
    pub name: String,
    pub full_name: String,
    pub methods: Vec<ProtoMethodInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoMethodInfo {
    pub name: String,
    pub full_method: String,
    pub input_type: String,
    pub output_type: String,
    pub client_streaming: bool,
    pub server_streaming: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtoFileInfo {
    pub path: String,
    pub package: String,
    pub services: Vec<ProtoServiceInfo>,
}

/// Parse a proto file and return its services and methods
#[tauri::command]
pub async fn grpc_parse_proto_file(
    _app: AppHandle,
    state: State<'_, ProtoState>,
    proto_path: String,
    include_paths: Option<Vec<String>>,
) -> Result<ProtoFileInfo, String> {
    let proto_path_buf = PathBuf::from(&proto_path);

    if !proto_path_buf.exists() {
        return Err(format!("Proto file not found: {}", proto_path));
    }

    // Build include paths - always include the proto file's directory
    let mut includes: Vec<PathBuf> = vec![];
    if let Some(parent) = proto_path_buf.parent() {
        includes.push(parent.to_path_buf());
    }
    if let Some(extra_includes) = include_paths {
        for p in extra_includes {
            includes.push(PathBuf::from(p));
        }
    }

    // Use protox to parse the proto file
    let pool = protox_parse::parse_proto_file(&proto_path, &includes)?;

    // Extract services from the pool
    let mut services = Vec::new();
    let mut package = String::new();

    for service in pool.services() {
        let service_full_name = service.full_name().to_string();

        // Extract package from service name
        if package.is_empty()
            && let Some(idx) = service_full_name.rfind('.')
        {
            package = service_full_name[..idx].to_string();
        }

        let mut methods = Vec::new();
        for method in service.methods() {
            methods.push(ProtoMethodInfo {
                name: method.name().to_string(),
                full_method: format!("/{}/{}", service_full_name, method.name()),
                input_type: format!(".{}", method.input().full_name()),
                output_type: format!(".{}", method.output().full_name()),
                client_streaming: method.is_client_streaming(),
                server_streaming: method.is_server_streaming(),
            });
        }

        services.push(ProtoServiceInfo {
            name: service.name().to_string(),
            full_name: service_full_name,
            methods,
        });
    }

    // Store the pool for later use
    {
        let mut pools = state.pools.lock().map_err(|e| e.to_string())?;
        pools.insert(proto_path.clone(), pool);
    }

    Ok(ProtoFileInfo {
        path: proto_path,
        package,
        services,
    })
}

/// Get input skeleton for a method from a loaded proto file
#[tauri::command]
pub async fn grpc_proto_get_input_skeleton(
    _app: AppHandle,
    state: State<'_, ProtoState>,
    proto_path: String,
    full_method: String,
) -> Result<Value, String> {
    let pool = state.pool(&proto_path)?;
    let method = resolve_method(&pool, &full_method)?;
    Ok(generate_message_skeleton(&method.input()))
}

/// Invoke a gRPC unary call using a loaded proto file for type information
#[tauri::command]
pub async fn grpc_proto_invoke_unary(
    _app: AppHandle,
    state: State<'_, ProtoState>,
    unary_state: State<'_, GrpcUnaryState>,
    proto_path: String,
    request: GrpcUnaryRequest,
) -> Result<Value, String> {
    let request_id = request.request_id.clone();
    run_cancellable_unary(
        &unary_state,
        request_id,
        invoke_unary_proto(&state, proto_path, request),
    )
    .await
}

async fn invoke_unary_proto(
    state: &ProtoState,
    proto_path: String,
    request: GrpcUnaryRequest,
) -> Result<Value, String> {
    let pool = state.pool(&proto_path)?;
    invoke_unary_with_pool(&pool, request).await
}

/// List all loaded proto files
#[tauri::command]
pub async fn grpc_list_loaded_protos(
    _app: AppHandle,
    state: State<'_, ProtoState>,
) -> Result<Vec<String>, String> {
    let pools = state.pools.lock().map_err(|e| e.to_string())?;
    Ok(pools.keys().cloned().collect())
}

/// Unload a proto file from memory
#[tauri::command]
pub async fn grpc_unload_proto(
    _app: AppHandle,
    state: State<'_, ProtoState>,
    proto_path: String,
) -> Result<(), String> {
    let mut pools = state.pools.lock().map_err(|e| e.to_string())?;
    pools.remove(&proto_path);
    Ok(())
}

/// Open a file dialog to select a proto file
#[tauri::command]
pub async fn grpc_select_proto_file(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = oneshot::channel();

    app.dialog()
        .file()
        .add_filter("Proto Files", &["proto"])
        .pick_file(move |file_path| {
            let result = file_path.map(|fp| match fp {
                FilePath::Path(p) => p.to_string_lossy().to_string(),
                FilePath::Url(u) => u.path().to_string(),
            });
            let _ = tx.send(result);
        });

    rx.await.map_err(|e| format!("Dialog error: {}", e))
}

/// Compiles `.proto` files in-process with protox, so no `protoc` binary is
/// needed. Google's well-known types (`google/protobuf/*.proto`) are bundled.
pub(crate) mod protox_parse {
    use prost_reflect::DescriptorPool;
    use std::path::PathBuf;

    pub fn parse_proto_file(
        proto_path: &str,
        include_paths: &[PathBuf],
    ) -> Result<DescriptorPool, String> {
        let mut compiler = protox::Compiler::new(include_paths)
            .map_err(|e| format!("Invalid include path: {e}"))?;
        compiler.include_imports(true);
        compiler
            .open_file(proto_path)
            .map_err(|e| format!("Failed to compile {proto_path}: {e}"))?;
        Ok(compiler.descriptor_pool())
    }
}

#[cfg(test)]
mod tests {
    use super::protox_parse::parse_proto_file;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn compiles_without_protoc_resolving_well_known_types_and_include_paths() {
        let service_dir = TempDir::new().unwrap();
        let shared_dir = TempDir::new().unwrap();
        fs::create_dir_all(shared_dir.path().join("common")).unwrap();
        fs::write(
            shared_dir.path().join("common/money.proto"),
            "syntax = \"proto3\";\npackage common;\nmessage Money { int64 cents = 1; }\n",
        )
        .unwrap();
        let service = service_dir.path().join("billing.proto");
        fs::write(
            &service,
            r#"syntax = "proto3";
package billing;
import "google/protobuf/timestamp.proto";
import "common/money.proto";
message Invoice { common.Money total = 1; google.protobuf.Timestamp due = 2; }
service Billing { rpc Get (Invoice) returns (Invoice); }
"#,
        )
        .unwrap();

        let pool = parse_proto_file(
            service.to_str().unwrap(),
            &[
                service_dir.path().to_path_buf(),
                shared_dir.path().to_path_buf(),
            ],
        )
        .unwrap();

        let names: Vec<String> = pool.services().map(|s| s.full_name().to_string()).collect();
        assert_eq!(names, vec!["billing.Billing".to_string()]);
        assert!(pool.get_message_by_name("common.Money").is_some());
    }

    #[test]
    fn skeletons_of_recursive_messages_terminate() {
        let dir = TempDir::new().unwrap();
        let service = dir.path().join("tree.proto");
        fs::write(
            &service,
            r#"syntax = "proto3";
package tree;
import "google/protobuf/struct.proto";
message Node { Node child = 1; repeated Node children = 2; map<string, Node> named = 3; string label = 4; }
message Input { Node root = 1; google.protobuf.Struct meta = 2; }
"#,
        )
        .unwrap();
        let pool =
            parse_proto_file(service.to_str().unwrap(), &[dir.path().to_path_buf()]).unwrap();
        let input = pool.get_message_by_name("tree.Input").unwrap();

        let skeleton = crate::commands::grpc_reflection::generate_message_skeleton(&input);

        assert_eq!(skeleton["root"]["label"], "");
        assert_eq!(skeleton["root"]["child"], serde_json::json!({}));
        assert_eq!(skeleton["root"]["named"], serde_json::json!({"key": {}}));
        assert_eq!(skeleton["meta"], serde_json::json!({}));
    }

    const SHAPES_PROTO: &str = r#"syntax = "proto3";
package shapes;
import "google/protobuf/any.proto";
import "google/protobuf/duration.proto";
import "google/protobuf/empty.proto";
import "google/protobuf/field_mask.proto";
import "google/protobuf/struct.proto";
import "google/protobuf/timestamp.proto";
import "google/protobuf/wrappers.proto";
message Item { string name = 1; }
message Input {
  oneof choice { string by_name = 1; int64 by_id = 2; Item by_item = 3; }
  optional string note = 4;
  map<string, int32> counts = 5;
  map<int32, string> labels = 6;
  map<bool, Item> items = 7;
  google.protobuf.Timestamp at = 8;
  google.protobuf.Duration ttl = 9;
  google.protobuf.StringValue nickname = 10;
  google.protobuf.Int64Value quota = 11;
  google.protobuf.BoolValue active = 12;
  google.protobuf.DoubleValue ratio = 13;
  google.protobuf.FieldMask mask = 14;
  google.protobuf.Struct meta = 15;
  google.protobuf.Value anything = 16;
  google.protobuf.ListValue list = 17;
  google.protobuf.Empty nothing = 18;
  repeated google.protobuf.Timestamp history = 19;
  google.protobuf.Any payload = 20;
}
"#;

    fn shapes_input() -> prost_reflect::MessageDescriptor {
        let dir = TempDir::new().unwrap();
        let service = dir.path().join("shapes.proto");
        fs::write(&service, SHAPES_PROTO).unwrap();
        parse_proto_file(service.to_str().unwrap(), &[dir.path().to_path_buf()])
            .unwrap()
            .get_message_by_name("shapes.Input")
            .unwrap()
    }

    #[test]
    fn a_skeleton_shows_one_oneof_member_typed_maps_and_canonical_well_known_types() {
        let skeleton = crate::commands::grpc_reflection::generate_message_skeleton(&shapes_input());

        assert_eq!(
            skeleton,
            serde_json::json!({
                "by_name": "",
                "note": "",
                "counts": {"key": 0},
                "labels": {"0": ""},
                "items": {"false": {"name": ""}},
                "at": "1970-01-01T00:00:00Z",
                "ttl": "0s",
                "nickname": "",
                "quota": 0,
                "active": false,
                "ratio": 0.0,
                "mask": "",
                "meta": {},
                "anything": null,
                "list": [],
                "nothing": {},
                "history": ["1970-01-01T00:00:00Z"],
                "payload": {"@type": ""}
            })
        );
    }

    /// The skeleton is only useful if the request path accepts it unedited.
    /// `Any` is the exception: it needs a type the user has to choose.
    #[test]
    fn a_generated_skeleton_is_accepted_by_the_request_path() {
        let input = shapes_input();
        let mut skeleton = crate::commands::grpc_reflection::generate_message_skeleton(&input);
        skeleton.as_object_mut().unwrap().remove("payload");

        crate::commands::grpc_reflection::json_to_dynamic_message(&skeleton, input)
            .expect("the skeleton should deserialize");
    }

    #[test]
    fn a_missing_import_is_reported() {
        let dir = TempDir::new().unwrap();
        let service = dir.path().join("svc.proto");
        fs::write(
            &service,
            "syntax = \"proto3\";\nimport \"nope/missing.proto\";\n",
        )
        .unwrap();

        let error =
            parse_proto_file(service.to_str().unwrap(), &[dir.path().to_path_buf()]).unwrap_err();
        assert!(error.contains("missing.proto"), "{error}");
    }
}
