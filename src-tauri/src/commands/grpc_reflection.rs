use super::api_request::ClientCertConfig;
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
    tonic::include_proto!("grpc.reflection.v1");
}

/// Kept only for the wire-compat test: v1 is a package rename of v1alpha with
/// identical field numbers, which is what lets `ReflectionClient` reuse the v1
/// types on the v1alpha method path.
#[cfg(test)]
pub mod reflection_v1alpha {
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
    /// Client identity (mTLS) and custom CA trust, resolved by the frontend
    /// from the per-host certificate store — same shape as the HTTP path.
    #[serde(default)]
    pub client_cert: Option<ClientCertConfig>,
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
    tls: Option<GrpcTlsOptions>,
) -> Result<Value, String> {
    let tls = tls.unwrap_or_default();
    let target = normalize_target_with_tls(&target, tls.use_tls);

    let channel = create_channel(&target, &tls).await?;
    let mut client = ReflectionClient::new(channel);

    let files = client.file_containing_symbol(&service_name).await?;

    let mut methods: Vec<Value> = Vec::new();
    for file in files {
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

    Ok(Value::Array(methods))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReflectionVersion {
    V1,
    V1Alpha,
}

impl ReflectionVersion {
    fn path(&self) -> &'static str {
        match self {
            ReflectionVersion::V1 => "/grpc.reflection.v1.ServerReflection/ServerReflectionInfo",
            ReflectionVersion::V1Alpha => {
                "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo"
            }
        }
    }
}

enum ReflectionCallError {
    Status(Status),
    Other(String),
}

impl ReflectionCallError {
    fn into_message(self) -> String {
        match self {
            ReflectionCallError::Status(status) => status.to_string(),
            ReflectionCallError::Other(message) => message,
        }
    }
}

/// Status codes that indicate the reflection service version is not exposed
/// (rather than a genuine failure), so the older v1alpha path should be tried.
fn should_fallback(status: &Status) -> bool {
    matches!(
        status.code(),
        tonic::Code::Unimplemented | tonic::Code::NotFound
    )
}

/// Reflection client that negotiates `grpc.reflection.v1` vs `v1alpha` on the
/// first call and pins the working version for the rest of the session. The
/// two protos are wire-identical (package rename only), so the v1 message
/// types are used on both paths.
pub(crate) struct ReflectionClient {
    grpc: tonic::client::Grpc<Channel>,
    version: Option<ReflectionVersion>,
}

impl ReflectionClient {
    pub(crate) fn new(channel: Channel) -> Self {
        Self {
            grpc: tonic::client::Grpc::new(channel),
            version: None,
        }
    }

    async fn call(
        &mut self,
        request: reflection::server_reflection_request::MessageRequest,
    ) -> Result<reflection::server_reflection_response::MessageResponse, String> {
        match self.version {
            Some(version) => self
                .call_version(version, request)
                .await
                .map_err(ReflectionCallError::into_message),
            None => match self
                .call_version(ReflectionVersion::V1, request.clone())
                .await
            {
                Ok(response) => {
                    self.version = Some(ReflectionVersion::V1);
                    Ok(response)
                }
                Err(ReflectionCallError::Status(status)) if should_fallback(&status) => {
                    let response = self
                        .call_version(ReflectionVersion::V1Alpha, request)
                        .await
                        .map_err(ReflectionCallError::into_message)?;
                    self.version = Some(ReflectionVersion::V1Alpha);
                    Ok(response)
                }
                Err(err) => Err(err.into_message()),
            },
        }
    }

    async fn call_version(
        &mut self,
        version: ReflectionVersion,
        request: reflection::server_reflection_request::MessageRequest,
    ) -> Result<reflection::server_reflection_response::MessageResponse, ReflectionCallError> {
        self.grpc.ready().await.map_err(|e| {
            ReflectionCallError::Other(format!("Reflection client not ready: {}", e))
        })?;

        let path: PathAndQuery = version
            .path()
            .parse()
            .map_err(|e| ReflectionCallError::Other(format!("Invalid reflection path: {}", e)))?;
        let codec = tonic::codec::ProstCodec::<
            reflection::ServerReflectionRequest,
            reflection::ServerReflectionResponse,
        >::default();

        let req = reflection::ServerReflectionRequest {
            host: String::new(),
            message_request: Some(request),
        };
        let request_stream = tokio_stream::iter(vec![req]);

        let response = self
            .grpc
            .streaming(Request::new(request_stream), path, codec)
            .await
            .map_err(ReflectionCallError::Status)?;
        let mut stream = response.into_inner();

        while let Some(resp) = stream
            .message()
            .await
            .map_err(ReflectionCallError::Status)?
        {
            if let Some(message_response) = resp.message_response {
                if let reflection::server_reflection_response::MessageResponse::ErrorResponse(err) =
                    message_response
                {
                    return Err(ReflectionCallError::Other(format!(
                        "Reflection error {}: {}",
                        err.error_code, err.error_message
                    )));
                }
                return Ok(message_response);
            }
        }

        Err(ReflectionCallError::Other(
            "No reflection response received".to_string(),
        ))
    }

    async fn file_descriptors(
        &mut self,
        request: reflection::server_reflection_request::MessageRequest,
    ) -> Result<Vec<prost_types::FileDescriptorProto>, String> {
        match self.call(request).await? {
            reflection::server_reflection_response::MessageResponse::FileDescriptorResponse(r) => {
                let mut out = Vec::new();
                for file_bytes in r.file_descriptor_proto {
                    out.push(
                        prost_types::FileDescriptorProto::decode(file_bytes.as_slice())
                            .map_err(|e| format!("Failed to decode FileDescriptorProto: {}", e))?,
                    );
                }
                Ok(out)
            }
            _ => Err("Unexpected reflection response".to_string()),
        }
    }

    pub(crate) async fn file_containing_symbol(
        &mut self,
        symbol: &str,
    ) -> Result<Vec<prost_types::FileDescriptorProto>, String> {
        self.file_descriptors(
            reflection::server_reflection_request::MessageRequest::FileContainingSymbol(
                symbol.to_string(),
            ),
        )
        .await
    }

    pub(crate) async fn file_by_filename(
        &mut self,
        filename: &str,
    ) -> Result<Vec<prost_types::FileDescriptorProto>, String> {
        self.file_descriptors(
            reflection::server_reflection_request::MessageRequest::FileByFilename(
                filename.to_string(),
            ),
        )
        .await
    }

    pub(crate) async fn list_services(&mut self) -> Result<Vec<String>, String> {
        match self
            .call(
                reflection::server_reflection_request::MessageRequest::ListServices(String::new()),
            )
            .await?
        {
            reflection::server_reflection_response::MessageResponse::ListServicesResponse(r) => {
                Ok(r.service.into_iter().map(|s| s.name).collect())
            }
            _ => Err("Unexpected reflection response".to_string()),
        }
    }
}

#[tauri::command]
pub async fn grpc_reflection_list_services(
    _app: AppHandle,
    target: String,
    tls: Option<GrpcTlsOptions>,
) -> Result<Value, String> {
    let tls = tls.unwrap_or_default();
    let target = normalize_target_with_tls(&target, tls.use_tls);

    let channel = create_channel(&target, &tls).await?;
    let mut client = ReflectionClient::new(channel);

    let services = client.list_services().await?;
    Ok(serde_json::to_value(services).unwrap())
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

pub(crate) fn normalize_target_with_tls(target: &str, use_tls: bool) -> String {
    let trimmed = target.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else if use_tls {
        format!("https://{}", trimmed)
    } else {
        format!("http://{}", trimmed)
    }
}

pub(crate) async fn create_channel(target: &str, tls: &GrpcTlsOptions) -> Result<Channel, String> {
    let endpoint =
        Endpoint::from_shared(target.to_string()).map_err(|e| format!("Invalid target: {}", e))?;

    if !tls.use_tls {
        return endpoint
            .connect()
            .await
            .map_err(|e| format!("Connection failed: {}", e));
    }

    let (cert_path, key_path, ca_path) = match &tls.client_cert {
        Some(cert) => (&cert.cert_path, &cert.key_path, &cert.ca_path),
        None => (&None, &None, &None),
    };
    let identity_pems = crate::commands::tls::load_identity_pems(cert_path, key_path)?;

    if tls.skip_verify {
        return connect_skip_verify(endpoint, identity_pems).await;
    }

    let mut tls_config = ClientTlsConfig::new().with_native_roots();
    if let Some(ca_pem) = crate::commands::tls::load_ca_pem(ca_path)? {
        tls_config = tls_config.ca_certificate(tonic::transport::Certificate::from_pem(ca_pem));
    }
    if let Some((cert_pem, key_pem)) = identity_pems {
        tls_config = tls_config.identity(tonic::transport::Identity::from_pem(cert_pem, key_pem));
    }

    endpoint
        .tls_config(tls_config)
        .map_err(|e| format!("TLS config error: {}", e))?
        .connect()
        .await
        .map_err(|e| format!("Connection failed: {}", e))
}

/// Connect with server-certificate verification disabled. tonic has no hook
/// for a custom certificate verifier, so the TLS handshake happens in a custom
/// connector and tonic receives an already-encrypted stream.
async fn connect_skip_verify(
    endpoint: Endpoint,
    identity_pems: Option<crate::commands::tls::IdentityPems>,
) -> Result<Channel, String> {
    let config = crate::commands::tls::build_danger_grpc_tls_config(identity_pems)?;
    let tls_connector = tokio_rustls::TlsConnector::from(std::sync::Arc::new(config));

    let connector = tower::service_fn(move |uri: http::Uri| {
        let tls_connector = tls_connector.clone();
        async move {
            let host = uri
                .host()
                .ok_or_else(|| {
                    std::io::Error::new(std::io::ErrorKind::InvalidInput, "target has no host")
                })?
                .to_string();
            let port = uri.port_u16().unwrap_or(443);

            let tcp = tokio::net::TcpStream::connect((host.as_str(), port)).await?;
            let server_name =
                rustls::pki_types::ServerName::try_from(host.clone()).map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        format!("invalid server name '{}': {}", host, e),
                    )
                })?;
            let stream = tls_connector.connect(server_name, tcp).await?;
            Ok::<_, std::io::Error>(hyper_util::rt::TokioIo::new(stream))
        }
    });

    endpoint
        .connect_with_connector(connector)
        .await
        .map_err(|e| format!("Connection failed: {}", e))
}

