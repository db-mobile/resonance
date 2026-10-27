use super::*;
use axum::{Router, extract::Request, routing::any};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::time::timeout;

#[tokio::test]
async fn get_replays_json_and_text_bodies_when_the_stream_reconnects() {
    for (body, content_type) in [
        (r#"{"id":7}"#, "application/json"),
        (" Grüße 7\n", "text/plain"),
    ] {
        let (tx, mut received) = mpsc::unbounded_channel();
        let router = Router::new().fallback(any(move |request: Request| {
            let tx = tx.clone();
            async move {
                let method = request.method().to_string();
                let headers = request.headers().clone();
                let bytes = axum::body::to_bytes(request.into_body(), 1024)
                    .await
                    .unwrap();
                tx.send(json!({"method":method,
                    "body":String::from_utf8(bytes.to_vec()).unwrap(),
                    "contentType":headers["content-type"].to_str().unwrap(),
                    "lastEventId":headers.get("last-event-id").map(|v|v.to_str().unwrap())
                }))
                .unwrap();
                (
                    [("content-type", "text/event-stream")],
                    "id: 42\nretry: 250\ndata: ready\n\n",
                )
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = StreamTarget {
            tab_id: "body-test".into(),
            url: format!("http://{}/events", listener.local_addr().unwrap()),
            method: Method::GET,
            body: Some(body.into()),
            headers: HashMap::from([("Content-Type".into(), content_type.into())]),
            last_event_id: None,
        };
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let request =
            serde_json::from_value(json!({"tabId":"body-test","url":target.url})).unwrap();
        let client = build_sse_client(&request, ProxyAction::Disable).unwrap();
        let (shutdown, mut cancelled) = oneshot::channel();
        let stream =
            tokio::spawn(
                async move { stream_loop(&handle, &client, &target, &mut cancelled).await },
            );
        for last_event_id in [None, Some("42")] {
            let request = timeout(Duration::from_secs(5), received.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                request,
                json!({"method":"GET","body":body,
                "contentType":content_type,"lastEventId":last_event_id})
            );
        }
        shutdown.send(()).unwrap();
        timeout(Duration::from_secs(2), stream)
            .await
            .unwrap()
            .unwrap();
        server.abort();
    }
}
