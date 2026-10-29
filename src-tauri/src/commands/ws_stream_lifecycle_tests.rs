use super::super::websocket::WEBSOCKET_CHANNEL;
use super::*;
use serde_json::Value;
use tauri::Listener;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

struct Client {
    app: tauri::App<tauri::test::MockRuntime>,
    connections: WsConnections,
    events: mpsc::UnboundedReceiver<Value>,
}

impl Client {
    fn new() -> Self {
        let app = tauri::test::mock_app();
        let (tx, events) = mpsc::unbounded_channel();
        app.listen(WEBSOCKET_CHANNEL.event_name, move |event| {
            let _ = tx.send(serde_json::from_str(event.payload()).unwrap());
        });
        Self {
            app,
            connections: WsConnections::default(),
            events,
        }
    }

    async fn connect(&self, request: WsConnectRequest) {
        self.connect_with_proxy(request, &ProxySettings::default())
            .await;
    }

    async fn connect_with_proxy(&self, request: WsConnectRequest, proxy: &ProxySettings) {
        let ack = timeout(
            Duration::from_secs(2),
            connect(
                self.app.handle().clone(),
                &WEBSOCKET_CHANNEL,
                &self.connections,
                proxy,
                request,
            ),
        )
        .await
        .expect("Connect must acknowledge before the handshake finishes")
        .unwrap();
        assert!(ack.success);
    }

    async fn next(&mut self) -> Value {
        timeout(Duration::from_secs(8), self.events.recv())
            .await
            .expect("expected lifecycle event before deadline")
            .expect("event channel closed")
    }

    async fn expect_event(&mut self, kind: &str, id: &str) -> Value {
        let event = self.next().await;
        assert_eq!(event["eventType"], kind, "unexpected event: {event}");
        assert_eq!(
            event["connectionId"], id,
            "event belongs to another attempt"
        );
        event
    }

    async fn send(&self, id: &str, message: &str) -> Result<CommandAck, String> {
        send_message(
            &self.connections,
            WsMessageRequest {
                tab_id: "tab-1".into(),
                connection_id: id.into(),
                message: message.into(),
            },
        )
        .await
    }

    async fn close(&self, id: &str) {
        close_matching(&self.connections, "tab-1".into(), Some(id))
            .await
            .unwrap();
    }

    async fn assert_removed(&self) {
        assert!(
            self.connections.lock().await.is_empty(),
            "terminal event must release the registry entry"
        );
    }
}

fn request(url: &str, id: &str, timeout_ms: Option<u64>) -> WsConnectRequest {
    WsConnectRequest {
        options: WsSendRequest {
            tab_id: "tab-1".into(),
            url: url.into(),
            headers: None,
            protocols: None,
            message: None,
            verify_ssl: None,
            client_cert: None,
        },
        connection_id: id.into(),
        connect_timeout_ms: timeout_ms,
    }
}

async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/socket", listener.local_addr().unwrap());
    (listener, url)
}

async fn echo(socket: TcpStream, received: mpsc::UnboundedSender<String>) {
    let mut socket = tokio_tungstenite::accept_async(socket).await.unwrap();
    while let Some(Ok(message)) = socket.next().await {
        match message {
            Message::Text(text) => {
                let _ = received.send(text.to_string());
                if socket.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => {
                let _ = socket.flush().await;
                break;
            }
            _ => {}
        }
    }
}

/// Accepts one socket, records the offered `Sec-WebSocket-Protocol` header and
/// answers with `chosen` when it is `Some`.
async fn negotiating_echo(
    socket: TcpStream,
    chosen: Option<&'static str>,
    offered: mpsc::UnboundedSender<Option<String>>,
) {
    use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
    #[allow(clippy::result_large_err)]
    let callback = move |request: &Request, mut response: Response| {
        let _ = offered.send(
            request
                .headers()
                .get("Sec-WebSocket-Protocol")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string),
        );
        if let Some(chosen) = chosen {
            response
                .headers_mut()
                .insert("Sec-WebSocket-Protocol", chosen.parse().unwrap());
        }
        Ok(response)
    };
    let Ok(mut socket) = tokio_tungstenite::accept_hdr_async(socket, callback).await else {
        return;
    };
    while let Some(Ok(message)) = socket.next().await {
        if message.is_close() {
            let _ = socket.flush().await;
            break;
        }
    }
}

