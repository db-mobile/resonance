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

fn emit(app: &AppHandle, payload: GrpcStreamEventPayload) {
    let _ = app.emit("grpc-stream-event", payload);
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

    let codec = DynamicMessageCodec::new(input_desc.clone(), output_desc);
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
            GrpcStreamEventPayload {
                tab_id: tab_id.clone(),
                event_type: "open".to_string(),
                full_method: full_method.clone(),
                message: None,
                status: None,
                status_message: None,
                headers: None,
                trailers: None,
            },
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
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "message".to_string(),
                            full_method: read_full_method.clone(),
                            message: Some(data),
                            status: None,
                            status_message: None,
                            headers: Some(headers),
                            trailers: None,
                        },
                    );
                    emit(
                        &read_app,
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "close".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(0),
                            status_message: Some("OK".to_string()),
                            headers: None,
                            trailers: None,
                        },
                    );
                }
                Err(status) => {
                    emit(
                        &read_app,
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "error".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(status.code() as i32),
                            status_message: Some(status.message().to_string()),
                            headers: None,
                            trailers: None,
                        },
                    );
                    emit(
                        &read_app,
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "close".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(status.code() as i32),
                            status_message: Some(status.message().to_string()),
                            headers: None,
                            trailers: None,
                        },
                    );
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
        GrpcStreamEventPayload {
            tab_id: tab_id.clone(),
            event_type: "open".to_string(),
            full_method: full_method.clone(),
            message: None,
            status: None,
            status_message: None,
            headers: Some(headers),
            trailers: None,
        },
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
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "message".to_string(),
                            full_method: read_full_method.clone(),
                            message: Some(data),
                            status: None,
                            status_message: None,
                            headers: None,
                            trailers: None,
                        },
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
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "close".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(0),
                            status_message: Some("OK".to_string()),
                            headers: None,
                            trailers,
                        },
                    );
                    break;
                }
                Err(status) => {
                    emit(
                        &read_app,
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "error".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(status.code() as i32),
                            status_message: Some(status.message().to_string()),
                            headers: None,
                            trailers: None,
                        },
                    );
                    emit(
                        &read_app,
                        GrpcStreamEventPayload {
                            tab_id: read_tab_id.clone(),
                            event_type: "close".to_string(),
                            full_method: read_full_method.clone(),
                            message: None,
                            status: Some(status.code() as i32),
                            status_message: Some(status.message().to_string()),
                            headers: None,
                            trailers: None,
                        },
                    );
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
                GrpcStreamEventPayload {
                    tab_id,
                    event_type: "close".to_string(),
                    full_method,
                    message: None,
                    status: Some(tonic::Code::Cancelled as i32),
                    status_message: Some("cancelled".to_string()),
                    headers: None,
                    trailers: None,
                },
            );
        }
    }
    Ok(GrpcStreamCommandResponse { success: true })
}
