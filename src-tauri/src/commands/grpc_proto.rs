use prost_reflect::{DescriptorPool, DynamicMessage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

use super::grpc_reflection::{
    DynamicMessageCodec, GrpcUnaryRequest, GrpcUnaryState, create_channel, dynamic_message_to_json,
    generate_message_skeleton, json_to_dynamic_message, metadata_to_json_map,
    normalize_target_with_tls, resolve_method_types, run_cancellable_unary, strip_leading_dot,
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
    let pool = {
        let pools = state.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(&proto_path)
            .cloned()
            .ok_or_else(|| format!("Proto file not loaded: {}", proto_path))?
    };

    let (input_type, _) = resolve_method_types(&pool, &full_method)?;

    let input_desc = pool
        .get_message_by_name(&strip_leading_dot(&input_type))
        .ok_or_else(|| format!("Input message type not found: {}", input_type))?;

    Ok(generate_message_skeleton(&input_desc))
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
    use http::uri::PathAndQuery;
    use tonic::Request;
    use tonic::metadata::{MetadataKey, MetadataValue};

    let pool = {
        let pools = state.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(&proto_path)
            .cloned()
            .ok_or_else(|| format!("Proto file not loaded: {}", proto_path))?
    };

    let target = normalize_target_with_tls(&request.target, request.tls.use_tls);
    let (input_type, output_type) = resolve_method_types(&pool, &request.full_method)?;

    let input_desc = pool
        .get_message_by_name(&strip_leading_dot(&input_type))
        .ok_or_else(|| format!("Input message type not found: {}", input_type))?;
    let output_desc = pool
        .get_message_by_name(&strip_leading_dot(&output_type))
        .ok_or_else(|| format!("Output message type not found: {}", output_type))?;

    let input_msg = json_to_dynamic_message(&request.request_json, input_desc)?;

    let channel = create_channel(&target, &request.tls).await?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("gRPC client not ready: {}", e))?;

    let mut req = Request::new(input_msg);
    for (k, v) in request.metadata {
        let key = MetadataKey::from_bytes(k.as_bytes())
            .map_err(|e| format!("Invalid metadata key '{}': {}", k, e))?;
        let val = MetadataValue::try_from(v)
            .map_err(|e| format!("Invalid metadata value for '{}': {}", key, e))?;
        req.metadata_mut().insert(key, val);
    }

    let path: PathAndQuery = request
        .full_method
        .parse()
        .map_err(|e| format!("Invalid method path: {}", e))?;

    let codec = DynamicMessageCodec::new(output_desc);

    let call_fut = grpc.unary(req, path, codec);
    let response: Result<tonic::Response<DynamicMessage>, tonic::Status> =
        if let Some(ms) = request.deadline_ms {
            match tokio::time::timeout(std::time::Duration::from_millis(ms), call_fut).await {
                Ok(res) => res,
                Err(_) => {
                    return Ok(serde_json::json!({
                        "success": false,
                        "status": tonic::Code::DeadlineExceeded as i32,
                        "statusMessage": "deadline exceeded"
                    }));
                }
            }
        } else {
            call_fut.await
        };

    match response {
        Ok(resp) => {
            let headers = metadata_to_json_map(resp.metadata());
            let msg = resp.into_inner();
            let data = dynamic_message_to_json(&msg)?;

            Ok(serde_json::json!({
                "success": true,
                "data": data,
                "status": 0,
                "statusMessage": "OK",
                "headers": headers,
                "trailers": {}
            }))
        }
        Err(status) => Ok(serde_json::json!({
            "success": false,
            "status": status.code() as i32,
            "statusMessage": status.message(),
            "details": status.details()
        })),
    }
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
mod protox_parse {
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
