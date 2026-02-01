use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use bytes::Buf;
use http::uri::PathAndQuery;
use prost::Message;
use prost_reflect::{DescriptorPool, DynamicMessage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::metadata::KeyAndValueRef;
use tonic::metadata::{MetadataKey, MetadataValue};
use tonic::transport::Channel;
use tonic::transport::{ClientTlsConfig, Endpoint};
use tonic::{Request, Status};

pub mod reflection {
    #![allow(dead_code)]
    tonic::include_proto!("grpc.reflection.v1alpha");
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GrpcTlsOptions {
    #[serde(default)]
    pub use_tls: bool,
    #[serde(default)]
    pub skip_verify: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcUnaryRequest {
    pub target: String,
    pub full_method: String,
    pub request_json: Value,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    pub deadline_ms: Option<u64>,
    #[serde(default)]
    pub tls: GrpcTlsOptions,
}

#[tauri::command]
pub async fn grpc_invoke_unary(
    _app: AppHandle,
    request: GrpcUnaryRequest,
) -> Result<Value, String> {
    let target = normalize_target_with_tls(&request.target, request.tls.use_tls);
    let pool =
        build_descriptor_pool_for_method_with_tls(&target, &request.full_method, &request.tls)
            .await?;
    let (input_type, output_type) = resolve_method_types(&pool, &request.full_method)?;

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
    let response = if let Some(ms) = request.deadline_ms {
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

#[tauri::command]
pub async fn grpc_reflection_list_methods(
    _app: AppHandle,
    target: String,
    service_name: String,
    use_tls: Option<bool>,
) -> Result<Value, String> {
    let use_tls = use_tls.unwrap_or(false);
    let tls = GrpcTlsOptions {
        use_tls,
        skip_verify: false,
    };
    let target = normalize_target_with_tls(&target, use_tls);

    let channel = create_channel(&target, &tls).await?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Reflection client not ready: {}", e))?;

    let req = reflection::ServerReflectionRequest {
        host: "".to_string(),
        message_request: Some(
            reflection::server_reflection_request::MessageRequest::FileContainingSymbol(
                service_name.clone(),
            ),
        ),
    };

    let mut stream = reflection_info_stream(&mut grpc, req).await?;

    while let Some(resp) = stream.message().await.map_err(|e| e.to_string())? {
        match resp.message_response {
            Some(
                reflection::server_reflection_response::MessageResponse::FileDescriptorResponse(r),
            ) => {
                let mut methods: Vec<Value> = Vec::new();

                for file_bytes in r.file_descriptor_proto {
                    let file = prost_types::FileDescriptorProto::decode(file_bytes.as_slice())
                        .map_err(|e| format!("Failed to decode FileDescriptorProto: {}", e))?;

                    let pkg = file.package.unwrap_or_default();
                    for svc in file.service {
                        let svc_name = svc.name.unwrap_or_default();
                        let full_svc_name = if pkg.is_empty() {
                            svc_name.clone()
                        } else {
                            format!("{}.{}", pkg, svc_name)
                        };

                        if full_svc_name != service_name {
                            continue;
                        }

                        for m in svc.method {
                            methods.push(serde_json::json!({
                                "name": m.name.clone().unwrap_or_default(),
                                "fullMethod": format!("/{}/{}", full_svc_name, m.name.unwrap_or_default()),
                                "inputType": m.input_type.unwrap_or_default(),
                                "outputType": m.output_type.unwrap_or_default(),
                                "clientStreaming": m.client_streaming.unwrap_or(false),
                                "serverStreaming": m.server_streaming.unwrap_or(false)
                            }));
                        }
                    }
                }

                return Ok(Value::Array(methods));
            }
            Some(reflection::server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                return Err(format!(
                    "Reflection error {}: {}",
                    err.error_code, err.error_message
                ));
            }
            _ => {}
        }
    }

    Err("No reflection response received".to_string())
}

async fn reflection_info_stream(
    grpc: &mut tonic::client::Grpc<Channel>,
    req: reflection::ServerReflectionRequest,
) -> Result<tonic::Streaming<reflection::ServerReflectionResponse>, String> {
    grpc.ready()
        .await
        .map_err(|e| format!("Reflection client not ready: {}", e))?;

    let path: PathAndQuery = "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo"
        .parse()
        .map_err(|e| format!("Invalid reflection path: {}", e))?;
    let codec = tonic::codec::ProstCodec::<
        reflection::ServerReflectionRequest,
        reflection::ServerReflectionResponse,
    >::default();

    let request_stream = tokio_stream::iter(vec![req]);
    let request = Request::new(request_stream);

    let resp = grpc
        .streaming(request, path, codec)
        .await
        .map_err(|e| e.to_string())?;

    Ok(resp.into_inner())
}

#[tauri::command]
pub async fn grpc_reflection_list_services(
    _app: AppHandle,
    target: String,
    use_tls: Option<bool>,
) -> Result<Value, String> {
    let use_tls = use_tls.unwrap_or(false);
    let tls = GrpcTlsOptions {
        use_tls,
        skip_verify: false,
    };
    let target = normalize_target_with_tls(&target, use_tls);

    let channel = create_channel(&target, &tls).await?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Reflection client not ready: {}", e))?;

    let req = reflection::ServerReflectionRequest {
        host: "".to_string(),
        message_request: Some(
            reflection::server_reflection_request::MessageRequest::ListServices("".to_string()),
        ),
    };

    let mut stream = reflection_info_stream(&mut grpc, req).await?;

    while let Some(resp) = stream.message().await.map_err(|e| e.to_string())? {
        match resp.message_response {
            Some(
                reflection::server_reflection_response::MessageResponse::ListServicesResponse(r),
            ) => {
                let services: Vec<String> = r.service.into_iter().map(|s| s.name).collect();
                return Ok(serde_json::to_value(services).unwrap());
            }
            Some(reflection::server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                return Err(format!(
                    "Reflection error {}: {}",
                    err.error_code, err.error_message
                ));
            }
            _ => {}
        }
    }

    Err("No reflection response received".to_string())
}

#[allow(dead_code)]
fn normalize_target(target: String) -> String {
    let trimmed = target.trim().to_string();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed
    } else {
        format!("http://{}", trimmed)
    }
}

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

async fn create_channel(target: &str, tls: &GrpcTlsOptions) -> Result<Channel, String> {
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

fn metadata_to_json_map(meta: &tonic::metadata::MetadataMap) -> Value {
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

fn resolve_method_types(
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

#[tauri::command]
pub async fn grpc_get_input_skeleton(
    _app: AppHandle,
    target: String,
    full_method: String,
    use_tls: Option<bool>,
) -> Result<Value, String> {
    let use_tls = use_tls.unwrap_or(false);
    let tls = GrpcTlsOptions {
        use_tls,
        skip_verify: false,
    };
    let target = normalize_target_with_tls(&target, use_tls);

    let pool = build_descriptor_pool_for_method_with_tls(&target, &full_method, &tls).await?;
    let (input_type, _) = resolve_method_types(&pool, &full_method)?;

    let input_desc = pool
        .get_message_by_name(&strip_leading_dot(&input_type))
        .ok_or_else(|| format!("Input message type not found: {}", input_type))?;

    let skeleton = generate_message_skeleton(&input_desc);
    Ok(skeleton)
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

#[allow(dead_code)]
async fn build_descriptor_pool_for_method(
    target: &str,
    full_method: &str,
) -> Result<DescriptorPool, String> {
    build_descriptor_pool_for_method_with_tls(target, full_method, &GrpcTlsOptions::default()).await
}

async fn build_descriptor_pool_for_method_with_tls(
    target: &str,
    full_method: &str,
    tls: &GrpcTlsOptions,
) -> Result<DescriptorPool, String> {
    let trimmed = full_method.trim();
    if !trimmed.starts_with('/') {
        return Err("fullMethod must start with '/'".to_string());
    }
    let parts: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() != 2 {
        return Err("fullMethod must be in the form '/package.Service/Method'".to_string());
    }
    let service_symbol = parts[0];

    let channel = create_channel(target, tls).await?;

    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("Reflection client not ready: {}", e))?;

    let mut collected: Vec<prost_types::FileDescriptorProto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let initial = reflection_request_file_containing_symbol(&mut grpc, service_symbol).await?;
    for fd in initial {
        queue_descriptor(&mut collected, &mut seen, fd);
    }

    let mut idx = 0;
    while idx < collected.len() {
        let deps = collected[idx].dependency.clone();
        idx += 1;
        for dep in deps {
            if seen.contains(&dep) {
                continue;
            }
            let dep_files = reflection_request_file_by_filename(&mut grpc, &dep).await?;
            for fd in dep_files {
                queue_descriptor(&mut collected, &mut seen, fd);
            }
        }
    }

    let fds = prost_types::FileDescriptorSet { file: collected };
    DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| format!("Failed to build descriptor pool: {}", e))
}

#[allow(dead_code)]
struct DynamicMessageCodec {
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

impl Codec for DynamicMessageCodec {
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

impl Encoder for DynamicMessageEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.reserve(item.encoded_len());
        item.encode(dst)
            .map_err(|e| Status::internal(format!("encode error: {}", e)))
    }
}

struct DynamicMessageDecoder {
    desc: prost_reflect::MessageDescriptor,
}

impl Decoder for DynamicMessageDecoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn decode(&mut self, src: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        if src.remaining() == 0 {
            return Ok(None);
        }

        let mut msg = DynamicMessage::new(self.desc.clone());
        msg.merge(src)
            .map_err(|e| Status::internal(format!("decode error: {}", e)))?;
        Ok(Some(msg))
    }
}

fn queue_descriptor(
    collected: &mut Vec<prost_types::FileDescriptorProto>,
    seen: &mut HashSet<String>,
    fd: prost_types::FileDescriptorProto,
) {
    if let Some(name) = fd.name.clone() {
        if seen.insert(name) {
            collected.push(fd);
        }
    }
}

async fn reflection_request_file_containing_symbol(
    grpc: &mut tonic::client::Grpc<Channel>,
    symbol: &str,
) -> Result<Vec<prost_types::FileDescriptorProto>, String> {
    let req = reflection::ServerReflectionRequest {
        host: "".to_string(),
        message_request: Some(
            reflection::server_reflection_request::MessageRequest::FileContainingSymbol(
                symbol.to_string(),
            ),
        ),
    };

    let mut stream = reflection_info_stream(grpc, req).await?;

    while let Some(resp) = stream.message().await.map_err(|e| e.to_string())? {
        match resp.message_response {
            Some(
                reflection::server_reflection_response::MessageResponse::FileDescriptorResponse(r),
            ) => {
                let mut out = Vec::new();
                for file_bytes in r.file_descriptor_proto {
                    out.push(
                        prost_types::FileDescriptorProto::decode(file_bytes.as_slice())
                            .map_err(|e| format!("Failed to decode FileDescriptorProto: {}", e))?,
                    );
                }
                return Ok(out);
            }
            Some(reflection::server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                return Err(format!(
                    "Reflection error {}: {}",
                    err.error_code, err.error_message
                ));
            }
            _ => {}
        }
    }

    Err("No reflection response received".to_string())
}

async fn reflection_request_file_by_filename(
    grpc: &mut tonic::client::Grpc<Channel>,
    filename: &str,
) -> Result<Vec<prost_types::FileDescriptorProto>, String> {
    let req = reflection::ServerReflectionRequest {
        host: "".to_string(),
        message_request: Some(
            reflection::server_reflection_request::MessageRequest::FileByFilename(
                filename.to_string(),
            ),
        ),
    };

    let mut stream = reflection_info_stream(grpc, req).await?;

    while let Some(resp) = stream.message().await.map_err(|e| e.to_string())? {
        match resp.message_response {
            Some(
                reflection::server_reflection_response::MessageResponse::FileDescriptorResponse(r),
            ) => {
                let mut out = Vec::new();
                for file_bytes in r.file_descriptor_proto {
                    out.push(
                        prost_types::FileDescriptorProto::decode(file_bytes.as_slice())
                            .map_err(|e| format!("Failed to decode FileDescriptorProto: {}", e))?,
                    );
                }
                return Ok(out);
            }
            Some(reflection::server_reflection_response::MessageResponse::ErrorResponse(err)) => {
                return Err(format!(
                    "Reflection error {}: {}",
                    err.error_code, err.error_message
                ));
            }
            _ => {}
        }
    }

    Err("No reflection response received".to_string())
}
