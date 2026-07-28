use std::collections::HashMap;
use std::sync::Arc;

use http::uri::PathAndQuery;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{mpsc, Mutex};
use tokio::task::AbortHandle;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tonic::metadata::{MetadataKey, MetadataValue};
use tonic::Request;

use super::grpc_proto::ProtoState;
use super::grpc_reflection::{
    build_descriptor_pool_for_method_with_tls, create_channel, dynamic_message_to_json,
    json_to_dynamic_message, metadata_to_json_map, normalize_target_with_tls, resolve_method_types,
    strip_leading_dot, DynamicMessageCodec, GrpcTlsOptions,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcStreamRequest {
    pub tab_id: String,
    pub target: String,
    pub full_method: String,
    #[serde(default)]
    pub request_json: Option<Value>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub tls: GrpcTlsOptions,
    #[serde(default)]
    pub proto_path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GrpcStreamCommandResponse {
    pub success: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrpcStreamEventPayload {
    tab_id: String,
    event_type: String,
    full_method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trailers: Option<Value>,
}

struct GrpcStreamHandle {
    sender: Option<mpsc::UnboundedSender<DynamicMessage>>,
    input_desc: MessageDescriptor,
    full_method: String,
    abort: AbortHandle,
    // Client-streaming-only: cancel half-closes (drops sender) so the server can respond
    // naturally, instead of aborting the spawned task.
    client_streaming_only: bool,
}

pub struct GrpcStreamingState {
    streams: Arc<Mutex<HashMap<String, GrpcStreamHandle>>>,
}

impl Default for GrpcStreamingState {
    fn default() -> Self {
        Self {
            streams: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl GrpcStreamEventPayload {
    fn new(tab_id: &str, full_method: &str, event_type: &str) -> Self {
        Self {
            tab_id: tab_id.to_string(),
            event_type: event_type.to_string(),
            full_method: full_method.to_string(),
            message: None,
            status: None,
            status_message: None,
            headers: None,
            trailers: None,
        }
    }

    /// Response headers are only known up front for the paths that await the
    /// stream's opening metadata; client-streaming reports them with the reply.
    fn open(tab_id: &str, full_method: &str, headers: Option<Value>) -> Self {
        Self {
            headers,
            ..Self::new(tab_id, full_method, "open")
        }
    }

    fn message(tab_id: &str, full_method: &str, data: Value, headers: Option<Value>) -> Self {
        Self {
            message: Some(data),
            headers,
            ..Self::new(tab_id, full_method, "message")
        }
    }

    fn close_ok(tab_id: &str, full_method: &str, trailers: Option<Value>) -> Self {
        Self {
            status: Some(0),
            status_message: Some("OK".to_string()),
            trailers,
            ..Self::new(tab_id, full_method, "close")
        }
    }

    fn close(tab_id: &str, full_method: &str, status: i32, status_message: String) -> Self {
        Self {
            status: Some(status),
            status_message: Some(status_message),
            ..Self::new(tab_id, full_method, "close")
        }
    }

    fn error(tab_id: &str, full_method: &str, status: i32, status_message: String) -> Self {
        Self {
            status: Some(status),
            status_message: Some(status_message),
            ..Self::new(tab_id, full_method, "error")
        }
    }
}

fn emit(app: &AppHandle, payload: GrpcStreamEventPayload) {
    let _ = app.emit("grpc-stream-event", payload);
}

/// A failed stream reports its status twice: as `error` so the UI can surface
/// it, then as `close` so the stream is torn down like any other. Both carry
/// the same code and message.
fn emit_error_and_close(app: &AppHandle, tab_id: &str, full_method: &str, status: &tonic::Status) {
    let code = status.code() as i32;
    let message = status.message().to_string();
    emit(
        app,
        GrpcStreamEventPayload::error(tab_id, full_method, code, message.clone()),
    );
    emit(
        app,
        GrpcStreamEventPayload::close(tab_id, full_method, code, message),
    );
}

fn apply_metadata<T>(
    req: &mut Request<T>,
    metadata: HashMap<String, String>,
) -> Result<(), String> {
    for (k, v) in metadata {
        let key = MetadataKey::from_bytes(k.as_bytes())
            .map_err(|e| format!("Invalid metadata key '{}': {}", k, e))?;
        let val = MetadataValue::try_from(v)
            .map_err(|e| format!("Invalid metadata value for '{}': {}", key, e))?;
        req.metadata_mut().insert(key, val);
    }
    Ok(())
}

fn resolve_method_streaming(
    pool: &DescriptorPool,
    full_method: &str,
) -> Result<(bool, bool), String> {
    let trimmed = full_method.trim();
    let parts: Vec<&str> = trimmed.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() != 2 {
        return Err("fullMethod must be in the form '/package.Service/Method'".to_string());
    }
    let service = pool
        .get_service_by_name(parts[0])
        .ok_or_else(|| format!("Service not found in descriptors: {}", parts[0]))?;
    let method = service
        .methods()
        .find(|m| m.name() == parts[1])
        .ok_or_else(|| format!("Method not found: {} on {}", parts[1], parts[0]))?;
    Ok((method.is_client_streaming(), method.is_server_streaming()))
}

#[tauri::command]
pub async fn grpc_stream_start(
    app: AppHandle,
    state: State<'_, GrpcStreamingState>,
    proto_state: State<'_, ProtoState>,
    request: GrpcStreamRequest,
) -> Result<GrpcStreamCommandResponse, String> {
    if request.tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }

    // Close any existing stream for this tab before opening a new one
    {
        let mut streams = state.streams.lock().await;
        if let Some(handle) = streams.remove(&request.tab_id) {
            handle.abort.abort();
            drop(handle.sender);
        }
    }

    let target = normalize_target_with_tls(&request.target, request.tls.use_tls);

    let pool: DescriptorPool = if let Some(proto_path) = &request.proto_path {
        let pools = proto_state.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(proto_path)
            .cloned()
            .ok_or_else(|| format!("Proto file not loaded: {}", proto_path))?
    } else {
        build_descriptor_pool_for_method_with_tls(&target, &request.full_method, &request.tls)
            .await?
    };

    let (input_type, output_type) = resolve_method_types(&pool, &request.full_method)?;
    let (is_client_streaming, is_server_streaming) =
        resolve_method_streaming(&pool, &request.full_method)?;

    if !is_server_streaming && !is_client_streaming {
        return Err("Use grpc_invoke_unary for unary methods".to_string());
    }

    let input_desc = pool
        .get_message_by_name(&strip_leading_dot(&input_type))
        .ok_or_else(|| format!("Input message type not found: {}", input_type))?;
    let output_desc = pool
        .get_message_by_name(&strip_leading_dot(&output_type))
        .ok_or_else(|| format!("Output message type not found: {}", output_type))?;

    let channel = create_channel(&target, &request.tls).await?;
    let mut grpc = tonic::client::Grpc::new(channel);
    grpc.ready()
        .await
        .map_err(|e| format!("gRPC client not ready: {}", e))?;

    let path: PathAndQuery = request
        .full_method
        .parse()
        .map_err(|e| format!("Invalid method path: {}", e))?;

    let codec = DynamicMessageCodec::new(output_desc);
    let tab_id = request.tab_id.clone();
    let full_method = request.full_method.clone();
    let metadata = request.metadata.clone();

    // Client-streaming-only: many requests → single response. The call only
    // resolves once the client half-closes (sender dropped), so we can't await
    // it here — spawn a task that awaits and emits message + close when the
    // server replies.
    if is_client_streaming && !is_server_streaming {
        let (tx, rx) = mpsc::unbounded_channel::<DynamicMessage>();
        let request_stream = UnboundedReceiverStream::new(rx);
        if let Some(initial) = &request.request_json {
            let msg = json_to_dynamic_message(initial, input_desc.clone())?;
            let _ = tx.send(msg);
        }
        let mut req = Request::new(request_stream);
        apply_metadata(&mut req, metadata)?;

        emit(
            &app,
            GrpcStreamEventPayload::open(&tab_id, &full_method, None),
        );

        let read_app = app.clone();
        let read_state = state.streams.clone();
        let read_tab_id = tab_id.clone();
        let read_full_method = full_method.clone();

        let join = tokio::spawn(async move {
            match grpc.client_streaming(req, path, codec).await {
                Ok(response) => {
                    let headers = metadata_to_json_map(response.metadata());
                    let msg = response.into_inner();
                    let data = dynamic_message_to_json(&msg).unwrap_or(Value::Null);
                    emit(
                        &read_app,
                        GrpcStreamEventPayload::message(
                            &read_tab_id,
                            &read_full_method,
                            data,
                            Some(headers),
                        ),
                    );
                    emit(
                        &read_app,
                        GrpcStreamEventPayload::close_ok(&read_tab_id, &read_full_method, None),
                    );
                }
                Err(status) => {
                    emit_error_and_close(&read_app, &read_tab_id, &read_full_method, &status);
                }
            }

            let mut streams = read_state.lock().await;
            if matches!(streams.get(&read_tab_id), Some(h) if h.full_method == read_full_method) {
                streams.remove(&read_tab_id);
            }
        });

        let abort = join.abort_handle();
        {
            let mut streams = state.streams.lock().await;
            streams.insert(
                tab_id,
                GrpcStreamHandle {
                    sender: Some(tx),
                    input_desc,
                    full_method,
                    abort,
                    client_streaming_only: true,
                },
            );
        }
        return Ok(GrpcStreamCommandResponse { success: true });
    }

    let (sender_opt, mut response_stream, headers) = if is_client_streaming {
        // Bidirectional
        let (tx, rx) = mpsc::unbounded_channel::<DynamicMessage>();
        let request_stream = UnboundedReceiverStream::new(rx);
        if let Some(initial) = &request.request_json {
            let msg = json_to_dynamic_message(initial, input_desc.clone())?;
            let _ = tx.send(msg);
        }
        let mut req = Request::new(request_stream);
        apply_metadata(&mut req, metadata)?;
        let response = grpc
            .streaming(req, path, codec)
            .await
            .map_err(|e| format!("Failed to start streaming call: {}", e))?;
        let headers = metadata_to_json_map(response.metadata());
        (Some(tx), response.into_inner(), headers)
    } else {
        // Server-streaming
        let initial_json = request
            .request_json
            .clone()
            .unwrap_or_else(|| Value::Object(Default::default()));
        let initial = json_to_dynamic_message(&initial_json, input_desc.clone())?;
        let mut req = Request::new(initial);
        apply_metadata(&mut req, metadata)?;
        let response = grpc
            .server_streaming(req, path, codec)
            .await
            .map_err(|e| format!("Failed to start server streaming: {}", e))?;
        let headers = metadata_to_json_map(response.metadata());
        (None, response.into_inner(), headers)
    };

    emit(
        &app,
        GrpcStreamEventPayload::open(&tab_id, &full_method, Some(headers)),
    );

    let read_app = app.clone();
    let read_state = state.streams.clone();
    let read_tab_id = tab_id.clone();
    let read_full_method = full_method.clone();

    let join = tokio::spawn(async move {
        loop {
            match response_stream.message().await {
                Ok(Some(msg)) => {
                    let data = dynamic_message_to_json(&msg).unwrap_or(Value::Null);
                    emit(
                        &read_app,
                        GrpcStreamEventPayload::message(
                            &read_tab_id,
                            &read_full_method,
                            data,
                            None,
                        ),
                    );
                }
                Ok(None) => {
                    let trailers = response_stream
                        .trailers()
                        .await
                        .ok()
                        .flatten()
                        .map(|m| metadata_to_json_map(&m));
                    emit(
                        &read_app,
                        GrpcStreamEventPayload::close_ok(&read_tab_id, &read_full_method, trailers),
                    );
                    break;
                }
                Err(status) => {
                    emit_error_and_close(&read_app, &read_tab_id, &read_full_method, &status);
                    break;
                }
            }
        }

        let mut streams = read_state.lock().await;
        if matches!(streams.get(&read_tab_id), Some(h) if h.full_method == read_full_method) {
            streams.remove(&read_tab_id);
        }
    });

    let abort = join.abort_handle();

    {
        let mut streams = state.streams.lock().await;
        streams.insert(
            tab_id,
            GrpcStreamHandle {
                sender: sender_opt,
                input_desc,
                full_method,
                abort,
                client_streaming_only: false,
            },
        );
    }

    Ok(GrpcStreamCommandResponse { success: true })
}

#[tauri::command]
pub async fn grpc_stream_send(
    state: State<'_, GrpcStreamingState>,
    tab_id: String,
    message_json: Value,
) -> Result<GrpcStreamCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }
    let streams = state.streams.lock().await;
    let handle = streams
        .get(&tab_id)
        .ok_or_else(|| "No active gRPC stream for this tab".to_string())?;
    let sender = handle
        .sender
        .as_ref()
        .ok_or_else(|| "This stream does not accept additional client messages".to_string())?;
    let msg = json_to_dynamic_message(&message_json, handle.input_desc.clone())?;
    sender
        .send(msg)
        .map_err(|_| "Failed to send: stream is closed".to_string())?;
    Ok(GrpcStreamCommandResponse { success: true })
}

#[tauri::command]
pub async fn grpc_stream_cancel(
    app: AppHandle,
    state: State<'_, GrpcStreamingState>,
    tab_id: String,
) -> Result<GrpcStreamCommandResponse, String> {
    if tab_id.trim().is_empty() {
        return Err("Tab ID is required".to_string());
    }
    let handle = {
        let mut streams = state.streams.lock().await;
        streams.remove(&tab_id)
    };
    if let Some(handle) = handle {
        let GrpcStreamHandle {
            sender,
            full_method,
            abort,
            client_streaming_only,
            ..
        } = handle;
        // Half-close in all cases so the server-side request stream ends.
        drop(sender);
        if client_streaming_only {
            // Let the spawned task await the server's single response and
            // emit message + close naturally. Don't abort, don't pre-emit close.
        } else {
            abort.abort();
            emit(
                &app,
                GrpcStreamEventPayload::close(
                    &tab_id,
                    &full_method,
                    tonic::Code::Cancelled as i32,
                    "cancelled".to_string(),
                ),
            );
        }
    }
    Ok(GrpcStreamCommandResponse { success: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(payload: GrpcStreamEventPayload) -> Value {
        serde_json::to_value(payload).unwrap()
    }

    /// The payload is a frontend contract, so pin what each constructor emits
    /// and — just as importantly — what it leaves out.
    #[test]
    fn payload_constructors_emit_the_expected_wire_shapes() {
        let open = json(GrpcStreamEventPayload::open(
            "tab-1",
            "/pkg.Svc/Method",
            None,
        ));
        assert_eq!(open["tabId"], "tab-1");
        assert_eq!(open["eventType"], "open");
        assert_eq!(open["fullMethod"], "/pkg.Svc/Method");
        assert!(open.get("headers").is_none());
        assert!(open.get("status").is_none());

        let open_with_headers = json(GrpcStreamEventPayload::open(
            "tab-1",
            "/pkg.Svc/Method",
            Some(serde_json::json!({ "x-trace": "abc" })),
        ));
        assert_eq!(open_with_headers["headers"]["x-trace"], "abc");

        let message = json(GrpcStreamEventPayload::message(
            "tab-1",
            "/pkg.Svc/Method",
            serde_json::json!({ "ok": true }),
            None,
        ));
        assert_eq!(message["eventType"], "message");
        assert_eq!(message["message"]["ok"], true);
        assert!(message.get("headers").is_none());

        let close_ok = json(GrpcStreamEventPayload::close_ok(
            "tab-1",
            "/pkg.Svc/Method",
            None,
        ));
        assert_eq!(close_ok["eventType"], "close");
        assert_eq!(close_ok["status"], 0);
        assert_eq!(close_ok["statusMessage"], "OK");
        assert!(close_ok.get("trailers").is_none());

        let close_ok_trailers = json(GrpcStreamEventPayload::close_ok(
            "tab-1",
            "/pkg.Svc/Method",
            Some(serde_json::json!({ "grpc-status": "0" })),
        ));
        assert_eq!(close_ok_trailers["trailers"]["grpc-status"], "0");

        let error = json(GrpcStreamEventPayload::error(
            "tab-1",
            "/pkg.Svc/Method",
            14,
            "unavailable".to_string(),
        ));
        assert_eq!(error["eventType"], "error");
        assert_eq!(error["status"], 14);
        assert_eq!(error["statusMessage"], "unavailable");

        let close = json(GrpcStreamEventPayload::close(
            "tab-1",
            "/pkg.Svc/Method",
            1,
            "cancelled".to_string(),
        ));
        assert_eq!(close["eventType"], "close");
        assert_eq!(close["status"], 1);
        assert_eq!(close["statusMessage"], "cancelled");
    }

    /// A failure emits error then close, both carrying the same status, so the
    /// UI can surface the reason and still tear the stream down.
    #[test]
    fn an_error_and_its_close_carry_the_same_status() {
        let status = tonic::Status::new(tonic::Code::Unavailable, "backend down");
        let code = status.code() as i32;

        let error = json(GrpcStreamEventPayload::error(
            "tab-1",
            "/pkg.Svc/Method",
            code,
            status.message().to_string(),
        ));
        let close = json(GrpcStreamEventPayload::close(
            "tab-1",
            "/pkg.Svc/Method",
            code,
            status.message().to_string(),
        ));

        assert_eq!(error["status"], close["status"]);
        assert_eq!(error["statusMessage"], close["statusMessage"]);
        assert_eq!(error["eventType"], "error");
        assert_eq!(close["eventType"], "close");
    }
}