#[tokio::test]
async fn a_requested_subprotocol_is_offered_in_order_and_the_servers_choice_is_reported() {
    let (listener, url) = listener().await;
    let (tx, mut offered) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        negotiating_echo(listener.accept().await.unwrap().0, Some("superchat"), tx).await;
    });
    let mut client = Client::new();
    let mut options = request(&url, "one", Some(2000));
    options.options.protocols = Some(vec!["chat".into(), "superchat".into()]);
    client.connect(options).await;
    let event = client.expect_event("open", "one").await;
    assert_eq!(event["protocol"], "superchat");
    assert_eq!(
        offered.recv().await.unwrap().as_deref(),
        Some("chat, superchat")
    );
    client.close("one").await;
    client.expect_event("close", "one").await;
}

#[tokio::test]
async fn a_server_that_ignores_the_offered_subprotocols_fails_the_handshake() {
    let (listener, url) = listener().await;
    let (tx, _offered) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        negotiating_echo(listener.accept().await.unwrap().0, None, tx).await;
    });
    let mut client = Client::new();
    let mut options = request(&url, "one", Some(2000));
    options.options.protocols = Some(vec!["chat".into()]);
    client.connect(options).await;
    let event = client.expect_event("error", "one").await;
    let message = event["message"].as_str().unwrap();
    assert!(
        message.to_lowercase().contains("protocol"),
        "unexpected error: {message}"
    );
    client.assert_removed().await;
}

#[tokio::test]
async fn without_a_protocol_list_no_subprotocol_is_offered_and_a_header_row_still_passes_through() {
    let (first, first_url) = listener().await;
    let (tx, mut offered) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        negotiating_echo(first.accept().await.unwrap().0, None, tx).await;
    });
    let mut client = Client::new();
    client.connect(request(&first_url, "one", Some(2000))).await;
    let event = client.expect_event("open", "one").await;
    assert!(event.get("protocol").is_none());
    assert_eq!(offered.recv().await.unwrap(), None);
    client.close("one").await;
    client.expect_event("close", "one").await;

    let (second, second_url) = listener().await;
    let (tx, mut offered) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        negotiating_echo(second.accept().await.unwrap().0, Some("chat"), tx).await;
    });
    let mut options = request(&second_url, "two", Some(2000));
    options.options.headers = Some(HashMap::from([(
        "Sec-WebSocket-Protocol".to_string(),
        "chat".to_string(),
    )]));
    client.connect(options).await;
    let event = client.expect_event("open", "two").await;
    assert_eq!(event["protocol"], "chat");
    assert_eq!(offered.recv().await.unwrap().as_deref(), Some("chat"));
    client.close("two").await;
    client.expect_event("close", "two").await;
}

#[tokio::test]
async fn connect_never_sends_the_composer_and_send_preserves_empty_text() {
    let (listener, url) = listener().await;
    let (tx, mut received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        echo(listener.accept().await.unwrap().0, tx).await;
    });
    let mut client = Client::new();
    let mut options = request(&url, "one", Some(2000));
    options.options.message = Some("existing composer content".into());
    client.connect(options).await;
    client.expect_event("open", "one").await;
    assert!(
        timeout(Duration::from_millis(75), received.recv())
            .await
            .is_err(),
        "Connect transmitted the composer"
    );

    for message in ["", "hello"] {
        client.send("one", message).await.unwrap();
        assert_eq!(
            timeout(Duration::from_secs(2), received.recv())
                .await
                .unwrap()
                .unwrap(),
            message
        );
        let event = client.expect_event("message", "one").await;
        assert_eq!(event["message"], message);
    }
    client.close("one").await;
    assert_eq!(client.expect_event("close", "one").await["code"], 1000);
    client.assert_removed().await;
}

#[tokio::test]
async fn peer_close_preserves_normal_custom_and_absent_status_codes() {
    for (frame, expected_code, expected_reason) in [
        (
            Some(CloseFrame {
                code: CloseCode::Normal,
                reason: "Normal completion".into(),
            }),
            1000,
            "Normal completion",
        ),
        (
            Some(CloseFrame {
                code: CloseCode::Library(4001),
                reason: "Session expired".into(),
            }),
            4001,
            "Session expired",
        ),
        (None, 1005, ""),
    ] {
        let (listener, url) = listener().await;
        tokio::spawn(async move {
            let mut socket = tokio_tungstenite::accept_async(listener.accept().await.unwrap().0)
                .await
                .unwrap();
            socket.send(Message::Close(frame)).await.unwrap();
            let _ = socket.next().await;
        });
        let mut client = Client::new();
        client.connect(request(&url, "one", Some(2000))).await;
        client.expect_event("open", "one").await;
        let event = client.expect_event("close", "one").await;
        assert_eq!(event["code"], expected_code);
        assert_eq!(event["reason"], expected_reason);
        client.assert_removed().await;
    }
}

