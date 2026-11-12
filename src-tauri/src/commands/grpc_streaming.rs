use std::collections::HashMap;

use http::uri::PathAndQuery;
use prost_reflect::{DescriptorPool, DynamicMessage, MessageDescriptor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::pin::Pin;

use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;
use tokio::task::AbortHandle;
use tokio_stream::wrappers::UnboundedReceiverStream;
use tonic::Request;
use tonic::codec::Streaming;

use super::grpc_proto::ProtoState;
use super::grpc_reflection::{
    DynamicMessageCodec, GrpcTlsOptions, apply_metadata, build_descriptor_pool_for_method_with_tls,
    create_channel, dynamic_message_to_json, json_to_dynamic_message, metadata_to_json_map,
    normalize_target_with_tls, resolve_method,
};
use super::tab_sessions::{CommandAck, Session, TabSessions, require_tab_id};

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

/// A live call. The spawned task removes the entry itself when the call ends,
/// and only while its generation still owns the tab.
struct GrpcStreamHandle {
    sender: Option<mpsc::UnboundedSender<DynamicMessage>>,
    input_desc: MessageDescriptor,
    full_method: String,
    abort: AbortHandle,
    /// Client-streaming-only: cancel half-closes (drops the sender) so the
    /// server can still send its single reply, instead of aborting the task.
    client_streaming_only: bool,
}

#[derive(Default)]
pub struct GrpcStreamingState {
    streams: TabSessions<GrpcStreamHandle>,
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

    /// Sent before the server has answered, so it carries no headers; they
    /// arrive with the first message instead.
    fn open(tab_id: &str, full_method: &str) -> Self {
        Self::new(tab_id, full_method, "open")
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

fn emit<R: Runtime>(app: &AppHandle<R>, payload: GrpcStreamEventPayload) {
    let _ = app.emit("grpc-stream-event", payload);
}

/// A failed stream reports its status twice: as `error` so the UI can surface
/// it, then as `close` so the stream is torn down like any other. Both carry
/// the same code and message.
fn emit_error_and_close<R: Runtime>(
    app: &AppHandle<R>,
    tab_id: &str,
    full_method: &str,
    status: &tonic::Status,
) {
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

/// The request side of a client- or bidi-streaming call, with the optional
/// initial message already queued.
fn client_request_stream(
    initial: Option<&Value>,
    input_desc: &MessageDescriptor,
    metadata: HashMap<String, String>,
) -> Result<
    (
        mpsc::UnboundedSender<DynamicMessage>,
        Request<UnboundedReceiverStream<DynamicMessage>>,
    ),
    String,
> {
    let (tx, rx) = mpsc::unbounded_channel::<DynamicMessage>();
    if let Some(initial) = initial {
        let _ = tx.send(json_to_dynamic_message(initial, input_desc.clone())?);
    }
    let mut req = Request::new(UnboundedReceiverStream::new(rx));
    apply_metadata(&mut req, metadata)?;
    Ok((tx, req))
}

/// Spawns `call` and registers it under the tab. The lock is held across
/// spawn + insert so a call that ends at once still finds its entry, and the
/// task only removes that entry while its generation still owns the tab.
async fn register_call(
    streams: &TabSessions<GrpcStreamHandle>,
    tab_id: String,
    call: impl Future<Output = ()> + Send + 'static,
    handle: impl FnOnce(AbortHandle) -> GrpcStreamHandle,
) {
    let generation = streams.next_generation();
    let mut entries = streams.lock().await;
    let own_streams = streams.clone();
    let own_tab_id = tab_id.clone();
    let join = tokio::spawn(async move {
        call.await;
        own_streams.remove_if_current(&own_tab_id, generation).await;
    });
    entries.insert(
        tab_id,
        Session {
            generation,
            value: handle(join.abort_handle()),
        },
    );
}

#[tauri::command]
pub async fn grpc_stream_start(
    app: AppHandle,
    state: State<'_, GrpcStreamingState>,
    proto_state: State<'_, ProtoState>,
    request: GrpcStreamRequest,
) -> Result<CommandAck, String> {
    require_tab_id(&request.tab_id)?;

    // Close any existing stream for this tab before opening a new one,
    // including a half-closed client stream still awaiting its reply.
    if let Some(previous) = state.streams.lock().await.remove(&request.tab_id) {
        previous.value.abort.abort();
    }

    let target = normalize_target_with_tls(&request.target, request.tls.use_tls);

    let pool: DescriptorPool = if let Some(proto_path) = &request.proto_path {
        proto_state.pool(proto_path)?
    } else {
        build_descriptor_pool_for_method_with_tls(&target, &request.full_method, &request.tls)
            .await?
    };

    start_stream(app, &state.streams, &pool, &target, request).await
}

/// A server- or bidi-streaming call once it is under way: forwards each reply
/// and ends with `close`, or reports the status the call failed with.
async fn forward_responses<R: Runtime>(
    app: &AppHandle<R>,
    tab_id: &str,
    full_method: &str,
    started: Result<tonic::Response<Streaming<DynamicMessage>>, tonic::Status>,
) {
    let response = match started {
        Ok(response) => response,
        Err(status) => {
            emit_error_and_close(app, tab_id, full_method, &status);
            return;
        }
    };
    let mut headers = Some(metadata_to_json_map(response.metadata()));
    let mut response_stream = response.into_inner();
    loop {
        match response_stream.message().await {
            Ok(Some(msg)) => {
                let data = dynamic_message_to_json(&msg).unwrap_or(Value::Null);
                emit(
                    app,
                    GrpcStreamEventPayload::message(tab_id, full_method, data, headers.take()),
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
                    app,
                    GrpcStreamEventPayload::close_ok(tab_id, full_method, trailers),
                );
                break;
            }
            Err(status) => {
                emit_error_and_close(app, tab_id, full_method, &status);
                break;
            }
        }
    }
}

/// Opens a streaming call and registers it under the tab before anything
/// waits on the server. Servers may hold back their response headers until
/// they have read more input, so awaiting the call here would leave it
/// unregistered: unreachable for send and cancel, and never `open` in the UI.
async fn start_stream<R: Runtime>(
    app: AppHandle<R>,
    streams: &TabSessions<GrpcStreamHandle>,
    pool: &DescriptorPool,
    target: &str,
    request: GrpcStreamRequest,
) -> Result<CommandAck, String> {
    let method = resolve_method(pool, &request.full_method)?;
    let is_client_streaming = method.is_client_streaming();
    let is_server_streaming = method.is_server_streaming();

    if !is_server_streaming && !is_client_streaming {
        return Err("Use grpc_invoke_unary for unary methods".to_string());
    }

    let input_desc = method.input();
    let output_desc = method.output();

    let channel = create_channel(target, &request.tls).await?;
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
        let (tx, req) =
            client_request_stream(request.request_json.as_ref(), &input_desc, metadata)?;

        emit(&app, GrpcStreamEventPayload::open(&tab_id, &full_method));

        let call = {
            let app = app.clone();
            let tab_id = tab_id.clone();
            let full_method = full_method.clone();
            async move {
                match grpc.client_streaming(req, path, codec).await {
                    Ok(response) => {
                        let headers = metadata_to_json_map(response.metadata());
                        let msg = response.into_inner();
                        let data = dynamic_message_to_json(&msg).unwrap_or(Value::Null);
                        emit(
                            &app,
                            GrpcStreamEventPayload::message(
                                &tab_id,
                                &full_method,
                                data,
                                Some(headers),
                            ),
                        );
                        emit(
                            &app,
                            GrpcStreamEventPayload::close_ok(&tab_id, &full_method, None),
                        );
                    }
                    Err(status) => {
                        emit_error_and_close(&app, &tab_id, &full_method, &status);
                    }
                }
            }
        };

        register_call(streams, tab_id, call, |abort| GrpcStreamHandle {
            sender: Some(tx),
            input_desc,
            full_method,
            abort,
            client_streaming_only: true,
        })
        .await;
        return Ok(CommandAck::ok());
    }

    let (sender_opt, started): (Option<_>, Pin<Box<dyn Future<Output = _> + Send>>) =
        if is_client_streaming {
            let (tx, req) =
                client_request_stream(request.request_json.as_ref(), &input_desc, metadata)?;
            (
                Some(tx),
                Box::pin(async move { grpc.streaming(req, path, codec).await }),
            )
        } else {
            let initial_json = request
                .request_json
                .clone()
                .unwrap_or_else(|| Value::Object(Default::default()));
            let initial = json_to_dynamic_message(&initial_json, input_desc.clone())?;
            let mut req = Request::new(initial);
            apply_metadata(&mut req, metadata)?;
            (
                None,
                Box::pin(async move { grpc.server_streaming(req, path, codec).await }),
            )
        };

    let call = {
        let tab_id = tab_id.clone();
        let full_method = full_method.clone();
        async move {
            emit(&app, GrpcStreamEventPayload::open(&tab_id, &full_method));
            forward_responses(&app, &tab_id, &full_method, started.await).await;
        }
    };

    register_call(streams, tab_id, call, |abort| GrpcStreamHandle {
        sender: sender_opt,
        input_desc,
        full_method,
        abort,
        client_streaming_only: false,
    })
    .await;

    Ok(CommandAck::ok())
}

#[tauri::command]
pub async fn grpc_stream_send(
    state: State<'_, GrpcStreamingState>,
    tab_id: String,
    message_json: Value,
) -> Result<CommandAck, String> {
    require_tab_id(&tab_id)?;
    let streams = state.streams.lock().await;
    let handle = &streams
        .get(&tab_id)
        .ok_or_else(|| "No active gRPC stream for this tab".to_string())?
        .value;
    let sender = handle
        .sender
        .as_ref()
        .ok_or_else(|| "This stream does not accept additional client messages".to_string())?;
    let msg = json_to_dynamic_message(&message_json, handle.input_desc.clone())?;
    sender
        .send(msg)
        .map_err(|_| "Failed to send: stream is closed".to_string())?;
    Ok(CommandAck::ok())
}

#[tauri::command]
pub async fn grpc_stream_cancel(
    app: AppHandle,
    state: State<'_, GrpcStreamingState>,
    tab_id: String,
) -> Result<CommandAck, String> {
    require_tab_id(&tab_id)?;
    cancel_stream(&app, &state.streams, &tab_id).await;
    Ok(CommandAck::ok())
}

async fn cancel_stream<R: Runtime>(
    app: &AppHandle<R>,
    streams: &TabSessions<GrpcStreamHandle>,
    tab_id: &str,
) {
    let mut streams = streams.lock().await;
    let Some(session) = streams.get_mut(tab_id) else {
        return;
    };

    // A client-streaming-only call stays registered, half-closed: its task
    // awaits the server's single reply, emits it, and removes itself.
    if session.value.client_streaming_only {
        session.value.sender = None;
        return;
    }

    if let Some(session) = streams.remove(tab_id) {
        session.value.abort.abort();
        emit(
            app,
            GrpcStreamEventPayload::close(
                tab_id,
                &session.value.full_method,
                tonic::Code::Cancelled as i32,
                "cancelled".to_string(),
            ),
        );
    }
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
        let open = json(GrpcStreamEventPayload::open("tab-1", "/pkg.Svc/Method"));
        assert_eq!(open["tabId"], "tab-1");
        assert_eq!(open["eventType"], "open");
        assert_eq!(open["fullMethod"], "/pkg.Svc/Method");
        assert!(open.get("headers").is_none());
        assert!(open.get("status").is_none());

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
    /// A server that completes the HTTP/2 handshake and then never answers:
    /// it sends its SETTINGS and only reads, the way a server holding back its
    /// response headers until it has more input looks to the client.
    async fn silent_server() -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    let _ = socket.write_all(&[0, 0, 0, 4, 0, 0, 0, 0, 0]).await;
                    let mut buf = [0u8; 4096];
                    while matches!(socket.read(&mut buf).await, Ok(n) if n > 0) {}
                });
            }
        });
        format!("http://{addr}")
    }

    fn chat_pool() -> (tempfile::TempDir, DescriptorPool) {
        let dir = tempfile::TempDir::new().unwrap();
        let proto = dir.path().join("chat.proto");
        std::fs::write(
            &proto,
            "syntax = \"proto3\";\npackage chat;\nmessage Msg { string text = 1; }\n\
             service Chat {\n  rpc Talk (stream Msg) returns (stream Msg);\n  rpc Watch (Msg) returns (stream Msg);\n}\n",
        )
        .unwrap();
        let pool = crate::commands::grpc_proto::protox_parse::parse_proto_file(
            proto.to_str().unwrap(),
            &[dir.path().to_path_buf()],
        )
        .unwrap();
        (dir, pool)
    }

    #[tokio::test]
    async fn a_stream_is_open_sendable_and_cancellable_before_the_server_answers() {
        use tauri::Listener;
        use tokio::time::{Duration, timeout};

        let target = silent_server().await;
        let (_dir, pool) = chat_pool();
        for method in ["/chat.Chat/Talk", "/chat.Chat/Watch"] {
            let app = tauri::test::mock_app();
            let (tx, mut events) = mpsc::unbounded_channel::<Value>();
            app.listen("grpc-stream-event", move |event| {
                let _ = tx.send(serde_json::from_str(event.payload()).unwrap());
            });
            let state = GrpcStreamingState::default();
            let request: GrpcStreamRequest = serde_json::from_value(serde_json::json!({
                "tabId": "t1",
                "target": target,
                "fullMethod": method,
                "requestJson": { "text": "hello" }
            }))
            .unwrap();

            let started = timeout(
                Duration::from_secs(5),
                start_stream(
                    app.handle().clone(),
                    &state.streams,
                    &pool,
                    &target,
                    request,
                ),
            )
            .await;
            assert!(
                started.expect("start must not wait for the server").is_ok(),
                "{method}"
            );

            let open = timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(open["eventType"], "open", "{method}");
            {
                let streams = state.streams.lock().await;
                let handle = &streams.get("t1").expect("registered").value;
                if method.ends_with("Talk") {
                    let msg = json_to_dynamic_message(
                        &serde_json::json!({ "text": "more" }),
                        handle.input_desc.clone(),
                    )
                    .unwrap();
                    assert!(handle.sender.as_ref().unwrap().send(msg).is_ok());
                }
            }

            cancel_stream(app.handle(), &state.streams, "t1").await;

            let closed = timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(closed["eventType"], "close", "{method}");
            assert_eq!(closed["status"], tonic::Code::Cancelled as i32);
            assert!(state.streams.lock().await.get("t1").is_none());
        }
    }

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