pub(crate) fn strip_leading_dot(name: &str) -> String {
    name.strip_prefix('.').unwrap_or(name).to_string()
}

pub(crate) fn metadata_to_json_map(meta: &tonic::metadata::MetadataMap) -> Value {
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

pub(crate) fn resolve_method_types(
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

pub(crate) fn json_to_dynamic_message(
    value: &Value,
    desc: prost_reflect::MessageDescriptor,
) -> Result<DynamicMessage, String> {
    let json = value.to_string();
    let mut de = serde_json::Deserializer::from_str(&json);
    DynamicMessage::deserialize(desc, &mut de)
        .map_err(|e| format!("Failed to map JSON to protobuf: {}", e))
}

pub(crate) fn dynamic_message_to_json(msg: &DynamicMessage) -> Result<Value, String> {
    serde_json::to_value(msg).map_err(|e| format!("Failed to map protobuf to JSON: {}", e))
}

#[tauri::command]
pub async fn grpc_get_input_skeleton(
    _app: AppHandle,
    target: String,
    full_method: String,
    tls: Option<GrpcTlsOptions>,
) -> Result<Value, String> {
    let tls = tls.unwrap_or_default();
    let target = normalize_target_with_tls(&target, tls.use_tls);

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

pub(crate) async fn build_descriptor_pool_for_method_with_tls(
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
    let mut client = ReflectionClient::new(channel);

    let mut collected: Vec<prost_types::FileDescriptorProto> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let initial = client.file_containing_symbol(service_symbol).await?;
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
            let dep_files = client.file_by_filename(&dep).await?;
            for fd in dep_files {
                queue_descriptor(&mut collected, &mut seen, fd);
            }
        }
    }

    let fds = prost_types::FileDescriptorSet { file: collected };
    DescriptorPool::from_file_descriptor_set(fds)
        .map_err(|e| format!("Failed to build descriptor pool: {}", e))
}

pub(crate) struct DynamicMessageCodec {
    #[allow(dead_code)]
    input_desc: prost_reflect::MessageDescriptor,
    output_desc: prost_reflect::MessageDescriptor,
}

impl DynamicMessageCodec {
    pub(crate) fn new(
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

pub(crate) struct DynamicMessageEncoder;

impl Encoder for DynamicMessageEncoder {
    type Item = DynamicMessage;
    type Error = Status;

    fn encode(&mut self, item: Self::Item, dst: &mut EncodeBuf<'_>) -> Result<(), Self::Error> {
        dst.reserve(item.encoded_len());
        item.encode(dst)
            .map_err(|e| Status::internal(format!("encode error: {}", e)))
    }
}

pub(crate) struct DynamicMessageDecoder {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_and_v1alpha_reflection_messages_are_wire_compatible() {
        let v1_request = reflection::ServerReflectionRequest {
            host: "example.com".to_string(),
            message_request: Some(
                reflection::server_reflection_request::MessageRequest::FileContainingSymbol(
                    "pkg.Service".to_string(),
                ),
            ),
        };
        let bytes = v1_request.encode_to_vec();
        let decoded =
            reflection_v1alpha::ServerReflectionRequest::decode(bytes.as_slice()).unwrap();
        assert_eq!(decoded.host, "example.com");
        assert!(matches!(
            decoded.message_request,
            Some(
                reflection_v1alpha::server_reflection_request::MessageRequest::FileContainingSymbol(
                    ref s
                )
            ) if s == "pkg.Service"
        ));

        let v1alpha_response = reflection_v1alpha::ServerReflectionResponse {
            valid_host: "example.com".to_string(),
            original_request: None,
            message_response: Some(
                reflection_v1alpha::server_reflection_response::MessageResponse::ListServicesResponse(
                    reflection_v1alpha::ListServiceResponse {
                        service: vec![reflection_v1alpha::ServiceResponse {
                            name: "pkg.Service".to_string(),
                        }],
                    },
                ),
            ),
        };
        let bytes = v1alpha_response.encode_to_vec();
        let decoded = reflection::ServerReflectionResponse::decode(bytes.as_slice()).unwrap();
        assert!(matches!(
            decoded.message_response,
            Some(reflection::server_reflection_response::MessageResponse::ListServicesResponse(
                ref r
            )) if r.service.len() == 1 && r.service[0].name == "pkg.Service"
        ));
    }

    #[test]
    fn fallback_triggers_only_on_missing_service_codes() {
        assert!(should_fallback(&Status::unimplemented("no v1")));
        assert!(should_fallback(&Status::not_found("no route")));
        assert!(!should_fallback(&Status::unavailable("down")));
        assert!(!should_fallback(&Status::deadline_exceeded("slow")));
        assert!(!should_fallback(&Status::permission_denied("denied")));
    }

    #[test]
    fn tls_options_deserialize_legacy_and_full_payloads() {
        let legacy: GrpcTlsOptions =
            serde_json::from_value(serde_json::json!({ "useTls": true, "skipVerify": true }))
                .unwrap();
        assert!(legacy.use_tls);
        assert!(legacy.skip_verify);
        assert!(legacy.client_cert.is_none());

        let full: GrpcTlsOptions = serde_json::from_value(serde_json::json!({
            "useTls": true,
            "skipVerify": false,
            "clientCert": {
                "certPath": "/tmp/client.pem",
                "keyPath": "/tmp/client.key",
                "caPath": "/tmp/ca.pem"
            }
        }))
        .unwrap();
        let cert = full.client_cert.expect("client cert present");
        assert_eq!(cert.cert_path.as_deref(), Some("/tmp/client.pem"));
        assert_eq!(cert.key_path.as_deref(), Some("/tmp/client.key"));
        assert_eq!(cert.ca_path.as_deref(), Some("/tmp/ca.pem"));
    }

    #[test]
    fn normalize_target_prefixes_scheme_by_tls_mode() {
        assert_eq!(
            normalize_target_with_tls("localhost:50051", false),
            "http://localhost:50051"
        );
        assert_eq!(
            normalize_target_with_tls("localhost:50051", true),
            "https://localhost:50051"
        );
        assert_eq!(
            normalize_target_with_tls("https://api.example.com", false),
            "https://api.example.com"
        );
    }
}
