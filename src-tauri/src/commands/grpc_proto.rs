use prost_reflect::{DescriptorPool, DynamicMessage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tokio::sync::oneshot;

pub use super::grpc_reflection::GrpcTlsOptions;
pub use super::grpc_reflection::GrpcUnaryRequest;

/// State to hold loaded proto file descriptors
pub struct ProtoState {
    /// Map from proto file path to its descriptor pool
    pools: Mutex<HashMap<String, DescriptorPool>>,
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
        if package.is_empty() {
            if let Some(idx) = service_full_name.rfind('.') {
                package = service_full_name[..idx].to_string();
            }
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

    let (input_type, _) = resolve_method_types_from_pool(&pool, &full_method)?;

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
    proto_path: String,
    request: GrpcUnaryRequest,
) -> Result<Value, String> {
    use http::uri::PathAndQuery;
    use tonic::metadata::{MetadataKey, MetadataValue};
    use tonic::Request;

    let pool = {
        let pools = state.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(&proto_path)
            .cloned()
            .ok_or_else(|| format!("Proto file not loaded: {}", proto_path))?
    };

    let target = normalize_target_with_tls(&request.target, request.tls.use_tls);
    let (input_type, output_type) = resolve_method_types_from_pool(&pool, &request.full_method)?;

    let input_desc = pool
        .get_message_by_name(&strip_leading_dot(&input_type))
        .ok_or_else(|| format!("Input message type not found: {}", input_type))?;
    let output_desc = pool
        .get_message_by_name(&strip_leading_dot(&output_type))
        .ok_or_else(|| format!("Output message type not found: {}", output_type))?;

    let input_msg = json_to_dynamic_message(&request.request_json, input_desc.clone())?;

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

    let codec = DynamicMessageCodec::new(input_desc, output_desc);

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

// Helper module for parsing proto files
mod protox_parse {
    use prost_reflect::DescriptorPool;
    use std::path::PathBuf;
    use std::process::Command;

    pub fn parse_proto_file(
        proto_path: &str,
        include_paths: &[PathBuf],
    ) -> Result<DescriptorPool, String> {
        // Use protoc to compile the proto file to a file descriptor set
        let protoc = find_protoc()?;

        let temp_dir = std::env::temp_dir();
        let descriptor_path = temp_dir.join(format!("resonance_proto_{}.pb", uuid::Uuid::new_v4()));

        let mut cmd = Command::new(&protoc);
        cmd.arg("--descriptor_set_out")
            .arg(&descriptor_path)
            .arg("--include_imports");

        for include in include_paths {
            cmd.arg("-I").arg(include);
        }

        cmd.arg(proto_path);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run protoc: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Clean up temp file if it exists
            let _ = std::fs::remove_file(&descriptor_path);
            return Err(format!("protoc failed: {}", stderr));
        }

        // Read the descriptor set
        let descriptor_bytes = std::fs::read(&descriptor_path)
            .map_err(|e| format!("Failed to read descriptor set: {}", e))?;

        // Clean up temp file
        let _ = std::fs::remove_file(&descriptor_path);

        // Parse into DescriptorPool
        DescriptorPool::decode(descriptor_bytes.as_slice())
            .map_err(|e| format!("Failed to parse descriptor set: {}", e))
    }

    fn find_protoc() -> Result<PathBuf, String> {
        // First try the vendored protoc from build dependencies
        if let Ok(path) = protoc_bin_vendored::protoc_bin_path() {
            return Ok(path);
        }

        // Fall back to system protoc
        if let Ok(path) = which::which("protoc") {
            return Ok(path);
        }

        Err("protoc not found. Please install Protocol Buffers compiler.".to_string())
    }
}

// Re-use helper functions from grpc_reflection module
fn normalize_target_with_tls(target: &str, use_tls: bool) -> String {
    let trimmed = target.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if use_tls {
        format!("https://{}", trimmed)
    } else {
        format!("http://{}", trimmed)
    }
}

async fn create_channel(
    target: &str,
    tls: &GrpcTlsOptions,
) -> Result<tonic::transport::Channel, String> {
    use tonic::transport::{ClientTlsConfig, Endpoint};

    let mut endpoint =
        Endpoint::from_shared(target.to_string()).map_err(|e| format!("Invalid target: {}", e))?;

    if tls.use_tls {
        let tls_config = ClientTlsConfig::new();
        endpoint = endpoint
            .tls_config(tls_config)
            .map_err(|e| format!("TLS config error: {}", e))?;
    }

    endpoint
        .connect()
        .await
        .map_err(|e| format!("Connection failed: {}", e))
}

fn strip_leading_dot(name: &str) -> String {
    name.strip_prefix('.').unwrap_or(name).to_string()
}

fn resolve_method_types_from_pool(
    pool: &DescriptorPool,
    full_method: &str,
) -> Result<(String, String), String> {
    let trimmed = full_method.trim();
    if !trimmed.starts_with('/') {
        return Err("fullMethod must start with '/'".to_string());
    }

    let parts: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() != 2 {
        return Err("fullMethod must be in the form '/package.Service/Method'".to_string());
    }

    let service_name = parts[0];
    let method_name = parts[1];

    let service = pool
        .get_service_by_name(service_name)
        .ok_or_else(|| format!("Service not found in descriptors: {}", service_name))?;

    let method = service
        .methods()
        .find(|m| m.name() == method_name)
        .ok_or_else(|| format!("Method not found: {} on {}", method_name, service_name))?;

    Ok((
        method.input().full_name().to_string(),
        method.output().full_name().to_string(),
    ))
}

fn json_to_dynamic_message(
    value: &Value,
    desc: prost_reflect::MessageDescriptor,
) -> Result<DynamicMessage, String> {
    let json = value.to_string();
    let mut de = serde_json::Deserializer::from_str(&json);
    DynamicMessage::deserialize(desc, &mut de)
        .map_err(|e| format!("Failed to map JSON to protobuf: {}", e))
}

fn dynamic_message_to_json(msg: &DynamicMessage) -> Result<Value, String> {
    serde_json::to_value(msg).map_err(|e| format!("Failed to map protobuf to JSON: {}", e))
}

fn metadata_to_json_map(meta: &tonic::metadata::MetadataMap) -> Value {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use tonic::metadata::KeyAndValueRef;

    let mut map = serde_json::Map::new();
    for kv in meta.iter() {
        match kv {
            KeyAndValueRef::Ascii(key, value) => {
                if let Ok(s) = value.to_str() {
                    map.insert(key.to_string(), Value::String(s.to_string()));
                }
            }
            KeyAndValueRef::Binary(key, value) => {
                map.insert(
                    key.to_string(),
                    Value::String(format!(
                        "base64:{}",
                        BASE64_STANDARD.encode(value.as_encoded_bytes())
                    )),
                );
            }
        }
    }
    Value::Object(map)
}

fn generate_message_skeleton(desc: &prost_reflect::MessageDescriptor) -> Value {
    let mut obj = serde_json::Map::new();

    for field in desc.fields() {
        let field_name = field.name().to_string();
        let field_value = generate_field_skeleton(&field);

        if field.is_list() {
            obj.insert(field_name, Value::Array(vec![field_value]));
        } else if field.is_map() {
            let mut map_obj = serde_json::Map::new();
            map_obj.insert("key".to_string(), Value::String("value".to_string()));
            obj.insert(field_name, Value::Object(map_obj));
        } else {
            obj.insert(field_name, field_value);
        }
    }

    Value::Object(obj)
}

fn generate_field_skeleton(field: &prost_reflect::FieldDescriptor) -> Value {
    use prost_reflect::Kind;

    match field.kind() {
        Kind::Double | Kind::Float => Value::Number(serde_json::Number::from_f64(0.0).unwrap()),
        Kind::Int32 | Kind::Sint32 | Kind::Sfixed32 => Value::Number(0.into()),
        Kind::Int64 | Kind::Sint64 | Kind::Sfixed64 => Value::Number(0.into()),
        Kind::Uint32 | Kind::Fixed32 => Value::Number(0.into()),
        Kind::Uint64 | Kind::Fixed64 => Value::Number(0.into()),
        Kind::Bool => Value::Bool(false),
        Kind::String => Value::String(String::new()),
        Kind::Bytes => Value::String(String::new()),
        Kind::Message(msg_desc) => generate_message_skeleton(&msg_desc),
        Kind::Enum(enum_desc) => {
            if let Some(first_value) = enum_desc.values().next() {
                Value::String(first_value.name().to_string())
            } else {
                Value::Number(0.into())
            }
        }
    }
}

// Codec for dynamic messages
struct DynamicMessageCodec {
    #[allow(dead_code)]
    input_desc: prost_reflect::MessageDescriptor,
    output_desc: prost_reflect::MessageDescriptor,
}

impl DynamicMessageCodec {
    fn new(
        input_desc: prost_reflect::MessageDescriptor,
        output_desc: prost_reflect::MessageDescriptor,
    ) -> Self {
        Self {
            input_desc,
            output_desc,
        }
    }
}

impl tonic::codec::Codec for DynamicMessageCodec {
    type Encode = DynamicMessage;
    type Decode = DynamicMessage;
    type Encoder = DynamicMessageEncoder;
    type Decoder = DynamicMessageDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        DynamicMessageEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        DynamicMessageDecoder {
            desc: self.output_desc.clone(),
        }
    }
}

struct DynamicMessageEncoder;

impl tonic::codec::Encoder for DynamicMessageEncoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn encode(
        &mut self,
        item: Self::Item,
        dst: &mut tonic::codec::EncodeBuf<'_>,
    ) -> Result<(), Self::Error> {
        use prost::Message;
        dst.reserve(item.encoded_len());
        item.encode(dst)
            .map_err(|e| tonic::Status::internal(format!("encode error: {}", e)))
    }
}

struct DynamicMessageDecoder {
    desc: prost_reflect::MessageDescriptor,
}

impl tonic::codec::Decoder for DynamicMessageDecoder {
    type Item = DynamicMessage;
    type Error = tonic::Status;

    fn decode(
        &mut self,
        src: &mut tonic::codec::DecodeBuf<'_>,
    ) -> Result<Option<Self::Item>, Self::Error> {
        use bytes::Buf;
        use prost::Message;

        if src.remaining() == 0 {
            return Ok(None);
        }

        let mut msg = DynamicMessage::new(self.desc.clone());
        msg.merge(src)
            .map_err(|e| tonic::Status::internal(format!("decode error: {}", e)))?;
        Ok(Some(msg))
    }
}