#[tokio::test]
async fn abrupt_tcp_loss_reports_abnormal_close_and_releases_the_session() {
    let (listener, url) = listener().await;
    tokio::spawn(async move {
        let socket = tokio_tungstenite::accept_async(listener.accept().await.unwrap().0)
            .await
            .unwrap();
        drop(socket);
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", Some(2000))).await;
    client.expect_event("open", "one").await;
    client.expect_event("error", "one").await;
    assert_eq!(client.expect_event("close", "one").await["code"], 1006);
    client.assert_removed().await;
}

#[tokio::test]
async fn an_open_socket_outlives_its_handshake_deadline() {
    let (listener, url) = listener().await;
    let (tx, mut received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        echo(listener.accept().await.unwrap().0, tx).await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", Some(100))).await;
    client.expect_event("open", "one").await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    client.send("one", "still connected").await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), received.recv())
            .await
            .unwrap()
            .unwrap(),
        "still connected"
    );
    client.expect_event("message", "one").await;
    client.close("one").await;
    client.expect_event("close", "one").await;
    client.assert_removed().await;
}

#[tokio::test]
async fn a_stalled_handshake_times_out_and_cannot_register_a_live_socket() {
    let (listener, url) = listener().await;
    let (accepted, started) = oneshot::channel();
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let _ = accepted.send(());
        let _socket = socket;
        std::future::pending::<()>().await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", Some(100))).await;
    timeout(Duration::from_secs(2), started)
        .await
        .unwrap()
        .unwrap();
    let event = client.expect_event("error", "one").await;
    assert!(event["message"].as_str().unwrap().contains("timed out"));
    assert!(
        event.get("code").is_none(),
        "a failed handshake has no close code"
    );
    client.assert_removed().await;
    assert!(
        timeout(Duration::from_millis(50), client.events.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn cancelling_a_pending_handshake_emits_cancelled_without_open_or_error() {
    let (listener, url) = listener().await;
    let (accepted, started) = oneshot::channel();
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let _ = accepted.send(());
        let _socket = socket;
        std::future::pending::<()>().await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", Some(2000))).await;
    timeout(Duration::from_secs(2), started)
        .await
        .unwrap()
        .unwrap();
    assert!(
        client
            .send("one", "must not send before open")
            .await
            .is_err()
    );
    client.close("one").await;
    client.expect_event("cancelled", "one").await;
    client.assert_removed().await;
    assert!(
        timeout(Duration::from_millis(50), client.events.recv())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn an_unlimited_deadline_stays_pending_until_explicit_cancellation() {
    let (listener, url) = listener().await;
    tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        let _socket = socket;
        std::future::pending::<()>().await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", None)).await;
    assert!(
        timeout(Duration::from_millis(150), client.events.recv())
            .await
            .is_err()
    );
    assert!(!client.connections.lock().await["tab-1"].value.open);
    client.close("one").await;
    client.expect_event("cancelled", "one").await;
    client.assert_removed().await;
}

#[tokio::test]
async fn a_stalled_proxy_negotiation_is_covered_by_the_handshake_deadline() {
    let (proxy_listener, _) = listener().await;
    let proxy = ProxySettings {
        enabled: true,
        host: "127.0.0.1".into(),
        port: proxy_listener.local_addr().unwrap().port(),
        ..ProxySettings::default()
    };
    let (accepted, started) = oneshot::channel();
    tokio::spawn(async move {
        let (socket, _) = proxy_listener.accept().await.unwrap();
        let _ = accepted.send(());
        let _socket = socket;
        std::future::pending::<()>().await;
    });
    let mut client = Client::new();
    client
        .connect_with_proxy(
            request("ws://upstream.test/socket", "one", Some(100)),
            &proxy,
        )
        .await;
    timeout(Duration::from_secs(2), started)
        .await
        .unwrap()
        .unwrap();
    assert!(
        client.expect_event("error", "one").await["message"]
            .as_str()
            .unwrap()
            .contains("timed out")
    );
    client.assert_removed().await;
}

#[tokio::test]
async fn send_requires_an_open_matching_identity_and_old_close_cannot_stop_its_successor() {
    let (listener, url) = listener().await;
    let (tx, mut received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        echo(listener.accept().await.unwrap().0, tx).await;
    });
    let mut client = Client::new();
    assert!(client.send("old", "hello").await.is_err());
    client.connect(request(&url, "new", Some(2000))).await;
    client.expect_event("open", "new").await;
    assert!(client.send("old", "must not send").await.is_err());
    client.close("old").await;
    assert!(client.connections.lock().await["tab-1"].value.open);
    client.send("new", "still connected").await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), received.recv())
            .await
            .unwrap()
            .unwrap(),
        "still connected"
    );
    client.expect_event("message", "new").await;
    client.close("new").await;
    client.expect_event("close", "new").await;
    client.assert_removed().await;
}

#[tokio::test]
async fn replacing_a_pending_attempt_suppresses_its_late_open_and_error() {
    let (listener, url) = listener().await;
    let (first_accepted, started) = oneshot::channel();
    let (tx, _received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let (first, _) = listener.accept().await.unwrap();
        let _ = first_accepted.send(());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            let _ = tokio_tungstenite::accept_async(first).await;
        });
        echo(listener.accept().await.unwrap().0, tx).await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "old", Some(2000))).await;
    timeout(Duration::from_secs(2), started)
        .await
        .unwrap()
        .unwrap();
    client.connect(request(&url, "new", Some(2000))).await;
    client.expect_event("open", "new").await;
    assert!(
        timeout(Duration::from_millis(150), client.events.recv())
            .await
            .is_err()
    );
    assert_eq!(
        client.connections.lock().await["tab-1"]
            .value
            .connection_id
            .as_deref(),
        Some("new")
    );
    client.close("new").await;
    client.expect_event("close", "new").await;
    client.assert_removed().await;
}

#[tokio::test]
async fn replacing_an_open_socket_suppresses_its_late_messages_and_close() {
    let (listener, url) = listener().await;
    let (release, ready) = oneshot::channel();
    let (tx, mut received) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let first = listener.accept().await.unwrap().0;
        tokio::spawn(async move {
            let mut socket = tokio_tungstenite::accept_async(first).await.unwrap();
            let _ = ready.await;
            let _ = socket.send(Message::text("stale message")).await;
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: CloseCode::Library(4001),
                    reason: "old session".into(),
                })))
                .await;
            let _ = socket.next().await;
        });
        echo(listener.accept().await.unwrap().0, tx).await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "old", Some(2000))).await;
    client.expect_event("open", "old").await;
    client.connect(request(&url, "new", Some(2000))).await;
    client.expect_event("open", "new").await;
    let _ = release.send(());
    client.send("new", "successor message").await.unwrap();
    assert_eq!(
        timeout(Duration::from_secs(2), received.recv())
            .await
            .unwrap()
            .unwrap(),
        "successor message"
    );
    assert_eq!(
        client.expect_event("message", "new").await["message"],
        "successor message"
    );
    assert!(
        timeout(Duration::from_millis(100), client.events.recv())
            .await
            .is_err()
    );
    client.close("new").await;
    client.expect_event("close", "new").await;
    client.assert_removed().await;
}

#[tokio::test]
async fn an_unresponsive_peer_is_forcibly_released_after_the_close_deadline() {
    let (listener, url) = listener().await;
    tokio::spawn(async move {
        let socket = tokio_tungstenite::accept_async(listener.accept().await.unwrap().0)
            .await
            .unwrap();
        let _socket = socket;
        std::future::pending::<()>().await;
    });
    let mut client = Client::new();
    client.connect(request(&url, "one", Some(2000))).await;
    client.expect_event("open", "one").await;
    let started = tokio::time::Instant::now();
    client.close("one").await;
    let error = client.expect_event("error", "one").await;
    assert!(started.elapsed() >= CLOSE_TIMEOUT);
    assert!(error["message"].as_str().unwrap().contains("timed out"));
    let event = client.expect_event("close", "one").await;
    assert_eq!(event["code"], 1006);
    client.assert_removed().await;
}

#[test]
fn omitted_timeout_defaults_to_thirty_seconds_and_null_disables_it() {
    let base = serde_json::json!({ "tabId": "tab-1", "connectionId": "one", "url": "ws://localhost/socket" });
    let request: WsConnectRequest = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(request.connect_timeout_ms, Some(30_000));
    let request: WsConnectRequest = serde_json::from_value(serde_json::json!({
        "connectTimeoutMs": null, "tabId": "tab-1", "connectionId": "one", "url": "ws://localhost/socket"
    })).unwrap();
    assert_eq!(request.connect_timeout_ms, None);
}
